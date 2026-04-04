import type { DashboardMetric } from "@/types/domain";

interface DashboardMetricsProps {
  metrics: DashboardMetric[];
}

export function DashboardMetrics({ metrics }: DashboardMetricsProps) {
  return (
    <section className="metric-grid">
      {metrics.map((metric) => (
        <article key={metric.label} className={`panel metric-panel metric-${metric.tone}`}>
          <p className="eyebrow">{metric.label}</p>
          <strong className="metric-value">{metric.value}</strong>
          <p className="muted">{metric.helper}</p>
        </article>
      ))}
    </section>
  );
}
