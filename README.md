# Local Edge Weekly

MVP pipeline for weekly local venue competitive-intelligence reporting.

## Outputs

- `weekly_intel_report.json` (strict contract fields: `timestamp`, `market_status`, `competitor_delta`, `target_leads`)
- `Dashboard_Summary.md` (top hooks + competitor deltas)
- `noise_log.json` (signals filtered out for confidence < 7)
- `source_diagnostics.json` (source-level lookup diagnostics, including Google Maps statuses)

## Run

1. Install dependencies:
   - `pip install -r requirements.txt`
2. Set any available API keys as env vars (optional but recommended):
   - `GEMINI_API_KEY` (Google AI Studio; used for hook phrasing)
   - `GOOGLE_MAPS_API_KEY`
   - `COMPETITOR_URLS_JSON` (JSON map: `{"Venue Name":"https://example.com"}` for any target or competitor venue website)
   - `GOOGLE_MAPS_PLACES_JSON` (JSON map of venue name to exact Google Maps place ID, search URL, or Maps URL)
3. Execute:
   - `python pipeline.py`

## Notes

- The pipeline auto-loads `.env` from the repo root at startup.
- `PLAN.md` is the source of truth for `last_scan_date`, `location_focus`, Targets, and Competition.
- Google Maps Place Details is used for ratings, review-derived strengths/issues, hours, and website context.
- The pipeline enforces confidence filtering, source precedence, and stop/failure behavior from `docs/SYSTEM_DOCS.md`.
- No Anthropic/OpenAI provider calls are used by the pipeline.
