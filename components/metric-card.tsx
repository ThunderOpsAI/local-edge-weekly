import Link from "next/link";
import { LucideIcon } from "lucide-react";

export type CardTone = "green" | "blue" | "purple" | "orange" | "neutral" | "good" | "warn";

interface MetricCardProps {
  label?: string;
  value: string | number | React.ReactNode;
  icon: LucideIcon;
  helper?: string;
  tone?: CardTone;
  href?: string;
}

export function MetricCard({ label, value, icon: Icon, helper, tone = "neutral", href }: MetricCardProps) {
  const normalizedTone = tone === "good" ? "green" : tone === "warn" ? "orange" : tone;
  const content = (
    <div className={`feature-card feature-card-${normalizedTone} ${href ? "feature-card-link" : ""}`}>
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

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}
