import type { TrendSnapshot } from "@/types/domain";

interface TrendCardProps {
  trends: TrendSnapshot;
}

function polylinePoints(values: number[]) {
  if (values.length === 0) {
    return "";
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 80 - 10;
      return `${x},${y}`;
    })
    .join(" ");
}

export function TrendCard({ trends }: TrendCardProps) {
  return (
    <article className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Trends</p>
          <h3>Change over time</h3>
        </div>
      </div>

      {trends.unlocked ? (
        <div className="trend-grid">
          {trends.series.map((series) => (
            <div key={series.label} className="trend-panel">
              <div className="trend-header">
                <strong>{series.label}</strong>
                <span className="muted">{trends.helper}</span>
              </div>
              <svg viewBox="0 0 100 100" className="trend-chart" aria-hidden="true">
                <polyline
                  fill="none"
                  stroke={series.color}
                  strokeWidth="4"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={polylinePoints(series.points.map((point) => point.value))}
                />
              </svg>
              <div className="trend-label-row">
                {series.points.map((point) => (
                  <div key={`${series.label}-${point.label}`} className="trend-label">
                    <strong>{point.value}</strong>
                    <span>{point.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="locked-trend">
          <strong>Trend history unlocks after run 2.</strong>
          <p className="muted">{trends.helper}</p>
        </div>
      )}
    </article>
  );
}
