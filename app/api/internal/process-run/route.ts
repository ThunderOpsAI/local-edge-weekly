import { NextResponse } from "next/server";

import { processQueuedRun } from "@/lib/run-executor";

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

  const payload = (await request.json().catch(() => null)) as { runId?: string } | null;
  if (!payload?.runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  try {
    const result = await processQueuedRun(payload.runId);
    return NextResponse.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
