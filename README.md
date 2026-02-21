# Local Edge Weekly

MVP pipeline for weekly local cafe competitive-intelligence reporting.

## Outputs

- `weekly_intel_report.json` (strict contract fields: `timestamp`, `market_status`, `competitor_delta`, `target_leads`)
- `Dashboard_Summary.md` (top hooks + competitor deltas)
- `noise_log.json` (signals filtered out for confidence < 7)

## Run

1. Install dependencies:
   - `pip install -r requirements.txt`
2. Set any available API keys as env vars (optional but recommended):
   - `GEMINI_API_KEY` (Google AI Studio; used for hook phrasing)
   - `GOOGLE_MAPS_API_KEY`
   - `YELP_API_KEY`
   - `COMPETITOR_URLS_JSON` (JSON map: `{"Cafe Name":"https://example.com"}`)
3. Execute:
   - `python pipeline.py`

## Notes

- `PLAN.md` is the source of truth for `last_scan_date`, Targets, and Competition.
- The pipeline enforces confidence filtering, source precedence, and stop/failure behavior from `docs/SYSTEM_DOCS.md`.
- No Anthropic/OpenAI provider calls are used by the pipeline.
