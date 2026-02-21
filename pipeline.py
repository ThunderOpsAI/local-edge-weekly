import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import requests


SOURCE_AUTHORITY = {
    "google_maps": 4,
    "reddit": 3,
    "yelp_tripadvisor": 2,
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


def parse_plan(plan_path: str) -> Tuple[datetime, List[Cafe], List[Cafe]]:
    with open(plan_path, "r", encoding="utf-8") as f:
        content = f.read().splitlines()

    last_scan_date = None
    targets: List[Cafe] = []
    competition: List[Cafe] = []
    current_section = None

    for line in content:
        stripped = line.strip()
        if stripped.startswith("- last_scan_date:"):
            value = stripped.split(":", 1)[1].strip()
            last_scan_date = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
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
    if not targets or not competition:
        raise ValueError("PLAN.md must include both Targets and Competition sections")
    return last_scan_date, targets, competition


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


def get_ai_studio_key() -> Optional[str]:
    return os.getenv("GEMINI_API_KEY") or os.getenv("AI_STUDIO_API_KEY")


def generate_hook_with_gemini(target_name: str, gap: str, competitor_issue: str) -> Optional[str]:
    api_key = get_ai_studio_key()
    if not api_key:
        return None

    prompt = (
        "You are generating a concise sales hook for a local cafe intelligence report.\n"
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


def fetch_google_maps_signals(cafes: List[Cafe], stats: SourceStats) -> List[Signal]:
    key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not key:
        return []

    signals: List[Signal] = []
    for cafe in cafes:
        try:
            url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
            params = {"query": f"{cafe.name} Prahran VIC", "key": key}
            resp = requests.get(url, params=params, timeout=20)
            if resp.status_code != 200:
                stats.mark_fail()
                continue

            payload = resp.json()
            results = payload.get("results", [])
            if not results:
                stats.mark_success()
                continue

            top = results[0]
            rating = top.get("rating")
            reviews_count = top.get("user_ratings_total")
            if rating is None:
                stats.mark_success()
                continue

            text = f"Rating {rating} from {reviews_count} reviews."
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
            stats.mark_success()
        except requests.RequestException:
            stats.mark_fail()
    return signals


def parse_reddit_time(created_utc: float) -> datetime:
    return datetime.fromtimestamp(created_utc, tz=timezone.utc)


def fetch_reddit_signals(cafes: List[Cafe], last_scan_date: datetime, stats: SourceStats) -> List[Signal]:
    headers = {"User-Agent": "local-edge-weekly/1.0"}
    subreddits = ["melbourne", "prahran", "coffee"]
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


def fetch_yelp_tripadvisor_signals(cafes: List[Cafe], stats: SourceStats) -> List[Signal]:
    # Yelp requires API key; TripAdvisor public API generally requires onboarding.
    yelp_key = os.getenv("YELP_API_KEY")
    if not yelp_key:
        return []

    headers = {"Authorization": f"Bearer {yelp_key}"}
    signals: List[Signal] = []
    for cafe in cafes:
        try:
            resp = requests.get(
                "https://api.yelp.com/v3/businesses/search",
                params={"term": cafe.name, "location": "Prahran VIC"},
                headers=headers,
                timeout=20,
            )
            if resp.status_code != 200:
                stats.mark_fail()
                continue

            businesses = resp.json().get("businesses", [])
            if businesses:
                b = businesses[0]
                rating = b.get("rating")
                count = b.get("review_count")
                signals.append(
                    Signal(
                        source="yelp_tripadvisor",
                        cafe=cafe.name,
                        kind="rating_snapshot",
                        summary=f"Yelp rating {rating} from {count} reviews.",
                        impact=6 if rating and rating < 4.0 else 4,
                        confidence=8.0,
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
    for cafe_name, url in mapping.items():
        try:
            resp = requests.get(url, timeout=20)
            if resp.status_code != 200:
                stats.mark_fail()
                continue

            text = re.sub(r"\s+", " ", resp.text.lower())
            snippets = []
            for keyword in ["special", "new menu", "price", "limited time", "booking"]:
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

    for s in comp_signals[:20]:
        competitor_delta.append([s.cafe, s.summary[:180], int(max(1, min(10, s.impact)))])

    comp_issues = [s for s in comp_signals if s.impact >= 7]
    default_issue = "Data Unavailable" if not comp_issues else comp_issues[0].summary
    for t in targets:
        relevant = [s for s in target_signals if s.cafe == t.name]
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

    last_scan_date, targets, competition = parse_plan(plan_path)
    all_cafes = targets + competition

    stats = SourceStats()
    signals: List[Signal] = []
    signals.extend(fetch_google_maps_signals(all_cafes, stats))
    signals.extend(fetch_reddit_signals(all_cafes, last_scan_date, stats))
    signals.extend(fetch_yelp_tripadvisor_signals(all_cafes, stats))
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

    write_dashboard(report, dashboard_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
