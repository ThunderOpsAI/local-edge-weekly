import Link from "next/link";
import { notFound } from "next/navigation";

import { DiagnosticsTable } from "@/components/diagnostics-table";
import { RunCheckpoints } from "@/components/run-checkpoints";
import { getStatusTone, StatusChip } from "@/components/status-chip";
import { getAccountContext } from "@/lib/auth";
import { getProject, getRunDetail, getRunDiagnosticsByRunId } from "@/lib/repository";

export default async function RunDetailPage({
  params,
}: {
  params: { id: string; runId: string };
}) {
  const [context, project, run, diagnostics] = await Promise.all([
    getAccountContext(),
    getProject(params.id),
    getRunDetail(params.runId),
    getRunDiagnosticsByRunId(params.runId),
  ]);

  if (!project || !run || run.projectId !== params.id) {
    notFound();
  }

  const internalAccess = context?.role === "owner";

  return (
    <section className="stack">
      <div className="panel">
        <div className="page-actions">
          <div>
            <p className="eyebrow">Run Detail</p>
            <h2>{project.name}</h2>
            <p className="muted">{run.createdAt}</p>
          </div>
          <div className="page-actions">
            <StatusChip tone={getStatusTone(run.status)} label={run.status} />
            <Link href={`/projects/${project.id}/runs`} className="button button-secondary">
              Back to run history
            </Link>
          </div>
        </div>

        <div className="project-hero-grid">
          <div className="hero-stat">
            <span className="metric-label">Stage</span>
            <strong>{run.stage}</strong>
          </div>
          <div className="hero-stat">
            <span className="metric-label">Coverage</span>
            <strong>{Math.round(run.coverageScore * 100)}%</strong>
          </div>
          <div className="hero-stat">
            <span className="metric-label">Duration</span>
            <strong>{run.durationLabel}</strong>
          </div>
          <div className="hero-stat">
            <span className="metric-label">Started</span>
            <strong>{run.startedAt ?? "Pending"}</strong>
          </div>
        </div>
      </div>

      <RunCheckpoints checkpoints={run.checkpoints} />
      <DiagnosticsTable
        diagnostics={diagnostics}
        diagnosticsEnabled={project.diagnosticsEnabled}
        internalAccess={internalAccess}
      />
    </section>
  );
}
