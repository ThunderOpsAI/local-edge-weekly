import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardMetrics } from "@/components/dashboard-metrics";
import { getStatusTone, StatusChip } from "@/components/status-chip";
import { getAccountContext } from "@/lib/auth";
import { getAdminOverviewData } from "@/lib/repository";

export default async function AdminPage() {
  const context = await getAccountContext();
  if (!context) {
    redirect("/login");
  }

  if (context.role !== "owner") {
    redirect("/");
  }

  const overview = await getAdminOverviewData();
  if (!overview) {
    redirect("/");
  }

  const metrics = [
    {
      label: "Projects",
      value: String(overview.projectsCount),
      helper: "Active projects on this account.",
      tone: "neutral" as const,
    },
    {
      label: "Runs in flight",
      value: String(overview.runsInFlight),
      helper: "Queued or running jobs that still need completion.",
      tone: overview.runsInFlight > 0 ? ("warn" as const) : ("good" as const),
    },
    {
      label: "Failed runs",
      value: String(overview.failedRuns),
      helper: "Recent runs that need review or rerun.",
      tone: overview.failedRuns > 0 ? ("warn" as const) : ("good" as const),
    },
    {
      label: "Ready reports",
      value: String(overview.approvedReports),
      helper: "Reports already persisted and ready for email delivery or sharing.",
      tone: overview.approvedReports > 0 ? ("good" as const) : ("neutral" as const),
    },
  ];

  return (
    <section className="stack">
      <div className="panel">
        <p className="eyebrow">Admin</p>
        <h2>{overview.account.name}</h2>
        <p className="muted">
          Lightweight operator tooling for account health, recent runs, and delivered reports.
        </p>
      </div>

      <DashboardMetrics metrics={metrics} />

      <div className="dashboard-grid">
        <article className="panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Recent Runs</p>
              <h3>What the worker has been doing</h3>
            </div>
          </div>
          <div className="run-checkpoint-list">
            {overview.recentRuns.map((run) => (
              <Link key={run.id} href={`/projects/${run.projectId}/runs/${run.id}`} className="checkpoint-row">
                <div>
                  <strong>{run.projectName}</strong>
                  <p className="muted">
                    {run.stage} · {run.createdAt}
                  </p>
                </div>
                <div className="stack-right">
                  <StatusChip tone={getStatusTone(run.status)} label={run.status} />
                  <span className="muted">{Math.round(run.coverageScore * 100)}%</span>
                </div>
              </Link>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Recent Reports</p>
              <h3>Delivery state</h3>
            </div>
          </div>
          <div className="run-checkpoint-list">
            {overview.recentReports.map((report) => (
              <Link key={report.id} href={`/reports/${report.id}`} className="checkpoint-row">
                <div>
                  <strong>{report.projectName}</strong>
                  <p className="muted">{report.createdAt}</p>
                </div>
                <div className="stack-right">
                  <span className={`chip ${report.status === "approved" ? "chip-good" : "chip-neutral"}`}>
                    {report.status}
                  </span>
                  <span className="muted">{Math.round(report.coverageScore * 100)}%</span>
                </div>
              </Link>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
