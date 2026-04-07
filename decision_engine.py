import json
import os
import re
from typing import Dict, List, Optional, Tuple

import requests


MOVE_TYPES = [
    "launch_bundle",
    "defend_value",
    "win_lunch",
    "extend_late_night",
    "push_group_order",
    "highlight_signature",
    "test_limited_offer",
    "hold_position",
]

CATEGORY_MOVES = {
    "delivery_value_pressure": ["defend_value", "launch_bundle"],
    "bundle_pressure": ["launch_bundle", "push_group_order"],
    "lunch_office_pressure": ["win_lunch", "push_group_order"],
    "late_night_pressure": ["extend_late_night", "launch_bundle"],
    "urgency_offer_pressure": ["test_limited_offer", "defend_value"],
    "differentiation_pressure": ["highlight_signature", "hold_position"],
}

MOVE_TITLES = {
    "launch_bundle": "Launch a named bundle this week",
    "defend_value": "Defend value without copying the discount",
    "win_lunch": "Win the office lunch window",
    "extend_late_night": "Extend the late-night offer",
    "push_group_order": "Push the group order",
    "highlight_signature": "Make the signature item louder",
    "test_limited_offer": "Test a short limited offer",
    "hold_position": "Hold position and keep watching",
}

ASSET_PROMPTS = {
    "launch_bundle": {
        "owner_brief": "Run one named bundle with a clear price anchor and a simple deadline.",
        "staff_brief": "Mention the bundle first for groups and repeat the offer name consistently.",
        "promo_lines": [
            "One box, one easy decision.",
            "Built for the table, priced for the week.",
            "Order the bundle before the rush.",
        ],
        "sms_caption": "This week only: one named bundle, easy to order, ready for the rush.",
        "delivery_description": "A simple bundle built for fast ordering and clear value.",
    },
    "defend_value": {
        "owner_brief": "Answer competitor value pressure with a margin-aware add-on, not a blanket discount.",
        "staff_brief": "Lead with the value add and avoid promising anything outside the offer.",
        "promo_lines": [
            "More value, same quality.",
            "A smarter deal for this week.",
            "Add the upgrade before checkout.",
        ],
        "sms_caption": "A smarter value offer is live this week. Add the upgrade before checkout.",
        "delivery_description": "A value-led offer with a simple add-on for this week.",
    },
    "win_lunch": {
        "owner_brief": "Own the lunch window with one office-friendly offer Tuesday to Thursday.",
        "staff_brief": "Keep the lunch message short: what is included, when it is available, and who it is for.",
        "promo_lines": [
            "Lunch sorted before the rush.",
            "Built for the office window.",
            "Fast, clear, and ready by midday.",
        ],
        "sms_caption": "Lunch is sorted this week: one office-ready offer before the midday rush.",
        "delivery_description": "An office-friendly lunch option built for quick ordering.",
    },
    "extend_late_night": {
        "owner_brief": "Create a simple after-9pm offer so late-night searches have a clear answer.",
        "staff_brief": "Use the same offer name after 9pm across counter, delivery, and social copy.",
        "promo_lines": [
            "After 9, make it easy.",
            "Late-night box, no guesswork.",
            "One order for the night shift.",
        ],
        "sms_caption": "After 9pm this week: one late-night box, easy to order.",
        "delivery_description": "A late-night box designed for simple after-hours ordering.",
    },
    "push_group_order": {
        "owner_brief": "Make group ordering easier with a single shareable offer and clear serving language.",
        "staff_brief": "Mention who it feeds and keep the sauce or add-on options simple.",
        "promo_lines": [
            "One order for the whole table.",
            "Built for groups, ready for the rush.",
            "Share the box, skip the maths.",
        ],
        "sms_caption": "Ordering for the group? The share box is the easy choice this week.",
        "delivery_description": "A group-ready offer with clear serving and sauce choices.",
    },
    "highlight_signature": {
        "owner_brief": "Make the signature product the headline so the venue is not only competing on price.",
        "staff_brief": "Repeat the signature item name and the proof point customers can verify.",
        "promo_lines": [
            "The signature order is the reason to choose us.",
            "Lead with the item people remember.",
            "Make the signature impossible to miss.",
        ],
        "sms_caption": "This week, lead with the signature order people remember.",
        "delivery_description": "The signature item, made easy to find and order.",
    },
    "test_limited_offer": {
        "owner_brief": "Run a three-day offer with a visible deadline and one conversion goal.",
        "staff_brief": "Repeat the deadline, keep terms simple, and do not extend it unless the owner approves.",
        "promo_lines": [
            "Three days only.",
            "This week, while it lasts.",
            "A short run for fast movers.",
        ],
        "sms_caption": "Three days only: the weekly offer is live until the deadline.",
        "delivery_description": "A limited weekly offer with simple terms and a clear deadline.",
    },
    "hold_position": {
        "owner_brief": "Do not force a promo. Keep the current position and watch for a stronger signal next run.",
        "staff_brief": "Stay consistent. Do not introduce new claims until the next report confirms the pressure.",
        "promo_lines": [
            "Keep the strongest message steady.",
            "No forced discount this week.",
            "Stay consistent and watch the market.",
        ],
        "sms_caption": "No broad promo this week. Keep the strongest message steady.",
        "delivery_description": "The core offer remains steady while the market is monitored.",
    },
}


def gemini_api_key() -> Optional[str]:
    return os.getenv("GEMINI_API_KEY") or os.getenv("AI_STUDIO_API_KEY")


def clamp_score(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def score_level(value: int) -> str:
    if value >= 7:
        return "high"
    if value >= 4:
        return "medium"
    return "low"


def aggregate_pressure(pressure_scores: List[Dict[str, object]]) -> Dict[str, int]:
    totals: Dict[str, int] = {}
    for row in pressure_scores:
        scores = row.get("scores")
        if not isinstance(scores, dict):
            continue
        for key, value in scores.items():
            if isinstance(value, (int, float)):
                totals[key] = totals.get(key, 0) + int(value)
    return totals


def score_move_candidates(pressure_scores: List[Dict[str, object]]) -> List[Dict[str, object]]:
    pressure_totals = aggregate_pressure(pressure_scores)
    move_scores = {move: 0.0 for move in MOVE_TYPES}
    for category, total in pressure_totals.items():
        for move in CATEGORY_MOVES.get(category, []):
            move_scores[move] = move_scores.get(move, 0.0) + total

    if not any(move_scores.values()):
        move_scores["hold_position"] = 1.0

    max_score = max(move_scores.values()) or 1.0
    candidates = [
        {
            "type": move,
            "title": MOVE_TITLES[move],
            "score": round(clamp_score(score / max_score), 2),
        }
        for move, score in move_scores.items()
        if score > 0
    ]
    return sorted(candidates, key=lambda item: float(item["score"]), reverse=True)


def build_pressure_summary(pressure_scores: List[Dict[str, object]]) -> List[Dict[str, object]]:
    pressure_totals = aggregate_pressure(pressure_scores)
    rows = []
    for category, total in sorted(pressure_totals.items(), key=lambda item: item[1], reverse=True):
        competitors = [
            {
                "competitor": row.get("competitor_name"),
                "score": row.get("scores", {}).get(category, 0) if isinstance(row.get("scores"), dict) else 0,
            }
            for row in pressure_scores
            if isinstance(row.get("scores"), dict) and row.get("scores", {}).get(category, 0)
        ]
        rows.append(
            {
                "type": category,
                "level": score_level(total),
                "score": total,
                "competitors": sorted(competitors, key=lambda item: int(item.get("score") or 0), reverse=True)[:3],
            }
        )
    return rows[:6]


def build_evidence_items(signals: List[Dict[str, object]], pressure_scores: List[Dict[str, object]]) -> List[Dict[str, object]]:
    pressure_names = {str(row.get("competitor_name") or "") for row in pressure_scores}
    candidates = [
        signal
        for signal in signals
        if isinstance(signal, dict)
        and str(signal.get("cafe") or "") in pressure_names
        and str(signal.get("summary") or "").strip()
    ]

    def signal_rank(signal: Dict[str, object]) -> Tuple[float, float]:
        return (
            float(signal.get("impact") or 0),
            float(signal.get("confidence") or 0),
        )

    evidence = []
    for signal in sorted(candidates, key=signal_rank, reverse=True)[:8]:
        evidence.append(
            {
                "competitor": signal.get("cafe"),
                "signal_type": signal.get("kind"),
                "week": None,
                "source": signal.get("source"),
                "summary": signal.get("summary"),
                "demo_flag": bool(signal.get("demo_flag") or False),
            }
        )
    return evidence


def build_why_now(primary_move: Dict[str, object], pressure_summary: List[Dict[str, object]]) -> str:
    if not pressure_summary:
        return "This run did not find strong enough market pressure to justify a new promo. Keep monitoring."

    top = pressure_summary[0]
    competitor = ""
    competitors = top.get("competitors")
    if isinstance(competitors, list) and competitors:
        competitor = str(competitors[0].get("competitor") or "")
    pressure_label = str(top.get("type") or "market pressure").replace("_", " ")
    if competitor:
        return (
            f"{competitor} is creating {top.get('level')} {pressure_label}. "
            f"The strongest response is to {str(primary_move.get('title') or '').lower()}."
        )
    return f"The market is showing {top.get('level')} {pressure_label}, so the owner should make one focused move."


def build_watch_list(primary_move_type: str, pressure_summary: List[Dict[str, object]]) -> List[str]:
    watch = [
        "Check whether the same competitors repeat or drop the offer language next week.",
        "Watch for new Reddit mentions that praise a competitor while the target is absent.",
    ]
    if primary_move_type in {"win_lunch", "push_group_order"}:
        watch.append("Check whether lunch and office-order keywords expand across competitor pages.")
    if primary_move_type == "extend_late_night":
        watch.append("Check whether late-night bundle wording spreads to more competitors.")
    if primary_move_type == "test_limited_offer":
        watch.append("Check whether urgency language becomes a category pattern or fades after the weekend.")
    return watch[:4]


def build_snapshot_candidates(
    pressure_scores: List[Dict[str, object]],
    source_diagnostics: Dict[str, object],
) -> List[Dict[str, object]]:
    diagnostics = source_diagnostics.get("competitor_urls") if isinstance(source_diagnostics, dict) else []
    urls_by_name = {
        str(item.get("cafe") or ""): item
        for item in diagnostics
        if isinstance(item, dict) and item.get("fetched")
    }

    snapshots = []
    for row in pressure_scores:
        sources = row.get("sources_fired")
        if not isinstance(sources, list) or "website_delta" not in sources:
            continue
        if int(row.get("total_pressure") or 0) < 6:
            continue
        competitor = str(row.get("competitor_name") or "")
        diagnostic = urls_by_name.get(competitor)
        if not diagnostic:
            continue
        matched_keywords = diagnostic.get("matched_keywords") if isinstance(diagnostic.get("matched_keywords"), list) else []
        snapshots.append(
            {
                "competitor": competitor,
                "url": diagnostic.get("url"),
                "trigger_score": row.get("total_pressure"),
                "current_image_url": None,
                "previous_image_url": None,
                "diff_summary": (
                    f"Website delta fired from tracked keyword changes: {', '.join([str(item) for item in matched_keywords[:5]])}."
                    if matched_keywords
                    else "Website delta fired from the competitor page fetch."
                ),
                "capture_note": "Screenshot storage is optional until the Playwright capture worker is available.",
            }
        )
    return snapshots[:4]


def fallback_decision_pack(context: Dict[str, object]) -> Dict[str, object]:
    pressure_scores = context.get("pressure_scores")
    signals = context.get("resolved_signals")
    source_diagnostics = context.get("source_diagnostics")
    if not isinstance(pressure_scores, list):
        pressure_scores = []
    if not isinstance(signals, list):
        signals = []
    if not isinstance(source_diagnostics, dict):
        source_diagnostics = {}

    candidates = score_move_candidates(pressure_scores)
    primary = candidates[0] if candidates else {"type": "hold_position", "title": MOVE_TITLES["hold_position"], "score": 1.0}
    secondary = candidates[1] if len(candidates) > 1 else {"type": "hold_position", "title": MOVE_TITLES["hold_position"], "score": 0.5}
    pressure_summary = build_pressure_summary(pressure_scores)
    evidence = build_evidence_items(signals, pressure_scores)
    primary_type = str(primary.get("type") or "hold_position")
    assets = ASSET_PROMPTS.get(primary_type, ASSET_PROMPTS["hold_position"])
    confidence = int(round(float(primary.get("score") or 0.5) * 100))
    week_label = next(
        (str(item.get("week")) for item in pressure_scores if isinstance(item, dict) and item.get("week")),
        None,
    )

    return {
        "week_label": week_label,
        "primary_move": primary,
        "secondary_move": secondary,
        "pressure_summary": pressure_summary,
        "why_now": build_why_now(primary, pressure_summary),
        "evidence_items": evidence,
        "expected_effect": "Best hypothesis: this move gives the owner one clear answer to the strongest pressure detected this week.",
        "confidence_score": max(45, min(92, confidence)),
        "execution_assets": assets,
        "watch_next_week": build_watch_list(primary_type, pressure_summary),
        "source_flags": {
            "demo_flag": any(bool(item.get("demo_flag")) for item in evidence if isinstance(item, dict)),
            "sources_fired": sorted(
                {
                    source
                    for row in pressure_scores
                    if isinstance(row, dict)
                    for source in (row.get("sources_fired") or [])
                    if isinstance(source, str)
                }
            ),
            "snapshot_candidates": build_snapshot_candidates(pressure_scores, source_diagnostics),
        },
    }


def strip_json_fence(value: str) -> str:
    text = value.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def coerce_llm_pack(candidate: Dict[str, object], fallback: Dict[str, object]) -> Dict[str, object]:
    next_pack = dict(fallback)
    for key in ["why_now", "expected_effect"]:
        value = candidate.get(key)
        if isinstance(value, str) and value.strip():
            next_pack[key] = value.strip()

    assets = candidate.get("execution_assets")
    if isinstance(assets, dict):
        fallback_assets = dict(next_pack.get("execution_assets") or {})
        for key in ["owner_brief", "staff_brief", "sms_caption", "delivery_description"]:
            value = assets.get(key)
            if isinstance(value, str) and value.strip():
                fallback_assets[key] = value.strip()
        promo_lines = assets.get("promo_lines")
        if isinstance(promo_lines, list):
            fallback_assets["promo_lines"] = [str(item).strip() for item in promo_lines if str(item).strip()][:3]
        next_pack["execution_assets"] = fallback_assets

    watch_next_week = candidate.get("watch_next_week")
    if isinstance(watch_next_week, list):
        next_pack["watch_next_week"] = [str(item).strip() for item in watch_next_week if str(item).strip()][:4]

    confidence = candidate.get("confidence_score")
    if isinstance(confidence, (int, float)):
        next_pack["confidence_score"] = int(max(35, min(95, round(confidence))))

    return next_pack


def llm_decision_pack(context: Dict[str, object], fallback: Dict[str, object]) -> Optional[Dict[str, object]]:
    api_key = gemini_api_key()
    if not api_key:
        return None

    prompt = {
        "instruction": (
            "Return a concise JSON decision pack for a local business owner. "
            "Only reference facts from the provided evidence_items array. "
            "Do not invent competitors, prices, dates, outcomes, or evidence. "
            "Keep max one primary move and one fallback move."
        ),
        "project": {
            "name": context.get("project_name"),
            "industry": context.get("industry"),
            "location": context.get("location_focus"),
        },
        "primary_move": fallback.get("primary_move"),
        "secondary_move": fallback.get("secondary_move"),
        "pressure_summary": fallback.get("pressure_summary"),
        "evidence_items": fallback.get("evidence_items"),
        "required_keys": [
            "why_now",
            "expected_effect",
            "confidence_score",
            "execution_assets",
            "watch_next_week",
        ],
    }
    payload = {
        "contents": [{"parts": [{"text": json.dumps(prompt, ensure_ascii=True)}]}],
        "generationConfig": {"response_mime_type": "application/json"},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key={api_key}"

    try:
        response = requests.post(url, headers={"Content-Type": "application/json"}, json=payload, timeout=35)
        if response.status_code != 200:
            return None
        data = response.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        candidate = json.loads(strip_json_fence(text))
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
        return None

    if not isinstance(candidate, dict):
        return None
    return coerce_llm_pack(candidate, fallback)


def generate_decision_pack(context: Dict[str, object]) -> Dict[str, object]:
    fallback = fallback_decision_pack(context)
    llm_pack = llm_decision_pack(context, fallback)
    return llm_pack or fallback
