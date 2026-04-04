import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { getAccountContext } from "@/lib/auth";
import { getProject, getProjectTrends } from "@/lib/repository";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const trends = await getProjectTrends(params.id);
  if (!trends) {
    return NextResponse.json({ error: "Trend data not found" }, { status: 404 });
  }

  return NextResponse.json({ data: trends });
}
