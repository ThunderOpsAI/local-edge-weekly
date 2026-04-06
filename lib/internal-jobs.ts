import { dispatchQueuedRuns } from "@/lib/run-executor";

export function triggerQueuedRunsInBackground(limit = 1, source = "unknown") {
  queueMicrotask(() => {
    void dispatchQueuedRuns(limit)
      .then((result) => {
        console.log(`[RUNNER] Background dispatch from ${source} completed`, result);
      })
      .catch((error) => {
        console.error(`[RUNNER] Background dispatch from ${source} failed`, error);
      });
  });
}
