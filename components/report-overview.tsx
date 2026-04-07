import { CompetitorSnapshotPanel } from "@/components/competitor-snapshot-panel";
import { DecisionPackHero } from "@/components/decision-pack-hero";
import type { CompetitorDelta, CompetitorSnapshot, DecisionPack, ReportLead, WeeklyIntelReport } from "@/types/domain";

interface ReportOverviewProps {
  report: WeeklyIntelReport;
  leads: ReportLead[];
  deltas: CompetitorDelta[];
  decisionPack?: DecisionPack | null;
  snapshots?: CompetitorSnapshot[];
}

export function ReportOverview({ report, leads, deltas, decisionPack, snapshots = [] }: ReportOverviewProps) {
  const primaryLead = leads[0];
  const rankedDeltas = [...deltas].sort((a, b) => b.impact - a.impact);
  const topDelta = rankedDeltas[0];
  const ownerMove = primaryLead?.hook ?? "Hold the current offer and wait for a clearer owner action.";
  const ownerReason =
    primaryLead?.gap ?? "This run did not find a strong target gap, so treat it as a monitoring check.";
  const competitorPressure = topDelta
    ? `${topDelta.name}: ${topDelta.summary}`
    : "No competitor move was strong enough to call out on this run.";
  const evidenceCount = leads.length + deltas.length;
  const evidenceLabel = evidenceCount === 1 ? "signal" : "signals";
  const targetMoveLabel = leads.length === 1 ? "target move" : "target moves";

  return (
    <section className="stack report-briefing">
      {decisionPack ? <DecisionPackHero decisionPack={decisionPack} /> : null}
      <CompetitorSnapshotPanel snapshots={snapshots} />

      <article className="panel hero-panel owner-briefing">
        <div className="section-header owner-briefing-header">
          <div>
            <p className="eyebrow">Owner Briefing</p>
            <h2>{ownerMove}</h2>
            <p className="muted">{report.timestamp}</p>
          </div>
          <span className="report-status">{report.market_status}</span>
        </div>

        <div className="owner-briefing-grid">
          <div className="report-callout owner-briefing-card">
            <span className="metric-label">Why now</span>
            <p>{ownerReason}</p>
          </div>
          <div className="report-callout owner-briefing-card">
            <span className="metric-label">Competitor pressure</span>
            <p>{competitorPressure}</p>
          </div>
          <div className="report-callout owner-briefing-card">
            <span className="metric-label">Evidence captured</span>
            <strong>
              {evidenceCount} {evidenceLabel}
            </strong>
            <p className="muted">
              {leads.length} {targetMoveLabel}
            </p>
          </div>
        </div>
      </article>

      <div className="dashboard-grid">
        <article className="panel">
          <p className="eyebrow">Target Move</p>
          <div className="stack">
            {leads.length > 0 ? (
              leads.map((lead) => (
                <div key={lead.name} className="report-callout">
                  <h3>{lead.name}</h3>
                  <p>
                    <strong>Pressure:</strong> {lead.gap}
                  </p>
                  <p>
                    <strong>Action:</strong> {lead.hook}
                  </p>
                </div>
              ))
            ) : (
              <p className="muted">No target move was captured on this run.</p>
            )}
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Watch Next</p>
          <div className="list-grid">
            {rankedDeltas.slice(0, 3).map((delta, index) => (
              <div key={`${delta.name}-${index}`} className="delta-row">
                <div>
                  <h4>{delta.name}</h4>
                  <p className="muted">{delta.summary}</p>
                </div>
                <span className="impact-pill">Impact {delta.impact}</span>
              </div>
            ))}
            {rankedDeltas.length === 0 ? <p className="muted">No competitor move was captured on this run.</p> : null}
          </div>
        </article>

        <article className="panel full-span">
          <p className="eyebrow">What Changed Around You</p>
          <div className="list-grid">
            {deltas.length > 0 ? (
              deltas.map((delta, index) => (
                <div key={`${delta.name}-${index}`} className="delta-row">
                  <div>
                    <h4>{delta.name}</h4>
                    <p className="muted">{delta.summary}</p>
                  </div>
                  <span className="impact-pill">Impact {delta.impact}</span>
                </div>
              ))
            ) : (
              <p className="muted">No competitor movement was captured on this run.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
