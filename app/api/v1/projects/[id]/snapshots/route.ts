import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { getAccountContext } from "@/lib/auth";
import { getLatestProjectSnapshots } from "@/lib/repository";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const snapshots = await getLatestProjectSnapshots(params.id);
  return NextResponse.json({ data: snapshots });
}
