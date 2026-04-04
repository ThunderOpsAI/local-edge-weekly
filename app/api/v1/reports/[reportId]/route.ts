import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { getAccountContext } from "@/lib/auth";
import { getReportById } from "@/lib/repository";

export async function GET(
  request: Request,
  { params }: { params: { reportId: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const report = await getReportById(params.reportId);
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json({ data: report });
}
