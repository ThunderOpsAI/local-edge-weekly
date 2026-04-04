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
5. Copy these values into `.env.local` for the Next app:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

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

## Current Python Run Flow

1. Install Python dependencies:
   - `pip install -r requirements.txt`
2. Set env vars in `.env`:
   - `GEMINI_API_KEY`
   - `GOOGLE_MAPS_API_KEY`
   - `COMPETITOR_URLS_JSON`
   - `GOOGLE_MAPS_PLACES_JSON`
   - Optional: `PROJECT_CONFIG_PATH`
3. Execute:
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
- Reports, diagnostics, and runs still need the queued analysis flow to become fully live per project.
