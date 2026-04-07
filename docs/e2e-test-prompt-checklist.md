# Local Edge Weekly E2E Test Prompt And Checklist

Use this prompt in Antigravity, VS Code, or any other coding agent so each runner tests the same thing and reports results in the same shape.

## Agent Prompt

```text
You are testing the Local Edge Weekly branch `codex/intel-fusion-engine`.

Goal: run a full e2e pass for the Intel Fusion Engine + Decision Pack work. Do not start by refactoring. First reproduce and record exact behavior, logs, URLs, screenshots if useful, and failing commands. Only propose fixes after the checklist is complete, unless a tiny unblocker is required to continue.

Important context:
- Supabase migration `supabase/migrations/20260407_decision_packs.sql` has been run successfully.
- Python is installed through Scoop. Use `python3`, not `python`.
- `.env` and `.env.local` should use `PYTHON_BIN=python3`.
- The latest pushed branch is `codex/intel-fusion-engine`.
- Known prior issue: `npm.cmd run build` hung twice in Codex with no useful output, while `npx.cmd tsc --noEmit` passed.
- Screenshot comparison is currently wired as snapshot metadata/UI/API. Real Playwright screenshot capture/storage may still need follow-up.

Report back using:
1. Environment summary
2. Command results
3. E2E flow results
4. Bugs found, with exact logs and URLs
5. Suggested fixes, ordered by impact
```

## Setup Checks

- Confirm branch:
  - `git branch --show-current`
  - Expected: `codex/intel-fusion-engine`
- Confirm clean or understood worktree:
  - `git status --short --branch`
  - Expected known untracked file may be `docs/local_edge_spec.docx`.
- Confirm Python:
  - `where.exe python3`
  - `python3 --version`
  - `python3 -m pip --version`
  - Expected: Scoop Python shim and Python 3.14.3 or newer.
- Confirm env:
  - `Select-String -Path .env,.env.local -Pattern '^PYTHON_BIN='`
  - Expected: `PYTHON_BIN=python3`.

## Static Verification

- Python compile:
  - `python3 -m py_compile pipeline.py decision_engine.py`
  - Expected: no output, exit code 0.
- Decision engine offline smoke:
  - Run:
    ```powershell
    $env:GEMINI_API_KEY=''; $env:AI_STUDIO_API_KEY='';
    @'
    from decision_engine import generate_decision_pack
    pack = generate_decision_pack({
        "pressure_scores": [{"competitor_name":"Gami CBD","week":"2026-W15","scores":{"lunch_office_pressure":8,"bundle_pressure":6},"total_pressure":14,"sources_fired":["reddit","website_delta"]}],
        "resolved_signals": [{"source":"reddit","cafe":"Gami CBD","kind":"discussion_signal","summary":"Best lunch CBD bundle mention.","impact":8,"confidence":8.5}],
        "source_diagnostics": {"competitor_urls": []},
    })
    print(pack["primary_move"]["type"], pack["confidence_score"])
    '@ | python3 -
    ```
  - Expected: prints a move type and confidence score, for example `push_group_order 92`.
- TypeScript:
  - `npx.cmd tsc --noEmit`
  - Expected: no output, exit code 0.
- Full build:
  - `npm.cmd run build`
  - Expected: should complete. If it hangs, record elapsed time, active Node PIDs started during the build, and last visible output.

## App E2E Flow

- Start dev server:
  - `npm.cmd run dev`
  - Record local URL and any startup warnings.
- Auth:
  - Visit `/login`.
  - Confirm magic-link/login route still renders and does not throw.
- Project setup:
  - Visit `/projects/new`.
  - Create or use a test project with one primary URL and at least two competitor URLs.
  - Confirm target management page still renders.
- Run lifecycle:
  - Trigger a project run from the UI.
  - Confirm run becomes queued/running/completed or partial.
  - If it fails, capture the run ID and stage checkpoint payload.
- Pipeline persistence:
  - Confirm a `reports` row is created.
  - Confirm a `decision_packs` row is created for the same `run_id`.
  - Confirm `reports.body.decision_pack_id` points to that decision pack.
- Report UI:
  - Open `/reports/:reportId`.
  - Confirm Decision Pack hero appears above Owner Briefing.
  - Confirm confidence score, pressure chips, Why Now, Expected Effect, Execution Kit, and Watch Next Week render.
  - Click Owner/Evidence toggle and confirm both states work.
  - Test copy buttons for owner brief, staff brief, promo lines, SMS caption, and delivery description.
- Snapshot metadata:
  - Call `GET /api/v1/projects/:id/snapshots`.
  - Expected: returns `data: []` if no website-delta candidate, or snapshot metadata rows if website delta fired.
  - Confirm snapshot panel only renders when snapshot data exists.

## Demo Seed Flow

- Optional after database is ready:
  - `node scripts/seed-demo-history.mjs`
- Expected:
  - Creates or replaces the Seoul Crunch demo project.
  - Seeds multiple reports.
  - Seeds `decision_packs` for those runs.
  - Demo decision packs carry `demo_flag: true`.
- Open the latest seeded report and confirm the hero shows a Demo Data badge.

## Things To Watch

- Python command must be `python3`, not `python`.
- LLM evidence must not invent facts. The Decision Pack should only refer to stored evidence items.
- A run can be `partial` if persistence warnings occur. Inspect stage checkpoints before assuming the whole run failed.
- Snapshot image URLs may be null until real Playwright capture/storage is added.
- If `npm.cmd run build` hangs again, isolate whether it is Next build, static generation, Supabase auth/env access, or a lingering dev server process.
