import type { PlaybookAction } from "@/types/domain";

interface PlaybookListProps {
  actions: PlaybookAction[];
}

export function PlaybookList({ actions }: PlaybookListProps) {
  return (
    <article className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Playbook</p>
          <h3>Actions an owner can take this cycle</h3>
        </div>
      </div>

      <div className="stack">
        {actions.map((action, index) => (
          <div key={`${action.title}-${index}`} className="playbook-row">
            <span className={`priority-pill priority-${action.priority.toLowerCase()}`}>{action.priority}</span>
            <div>
              <strong>{action.title}</strong>
              <p className="muted">{action.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
