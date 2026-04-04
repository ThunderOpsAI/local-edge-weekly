import { NextResponse } from "next/server";

import { dispatchQueuedRuns } from "@/lib/run-executor";

function getCronSecret() {
  return process.env.CRON_SECRET;
}

function isAuthorized(request: Request) {
  const expectedSecret = getCronSecret();
  if (!expectedSecret) {
    return false;
  }

  const bearer = request.headers.get("authorization");
  const providedBearer = bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : null;
  const providedHeader = request.headers.get("x-cron-secret");

  return providedBearer === expectedSecret || providedHeader === expectedSecret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchQueuedRuns(3);
    return NextResponse.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled dispatch failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
