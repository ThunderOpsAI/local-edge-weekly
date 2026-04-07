import type { CompetitorSnapshot } from "@/types/domain";

interface CompetitorSnapshotPanelProps {
  snapshots: CompetitorSnapshot[];
}

function SnapshotFrame({
  label,
  imageUrl,
}: {
  label: string;
  imageUrl?: string | null;
}) {
  return (
    <div className="snapshot-frame">
      <span className="metric-label">{label}</span>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={`${label} competitor homepage screenshot`} />
      ) : (
        <div className="snapshot-placeholder">Screenshot pending</div>
      )}
    </div>
  );
}

export function CompetitorSnapshotPanel({ snapshots }: CompetitorSnapshotPanelProps) {
  if (snapshots.length === 0) {
    return null;
  }

  return (
    <article className="panel stack">
      <div className="section-header">
        <div>
          <p className="eyebrow">Website Delta</p>
          <h3>Competitor snapshot</h3>
        </div>
      </div>

      <div className="list-grid">
        {snapshots.map((snapshot) => (
          <div key={`${snapshot.competitor}-${snapshot.url ?? "snapshot"}`} className="snapshot-card">
            <div className="section-header">
              <div>
                <h4>{snapshot.competitor}</h4>
                <p className="muted">{snapshot.diff_summary}</p>
                {snapshot.url ? <p className="table-link-cell">{snapshot.url}</p> : null}
              </div>
              {snapshot.demo_flag ? <span className="chip chip-neutral">Demo Data</span> : null}
            </div>
            <div className="snapshot-grid">
              <SnapshotFrame label="Last Week" imageUrl={snapshot.previous_image_url} />
              <SnapshotFrame label="This Week" imageUrl={snapshot.current_image_url} />
            </div>
            {snapshot.capture_note ? <p className="muted">{snapshot.capture_note}</p> : null}
          </div>
        ))}
      </div>
    </article>
  );
}
