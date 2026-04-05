import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { getAccountContext } from "@/lib/auth";
import { sendRunSummaryEmail } from "@/lib/email";
import { getProject, getReportById } from "@/lib/repository";

export async function PATCH(
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

  const project = await getProject(report.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found for report" }, { status: 404 });
  }

  const emailResult = await sendRunSummaryEmail({
    to: context.email,
    project: {
      id: project.id,
      name: project.name,
      location: project.location,
      industry: project.industry,
    },
    report,
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
