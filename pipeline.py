import json
import os
import re
from urllib.parse import parse_qs, unquote_plus, urlparse
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import requests


def load_dotenv_file(dotenv_path: str) -> None:
    if not os.path.exists(dotenv_path):
        return

    with open(dotenv_path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()

            if not key or key in os.environ:
                continue

            if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                value = value[1:-1]

            os.environ[key] = value


load_dotenv_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


SOURCE_AUTHORITY = {
    "google_maps": 4,
    "reddit": 3,
    "competitor_url": 1,
}


ALLOWED_MARKET_STATUS = {"Growth", "Stagnant", "Volatile"}


@dataclass
class Cafe:
    name: str
    focus: str
    kind: str  # "target" or "competition"


@dataclass
class Signal:
    source: str
    cafe: str
    kind: str
    summary: str
    impact: int
    confidence: float
    happened_at: Optional[datetime] = None


@dataclass
class GoogleLookupResult:
    api_status: str
    via: str
    query: str
    name: Optional[str] = None
    place_id: Optional[str] = None
    rating: Optional[float] = None
    reviews_count: Optional[int] = None
    http_status: Optional[int] = None
    error_message: Optional[str] = None


class SourceStats:
    def __init__(self) -> None:
        self.success = 0
        self.fail = 0

    def mark_success(self) -> None:
        self.success += 1

    def mark_fail(self) -> None:
        self.fail += 1

    @property
    def total(self) -> int:
        return self.success + self.fail

    @property
    def failure_ratio(self) -> float:
        if self.total == 0:
            return 0.0
        return self.fail / self.total


def parse_plan(plan_path: str) -> Tuple[datetime, str, List[Cafe], List[Cafe]]:
    with open(plan_path, "r", encoding="utf-8") as f:
        content = f.read().splitlines()

    last_scan_date = None
    location_focus = ""
    targets: List[Cafe] = []
    competition: List[Cafe] = []
    current_section = None

    for line in content:
        stripped = line.strip()
        if stripped.startswith("- last_scan_date:"):
            value = stripped.split(":", 1)[1].strip()
            last_scan_date = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            continue

        if stripped.startswith("- location_focus:"):
            location_focus = stripped.split(":", 1)[1].strip()
            continue

        if stripped.startswith("## Targets"):
            current_section = "targets"
            continue
        if stripped.startswith("## Competition"):
            current_section = "competition"
            continue
        if stripped.startswith("## ") and not stripped.startswith("## Targets") and not stripped.startswith("## Competition"):
            current_section = None
            continue

        if stripped.startswith("- ") and current_section in {"targets", "competition"}:
            # Format: - Name: Focus text
            text = stripped[2:]
            if ":" in text:
                name, focus = text.split(":", 1)
                name = name.strip()
                focus = focus.strip()
            else:
                name, focus = text.strip(), ""
            cafe = Cafe(name=name, focus=focus, kind="target" if current_section == "targets" else "competition")
            if current_section == "targets":
                targets.append(cafe)
            else:
                competition.append(cafe)

    if not last_scan_date:
        raise ValueError("Missing `last_scan_date` in PLAN.md")
    if not location_focus:
        raise ValueError("Missing `location_focus` in PLAN.md")
    if not targets or not competition:
        raise ValueError("PLAN.md must include both Targets and Competition sections")
    return last_scan_date, location_focus, targets, competition


def score_confidence_from_text(text: str) -> float:
    # Conservative heuristic so low-quality matches are filtered out.
    length_bonus = min(len(text) / 200.0, 2.0)
    keyword_bonus = 0.0
    for word in ["wait", "price", "slow", "complaint", "queue", "special", "deal", "service"]:
        if re.search(rf"\b{re.escape(word)}\b", text.lower()):
            keyword_bonus += 0.7
    return min(10.0, 5.0 + length_bonus + keyword_bonus)


def normalize_impact(text: str) -> int:
    lower = text.lower()
    if any(w in lower for w in ["terrible", "awful", "never again", "too long", "very slow"]):
        return 9
    if any(w in lower for w in ["slow", "overpriced", "crowded", "cold food", "rude"]):
        return 7
    if any(w in lower for w in ["good", "great", "popular", "busy"]):
        return 5
    return 4


GOOGLE_POSITIVE_REVIEW_PATTERNS = {
    "friendly staff": [r"\bfriendly\b", r"\bwelcoming\b", r"\blovely staff\b", r"\bgreat service\b"],
    "strong meals": [r"\bgreat food\b", r"\bdelicious\b", r"\btasty\b", r"\bexcellent meals?\b", r"\bgood meals?\b"],
    "good value": [r"\bgood value\b", r"\bgreat value\b", r"\bwell priced\b", r"\breasonable prices?\b"],
    "strong atmosphere": [r"\bgreat atmosphere\b", r"\bnice atmosphere\b", r"\bgood vibe\b", r"\blive music\b"],
    "drink selection": [r"\bgreat drinks?\b", r"\bgood beers?\b", r"\bcold beers?\b", r"\bgood wine\b"],
}


GOOGLE_NEGATIVE_REVIEW_PATTERNS = {
    "slow service": [r"\bslow\b", r"\bwait(?:ed|ing)? too long\b", r"\blong wait\b", r"\btook forever\b"],
    "staff friction": [r"\brude\b", r"\bunfriendly\b", r"\bbad service\b", r"\bpoor service\b"],
    "pricing complaints": [r"\boverpriced\b", r"\bexpensive\b", r"\bpricey\b"],
    "food quality issues": [r"\bcold food\b", r"\bcold meals?\b", r"\bdry\b", r"\bbland\b", r"\bdisappoint"],
    "crowding or noise": [r"\bnoisy\b", r"\bcrowded\b", r"\btoo busy\b"],
    "booking friction": [r"\bbooking\b", r"\bbooked\b", r"\breservation\b"],
}


def load_json_env(name: str) -> Dict[str, object]:
    raw = os.getenv(name)
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def extract_google_place_id(value: object) -> Optional[str]:
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    if text.startswith("ChIJ") or text.startswith("Ei"):
        return text

    if text.startswith("http://") or text.startswith("https://"):
        parsed = urlparse(text)
        params = parse_qs(parsed.query)
        for key in ("query_place_id", "place_id"):
            ids = params.get(key)
            if ids and ids[0]:
                return ids[0]

        match = re.search(r"/place/[^/]+/data=!4m!3m1!1s([^/?]+)", text)
        if match:
            return match.group(1)

    return None


def extract_google_search_query(value: object) -> Optional[str]:
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    if text.startswith("http://") or text.startswith("https://"):
        parsed = urlparse(text)
        params = parse_qs(parsed.query)
        for key in ("query", "q"):
            queries = params.get(key)
            if queries and queries[0]:
                return queries[0]

        search_match = re.search(r"/maps/search/([^/?]+)", parsed.path)
        if search_match:
            return unquote_plus(search_match.group(1))

    return text


def textsearch_place_rating(query: str, key: str) -> GoogleLookupResult:
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {"query": query, "key": key}
    resp = requests.get(url, params=params, timeout=20)
    if resp.status_code != 200:
        return GoogleLookupResult(
            api_status="HTTP_ERROR",
            via="textsearch",
            query=query,
            http_status=resp.status_code,
        )

    payload = resp.json()
    status = payload.get("status", "UNKNOWN")
    if status != "OK":
        return GoogleLookupResult(
            api_status=str(status),
            via="textsearch",
            query=query,
            http_status=resp.status_code,
            error_message=payload.get("error_message"),
        )

    results = payload.get("results", [])
    if not results:
        return GoogleLookupResult(
            api_status="OK_EMPTY",
            via="textsearch",
            query=query,
            http_status=resp.status_code,
        )

    top = results[0]
    rating = top.get("rating")
    name = top.get("name") or query
    place_id = top.get("place_id")
    if rating is None:
        return GoogleLookupResult(
            api_status="OK_NO_RATING",
            via="textsearch",
            query=query,
            name=str(name),
            place_id=str(place_id) if place_id else None,
            http_status=resp.status_code,
        )

    reviews_count = top.get("user_ratings_total")
    return GoogleLookupResult(
        api_status="OK",
        via="textsearch",
        query=query,
        name=str(name),
        place_id=str(place_id) if place_id else None,
        rating=float(rating),
        reviews_count=reviews_count,
        http_status=resp.status_code,
    )


def details_place_rating(place_id: str, key: str) -> GoogleLookupResult:
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "name,rating,user_ratings_total",
        "key": key,
    }
    resp = requests.get(url, params=params, timeout=20)
    if resp.status_code != 200:
        return GoogleLookupResult(
            api_status="HTTP_ERROR",
            via="details",
            query=place_id,
            http_status=resp.status_code,
        )

    payload = resp.json()
    status = payload.get("status", "UNKNOWN")
    if status != "OK":
        return GoogleLookupResult(
            api_status=str(status),
            via="details",
            query=place_id,
            http_status=resp.status_code,
            error_message=payload.get("error_message"),
        )

    result = payload.get("result") or {}
    rating = result.get("rating")
    name = result.get("name") or place_id
    if rating is None:
        return GoogleLookupResult(
            api_status="OK_NO_RATING",
            via="details",
            query=place_id,
            name=str(name),
            http_status=resp.status_code,
        )

    reviews_count = result.get("user_ratings_total")
    return GoogleLookupResult(
        api_status="OK",
        via="details",
        query=place_id,
        name=str(name),
        place_id=place_id,
        rating=float(rating),
        reviews_count=reviews_count,
        http_status=resp.status_code,
    )


def details_place_context(place_id: str, key: str) -> Dict[str, object]:
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "name,website,price_level,reviews,user_ratings_total,rating,opening_hours",
        "reviews_sort": "newest",
        "reviews_no_translations": "true",
        "key": key,
    }
    resp = requests.get(url, params=params, timeout=20)
    if resp.status_code != 200:
        return {"api_status": "HTTP_ERROR", "http_status": resp.status_code}

    payload = resp.json()
    status = payload.get("status", "UNKNOWN")
    if status != "OK":
        return {
            "api_status": str(status),
            "http_status": resp.status_code,
            "error_message": payload.get("error_message"),
        }

    result = payload.get("result") or {}
    return {
        "api_status": "OK",
        "http_status": resp.status_code,
        "name": result.get("name"),
        "website": result.get("website"),
        "price_level": result.get("price_level"),
        "rating": result.get("rating"),
        "reviews_count": result.get("user_ratings_total"),
        "opening_hours": (result.get("opening_hours") or {}).get("weekday_text"),
        "reviews": result.get("reviews", []),
    }


def extract_review_topics(text: str, patterns: Dict[str, List[str]]) -> List[str]:
    lower = text.lower()
    matches = []
    for topic, topic_patterns in patterns.items():
        if any(re.search(pattern, lower) for pattern in topic_patterns):
            matches.append(topic)
    return matches


def summarize_topics(prefix: str, counts: Dict[str, int]) -> Optional[str]:
    if not counts:
        return None

    top_topics = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:2]
    labels = [topic for topic, _count in top_topics]
    if len(labels) == 1:
        body = labels[0]
    else:
        body = f"{labels[0]} and {labels[1]}"
    return f"{prefix} {body}."


def build_google_review_signals(cafe: Cafe, context: Dict[str, object]) -> List[Signal]:
    reviews = context.get("reviews")
    if not isinstance(reviews, list) or not reviews:
        return []

    positive_counts: Dict[str, int] = {}
    negative_counts: Dict[str, int] = {}
    latest_positive_at: Optional[datetime] = None
    latest_negative_at: Optional[datetime] = None

    for review in reviews:
        if not isinstance(review, dict):
            continue

        text = str(review.get("text") or "").strip()
        rating = review.get("rating")
        review_time = review.get("time")
        happened_at = None
        if isinstance(review_time, (int, float)):
            happened_at = datetime.fromtimestamp(review_time, tz=timezone.utc)

        if text and isinstance(rating, (int, float)) and rating >= 4:
            for topic in extract_review_topics(text, GOOGLE_POSITIVE_REVIEW_PATTERNS):
                positive_counts[topic] = positive_counts.get(topic, 0) + 1
                if happened_at and (latest_positive_at is None or happened_at > latest_positive_at):
                    latest_positive_at = happened_at

        if text and isinstance(rating, (int, float)) and rating <= 3:
            for topic in extract_review_topics(text, GOOGLE_NEGATIVE_REVIEW_PATTERNS):
                negative_counts[topic] = negative_counts.get(topic, 0) + 1
                if happened_at and (latest_negative_at is None or happened_at > latest_negative_at):
                    latest_negative_at = happened_at

    signals: List[Signal] = []
    if cafe.kind == "target":
        strength_summary = summarize_topics("Google reviews praise", positive_counts)
        if strength_summary:
            signals.append(
                Signal(
                    source="google_maps",
                    cafe=cafe.name,
                    kind="review_strength",
                    summary=strength_summary,
                    impact=6 if sum(positive_counts.values()) >= 3 else 5,
                    confidence=8.9,
                    happened_at=latest_positive_at,
                )
            )
    else:
        issue_summary = summarize_topics("Google reviews mention", negative_counts)
        if issue_summary:
            signals.append(
                Signal(
                    source="google_maps",
                    cafe=cafe.name,
                    kind="review_issue",
                    summary=issue_summary,
                    impact=8 if sum(negative_counts.values()) >= 3 else 7,
                    confidence=8.9,
                    happened_at=latest_negative_at,
                )
            )

    return signals


def is_google_lookup_error(status: str) -> bool:
    return status not in {"OK", "ZERO_RESULTS", "NOT_FOUND", "OK_EMPTY", "OK_NO_RATING"}


def get_ai_studio_key() -> Optional[str]:
    return os.getenv("GEMINI_API_KEY") or os.getenv("AI_STUDIO_API_KEY")


def generate_hook_with_gemini(target_name: str, gap: str, competitor_issue: str) -> Optional[str]:
    api_key = get_ai_studio_key()
    if not api_key:
        return None

    prompt = (
        "You are generating a concise sales hook for a local venue intelligence report.\n"
        "Rules:\n"
        "- Use only the facts provided below.\n"
        "- If facts are insufficient, respond exactly: Data Unavailable\n"
        "- Max 35 words.\n"
        f"Target: {target_name}\n"
        f"Target Gap/Facts: {gap}\n"
        f"Competitor Issue/Facts: {competitor_issue}\n"
        "Return only the hook text."
    )

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={api_key}"
    )
    payload = {"contents": [{"parts": [{"text": prompt}]}]}
    headers = {"Content-Type": "application/json"}

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=25)
        if resp.status_code != 200:
            return None
        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            return None
        text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
        return text[:220] if text else None
    except requests.RequestException:
        return None


def fetch_google_maps_signals(
    cafes: List[Cafe],
    location_focus: str,
    stats: SourceStats,
    diagnostics: Optional[List[Dict[str, object]]] = None,
) -> List[Signal]:
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return []

    place_overrides = load_json_env("GOOGLE_MAPS_PLACES_JSON")
    signals: List[Signal] = []
    for cafe in cafes:
        try:
            override = place_overrides.get(cafe.name)
            resolved: Optional[GoogleLookupResult] = None
            attempts: List[Dict[str, object]] = []

            place_id = extract_google_place_id(override)
            if place_id:
                lookup = details_place_rating(place_id, key)
                attempts.append(lookup.__dict__.copy())
                if lookup.api_status == "OK":
                    resolved = lookup
            else:
                search_query = extract_google_search_query(override)
                if search_query:
                    lookup = textsearch_place_rating(search_query, key)
                    attempts.append(lookup.__dict__.copy())
                    if lookup.api_status == "OK":
                        resolved = lookup

            queries = [
                f"{cafe.name} {location_focus}",
                f"{cafe.name} Wangaratta VIC pub",
                f"{cafe.name} Wangaratta pub",
                cafe.name,
            ]
            if not resolved:
                for query in queries:
                    lookup = textsearch_place_rating(query, key)
                    attempts.append(lookup.__dict__.copy())
                    if lookup.api_status == "OK":
                        resolved = lookup
                        break

            if not resolved:
                if diagnostics is not None:
                    diagnostics.append(
                        {
                            "cafe": cafe.name,
                            "override_present": bool(override),
                            "resolved": False,
                            "attempts": attempts,
                        }
                    )
                if any(is_google_lookup_error(str(attempt.get("api_status"))) for attempt in attempts):
                    stats.mark_fail()
                else:
                    stats.mark_success()
                continue

            resolved_name = resolved.name or cafe.name
            rating = resolved.rating
            reviews_count = resolved.reviews_count
            target_tokens = [t for t in re.split(r"[^a-z0-9]+", cafe.name.lower()) if len(t) > 2]
            if target_tokens:
                resolved_lower = resolved_name.lower()
                if not all(token in resolved_lower for token in target_tokens[:2]):
                    fallback = None
                    for query in queries[1:]:
                        fallback = textsearch_place_rating(query, key)
                        attempts.append(fallback.__dict__.copy())
                        if fallback.api_status == "OK" and fallback.name:
                            fallback_lower = fallback.name.lower()
                            if all(token in fallback_lower for token in target_tokens[:2]):
                                resolved_name = fallback.name
                                rating = fallback.rating
                                reviews_count = fallback.reviews_count
                                break

            if rating is None:
                if diagnostics is not None:
                    diagnostics.append(
                        {
                            "cafe": cafe.name,
                            "override_present": bool(override),
                            "resolved": False,
                            "attempts": attempts,
                            "reason": "NO_RATING",
                        }
                    )
                stats.mark_success()
                continue

            text = f"{resolved_name}: Rating {rating} from {reviews_count} reviews."
            signals.append(
                Signal(
                    source="google_maps",
                    cafe=cafe.name,
                    kind="rating_snapshot",
                    summary=text,
                    impact=6 if rating and rating < 4.2 else 4,
                    confidence=8.5,
                )
            )

            context = {}
            if resolved.place_id:
                context = details_place_context(resolved.place_id, key)
                if context.get("api_status") == "OK":
                    signals.extend(build_google_review_signals(cafe, context))

            if diagnostics is not None:
                diagnostics.append(
                    {
                        "cafe": cafe.name,
                        "override_present": bool(override),
                        "resolved": True,
                        "resolved_name": resolved_name,
                        "place_id": resolved.place_id,
                        "rating": rating,
                        "reviews_count": reviews_count,
                        "details_context": {
                            "api_status": context.get("api_status"),
                            "website": context.get("website"),
                            "price_level": context.get("price_level"),
                            "opening_hours": context.get("opening_hours"),
                            "reviews_fetched": len(context.get("reviews", [])) if isinstance(context.get("reviews"), list) else 0,
                        }
                        if context
                        else None,
                        "attempts": attempts,
                    }
                )
            stats.mark_success()
        except requests.RequestException:
            stats.mark_fail()
    return signals


def parse_reddit_time(created_utc: float) -> datetime:
    return datetime.fromtimestamp(created_utc, tz=timezone.utc)


def fetch_reddit_signals(cafes: List[Cafe], last_scan_date: datetime, stats: SourceStats) -> List[Signal]:
    headers = {"User-Agent": "local-edge-weekly/1.0"}
    subreddits = ["melbourne", "australia", "coffee"]
    signals: List[Signal] = []

    for cafe in cafes:
        for sub in subreddits:
            try:
                url = f"https://www.reddit.com/r/{sub}/search.json"
                params = {"q": cafe.name, "restrict_sr": "1", "sort": "new", "t": "week", "limit": 10}
                resp = requests.get(url, params=params, headers=headers, timeout=20)
                if resp.status_code != 200:
                    stats.mark_fail()
                    continue

                data = resp.json()
                posts = data.get("data", {}).get("children", [])
                for post in posts:
                    body = post.get("data", {}).get("selftext", "")
                    title = post.get("data", {}).get("title", "")
                    created = post.get("data", {}).get("created_utc")
                    if created is None:
                        continue
                    happened_at = parse_reddit_time(created)
                    if happened_at < last_scan_date:
                        continue

                    text = f"{title} {body}".strip()
                    confidence = score_confidence_from_text(text)
                    signals.append(
                        Signal(
                            source="reddit",
                            cafe=cafe.name,
                            kind="discussion_signal",
                            summary=text[:260] if text else "Mentioned in Reddit discussion.",
                            impact=normalize_impact(text),
                            confidence=confidence,
                            happened_at=happened_at,
                        )
                    )
                stats.mark_success()
            except requests.RequestException:
                stats.mark_fail()
    return signals


def fetch_competitor_url_signals(stats: SourceStats) -> List[Signal]:
    # Optional mapping from env var:
    # {"Cafe Name":"https://example.com/menu"}
    mapping_raw = os.getenv("COMPETITOR_URLS_JSON")
    if not mapping_raw:
        return []

    try:
        mapping = json.loads(mapping_raw)
    except json.JSONDecodeError:
        stats.mark_fail()
        return []

    signals: List[Signal] = []
    keywords = [
        "special",
        "new menu",
        "menu",
        "price",
        "limited time",
        "booking",
        "book now",
        "functions",
        "bistro",
        "events",
        "live music",
        "happy hour",
        "sports bar",
    ]
    for cafe_name, url in mapping.items():
        try:
            resp = requests.get(url, timeout=20)
            if resp.status_code != 200:
                stats.mark_fail()
                continue

            text = re.sub(r"\s+", " ", resp.text.lower())
            snippets = []
            for keyword in keywords:
                if keyword in text:
                    snippets.append(keyword)
            if snippets:
                signals.append(
                    Signal(
                        source="competitor_url",
                        cafe=cafe_name,
                        kind="menu_pricing_signal",
                        summary=f"Detected website keywords: {', '.join(snippets[:4])}.",
                        impact=5,
                        confidence=7.5,
                    )
                )
            stats.mark_success()
        except requests.RequestException:
            stats.mark_fail()
    return signals


def filter_confident_signals(signals: List[Signal]) -> Tuple[List[Signal], List[Signal]]:
    kept = []
    noise = []
    for s in signals:
        if s.confidence < 7.0:
            noise.append(s)
        else:
            kept.append(s)
    return kept, noise


def resolve_conflicts(signals: List[Signal]) -> List[Signal]:
    # Keep top-authority + top-confidence signal for each cafe+kind.
    best: Dict[Tuple[str, str], Signal] = {}
    for s in signals:
        key = (s.cafe, s.kind)
        current = best.get(key)
        if not current:
            best[key] = s
            continue
        current_rank = (SOURCE_AUTHORITY.get(current.source, 0), current.confidence)
        new_rank = (SOURCE_AUTHORITY.get(s.source, 0), s.confidence)
        if new_rank > current_rank:
            best[key] = s
    return list(best.values())


def assess_market_status(signals: List[Signal]) -> str:
    if not signals:
        return "Stagnant"
    avg = sum(s.impact for s in signals) / len(signals)
    if avg >= 6.5:
        return "Volatile"
    if avg >= 5.2:
        return "Growth"
    return "Stagnant"


def build_report(
    last_scan_date: datetime,
    targets: List[Cafe],
    competition: List[Cafe],
    signals: List[Signal],
    connectivity_error: bool,
) -> Dict:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    if connectivity_error:
        return {
            "timestamp": now,
            "market_status": "Volatile",
            "competitor_delta": [["Connectivity Error", "Source failure rate exceeded 30%.", 10]],
            "target_leads": [[t.name, "Data Unavailable", "Data Unavailable"] for t in targets],
        }

    # Stop Condition 1: no new data since last_scan_date.
    new_signals = [s for s in signals if not s.happened_at or s.happened_at >= last_scan_date]
    if not new_signals:
        return {
            "timestamp": now,
            "market_status": "Stagnant",
            "competitor_delta": [],
            "target_leads": [[t.name, "No Changes", "No Changes"] for t in targets],
        }

    market_status = assess_market_status(new_signals)
    if market_status not in ALLOWED_MARKET_STATUS:
        market_status = "Stagnant"

    comp_names = {c.name for c in competition}
    target_names = {t.name for t in targets}
    competitor_delta = []
    target_leads = []

    comp_signals = [s for s in new_signals if s.cafe in comp_names]
    target_signals = [s for s in new_signals if s.cafe in target_names]

    for s in sorted(comp_signals, key=lambda s: (s.impact, s.confidence), reverse=True)[:20]:
        competitor_delta.append([s.cafe, s.summary[:180], int(max(1, min(10, s.impact)))])

    prioritized_comp_signals = sorted(
        comp_signals,
        key=lambda s: (1 if s.kind == "review_issue" else 0, s.impact, s.confidence),
        reverse=True,
    )
    comp_issues = prioritized_comp_signals
    default_issue = "Data Unavailable" if not comp_issues else comp_issues[0].summary
    for t in targets:
        relevant = sorted(
            [s for s in target_signals if s.cafe == t.name],
            key=lambda s: (1 if s.kind == "review_strength" else 0, s.impact, s.confidence),
            reverse=True,
        )
        if relevant:
            gap = relevant[0].summary[:120]
            fallback_hook = f"Position {t.name} as the alternative when competitors show: {default_issue[:90]}"
            hook = generate_hook_with_gemini(t.name, gap, default_issue[:180]) or fallback_hook
        else:
            gap = "Data Unavailable"
            hook = "Data Unavailable"
        target_leads.append([t.name, gap, hook[:200]])

    return {
        "timestamp": now,
        "market_status": market_status,
        "competitor_delta": competitor_delta,
        "target_leads": target_leads,
    }


def write_dashboard(report: Dict, output_path: str) -> None:
    leads = report.get("target_leads", [])[:3]
    deltas = report.get("competitor_delta", [])[:5]

    lines = [
        "# Dashboard Summary",
        "",
        f"- Timestamp: {report.get('timestamp')}",
        f"- Market Status: {report.get('market_status')}",
        "",
        "## Top 3 Sales Hooks",
    ]
    for lead in leads:
        lines.append(f"- {lead[0]}: {lead[2]}")

    lines.extend(["", "## Competitor Deltas"])
    for delta in deltas:
        lines.append(f"- {delta[0]} | Impact {delta[2]} | {delta[1]}")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def run() -> int:
    root = os.path.dirname(os.path.abspath(__file__))
    plan_path = os.path.join(root, "PLAN.md")
    report_path = os.path.join(root, "weekly_intel_report.json")
    dashboard_path = os.path.join(root, "Dashboard_Summary.md")
    noise_log_path = os.path.join(root, "noise_log.json")
    diagnostics_path = os.path.join(root, "source_diagnostics.json")

    last_scan_date, location_focus, targets, competition = parse_plan(plan_path)
    all_cafes = targets + competition

    stats = SourceStats()
    signals: List[Signal] = []
    google_diagnostics: List[Dict[str, object]] = []
    signals.extend(fetch_google_maps_signals(all_cafes, location_focus, stats, google_diagnostics))
    signals.extend(fetch_reddit_signals(all_cafes, last_scan_date, stats))
    signals.extend(fetch_competitor_url_signals(stats))

    kept, noise = filter_confident_signals(signals)
    resolved = resolve_conflicts(kept)

    connectivity_error = stats.failure_ratio > 0.30
    report = build_report(last_scan_date, targets, competition, resolved, connectivity_error)

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    noise_payload = [
        {
            "source": s.source,
            "cafe": s.cafe,
            "kind": s.kind,
            "summary": s.summary,
            "impact": s.impact,
            "confidence": s.confidence,
        }
        for s in noise
    ]
    with open(noise_log_path, "w", encoding="utf-8") as f:
        json.dump(noise_payload, f, indent=2)

    diagnostics_payload = {
        "source_stats": {
            "success": stats.success,
            "fail": stats.fail,
            "failure_ratio": stats.failure_ratio,
        },
        "google_maps": google_diagnostics,
    }
    with open(diagnostics_path, "w", encoding="utf-8") as f:
        json.dump(diagnostics_payload, f, indent=2)

    write_dashboard(report, dashboard_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
