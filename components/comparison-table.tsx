import type { ComparisonRow } from "@/types/domain";

interface ComparisonTableProps {
  rows: ComparisonRow[];
}

export function ComparisonTable({ rows }: ComparisonTableProps) {
  return (
    <article className="panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Comparison</p>
          <h3>Target vs competitor snapshot</h3>
        </div>
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th>Rating</th>
              <th>Review volume</th>
              <th>Website</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.venue}>
                <td>{row.venue}</td>
                <td>{row.rating}</td>
                <td>{row.reviewVolume}</td>
                <td className="table-link-cell">{row.website}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
