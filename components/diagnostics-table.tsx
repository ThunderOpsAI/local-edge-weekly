import type { SourceDiagnostics } from "@/types/domain";

interface DiagnosticsTableProps {
  diagnostics: SourceDiagnostics;
  diagnosticsEnabled: boolean;
}

export function DiagnosticsTable({ diagnostics, diagnosticsEnabled }: DiagnosticsTableProps) {
  if (!diagnosticsEnabled) {
    return (
      <section className="panel">
        <p className="eyebrow">Diagnostics</p>
        <h2>Available on the Edge plan</h2>
        <p className="muted">
          Solo customers receive the report itself, but not the underlying source diagnostics view.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Source Diagnostics</p>
          <h2>Coverage and resolution health</h2>
        </div>
        <div className="stack-right">
          <span className="metric-label">Success ratio</span>
          <strong>{Math.round((1 - diagnostics.source_stats.failure_ratio) * 100)}%</strong>
        </div>
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th>Status</th>
              <th>Reviews</th>
              <th>Website</th>
              <th>Recent source note</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.google_maps.map((entry) => (
              <tr key={entry.cafe}>
                <td>{entry.resolved_name ?? entry.cafe}</td>
                <td>{entry.resolved ? "Resolved" : "Needs attention"}</td>
                <td>{entry.reviews_count ?? 0}</td>
                <td className="table-link-cell">{entry.details_context?.website ?? "N/A"}</td>
                <td>{entry.attempts[entry.attempts.length - 1]?.error_message ?? "Google place details available"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
