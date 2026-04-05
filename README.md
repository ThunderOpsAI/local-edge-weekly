# Local Edge Weekly

Local Edge Weekly is moving from a file-driven Python prototype into a customer-facing competitive intelligence product.

## What Exists Today

- A working Python engine in `pipeline.py`
- Google Maps venue resolution and review-derived signals
- Website keyword extraction
- Generated report artifacts:
  - `weekly_intel_report.json`
  - `Dashboard_Summary.md`
  - `noise_log.json`
  - `source_diagnostics.json`

## What Was Added In This Scaffold

- Product and architecture docs under `docs/product` and `docs/architecture`
- Initial Supabase schema under `supabase/migrations`
- Industry profile config under `industry_profiles`
- A Next.js dashboard shell under `app`
- API route scaffolding under `app/api/v1`

The dashboard currently reads the existing local report artifacts so we can review the product shape before wiring Supabase and background jobs.

There is also a bridge artifact at `lib/mock/project-config.sample.json` that matches the new JSON config path supported by `pipeline.py`.

## Supabase Setup

If you are creating the Supabase project now, the SQL you want to paste into the SQL editor is:

- `supabase/migrations/20260404_initial_schema.sql`

Suggested first-time setup:

1. Create a new Supabase project.
2. Open the SQL Editor.
3. Paste the contents of `supabase/migrations/20260404_initial_schema.sql`.
4. Run the migration.
5. If you are updating an existing project, also run:
   - `supabase/migrations/20260405_run_diagnostics_payload.sql`
6. Copy these values into `.env.local` for the Next app:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `INTERNAL_JOB_SECRET`
   - `CRON_SECRET`
   - `APP_BASE_URL`
   - `GOOGLE_MAPS_API_KEY`
   - `GOOGLE_MAPS_PLACES_JSON`
   - `COMPETITOR_URLS_JSON`
   - Optional: `GEMINI_API_KEY`
   - Optional: `RESEND_API_KEY`
   - Optional: `RESEND_FROM_EMAIL`
   - Optional: `PYTHON_BIN` if your Python executable is not available as `python`

You can start from `.env.local.example` and rename it to `.env.local`.

Once those env vars are present, the app will use Supabase-backed auth and account-scoped data access.

## Supabase Auth Setup

To make magic-link auth work locally:

1. In Supabase, open `Authentication` -> `URL Configuration`
2. Set the site URL to your local app URL, usually `http://localhost:3000`
3. Add this redirect URL:
   - `http://localhost:3000/auth/callback`
4. In `Authentication` -> `Providers` -> `Email`, enable magic links

The callback route creates the first `accounts` and `users` membership row for each authenticated user automatically.

## Ownership And RLS

- `users.id` is tied to `auth.users.id`
- RLS is enabled on every application table
- Access is enforced by `auth.uid()` -> `public.users.account_id`
- API routes and server components both read through the authenticated Supabase session
- Protected app/API routes redirect unauthenticated users to `/login`

## Current Run Flow

1. Install Python dependencies:
   - `pip install -r requirements.txt`
2. Copy `.env.local.example` to `.env.local`
3. Fill in the required app + pipeline env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `INTERNAL_JOB_SECRET`
   - `APP_BASE_URL`
   - `GOOGLE_MAPS_API_KEY`
   - `GOOGLE_MAPS_PLACES_JSON`
   - `COMPETITOR_URLS_JSON`
4. Optional:
   - `RESEND_API_KEY`
   - `RESEND_FROM_EMAIL`
   - `GEMINI_API_KEY`
   - `PYTHON_BIN`
5. For pipeline-only local execution, `.env` is still auto-loaded by `pipeline.py`
6. Execute the app:
   - `npm run dev`
7. Or execute the pipeline directly:
   - `python pipeline.py`

## Planned Product Direction

- Replace `.env` and `PLAN.md` inputs with authenticated project setup in the dashboard.
- Persist projects, runs, signals, diagnostics, and reports in Supabase.
- Run the analysis engine through a queued job flow with checkpoints and coverage scoring.
- Support additional industries through config-first industry profiles.

## Notes

- The pipeline auto-loads `.env` from the repo root at startup.
- Google Maps Place Details is used for ratings, review-derived strengths/issues, hours, and website context.
- Magic-link auth is now required for `/projects` and `/api` routes.
- Projects are account-owned and tenant-scoped through Supabase Auth + RLS.
- Project runs now queue through the API, then dispatch from the database queue through an internal worker route that persists reports, diagnostics, checkpoints, and analysis runs.
- The dispatcher can be called safely again to recover queued work, and it will requeue stale in-progress runs automatically.
- A scheduled cron endpoint now exists at `/api/internal/scheduled-dispatch` for automatic queue draining.
- Report detail pages now live at `/reports/:reportId`.
- Owner accounts now get a lightweight `/admin` workspace for recent run and report oversight.
- Richer diagnostics are now stored directly on `run_diagnostics.detail_payload` when the latest migration is applied.
- If your machine has a non-standard Python path, set `PYTHON_BIN` in `.env.local`.
- In production, set a strong `INTERNAL_JOB_SECRET` so only trusted internal calls can start the worker route.
- Set `CRON_SECRET` so scheduled dispatch calls can authenticate safely.
- Completed runs can send real email through Resend when `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are configured.

## Scheduler / Cron

The repo now includes a Vercel-ready cron config in `vercel.json`:

- `/api/internal/scheduled-dispatch`
- schedule: every 5 minutes

That endpoint:

- authenticates with `CRON_SECRET`
- claims queued runs from the database
- processes up to 3 runs per invocation
- requeues stale running jobs before dispatching

If you deploy somewhere other than Vercel, point your scheduler at:

- `GET /api/internal/scheduled-dispatch`

With either:

- `Authorization: Bearer <CRON_SECRET>`
- or `x-cron-secret: <CRON_SECRET>`
