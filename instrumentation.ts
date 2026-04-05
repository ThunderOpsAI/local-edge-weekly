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

    if (!cronSecret) {
      console.warn("[CRON] CRON_SECRET is not set — scheduled dispatch will not be authorized. Skipping cron registration.");
      return;
    }

    // Original vercel.json schedule: "0 9 * * *" (daily at 09:00 UTC)
    // Railway containers run in UTC by default, matching Vercel behavior.
    const schedule = process.env.CRON_SCHEDULE || "0 9 * * *";

    nodeCron.schedule(schedule, async () => {
      const url = `http://localhost:${port}/api/internal/scheduled-dispatch`;
      console.log(`[CRON] Triggering scheduled dispatch at ${new Date().toISOString()}`);

      try {
        const response = await fetch(url, {
          headers: {
            "x-cron-secret": cronSecret,
          },
        });

        const body = await response.json().catch(() => null);
        console.log(`[CRON] Scheduled dispatch responded ${response.status}`, body);
      } catch (error) {
        console.error("[CRON] Scheduled dispatch failed:", error);
      }
    });

    console.log(`[CRON] Registered scheduled-dispatch cron: "${schedule}" (UTC)`);
  }
}
