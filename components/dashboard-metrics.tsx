import type { DashboardMetric } from "@/types/domain";
import { MetricCard } from "@/components/metric-card";
import { 
  Zap, 
  Target, 
  Calendar, 
  Activity, 
  ShieldCheck, 
  Award,
  ArrowUpRight,
  MonitorCheck
} from "lucide-react";

interface DashboardMetricsProps {
  metrics: DashboardMetric[];
}

function getIcon(label: string) {
  const l = label.toLowerCase();
  if (l.includes("plan")) return Target;
  if (l.includes("cadence")) return Calendar;
  if (l.includes("projects")) return Zap;
  if (l.includes("diagnostics")) return MonitorCheck;
  if (l.includes("coverage")) return ShieldCheck;
  if (l.includes("score")) return Award;
  if (l.includes("status")) return Activity;
  return ArrowUpRight;
}

export function DashboardMetrics({ metrics }: DashboardMetricsProps) {
  return (
    <section className="dashboard-metrics-grid">
      {metrics.map((metric) => (
        <MetricCard
          key={metric.label}
          label={metric.label}
          value={metric.value}
          helper={metric.helper}
          tone={metric.tone}
          icon={getIcon(metric.label)}
        />
      ))}
    </section>
  );
}
