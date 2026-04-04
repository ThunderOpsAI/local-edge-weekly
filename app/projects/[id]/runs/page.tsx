import { notFound } from "next/navigation";

import { getStatusTone, StatusChip } from "@/components/status-chip";
import { getProject, listRuns } from "@/lib/repository";

export default async function ProjectRunsPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await getProject(params.id);
  if (!project) {
    notFound();
  }

  const runs = await listRuns(params.id);

  return (
    <section className="stack">
      <div className="panel">
        <p className="eyebrow">Run History</p>
        <h2>{project.name}</h2>
        <p className="muted">
          Owners should be able to see every completed, partial, or queued run without reading raw
          logs. Trend charts unlock only once at least two real runs exist.
        </p>
      </div>

      <div className="panel run-list">
        {runs.map((run) => (
          <div key={run.id} className="run-row">
            <div>
              <StatusChip tone={getStatusTone(run.status)} label={run.status} />
              <p className="muted">{run.createdAt}</p>
            </div>
            <div>
              <strong>{Math.round(run.coverageScore * 100)}% coverage</strong>
              <p className="muted">
                {run.stage}
                {run.durationLabel ? ` - ${run.durationLabel}` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
