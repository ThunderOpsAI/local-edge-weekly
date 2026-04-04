import type { RunCheckpoint } from "@/types/domain";

interface RunCheckpointsProps {
  checkpoints: RunCheckpoint[];
}

export function RunCheckpoints({ checkpoints }: RunCheckpointsProps) {
  return (
    <article className="panel stack">
      <div className="section-header">
        <div>
          <p className="eyebrow">Checkpoints</p>
          <h3>Stage-by-stage run trace</h3>
        </div>
      </div>

      <div className="run-checkpoint-list">
        {checkpoints.map((checkpoint) => (
          <div key={checkpoint.id} className="checkpoint-row">
            <div>
              <strong>{checkpoint.stage}</strong>
              <p className="muted">{checkpoint.createdAt}</p>
            </div>
            <div>
              <span className={`chip ${checkpoint.status === "completed" ? "chip-good" : checkpoint.status === "failed" ? "chip-warn" : "chip-neutral"}`}>
                {checkpoint.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
