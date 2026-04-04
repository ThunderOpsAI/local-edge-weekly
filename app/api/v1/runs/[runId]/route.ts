import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { getAccountContext } from "@/lib/auth";
import { getRunDetail } from "@/lib/repository";

export async function GET(
  request: Request,
  { params }: { params: { runId: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const run = await getRunDetail(params.runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ data: run });
}
