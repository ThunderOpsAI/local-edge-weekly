import { notFound } from "next/navigation";

import { TrendCard } from "@/components/trend-card";
import { TrendDeltaList } from "@/components/trend-delta-list";
import { getProject, getProjectTrends } from "@/lib/repository";

export default async function ProjectTrendsPage({
  params,
}: {
  params: { id: string };
}) {
  const [project, trendData] = await Promise.all([
    getProject(params.id),
    getProjectTrends(params.id),
  ]);

  if (!project || !trendData) {
    notFound();
  }

  return (
    <section className="stack">
      <div className="panel">
        <p className="eyebrow">Trends</p>
        <h2>{project.name}</h2>
        <p className="muted">
          Trend history turns one-off reports into an operating system. This page focuses on what
          changed, whether coverage improved, and where competitor movement is opening up space.
        </p>
      </div>

      <TrendDeltaList deltas={trendData.deltas} />
      <TrendCard trends={trendData.snapshot} />
    </section>
  );
}
