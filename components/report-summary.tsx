import type { ReportLead, WeeklyIntelReport } from "@/types/domain";

interface ReportSummaryProps {
  report: WeeklyIntelReport;
  leads: ReportLead[];
}

export function ReportSummary({ report, leads }: ReportSummaryProps) {
  return (
    <article className="panel report-summary">
      <div className="section-header">
        <div>
          <p className="eyebrow">Email Summary</p>
          <h3>What the owner would receive on this run</h3>
        </div>
        <span className="report-status">{report.market_status}</span>
      </div>

      <div className="stack">
        {leads.map((lead) => (
          <div key={lead.name} className="report-callout">
            <strong>{lead.name}</strong>
            <p>
              <strong>Strength:</strong> {lead.gap}
            </p>
            <p>
              <strong>Action:</strong> {lead.hook}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}
