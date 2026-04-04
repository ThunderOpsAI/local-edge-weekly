import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { approveReportSchema } from "@/lib/api-contract";
import { getAccountContext } from "@/lib/auth";
import { approveReport, getReportById } from "@/lib/repository";

export async function PATCH(
  request: Request,
  { params }: { params: { reportId: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const existing = await getReportById(params.reportId);
  if (!existing) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => ({}));
  const parsed = approveReportSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid approval payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const report = await approveReport(params.reportId);
  if (!report) {
    return NextResponse.json({ error: "Unable to approve report" }, { status: 500 });
  }

  return NextResponse.json({ data: report });
}
