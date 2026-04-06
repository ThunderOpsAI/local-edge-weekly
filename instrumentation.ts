/**
 * Next.js instrumentation hook — runs once on server startup.
 *
 * Replaces the previous node-cron + HTTP self-call approach. node-cron was a
 * dynamic import that Next.js's file tracer (nft) could not reliably follow from
 * a type-only import, so it was absent from the standalone output and the entire
 * register() function silently failed. setInterval is built into Node.js and
 * always available. Calling dispatchQueuedRuns() directly avoids the HTTP
 * self-call race (server not yet listening on startup) and the CRON_SECRET auth path.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { dispatchQueuedRuns } = await import("@/lib/run-executor");

    async function runDispatch(reason: string) {
      console.log(`[CRON] Dispatch triggered (${reason}) at ${new Date().toISOString()}`);
      try {
        const result = await dispatchQueuedRuns(3);
        console.log(`[CRON] Dispatch (${reason}) done`, result);
      } catch (err) {
        console.error(`[CRON] Dispatch (${reason}) failed`, err instanceof Error ? err.message : String(err));
      }
    }

    // Startup drain — 5 s delay lets the HTTP server finish initialising
    // before we touch Supabase, so any ECONNREFUSED window is safely avoided.
    setTimeout(() => void runDispatch("startup"), 5_000);

    // Periodic fallback — catches any runs that slip through the in-process
    // trigger (e.g. request-lifecycle teardown in Next.js App Router).
    setInterval(() => void runDispatch("cron"), 60_000);

    console.log("[CRON] Registered dispatch scheduler (startup +5 s, then every 60 s)");
  }
}
