# Build Suggestions

These are the improvements that came up while implementing the V1 dashboard scaffold.

## Near-Term

1. Replace the bootstrap account flow with real Supabase Auth magic links.
   The current bootstrap mode is useful for local progress, but real customer ownership and RLS become much cleaner once every request is tied to a real authenticated user.

2. Add a queued run executor and write reports per project.
   The dashboard is now product-shaped, but the real leap is letting `POST /projects/:id/runs` create a genuine report and diagnostics payload instead of relying on the Wangaratta prototype artifacts.

3. Persist richer diagnostics payloads in `run_diagnostics`.
   Right now the file-backed diagnostics are more detailed than the database-backed fallback. We should store rating, review count, website, and key Google attempt metadata structurally.

4. Add a proper email preview and Resend integration.
   The current report surface already has the right content model for the owner email. A dedicated email template would make the value proposition much more tangible.

## Product UX

5. Add an onboarding step that auto-suggests competitors from the target URL and location.
   This would reduce setup friction for non-technical owners and make the first-run experience feel more magical.

6. Add a confidence explainer next to coverage.
   Customers will trust the product more if they can see how coverage, source health, and signal confidence relate to each other.

7. Add explicit "what changed since last run" cards.
   The trend system is set up conceptually, but a dedicated delta strip would be one of the highest-value dashboard elements once live multi-run data exists.

8. Add industry-specific insight labels from profile configs.
   For example, pubs might care about staff, booking, and pricing, while dentists might care about wait times and bedside manner.

## Technical

9. Migrate the UI to Tailwind + shadcn/ui fully.
   The current UI is intentionally polished and product-oriented, but it is still custom CSS. If the brief's frontend stack needs to be followed strictly, that migration should happen next.

10. Split `pipeline.py` into modules and expose a worker-friendly entry point.
    The dashboard is ready for a job runner, but the Python engine should be broken into reusable stages before we wire Inngest or a worker host.
