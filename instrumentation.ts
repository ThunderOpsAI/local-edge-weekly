import type cron from "node-cron";

/**
 * Next.js instrumentation hook — runs once on server startup.
 * Replaces the Vercel cron job that was defined in vercel.json.
 */
export async function register() {
  // Only run the cron scheduler on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const nodeCron: typeof cron = (await import("node-cron")).default;

    const cronSecret = process.env.CRON_SECRET;
    const port = process.env.PORT || "3000";
    const url = `http://127.0.0.1:${port}/api/internal/scheduled-dispatch`;

    async function triggerScheduledDispatch(reason: string) {
      console.log(`[CRON] Triggering scheduled dispatch (${reason}) at ${new Date().toISOString()}`);

      try {
        const response = await fetch(url, {
          headers: {
            "x-cron-secret": cronSecret!,
          },
        });

        const body = await response.json().catch(() => null);
        console.log(`[CRON] Scheduled dispatch (${reason}) responded ${response.status}`, body);
      } catch (error) {
        console.error(`[CRON] Scheduled dispatch (${reason}) failed:`, error);
      }
    }

    if (!cronSecret) {
      console.warn("[CRON] CRON_SECRET is not set — scheduled dispatch will not be authorized. Skipping cron registration.");
      return;
    }

    // Railway uses this scheduler as a queue-draining fallback when the
    // immediate in-process trigger is interrupted or missed.
    const schedule = process.env.CRON_SCHEDULE || "*/1 * * * *";

    nodeCron.schedule(schedule, async () => {
      await triggerScheduledDispatch("cron");
    });

    console.log(`[CRON] Registered scheduled-dispatch cron: "${schedule}" (UTC)`);
    void triggerScheduledDispatch("startup");
  }
}
