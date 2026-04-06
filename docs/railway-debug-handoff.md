# Railway Debug Handoff

## Current Goal

Get production analysis runs on Railway to advance past `queued` and execute the Python pipeline successfully.

## Current Status

- Auth is working in production.
- Magic links now send and return to the public Railway domain.
- Users can log in, create projects, and queue runs.
- The main remaining production issue is that runs can remain stuck at:
  - `status = queued`
  - `stage = queued`
  - `duration = Waiting for worker`

## Current Production Stack

- Next.js app
- Supabase auth + database
- Railway Docker deploy
- Python pipeline invoked from Node via `child_process.spawn`

## Confirmed Earlier Failure

On Vercel Hobby, production runs failed with:

- `spawn python ENOENT`

That drove the move to Railway.

## Railway Issues We Already Found And Fixed

### 1. Build-time env vars were not reaching the Next.js client bundle

Problem:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` were set in Railway,
- but the app was built through a Dockerfile,
- and Next.js needs `NEXT_PUBLIC_*` values during `npm run build`.

Fix:

- Added Docker `ARG` and `ENV` declarations in `Dockerfile`.

Related commit:

- `dc17a3e` - `Fix Railway Supabase build env handling`

### 2. Auth callback redirects used Railway's internal server origin

Problem:

- Magic link flow redirected to `https://0.0.0.0:8080/...`
- rather than the public Railway domain.

Fix:

- Added `lib/request-url.ts`
- switched auth and login redirects to use forwarded headers or `APP_BASE_URL`

Related commit:

- `8e38c3b` - `Fix public auth callback redirects on Railway`

### 3. Worker dispatch originally tried to self-call via request host

Problem:

- Manual run route enqueued successfully, but self-fetch to the internal dispatcher likely used the wrong host context on Railway.

Fix:

- switched internal dispatch URL to `127.0.0.1:${PORT}`

Related commit:

- `fb6cbc8` - `Fix Railway internal worker dispatch URLs`

### 4. Worker trigger was simplified to in-process dispatch

Problem:

- Even with the localhost internal URL fix, runs still appeared stuck in `queued`
- suggesting the self-call handoff itself was unreliable.

Fix:

- removed the self-fetch from manual/project-run trigger paths
- directly called `dispatchQueuedRuns()` in-process through `triggerQueuedRunsInBackground`

Related commit:

- `fe7f241` - `Trigger queued runs directly in process`

## Uncommitted Changes Prepared After `fe7f241`

These changes were added locally after `fe7f241` and should be committed/pushed if production still sticks on `queued`:

### A. Remove unnecessary `INTERNAL_JOB_SECRET` dependency for direct background trigger

Reason:

- after moving to in-process dispatch, the manual enqueue path no longer needs to require `INTERNAL_JOB_SECRET`

Files:

- `app/api/v1/projects/route.ts`
- `app/api/v1/projects/[id]/runs/route.ts`

### B. Improve runner logging

Reason:

- make it obvious in Railway logs whether queued runs are being claimed, processed, or failing before the pipeline starts

Added logs in:

- `lib/internal-jobs.ts`
- `lib/run-executor.ts`

Example log lines:

- `[RUNNER] Scheduling background dispatch from manual-run`
- `[RUNNER] Dispatch requested`
- `[RUNNER] Claimed queued run`
- `[RUNNER] Processing queued run`
- `[RUNNER] Running Python pipeline`
- `[RUNNER] Queued run failed`
- `[RUNNER] Dispatch finished`

### C. Make the cron fallback frequent and trigger once on startup

Reason:

- current old schedule was effectively daily
- if the immediate worker kick is missed, queued jobs can sit forever

Changes:

- `instrumentation.ts`
- default schedule changed from daily to every minute: `*/1 * * * *`
- startup one-shot dispatch added
- cron calls switched to `127.0.0.1`

## Files Most Relevant To The Remaining Queue Bug

- `app/api/v1/projects/route.ts`
- `app/api/v1/projects/[id]/runs/route.ts`
- `app/api/internal/dispatch-runs/route.ts`
- `app/api/internal/scheduled-dispatch/route.ts`
- `instrumentation.ts`
- `lib/internal-jobs.ts`
- `lib/run-executor.ts`
- `Dockerfile`

## Railway / Supabase Config That Should Be Present

### Railway variables

- `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...`
- `SUPABASE_SERVICE_ROLE_KEY=sb_secret_...`
- `APP_BASE_URL=https://local-edge-weekly-production.up.railway.app`
- `CRON_SECRET=<random secret>`
- `INTERNAL_JOB_SECRET=<random secret>` though less important after the in-process change
- `GOOGLE_MAPS_API_KEY=...`
- `GOOGLE_MAPS_PLACES_JSON=...`
- `COMPETITOR_URLS_JSON=...`
- optional `PYTHON_BIN=python3`

### Supabase auth

- Site URL:
  - `https://local-edge-weekly-production.up.railway.app`
- Redirect URL:
  - `https://local-edge-weekly-production.up.railway.app/auth/callback`

## Strongest Current Hypotheses If Runs Still Stay Queued

### 1. Unawaited background work is being dropped by the Next.js request lifecycle

Why it fits:

- runs enqueue successfully
- status never progresses to `running`
- no checkpoints are written

Next step:

- confirm whether `[RUNNER] Scheduling background dispatch...` appears in Railway logs
- if it does not, the trigger is not surviving the request lifecycle

Potential fix:

- use a dedicated worker service
- use a durable queue
- or intentionally process one run synchronously in the route handler for the short term

### 2. `instrumentation.ts` cron hook is not running as expected in the deployed standalone server

Why it fits:

- fallback drain never picks up queued work

Next step:

- look for these logs in Railway:
  - `[CRON] Registered scheduled-dispatch cron`
  - `[CRON] Triggering scheduled dispatch (startup)`
  - `[CRON] Scheduled dispatch (startup) responded ...`
  - `[CRON] Triggering scheduled dispatch (cron)`

Potential fix:

- replace the in-process cron with a real Railway cron/service ping

### 3. `dispatchQueuedRuns()` is running but failing before `claimQueuedRun()` can update the run

Why it fits:

- if `requeueStaleRuns()` or the initial DB calls error before a claim

Next step:

- inspect for:
  - `[RUNNER] Dispatch requested`
  - missing subsequent `Claimed queued run`
  - any thrown error after that

### 4. Python pipeline may still fail after claim, but that should usually move status to `failed`

Why it fits less well:

- if `processQueuedRun()` starts, the run should stop looking like plain `queued`

Next step:

- if logs show `Running Python pipeline`, then the remaining problem is inside Python/runtime/dependencies

## Suggested Next Debug Steps

1. Push the current uncommitted changes.
2. Deploy on Railway.
3. Create one fresh run.
4. Inspect Railway deploy logs immediately and search for:
   - `[RUNNER]`
   - `[CRON]`
5. Determine which of these is true:
   - no runner logs at all
   - dispatch requested but no claim
   - claim occurs but pipeline never starts
   - pipeline starts and fails

## Practical Fallback If Fast Reliability Is More Important Than Clean Architecture

If the request-lifecycle issue keeps fighting back, the simplest reliable short-term architecture is:

- web app on Railway
- separate worker service on Railway
- worker polls queued runs every minute
- web app only enqueues

That avoids self-calls, unawaited background work, and framework lifecycle ambiguity.
