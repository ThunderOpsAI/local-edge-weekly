# Local Edge Weekly Implementation Brief

## Product Goal

Any customer, regardless of industry, should be able to log in to a dashboard, enter a target business plus competitor URLs, and receive analytics that highlight strengths, risks, and opportunities.

The current Python pipeline proves the signal model. The next build stage productizes that engine into an authenticated, multi-tenant application with saved runs, diagnostics, and trend history.

## Challenged Decisions

### Partial Success Policy

Runs should complete with a transparent coverage score instead of failing whenever one source is missing. The correct operating model is partial success with explicit diagnostics.

- Always complete a run unless zero signals are collected.
- Compute `coverage_score` as `signals_found / signals_expected`.
- Mark the run as `partial` when coverage falls below a configured threshold.
- Persist target-level statuses as `resolved`, `failed`, or `skipped` so trends can still compare partial runs.

Why:
- Customers still get value from incomplete but transparent results.
- Operators can identify weak sources without discarding good ones.
- Trend history becomes more useful because partial runs are still stored.

### Strategy Classes vs Config

Use a config-first industry model for the MVP, with a thin adapter layer. Introduce strategy classes only when industry-specific behavior truly cannot be represented in configuration.

Why:
- Adding a new industry should not require a redeploy.
- Most industries can share the same collection and extraction flow with different keywords, labels, and thresholds.
- The first three industries are better served by fast iteration than by heavy class hierarchies.

## Milestones

### M1: Contract and Foundation

- Authentication and account model
- Database schema and RLS
- Project, target, and competitor inputs
- Industry profile format
- Credit model

### M2: Engine and API

- Job-based analysis runner
- Stage checkpoints and resumability
- Canonical signals table
- Coverage scoring
- Reports and diagnostics APIs

### M3: Dashboard and Trends

- Project setup flow
- Latest report view
- Diagnostics view
- Run history
- Trend deltas after two or more completed runs

## Schema Summary

Core entities:

- `accounts`
- `users`
- `projects`
- `project_targets`
- `analysis_runs`
- `run_stage_checkpoints`
- `signals`
- `reports`
- `run_diagnostics`

Important design choices:

- `account_id` is denormalized into hot tables to simplify RLS and reduce joins.
- `structured_insight` is JSONB so signal types can evolve without schema churn.
- Stage checkpoints enable safe retries and resumable jobs.
- Reports are versioned and stored, not regenerated on demand.

## API Summary

Authentication:

- `POST /api/v1/auth/magic-link`
- `GET /api/v1/auth/callback`

Projects:

- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/:id`
- `PATCH /api/v1/projects/:id`
- `DELETE /api/v1/projects/:id`

Targets:

- `POST /api/v1/projects/:id/targets`
- `DELETE /api/v1/projects/:id/targets/:tid`

Runs:

- `POST /api/v1/projects/:id/runs`
- `GET /api/v1/projects/:id/runs`
- `GET /api/v1/runs/:run_id`
- `GET /api/v1/runs/:run_id/diagnostics`

Reports:

- `GET /api/v1/projects/:id/reports/latest`
- `GET /api/v1/reports/:report_id`
- `PATCH /api/v1/reports/:report_id/approve`

Trends:

- `GET /api/v1/projects/:id/trends`

## Job Flow

Stages:

1. `input_normalization`
2. `place_resolution`
3. `source_collection`
4. `signal_extraction`
5. `report_generation`
6. `notification`

Each stage writes a checkpoint. If a retry occurs, completed stages are skipped.

## Dashboard Screens

Initial dashboard screens:

- Project list
- Project setup
- Latest report
- Diagnostics
- Run history
- Trends

## MVP Rules

- Platform-owned API keys stay server-side.
- User inputs come from the app, not `.env` or `PLAN.md`.
- Dashboard must always show source diagnostics.
- Industry support is profile-driven.
- Partial reports are allowed and clearly marked.
