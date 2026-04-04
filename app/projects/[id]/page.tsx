import Link from "next/link";
import { notFound } from "next/navigation";

import { ComparisonTable } from "@/components/comparison-table";
import { DashboardMetrics } from "@/components/dashboard-metrics";
import { OpportunityGrid } from "@/components/opportunity-grid";
import { PlaybookList } from "@/components/playbook-list";
import { ProjectSettingsForm } from "@/components/project-settings-form";
import { ReportApprovalButton } from "@/components/report-approval-button";
import { ReportSummary } from "@/components/report-summary";
import { RunAnalysisButton } from "@/components/run-analysis-button";
import { TargetManager } from "@/components/target-manager";
import { TrendCard } from "@/components/trend-card";
import { TrendDeltaList } from "@/components/trend-delta-list";
import { getStatusTone, StatusChip } from "@/components/status-chip";
import { getDashboardData, getProjectTrends, listProjectTargets } from "@/lib/repository";

export default async function ProjectDashboardPage({
  params,
}: {
  params: { id: string };
}) {
  const [dashboard, targets, trendData] = await Promise.all([
    getDashboardData(params.id),
    listProjectTargets(params.id),
    getProjectTrends(params.id),
  ]);
  if (!dashboard) {
    notFound();
  }

  const { account, comparison, coverage, diagnostics, metrics, opportunities, playbook, project, report, reportRecord, trends } =
    dashboard;

  return (
    <section className="stack">
      <div className="panel project-hero">
        <div className="page-actions">
          <div>
            <p className="eyebrow">
              {project.industry} - {account.plan} plan
            </p>
            <h2>{project.name}</h2>
            <p className="muted">{project.location}</p>
          </div>
          <div className="page-actions">
            <RunAnalysisButton
              projectId={project.id}
              disabled={!project.manualRerunAvailable && project.reportStatus !== "draft"}
            />
            <StatusChip tone={getStatusTone(project.reportStatus)} label={project.reportStatus} />
            <Link href={`/projects/${project.id}/diagnostics`} className="button button-secondary">
              Diagnostics
            </Link>
            <Link href={`/projects/${project.id}/runs`} className="button button-secondary">
              Run history
            </Link>
            <Link href={`/projects/${project.id}/trends`} className="button button-secondary">
              Trends
            </Link>
          </div>
        </div>

        <div className="project-hero-grid">
          <div className="hero-stat">
            <span className="metric-label">Cadence</span>
            <strong>{project.cadence === "weekly" ? "Weekly summaries" : "Monthly summaries"}</strong>
          </div>
          <div className="hero-stat">
            <span className="metric-label">Coverage</span>
            <strong>{Math.round(coverage.score * 100)}%</strong>
          </div>
          <div className="hero-stat">
            <span className="metric-label">Resolved sources</span>
            <strong>{coverage.resolvedSources}</strong>
          </div>
          <div className="hero-stat">
            <span className="metric-label">Playbook actions</span>
            <strong>{project.playbookActionsPerRun}</strong>
          </div>
        </div>
      </div>

      <DashboardMetrics metrics={metrics} />
      <OpportunityGrid cards={opportunities} />

      {report ? (
        <div className="dashboard-grid">
          <div className="stack">
            <ReportSummary report={report} leads={dashboard.leads} />
            {reportRecord && reportRecord.status !== "approved" ? (
              <article className="panel">
                <p className="eyebrow">Operator Action</p>
                <h3>Approve the latest report</h3>
                <p className="muted">
                  Approved reports are the cleanest candidate for customer email delivery and trend comparisons.
                </p>
                <ReportApprovalButton reportId={reportRecord.id} />
              </article>
            ) : null}
          </div>
          <PlaybookList actions={playbook} />
        </div>
      ) : (
        <article className="panel">
          <p className="eyebrow">No Report Yet</p>
          <h3>This project is ready for its first analysis run.</h3>
          <p className="muted">
            The project exists, the plan logic is applied, and the dashboard is ready. Queue a run
            and this page will fill in once the worker finishes collecting and scoring signals.
          </p>
        </article>
      )}

      <div className="dashboard-grid">
        <ProjectSettingsForm
          projectId={project.id}
          initialName={project.name}
          initialIndustry={project.industry}
          initialLocation={project.location}
        />
        <TargetManager
          projectId={project.id}
          targets={targets}
          competitorLimit={project.plan === "edge" ? 5 : 2}
        />
      </div>

      <ComparisonTable rows={comparison} />
      <TrendDeltaList deltas={trendData?.deltas ?? []} />
      <TrendCard trends={trends} />

      <article className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Coverage Note</p>
            <h3>Why this report can be trusted</h3>
          </div>
        </div>
        <p className="muted">{coverage.helper}</p>
        <p className="muted">
          {diagnostics.source_stats.fail === 0
            ? "All tracked venues resolved on the latest run."
            : `${diagnostics.source_stats.fail} sources still need attention before the report is fully complete.`}
        </p>
      </article>
    </section>
  );
}
