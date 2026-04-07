import json
import os
import re
import sys
from urllib.parse import parse_qs, unquote_plus, urlparse
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

import requests

from decision_engine import generate_decision_pack


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

SOURCE_WEIGHTS = {
    "google_maps": 1.5,
    "competitor_url": 2.0,
    "social": 1.2,
    "reddit": 1.8,
    "uber_eats": 1.6,
}

SOURCE_FLAGS = {
    "google_maps": "google_reviews",
    "competitor_url": "website_delta",
    "reddit": "reddit",
    "social": "social",
    "uber_eats": "uber_eats",
}

PRESSURE_SCORE_FIELDS = [
    "delivery_value_pressure",
    "bundle_pressure",
    "lunch_office_pressure",
    "late_night_pressure",
    "urgency_offer_pressure",
    "differentiation_pressure",
]

PRESSURE_KEYWORDS = {
    "delivery_value_pressure": [
        "delivery",
        "order online",
        "free delivery",
        "value",
        "deal",
        "discount",
        "price",
        "cheap",
        "minimum spend",
    ],
    "bundle_pressure": [
        "bundle",
        "combo",
        "box",
        "pack",
        "group",
        "share",
        "family",
        "meal deal",
    ],
    "lunch_office_pressure": [
        "lunch",
        "office",
        "cbd",
        "weekday",
        "worker",
        "student",
        "desk",
    ],
    "late_night_pressure": [
        "late night",
        "after 9",
        "9pm",
        "midnight",
        "open late",
        "night",
    ],
    "urgency_offer_pressure": [
        "limited",
        "limited time",
        "today only",
        "this week",
        "new",
        "special",
        "free",
        "deadline",
    ],
    "differentiation_pressure": [
        "signature",
        "crispy",
        "boneless",
        "spicy",
        "sauce",
        "flavour",
        "flavor",
        "hero",
        "premium",
    ],
}

SIGNAL_KIND_PRESSURE_DEFAULTS = {
    "rating_snapshot": ["differentiation_pressure"],
    "review_strength": ["differentiation_pressure"],
    "review_issue": ["differentiation_pressure"],
    "discussion_signal": ["differentiation_pressure"],
    "reddit_target_absent_opportunity": ["lunch_office_pressure", "delivery_value_pressure"],
    "menu_pricing_signal": ["delivery_value_pressure", "urgency_offer_pressure"],
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


def parse_project_config(config_path: str) -> Tuple[datetime, str, List[Cafe], List[Cafe]]:
    with open(config_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    if not isinstance(payload, dict):
        raise ValueError("Project config must be a JSON object")

    last_scan_raw = payload.get("last_scan_date")
    location_focus = payload.get("location_focus")
    targets_raw = payload.get("targets")
    competition_raw = payload.get("competition")

    if not isinstance(last_scan_raw, str):
        raise ValueError("Project config requires string field `last_scan_date`")
    if not isinstance(location_focus, str) or not location_focus.strip():
        raise ValueError("Project config requires string field `location_focus`")
    if not isinstance(targets_raw, list) or not isinstance(competition_raw, list):
        raise ValueError("Project config requires list fields `targets` and `competition`")

    last_scan_date = datetime.strptime(last_scan_raw, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    def parse_cafe_list(items: List[object], kind: str) -> List[Cafe]:
        cafes: List[Cafe] = []
        for item in items:
            if not isinstance(item, dict):
                raise ValueError(f"{kind} entries must be objects")
            name = item.get("name")
            focus = item.get("focus", "")
            if not isinstance(name, str) or not name.strip():
                raise ValueError(f"{kind} entries require `name`")
            if not isinstance(focus, str):
                raise ValueError(f"{kind} entry focus must be a string")
            cafes.append(Cafe(name=name.strip(), focus=focus.strip(), kind=kind))
        return cafes

    targets = parse_cafe_list(targets_raw, "target")
    competition = parse_cafe_list(competition_raw, "competition")
    if not targets or not competition:
        raise ValueError("Project config must include at least one target and one competitor")

    return last_scan_date, location_focus.strip(), targets, competition


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


def infer_market_subreddits(location_focus: str) -> List[str]:
    location = location_focus.lower()
    subreddits = []
    for token, names in [
        ("melbourne", ["melbourne", "melbournefood"]),
        ("sydney", ["sydney", "foodies_sydney"]),
        ("brisbane", ["brisbane"]),
        ("perth", ["perth"]),
    ]:
        if token in location:
            subreddits.extend(names)

    if not subreddits:
        subreddits.extend(["melbourne", "sydney", "brisbane", "perth"])

    subreddits.append("australia")
    seen = set()
    return [sub for sub in subreddits if not (sub in seen or seen.add(sub))]


def build_reddit_category_keywords(payload: Dict[str, object]) -> List[str]:
    text = f"{payload.get('industry') or ''} {payload.get('location_focus') or ''}".lower()
    keywords = ["best deal", "lunch", "delivery", "bundle"]

    if any(word in text for word in ["restaurant", "chicken", "cafe", "food", "pub", "bar"]):
        keywords.extend(["best lunch", "late night", "combo", "special"])
    if "gym" in text or "fitness" in text:
        keywords.extend(["membership deal", "classes", "trial"])

    seen = set()
    return [keyword for keyword in keywords if not (keyword in seen or seen.add(keyword))]


def normalize_matchable_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def reddit_name_matches(text: str, cafe_name: str) -> bool:
    normalized_text = normalize_matchable_text(text)
    normalized_name = normalize_matchable_text(cafe_name)
    if not normalized_text or not normalized_name:
        return False

    if normalized_name in normalized_text:
        return True

    tokens = [token for token in normalized_name.split() if len(token) > 2]
    if len(tokens) >= 2 and all(re.search(rf"\b{re.escape(token)}\b", normalized_text) for token in tokens[:2]):
        return True

    return len(tokens) == 1 and re.search(rf"\b{re.escape(tokens[0])}\b", normalized_text) is not None


def classify_reddit_sentiment(text: str) -> str:
    lower = text.lower()
    positive_hits = sum(
        1
        for word in ["best", "great", "good", "love", "recommend", "worth", "favourite", "favorite", "cheap"]
        if word in lower
    )
    negative_hits = sum(
        1
        for word in ["bad", "awful", "slow", "overpriced", "avoid", "terrible", "expensive", "cold"]
        if word in lower
    )
    if positive_hits > negative_hits:
        return "positive"
    if negative_hits > positive_hits:
        return "negative"
    return "neutral"


def reddit_recency_decay(happened_at: Optional[datetime], last_scan_date: datetime) -> float:
    if not happened_at:
        return 0.75

    age_days = max(0, (datetime.now(timezone.utc) - happened_at).days)
    scan_age_days = max(1, (datetime.now(timezone.utc) - last_scan_date).days + 1)
    return max(0.35, 1.0 - (age_days / max(7, scan_age_days + 7)))


def score_reddit_impact(
    text: str,
    sentiment: str,
    happened_at: Optional[datetime],
    last_scan_date: datetime,
    target_absent: bool,
) -> int:
    base = normalize_impact(text)
    if sentiment == "positive":
        base += 1
    elif sentiment == "negative":
        base -= 1
    if target_absent:
        base += 1

    return int(max(3, min(10, round(base * reddit_recency_decay(happened_at, last_scan_date)))))


def extract_reddit_comments(
    permalink: str,
    headers: Dict[str, str],
    last_scan_date: datetime,
) -> List[Dict[str, object]]:
    if not permalink:
        return []

    try:
        resp = requests.get(f"https://www.reddit.com{permalink}.json", params={"limit": 20}, headers=headers, timeout=20)
        if resp.status_code != 200:
            return []
        payload = resp.json()
    except (requests.RequestException, ValueError):
        return []

    if not isinstance(payload, list) or len(payload) < 2:
        return []

    comments: List[Dict[str, object]] = []
    for child in payload[1].get("data", {}).get("children", [])[:20]:
        data = child.get("data", {}) if isinstance(child, dict) else {}
        body = str(data.get("body") or "").strip()
        created = data.get("created_utc")
        if not body or created is None:
            continue
        happened_at = parse_reddit_time(created)
        if happened_at < last_scan_date:
            continue
        comments.append(
            {
                "id": data.get("id"),
                "text": body,
                "happened_at": happened_at,
            }
        )
    return comments


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
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(render_dashboard(report))


def render_dashboard(report: Dict) -> str:
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

    return "\n".join(lines) + "\n"


def cafe_to_dict(cafe: Cafe) -> Dict[str, str]:
    return {"name": cafe.name, "focus": cafe.focus, "kind": cafe.kind}


def cafe_from_dict(payload: Dict[str, object]) -> Cafe:
    return Cafe(
        name=str(payload.get("name") or ""),
        focus=str(payload.get("focus") or ""),
        kind=str(payload.get("kind") or ""),
    )


def signal_to_dict(signal: Signal) -> Dict[str, object]:
    return {
        "source": signal.source,
        "cafe": signal.cafe,
        "kind": signal.kind,
        "summary": signal.summary,
        "impact": signal.impact,
        "confidence": signal.confidence,
        "happened_at": signal.happened_at.isoformat() if signal.happened_at else None,
    }


def signal_from_dict(payload: Dict[str, object]) -> Signal:
    happened_at_raw = payload.get("happened_at")
    happened_at = None
    if isinstance(happened_at_raw, str) and happened_at_raw:
        happened_at = datetime.fromisoformat(happened_at_raw)

    return Signal(
        source=str(payload.get("source") or ""),
        cafe=str(payload.get("cafe") or ""),
        kind=str(payload.get("kind") or ""),
        summary=str(payload.get("summary") or ""),
        impact=int(payload.get("impact") or 0),
        confidence=float(payload.get("confidence") or 0),
        happened_at=happened_at,
    )


def slugify_name(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "unknown_competitor"


def pipeline_week_label(value: object) -> str:
    try:
        date = parse_pipeline_date(value, "last_scan_date")
    except ValueError:
        date = datetime.now(timezone.utc)
    iso_year, iso_week, _ = date.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def pressure_categories_for_signal(signal: Signal) -> List[str]:
    text = f"{signal.kind} {signal.summary}".lower()
    categories = []
    for field, keywords in PRESSURE_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            categories.append(field)

    for field in SIGNAL_KIND_PRESSURE_DEFAULTS.get(signal.kind, []):
        if field not in categories:
            categories.append(field)

    if not categories:
        categories.append("differentiation_pressure")

    return categories


def source_flag_for_signal(source: str) -> str:
    return SOURCE_FLAGS.get(source, source or "unknown")


def weighted_pressure_value(signal: Signal) -> float:
    source_weight = SOURCE_WEIGHTS.get(signal.source, 1.0)
    confidence_multiplier = max(0.1, min(1.0, signal.confidence / 10.0))
    return max(0.0, signal.impact * confidence_multiplier * source_weight)


def build_pressure_scores(
    week_label: str,
    competitors: List[Cafe],
    signals: List[Signal],
) -> List[Dict[str, object]]:
    pressure_scores: List[Dict[str, object]] = []
    signals_by_competitor: Dict[str, List[Signal]] = {competitor.name: [] for competitor in competitors}

    for signal in signals:
        if signal.cafe in signals_by_competitor:
            signals_by_competitor[signal.cafe].append(signal)

    for competitor in competitors:
        scores = {field: 0.0 for field in PRESSURE_SCORE_FIELDS}
        fired_sources = set()
        for signal in signals_by_competitor.get(competitor.name, []):
            fired_sources.add(source_flag_for_signal(signal.source))
            categories = pressure_categories_for_signal(signal)
            value = weighted_pressure_value(signal) / max(1, len(categories))
            for category in categories:
                scores[category] = min(10.0, scores.get(category, 0.0) + value)

        rounded_scores = {
            field: int(max(0, min(10, round(scores.get(field, 0.0)))))
            for field in PRESSURE_SCORE_FIELDS
        }
        pressure_scores.append(
            {
                "competitor_id": slugify_name(competitor.name),
                "competitor_name": competitor.name,
                "week": week_label,
                "scores": rounded_scores,
                "total_pressure": sum(rounded_scores.values()),
                "sources_fired": sorted(fired_sources),
            }
        )

    return sorted(pressure_scores, key=lambda item: int(item.get("total_pressure") or 0), reverse=True)


def stats_dict(success: int = 0, fail: int = 0) -> Dict[str, object]:
    total = success + fail
    return {
        "success": success,
        "fail": fail,
        "failure_ratio": (fail / total) if total else 0.0,
    }


def mark_stats_success(payload: Dict[str, object]) -> None:
    payload["success"] = int(payload.get("success") or 0) + 1
    payload["failure_ratio"] = stats_dict(
        success=int(payload.get("success") or 0),
        fail=int(payload.get("fail") or 0),
    )["failure_ratio"]


def mark_stats_fail(payload: Dict[str, object]) -> None:
    payload["fail"] = int(payload.get("fail") or 0) + 1
    payload["failure_ratio"] = stats_dict(
        success=int(payload.get("success") or 0),
        fail=int(payload.get("fail") or 0),
    )["failure_ratio"]


def parse_pipeline_date(value: object, field_name: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Missing `{field_name}`")

    text = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(text)


def normalize_cafe_entries(items: object, field_name: str, kind: str) -> List[Dict[str, str]]:
    if not isinstance(items, list) or not items:
        raise ValueError(f"`{field_name}` must be a non-empty list")

    normalized: List[Dict[str, str]] = []
    for item in items:
        if isinstance(item, Cafe):
            cafe = item
        elif isinstance(item, dict):
            name = item.get("name")
            focus = item.get("focus", "")
            if not isinstance(name, str) or not name.strip():
                raise ValueError(f"`{field_name}` entries require `name`")
            if not isinstance(focus, str):
                raise ValueError(f"`{field_name}` entry `focus` must be a string")
            cafe = Cafe(name=name.strip(), focus=focus.strip(), kind=kind)
        else:
            raise ValueError(f"`{field_name}` entries must be objects")
        normalized.append(cafe_to_dict(cafe))

    return normalized


def load_competitor_url_mapping(payload: Dict[str, object]) -> Dict[str, str]:
    inline_mapping = payload.get("competitor_urls")
    if isinstance(inline_mapping, dict):
        normalized_inline: Dict[str, str] = {}
        for cafe_name, url in inline_mapping.items():
            if isinstance(cafe_name, str) and cafe_name.strip() and isinstance(url, str) and url.strip():
                normalized_inline[cafe_name.strip()] = url.strip()
        if normalized_inline:
            return normalized_inline

    mapping_raw = os.getenv("COMPETITOR_URLS_JSON")
    if not mapping_raw:
        return {}

    try:
        parsed = json.loads(mapping_raw)
    except json.JSONDecodeError:
        return {}

    if not isinstance(parsed, dict):
        return {}

    normalized_env: Dict[str, str] = {}
    for cafe_name, url in parsed.items():
        if isinstance(cafe_name, str) and cafe_name.strip() and isinstance(url, str) and url.strip():
            normalized_env[cafe_name.strip()] = url.strip()
    return normalized_env


def resolve_google_places(cafes: List[Cafe], location_focus: str) -> List[Dict[str, object]]:
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return []

    place_overrides = load_json_env("GOOGLE_MAPS_PLACES_JSON")
    results: List[Dict[str, object]] = []

    for cafe in cafes:
        override = place_overrides.get(cafe.name)
        resolved: Optional[GoogleLookupResult] = None
        attempts: List[Dict[str, object]] = []

        try:
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
                results.append(
                    {
                        "cafe": cafe.name,
                        "kind": cafe.kind,
                        "override_present": bool(override),
                        "resolved": False,
                        "attempts": attempts,
                    }
                )
                continue

            resolved_name = resolved.name or cafe.name
            rating = resolved.rating
            reviews_count = resolved.reviews_count
            target_tokens = [t for t in re.split(r"[^a-z0-9]+", cafe.name.lower()) if len(t) > 2]
            if target_tokens:
                resolved_lower = resolved_name.lower()
                if not all(token in resolved_lower for token in target_tokens[:2]):
                    for query in queries[1:]:
                        fallback = textsearch_place_rating(query, key)
                        attempts.append(fallback.__dict__.copy())
                        if fallback.api_status == "OK" and fallback.name:
                            fallback_lower = fallback.name.lower()
                            if all(token in fallback_lower for token in target_tokens[:2]):
                                resolved_name = fallback.name
                                rating = fallback.rating
                                reviews_count = fallback.reviews_count
                                resolved = fallback
                                break

            base_result = {
                "cafe": cafe.name,
                "kind": cafe.kind,
                "override_present": bool(override),
                "attempts": attempts,
                "resolved_name": resolved_name,
                "place_id": resolved.place_id,
                "rating": rating,
                "reviews_count": reviews_count,
            }
            if rating is None:
                results.append(
                    {
                        **base_result,
                        "resolved": False,
                        "reason": "NO_RATING",
                    }
                )
                continue

            results.append({**base_result, "resolved": True})
        except requests.RequestException as exc:
            results.append(
                {
                    "cafe": cafe.name,
                    "kind": cafe.kind,
                    "override_present": bool(override),
                    "resolved": False,
                    "attempts": attempts,
                    "request_exception": True,
                    "error_message": str(exc),
                }
            )

    return results


def input_normalization(payload: Dict[str, object]) -> Dict[str, object]:
    last_scan_date = parse_pipeline_date(payload.get("last_scan_date"), "last_scan_date")
    location_focus = payload.get("location_focus")
    if not isinstance(location_focus, str) or not location_focus.strip():
        raise ValueError("Missing `location_focus`")

    targets = normalize_cafe_entries(payload.get("targets"), "targets", "target")
    competition = normalize_cafe_entries(payload.get("competition"), "competition", "competition")

    return {
        **payload,
        "last_scan_date": last_scan_date.isoformat(),
        "location_focus": location_focus.strip(),
        "targets": targets,
        "competition": competition,
        "all_cafes": targets + competition,
        "stage_outputs": {"input_normalization": {"normalized": True}},
    }


def place_resolution(payload: Dict[str, object]) -> Dict[str, object]:
    cafes = [cafe_from_dict(item) for item in payload.get("all_cafes", [])]
    google_places = resolve_google_places(cafes, str(payload.get("location_focus") or ""))

    next_payload = dict(payload)
    next_payload["google_places"] = google_places
    stage_outputs = dict(next_payload.get("stage_outputs") or {})
    stage_outputs["place_resolution"] = {
        "resolved_places": sum(1 for item in google_places if item.get("resolved")),
        "attempted_places": len(google_places),
    }
    next_payload["stage_outputs"] = stage_outputs
    return next_payload


def source_collection(payload: Dict[str, object]) -> Dict[str, object]:
    last_scan_date = parse_pipeline_date(payload.get("last_scan_date"), "last_scan_date")
    cafes = [cafe_from_dict(item) for item in payload.get("all_cafes", [])]
    stats = stats_dict()
    google_collected: List[Dict[str, object]] = []
    google_diagnostics: List[Dict[str, object]] = []
    reddit_diagnostics: List[Dict[str, object]] = []
    competitor_website_diagnostics: List[Dict[str, object]] = []
    key = os.getenv("GOOGLE_MAPS_API_KEY")

    for place in payload.get("google_places", []):
        if not isinstance(place, dict):
            continue

        if place.get("request_exception"):
            google_diagnostics.append(
                {
                    "cafe": place.get("cafe"),
                    "override_present": bool(place.get("override_present")),
                    "resolved": False,
                    "attempts": place.get("attempts", []),
                    "request_exception": True,
                    "error_message": place.get("error_message"),
                }
            )
            mark_stats_fail(stats)
            continue

        if not place.get("resolved"):
            google_diagnostics.append(
                {
                    "cafe": place.get("cafe"),
                    "override_present": bool(place.get("override_present")),
                    "resolved": False,
                    "attempts": place.get("attempts", []),
                    **({"error_message": place.get("error_message")} if place.get("error_message") else {}),
                    **({"reason": place.get("reason")} if place.get("reason") else {}),
                }
            )
            attempts = place.get("attempts", [])
            if any(
                isinstance(attempt, dict) and is_google_lookup_error(str(attempt.get("api_status")))
                for attempt in attempts
            ):
                mark_stats_fail(stats)
            else:
                mark_stats_success(stats)
            continue

        context: Dict[str, object] = {}
        if key and place.get("place_id"):
            try:
                context = details_place_context(str(place.get("place_id")), key)
            except requests.RequestException:
                mark_stats_fail(stats)
                google_collected.append({**place, "details_context": None})
                continue

        google_collected.append({**place, "details_context": context or None})
        google_diagnostics.append(
            {
                "cafe": place.get("cafe"),
                "override_present": bool(place.get("override_present")),
                "resolved": True,
                "resolved_name": place.get("resolved_name"),
                "place_id": place.get("place_id"),
                "rating": place.get("rating"),
                "reviews_count": place.get("reviews_count"),
                "details_context": {
                    "api_status": context.get("api_status"),
                    "website": context.get("website"),
                    "price_level": context.get("price_level"),
                    "opening_hours": context.get("opening_hours"),
                    "reviews_fetched": len(context.get("reviews", [])) if isinstance(context.get("reviews"), list) else 0,
                }
                if context
                else None,
                "attempts": place.get("attempts", []),
            }
        )
        mark_stats_success(stats)

    headers = {"User-Agent": "local-edge-weekly/1.0"}
    subreddits = infer_market_subreddits(str(payload.get("location_focus") or ""))
    reddit_keywords = build_reddit_category_keywords(payload)
    reddit_posts: List[Dict[str, object]] = []
    seen_reddit_hits = set()
    for cafe in cafes:
        cafe_posts_found = 0
        reddit_attempts: List[Dict[str, object]] = []
        fetched_any = False
        queries = [cafe.name, *[f"{cafe.name} {keyword}" for keyword in reddit_keywords[:3]]]
        for sub in subreddits:
            for query in queries:
                try:
                    url = f"https://www.reddit.com/r/{sub}/search.json"
                    params = {"q": query, "restrict_sr": "1", "sort": "new", "t": "week", "limit": 10}
                    resp = requests.get(url, params=params, headers=headers, timeout=20)
                    reddit_attempts.append({"subreddit": sub, "query": query, "http_status": resp.status_code})
                    if resp.status_code != 200:
                        continue

                    fetched_any = True
                    data = resp.json()
                    posts = data.get("data", {}).get("children", [])
                    for post in posts:
                        post_data = post.get("data", {})
                        post_id = str(post_data.get("id") or "")
                        created = post_data.get("created_utc")
                        if created is None:
                            continue
                        happened_at = parse_reddit_time(created)
                        if happened_at < last_scan_date:
                            continue

                        title = str(post_data.get("title") or "")
                        body = str(post_data.get("selftext") or "")
                        post_text = f"{title} {body}".strip()
                        if not reddit_name_matches(post_text, cafe.name):
                            continue

                        hit_key = (post_id, cafe.name, "post")
                        if hit_key in seen_reddit_hits:
                            continue
                        seen_reddit_hits.add(hit_key)

                        target_absent = not any(
                            item.kind == "target" and reddit_name_matches(post_text, item.name)
                            for item in cafes
                        )
                        matched_keywords = [
                            keyword for keyword in reddit_keywords if keyword.lower() in post_text.lower()
                        ]
                        reddit_posts.append(
                            {
                                "cafe": cafe.name,
                                "subreddit": sub,
                                "title": title,
                                "body": body,
                                "happened_at": happened_at.isoformat(),
                                "sentiment": classify_reddit_sentiment(post_text),
                                "matched_keywords": matched_keywords,
                                "target_absent": target_absent,
                                "permalink": post_data.get("permalink"),
                            }
                        )
                        cafe_posts_found += 1

                        for comment in extract_reddit_comments(str(post_data.get("permalink") or ""), headers, last_scan_date):
                            comment_text = str(comment.get("text") or "")
                            if not reddit_name_matches(comment_text, cafe.name):
                                continue
                            comment_key = (str(comment.get("id") or ""), cafe.name, "comment")
                            if comment_key in seen_reddit_hits:
                                continue
                            seen_reddit_hits.add(comment_key)
                            reddit_posts.append(
                                {
                                    "cafe": cafe.name,
                                    "subreddit": sub,
                                    "title": title,
                                    "body": comment_text,
                                    "happened_at": comment["happened_at"].isoformat()
                                    if isinstance(comment.get("happened_at"), datetime)
                                    else None,
                                    "sentiment": classify_reddit_sentiment(comment_text),
                                    "matched_keywords": [
                                        keyword for keyword in reddit_keywords if keyword.lower() in comment_text.lower()
                                    ],
                                    "target_absent": not any(
                                        item.kind == "target" and reddit_name_matches(comment_text, item.name)
                                        for item in cafes
                                    ),
                                    "permalink": post_data.get("permalink"),
                                }
                            )
                            cafe_posts_found += 1
                except (requests.RequestException, ValueError):
                    reddit_attempts.append({"subreddit": sub, "query": query, "error_message": "request_or_parse_exception"})

        reddit_diagnostics.append(
            {
                "cafe": cafe.name,
                "fetched": fetched_any,
                "posts_found": cafe_posts_found,
                "subreddits": subreddits,
                "category_keywords": reddit_keywords,
                "attempts": reddit_attempts,
            }
        )
        if fetched_any:
            mark_stats_success(stats)
        else:
            mark_stats_fail(stats)

    competitor_websites: List[Dict[str, object]] = []
    website_keywords = [
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
    competitor_url_mapping = load_competitor_url_mapping(payload)
    for cafe_name, url in competitor_url_mapping.items():
        try:
            resp = requests.get(url, timeout=20)
            if resp.status_code != 200:
                competitor_website_diagnostics.append(
                    {
                        "cafe": cafe_name,
                        "url": url,
                        "fetched": False,
                        "matched_keywords": [],
                        "http_status": resp.status_code,
                    }
                )
                mark_stats_fail(stats)
                continue

            text = re.sub(r"\s+", " ", resp.text.lower())
            snippets = [keyword for keyword in website_keywords if keyword in text]
            competitor_websites.append(
                {
                    "cafe": cafe_name,
                    "url": url,
                    "content": text,
                }
            )
            competitor_website_diagnostics.append(
                {
                    "cafe": cafe_name,
                    "url": url,
                    "fetched": True,
                    "matched_keywords": snippets,
                    "http_status": resp.status_code,
                }
            )
            mark_stats_success(stats)
        except requests.RequestException:
            competitor_website_diagnostics.append(
                {
                    "cafe": cafe_name,
                    "url": url,
                    "fetched": False,
                    "matched_keywords": [],
                    "error_message": "request_exception",
                }
            )
            mark_stats_fail(stats)

    next_payload = dict(payload)
    next_payload["source_stats"] = stats
    next_payload["google_collected"] = google_collected
    next_payload["google_diagnostics"] = google_diagnostics
    next_payload["reddit_posts"] = reddit_posts
    next_payload["reddit_diagnostics"] = reddit_diagnostics
    next_payload["competitor_websites"] = competitor_websites
    next_payload["competitor_website_diagnostics"] = competitor_website_diagnostics
    stage_outputs = dict(next_payload.get("stage_outputs") or {})
    stage_outputs["source_collection"] = {
        "google_targets_checked": len([place for place in payload.get("google_places", []) if isinstance(place, dict)]),
        "google_records": len(google_collected),
        "reddit_posts": len(reddit_posts),
        "competitor_websites": len(competitor_websites),
        "reddit_targets_checked": len(reddit_diagnostics),
        "reddit_targets_with_posts": sum(1 for item in reddit_diagnostics if item.get("posts_found")),
        "competitor_websites_checked": len(competitor_website_diagnostics),
        "competitor_websites_fetched": sum(1 for item in competitor_website_diagnostics if item.get("fetched")),
    }
    next_payload["stage_outputs"] = stage_outputs
    return next_payload


def signal_extraction(payload: Dict[str, object]) -> Dict[str, object]:
    cafes_by_name = {
        cafe["name"]: cafe_from_dict(cafe)
        for cafe in payload.get("all_cafes", [])
        if isinstance(cafe, dict) and cafe.get("name")
    }

    signals: List[Signal] = []
    for entry in payload.get("google_collected", []):
        if not isinstance(entry, dict):
            continue

        rating = entry.get("rating")
        resolved_name = entry.get("resolved_name") or entry.get("cafe")
        reviews_count = entry.get("reviews_count")
        if rating is not None:
            signals.append(
                Signal(
                    source="google_maps",
                    cafe=str(entry.get("cafe") or ""),
                    kind="rating_snapshot",
                    summary=f"{resolved_name}: Rating {rating} from {reviews_count} reviews.",
                    impact=6 if rating and float(rating) < 4.2 else 4,
                    confidence=8.5,
                )
            )

        cafe = cafes_by_name.get(str(entry.get("cafe") or ""))
        context = entry.get("details_context")
        if cafe and isinstance(context, dict) and context.get("api_status") == "OK":
            signals.extend(build_google_review_signals(cafe, context))

    for post in payload.get("reddit_posts", []):
        if not isinstance(post, dict):
            continue
        title = str(post.get("title") or "")
        body = str(post.get("body") or "")
        text = f"{title} {body}".strip()
        happened_at_raw = post.get("happened_at")
        happened_at = datetime.fromisoformat(happened_at_raw) if isinstance(happened_at_raw, str) else None
        confidence = score_confidence_from_text(text)
        sentiment = str(post.get("sentiment") or classify_reddit_sentiment(text))
        target_absent = bool(post.get("target_absent"))
        matched_keywords = post.get("matched_keywords")
        keyword_suffix = (
            f" Matched keywords: {', '.join([str(item) for item in matched_keywords[:4]])}."
            if isinstance(matched_keywords, list) and matched_keywords
            else ""
        )
        signals.append(
            Signal(
                source="reddit",
                cafe=str(post.get("cafe") or ""),
                kind="reddit_target_absent_opportunity" if target_absent else "discussion_signal",
                summary=(
                    f"{text[:220]} Sentiment: {sentiment}.{keyword_suffix}"
                    if text
                    else f"Mentioned in Reddit discussion. Sentiment: {sentiment}.{keyword_suffix}"
                ),
                impact=score_reddit_impact(text, sentiment, happened_at, last_scan_date, target_absent),
                confidence=confidence,
                happened_at=happened_at,
            )
        )

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
    for website in payload.get("competitor_websites", []):
        if not isinstance(website, dict):
            continue
        text = str(website.get("content") or "")
        snippets = [keyword for keyword in keywords if keyword in text]
        if snippets:
            signals.append(
                Signal(
                    source="competitor_url",
                    cafe=str(website.get("cafe") or ""),
                    kind="menu_pricing_signal",
                    summary=f"Detected website keywords: {', '.join(snippets[:4])}.",
                    impact=5,
                    confidence=7.5,
                )
            )

    kept, noise = filter_confident_signals(signals)
    resolved = resolve_conflicts(kept)
    noise_payload = [
        {
            "source": signal.source,
            "cafe": signal.cafe,
            "kind": signal.kind,
            "summary": signal.summary,
            "impact": signal.impact,
            "confidence": signal.confidence,
        }
        for signal in noise
    ]

    next_payload = dict(payload)
    next_payload["raw_signals"] = [signal_to_dict(signal) for signal in signals]
    next_payload["kept_signals"] = [signal_to_dict(signal) for signal in kept]
    next_payload["noise_log"] = noise_payload
    next_payload["resolved_signals"] = [signal_to_dict(signal) for signal in resolved]
    next_payload["source_diagnostics"] = {
        "source_stats": payload.get("source_stats", stats_dict()),
        "google_maps": payload.get("google_diagnostics", []),
        "reddit": payload.get("reddit_diagnostics", []),
        "competitor_urls": payload.get("competitor_website_diagnostics", []),
    }
    stage_outputs = dict(next_payload.get("stage_outputs") or {})
    stage_outputs["signal_extraction"] = {
        "raw_signals": len(signals),
        "kept_signals": len(kept),
        "resolved_signals": len(resolved),
        "noise_signals": len(noise),
    }
    next_payload["stage_outputs"] = stage_outputs
    return next_payload


def pressure_scoring(payload: Dict[str, object]) -> Dict[str, object]:
    week_label = pipeline_week_label(payload.get("last_scan_date"))
    competition = [cafe_from_dict(item) for item in payload.get("competition", [])]
    resolved_signals = [signal_from_dict(item) for item in payload.get("resolved_signals", []) if isinstance(item, dict)]
    pressure_scores = build_pressure_scores(week_label, competition, resolved_signals)

    next_payload = dict(payload)
    next_payload["pressure_scores"] = pressure_scores
    stage_outputs = dict(next_payload.get("stage_outputs") or {})
    stage_outputs["pressure_scoring"] = {
        "week": week_label,
        "competitors_scored": len(pressure_scores),
        "highest_total_pressure": max(
            [int(item.get("total_pressure") or 0) for item in pressure_scores],
            default=0,
        ),
        "sources_fired": sorted(
            {
                source
                for item in pressure_scores
                for source in item.get("sources_fired", [])
                if isinstance(source, str)
            }
        ),
    }
    next_payload["stage_outputs"] = stage_outputs
    return next_payload


def report_generation(payload: Dict[str, object]) -> Dict[str, object]:
    last_scan_date = parse_pipeline_date(payload.get("last_scan_date"), "last_scan_date")
    targets = [cafe_from_dict(item) for item in payload.get("targets", [])]
    competition = [cafe_from_dict(item) for item in payload.get("competition", [])]
    resolved_signals = [signal_from_dict(item) for item in payload.get("resolved_signals", []) if isinstance(item, dict)]
    source_stats_payload = payload.get("source_stats")
    failure_ratio = 0.0
    if isinstance(source_stats_payload, dict):
        failure_ratio = float(source_stats_payload.get("failure_ratio") or 0.0)

    report = build_report(last_scan_date, targets, competition, resolved_signals, failure_ratio > 0.30)

    next_payload = dict(payload)
    next_payload["report"] = report
    next_payload["dashboard_summary"] = render_dashboard(report)
    stage_outputs = dict(next_payload.get("stage_outputs") or {})
    stage_outputs["report_generation"] = {
        "market_status": report.get("market_status"),
        "target_leads": len(report.get("target_leads", [])),
        "competitor_delta": len(report.get("competitor_delta", [])),
    }
    next_payload["stage_outputs"] = stage_outputs
    return next_payload


def decision_pack_generation(payload: Dict[str, object]) -> Dict[str, object]:
    context = {
        "project_id": payload.get("project_id"),
        "project_name": payload.get("project_name"),
        "industry": payload.get("industry"),
        "location_focus": payload.get("location_focus"),
        "targets": payload.get("targets", []),
        "competition": payload.get("competition", []),
        "pressure_scores": payload.get("pressure_scores", []),
        "resolved_signals": payload.get("resolved_signals", []),
        "previous_signals": payload.get("previous_signals", []),
        "source_diagnostics": payload.get("source_diagnostics", {}),
    }
    decision_pack = generate_decision_pack(context)

    next_payload = dict(payload)
    next_payload["decision_pack"] = decision_pack
    stage_outputs = dict(next_payload.get("stage_outputs") or {})
    stage_outputs["decision_pack_generation"] = {
        "primary_move_type": decision_pack.get("primary_move", {}).get("type")
        if isinstance(decision_pack.get("primary_move"), dict)
        else None,
        "confidence_score": decision_pack.get("confidence_score"),
        "evidence_items": len(decision_pack.get("evidence_items", []))
        if isinstance(decision_pack.get("evidence_items"), list)
        else 0,
        "snapshot_candidates": len(decision_pack.get("source_flags", {}).get("snapshot_candidates", []))
        if isinstance(decision_pack.get("source_flags"), dict)
        else 0,
    }
    next_payload["stage_outputs"] = stage_outputs
    return next_payload


def notification(payload: Dict[str, object]) -> Dict[str, object]:
    next_payload = dict(payload)
    next_payload["final_output"] = {
        "report": payload.get("report", {}),
        "noise_log": payload.get("noise_log", []),
        "resolved_signals": payload.get("resolved_signals", []),
        "pressure_scores": payload.get("pressure_scores", []),
        "decision_pack": payload.get("decision_pack", {}),
        "source_diagnostics": payload.get("source_diagnostics", {}),
        "dashboard_summary": payload.get("dashboard_summary", ""),
        "stage_outputs": payload.get("stage_outputs", {}),
    }
    stage_outputs = dict(next_payload.get("stage_outputs") or {})
    stage_outputs["notification"] = {
        "prepared": True,
        "keys": list(next_payload["final_output"].keys()),
    }
    next_payload["stage_outputs"] = stage_outputs
    return next_payload


STAGE_FUNCTIONS: Dict[str, Callable[[Dict[str, object]], Dict[str, object]]] = {
    "input_normalization": input_normalization,
    "place_resolution": place_resolution,
    "source_collection": source_collection,
    "signal_extraction": signal_extraction,
    "pressure_scoring": pressure_scoring,
    "report_generation": report_generation,
    "decision_pack_generation": decision_pack_generation,
    "notification": notification,
}


def execute_stage(stage_name: str, payload: Dict[str, object]) -> Dict[str, object]:
    stage = STAGE_FUNCTIONS.get(stage_name)
    if not stage:
        raise ValueError(f"Unknown stage `{stage_name}`")

    print(f"[pipeline] stage={stage_name} start", file=sys.stderr)
    try:
        next_payload = stage(payload)
    except Exception as exc:
        print(f"[pipeline] stage={stage_name} error: {exc}", file=sys.stderr)
        raise
    print(f"[pipeline] stage={stage_name} end", file=sys.stderr)
    return next_payload


def run_pipeline(payload: Dict[str, object]) -> Dict[str, object]:
    for stage_name in STAGE_FUNCTIONS:
        payload = execute_stage(stage_name, payload)
    return payload


def run_stage(stage_name: str, payload: Dict[str, object]) -> Dict[str, object]:
    return execute_stage(stage_name, payload)


def run() -> int:
    root = os.path.dirname(os.path.abspath(__file__))
    plan_path = os.path.join(root, "PLAN.md")
    output_dir = os.getenv("PIPELINE_OUTPUT_DIR", root)
    if not os.path.isabs(output_dir):
        output_dir = os.path.join(root, output_dir)
    os.makedirs(output_dir, exist_ok=True)

    report_path = os.path.join(output_dir, "weekly_intel_report.json")
    dashboard_path = os.path.join(output_dir, "Dashboard_Summary.md")
    noise_log_path = os.path.join(output_dir, "noise_log.json")
    diagnostics_path = os.path.join(output_dir, "source_diagnostics.json")
    project_config_path = os.getenv("PROJECT_CONFIG_PATH")

    if project_config_path:
        resolved_config_path = (
            project_config_path
            if os.path.isabs(project_config_path)
            else os.path.join(root, project_config_path)
        )
        last_scan_date, location_focus, targets, competition = parse_project_config(resolved_config_path)
    else:
        last_scan_date, location_focus, targets, competition = parse_plan(plan_path)

    pipeline_payload = run_pipeline(
        {
            "last_scan_date": last_scan_date.strftime("%Y-%m-%d"),
            "location_focus": location_focus,
            "targets": [cafe_to_dict(cafe) for cafe in targets],
            "competition": [cafe_to_dict(cafe) for cafe in competition],
        }
    )
    final_output = pipeline_payload.get("final_output", {})
    report = final_output.get("report", {})

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    with open(noise_log_path, "w", encoding="utf-8") as f:
        json.dump(final_output.get("noise_log", []), f, indent=2)

    with open(diagnostics_path, "w", encoding="utf-8") as f:
        json.dump(final_output.get("source_diagnostics", {}), f, indent=2)

    with open(dashboard_path, "w", encoding="utf-8") as f:
        f.write(str(final_output.get("dashboard_summary", "")))
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
