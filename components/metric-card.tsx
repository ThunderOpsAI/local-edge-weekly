import { LucideIcon } from "lucide-react";

export type CardTone = "green" | "blue" | "purple" | "orange" | "neutral" | "good" | "warn";

interface MetricCardProps {
  label?: string;
  value: string | number | React.ReactNode;
  icon: LucideIcon;
  helper?: string;
  tone?: CardTone;
}

export function MetricCard({ label, value, icon: Icon, helper, tone = "neutral" }: MetricCardProps) {
  const normalizedTone = tone === "good" ? "green" : tone === "warn" ? "orange" : tone;

  return (
    <div className={`feature-card feature-card-${normalizedTone}`}>
      <div className={`feature-icon feature-icon-${normalizedTone}`}>
        <Icon />
      </div>
      
      <div className="feature-content">
        {label && (
          <p className="feature-label">{label}</p>
        )}
        <h3 className="feature-title">{value}</h3>
        {helper && (
          <p className="feature-helper">{helper}</p>
        )}
      </div>
    </div>
  );
}
