import type { TrendDeltaCard } from "@/types/domain";

interface TrendDeltaListProps {
  deltas: TrendDeltaCard[];
}

export function TrendDeltaList({ deltas }: TrendDeltaListProps) {
  if (deltas.length === 0) {
    return (
      <article className="panel">
        <p className="eyebrow">Trend Deltas</p>
        <h3>Waiting on more history</h3>
        <p className="muted">
          Local Edge will start comparing changes between runs once the second completed report is
          available.
        </p>
      </article>
    );
  }

  return (
    <article className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Trend Deltas</p>
          <h3>What changed since the last run</h3>
        </div>
      </div>

      <div className="card-grid">
        {deltas.map((delta) => (
          <div key={delta.title} className={`panel insight-card insight-${delta.tone}`}>
            <p className="eyebrow">{delta.title}</p>
            <p>{delta.summary}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
