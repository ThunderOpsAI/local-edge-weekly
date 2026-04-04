import { NextResponse } from "next/server";

import { dispatchQueuedRuns } from "@/lib/run-executor";

function getInternalJobSecret() {
  return process.env.INTERNAL_JOB_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : "local-edge-dev-secret");
}

export async function POST(request: Request) {
  const expectedSecret = getInternalJobSecret();
  const providedSecret = request.headers.get("x-internal-job-secret");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as { limit?: number } | null;
  const limit = Math.max(1, Math.min(5, payload?.limit ?? 1));

  try {
    const result = await dispatchQueuedRuns(limit);
    return NextResponse.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
