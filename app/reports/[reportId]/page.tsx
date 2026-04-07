import Link from "next/link";
import { notFound } from "next/navigation";

import { ComparisonTable } from "@/components/comparison-table";
import { OpportunityGrid } from "@/components/opportunity-grid";
import { ReportApprovalButton } from "@/components/report-approval-button";
import { ReportOverview } from "@/components/report-overview";
import {
  getCompetitorSnapshotsByRunId,
  getProject,
  getReportById,
  getRunDiagnosticsByRunId,
  parseCompetitorDeltas,
  parseLeads,
} from "@/lib/repository";

export default async function ReportDetailPage({
  params,
}: {
  params: { reportId: string };
}) {
  const report = await getReportById(params.reportId);
  if (!report) {
    notFound();
  }

  const [project, diagnostics, snapshots] = await Promise.all([
    getProject(report.projectId),
    getRunDiagnosticsByRunId(report.runId),
    getCompetitorSnapshotsByRunId(report.runId),
  ]);
  if (!project) {
    notFound();
  }

  const leads = parseLeads(report.body);
  const deltas = parseCompetitorDeltas(report.body);
  const opportunities = [
    leads[0]
      ? {
          title: "Target advantage",
          summary: leads[0].gap,
          sourceLabel: "Report lead",
          tone: "good" as const,
        }
      : null,
    deltas[0]
      ? {
          title: "Competitor gap",
          summary: deltas[0].summary,
          sourceLabel: "Competitor delta",
          tone: deltas[0].impact >= 6 ? ("warn" as const) : ("neutral" as const),
        }
      : null,
    {
      title: "Coverage",
      summary: `${Math.round(report.coverageScore * 100)}% coverage on this report.`,
      sourceLabel: "Latest report",
      tone: report.coverageScore >= 0.65 ? ("good" as const) : ("warn" as const),
    },
  ].filter(Boolean) as Array<{ title: string; summary: string; sourceLabel: string; tone: "good" | "warn" | "neutral" }>;

  const comparison = [project.primaryTarget, ...project.competitors].map((venue) => {
    const match = diagnostics.google_maps.find(
      (entry) => (entry.resolved_name ?? entry.cafe).toLowerCase() === venue.toLowerCase(),
    );

    return {
      venue,
      rating: match?.rating ? `${match.rating.toFixed(1)} stars` : "Not captured",
      reviewVolume: match?.reviews_count ? `${match.reviews_count} reviews` : "N/A",
      website: match?.details_context?.website ?? "Not detected",
      status: match?.resolved ? "Resolved" : "Needs attention",
    };
  });

  return (
    <section className="stack">
      <div className="panel">
        <div className="page-actions">
          <div>
            <p className="eyebrow">Report Detail</p>
            <h2>{project.name}</h2>
            <p className="muted">
              {report.createdAt} · {report.status}
            </p>
          </div>
          <div className="page-actions">
            <ReportApprovalButton reportId={report.id} />
            <Link href={`/projects/${project.id}`} className="button button-secondary">
              Back to project
            </Link>
          </div>
        </div>
      </div>

      <ReportOverview
        report={report.body}
        leads={leads}
        deltas={deltas}
        decisionPack={report.decisionPack}
        snapshots={snapshots}
      />
      <OpportunityGrid cards={opportunities} />
      <ComparisonTable rows={comparison} />
    </section>
  );
}
