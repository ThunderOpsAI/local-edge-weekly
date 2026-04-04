import type { CompetitorDelta, ReportLead, WeeklyIntelReport } from "@/types/domain";

interface ReportOverviewProps {
  report: WeeklyIntelReport;
  leads: ReportLead[];
  deltas: CompetitorDelta[];
}

export function ReportOverview({ report, leads, deltas }: ReportOverviewProps) {
  return (
    <section className="dashboard-grid">
      <article className="panel hero-panel">
        <p className="eyebrow">Latest Run</p>
        <h2>{report.market_status} Market Signal</h2>
        <p className="muted">{report.timestamp}</p>
        <div className="metric-row">
          <div className="metric-box">
            <span className="metric-label">Target Leads</span>
            <strong>{leads.length}</strong>
          </div>
          <div className="metric-box">
            <span className="metric-label">Competitor Signals</span>
            <strong>{deltas.length}</strong>
          </div>
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">Target Opportunity</p>
        {leads.map((lead) => (
          <div key={lead.name} className="stack">
            <h3>{lead.name}</h3>
            <p>
              <strong>Gap:</strong> {lead.gap}
            </p>
            <p>
              <strong>Hook:</strong> {lead.hook}
            </p>
          </div>
        ))}
      </article>

      <article className="panel full-span">
        <p className="eyebrow">Competitor Deltas</p>
        <div className="list-grid">
          {deltas.map((delta, index) => (
            <div key={`${delta.name}-${index}`} className="delta-row">
              <div>
                <h4>{delta.name}</h4>
                <p className="muted">{delta.summary}</p>
              </div>
              <span className="impact-pill">Impact {delta.impact}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
