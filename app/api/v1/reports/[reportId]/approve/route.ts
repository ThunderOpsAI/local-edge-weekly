import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { approveReportSchema } from "@/lib/api-contract";
import { getAccountContext } from "@/lib/auth";
import { sendApprovedReportEmail } from "@/lib/email";
import {
  approveReport,
  getProject,
  getReportById,
  parseCompetitorDeltas,
  parseLeads,
} from "@/lib/repository";

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

  const project = await getProject(report.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found for approved report" }, { status: 500 });
  }

  const leads = parseLeads(report.body);
  const deltas = parseCompetitorDeltas(report.body);

  const emailResult = await sendApprovedReportEmail({
    to: context.email,
    project,
    report,
    leads,
    deltas,
  }).catch((error) => ({
    delivered: false as const,
    reason: error instanceof Error ? error.message : "Email delivery failed",
  }));

  return NextResponse.json({
    data: {
      report,
      email: emailResult,
    },
  });
}
