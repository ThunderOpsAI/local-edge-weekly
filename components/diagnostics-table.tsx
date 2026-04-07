import type { SourceDiagnostics } from "@/types/domain";

interface DiagnosticsTableProps {
  diagnostics: SourceDiagnostics;
  diagnosticsEnabled: boolean;
  internalAccess?: boolean;
}

function renderChip(label: string, tone: "good" | "warn" | "neutral") {
  const className =
    tone === "good" ? "chip chip-good" : tone === "warn" ? "chip chip-warn" : "chip chip-neutral";

  return <span className={className}>{label}</span>;
}

function summarizeDiagnostics(diagnostics: SourceDiagnostics, successRatio: number) {
  const resolvedVenues = diagnostics.google_maps.filter((entry) => entry.resolved).length;
  const fetchedCompetitorPages = diagnostics.competitor_urls.filter((entry) => entry.fetched).length;
  const discussionPosts = diagnostics.reddit.reduce((sum, entry) => sum + entry.posts_found, 0);
  const keywords = diagnostics.competitor_urls.flatMap((entry) => entry.matched_keywords);
  const visibleKeywords = [...new Set(keywords)].slice(0, 6);
  const offerKeywords = keywords.filter((keyword) =>
    /deal|offer|special|bundle|combo|delivery|lunch|late|book|order|free|box/i.test(keyword),
  );

  return {
    sourceHealth:
      successRatio >= 95
        ? `We checked the full tracked market: ${resolvedVenues} venues, ${fetchedCompetitorPages} competitor websites, and discussion sources all came back clean.`
        : `We checked the tracked market, but ${diagnostics.source_stats.fail} source checks need attention before this run is fully trusted.`,
    marketActivity:
      visibleKeywords.length > 0
        ? `Competitor pages are showing ${visibleKeywords.join(", ")} signals. That points to what buyers are being trained to notice.`
        : `Competitor pages were reachable, but this run did not find strong tracked offer language.`,
    ownerAction:
      offerKeywords.length > 0
        ? `Treat this as offer pressure. Pick one clear counter-move for the next run: a named bundle, delivery hook, lunch offer, or booking message.`
        : `Treat this as a quiet market check. Keep monitoring, but do not force a campaign unless the report found a stronger owner action.`,
    evidence: `${discussionPosts} public discussion matches and ${keywords.length} competitor website keywords were captured as evidence.`,
  };
}

export function DiagnosticsTable({
  diagnostics,
  diagnosticsEnabled,
  internalAccess = false,
}: DiagnosticsTableProps) {
  const canViewDiagnostics = diagnosticsEnabled || internalAccess;
  const successRatio = Math.round((1 - diagnostics.source_stats.failure_ratio) * 100);
  const summary = summarizeDiagnostics(diagnostics, successRatio);

  if (!canViewDiagnostics) {
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
    <section className="panel stack">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Source Diagnostics</p>
          <h2>Coverage and resolution health</h2>
          <p className="muted">
            {internalAccess && !diagnosticsEnabled
              ? "Internal preview is enabled for owners so runs can be debugged even when customer-facing diagnostics are hidden."
              : "Source diagnostics explain what resolved cleanly, what was fetched, and where more coverage is still needed."}
          </p>
        </div>
        <div className="stack-right">
          <span className="metric-label">Success ratio</span>
          <strong>{successRatio}%</strong>
        </div>
      </div>

      <article className="panel">
        <p className="eyebrow">Owner Translation</p>
        <h3>What this means</h3>
        <div className="card-grid">
          <div className="panel insight-card insight-good">
            <p className="eyebrow">Source health</p>
            <p>{summary.sourceHealth}</p>
          </div>
          <div className="panel insight-card insight-warn">
            <p className="eyebrow">Market activity</p>
            <p>{summary.marketActivity}</p>
          </div>
          <div className="panel insight-card insight-neutral">
            <p className="eyebrow">Owner action</p>
            <p>{summary.ownerAction}</p>
          </div>
          <div className="panel insight-card insight-neutral">
            <p className="eyebrow">Evidence</p>
            <p>{summary.evidence}</p>
          </div>
        </div>
      </article>

      <div className="dashboard-grid">
        <article className="panel">
          <p className="eyebrow">Google Maps</p>
          <h3>Venue resolution</h3>
          <p className="muted">
            {diagnostics.google_maps.filter((entry) => entry.resolved).length} of {diagnostics.google_maps.length} venues resolved.
          </p>
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
                {diagnostics.google_maps.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No Google diagnostics captured on this run.</td>
                  </tr>
                ) : (
                  diagnostics.google_maps.map((entry) => (
                    <tr key={`${entry.cafe}-${entry.place_id ?? "unresolved"}`}>
                      <td>{entry.resolved_name ?? entry.cafe}</td>
                      <td>{renderChip(entry.resolved ? "Resolved" : "Needs attention", entry.resolved ? "good" : "warn")}</td>
                      <td>{entry.reviews_count ?? 0}</td>
                      <td className="table-link-cell">{entry.details_context?.website ?? "N/A"}</td>
                      <td>
                        {entry.error_message ??
                          entry.reason ??
                          entry.attempts[entry.attempts.length - 1]?.error_message ??
                          "Google place details available"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <p className="eyebrow">Reddit</p>
          <h3>Discussion fetch health</h3>
          <p className="muted">
            {diagnostics.reddit.filter((entry) => entry.fetched).length} of {diagnostics.reddit.length} venue searches fetched successfully.
          </p>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Venue</th>
                  <th>Status</th>
                  <th>Posts found</th>
                  <th>Subreddits</th>
                  <th>Recent source note</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.reddit.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No Reddit diagnostics captured on this run.</td>
                  </tr>
                ) : (
                  diagnostics.reddit.map((entry) => (
                    <tr key={entry.cafe}>
                      <td>{entry.cafe}</td>
                      <td>{renderChip(entry.fetched ? "Fetched" : "Failed", entry.fetched ? "good" : "warn")}</td>
                      <td>{entry.posts_found}</td>
                      <td>{entry.subreddits.join(", ")}</td>
                      <td>
                        {entry.attempts.find((attempt) => attempt.error_message)?.error_message ??
                          (entry.posts_found > 0 ? "Recent venue mentions found." : "No recent venue posts matched this run.")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <article className="panel">
        <p className="eyebrow">Competitor URLs</p>
        <h3>Website collection health</h3>
        <p className="muted">
          {diagnostics.competitor_urls.filter((entry) => entry.fetched).length} of {diagnostics.competitor_urls.length} competitor pages fetched successfully.
        </p>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Venue</th>
                <th>Status</th>
                <th>URL</th>
                <th>Matched keywords</th>
                <th>Recent source note</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.competitor_urls.length === 0 ? (
                <tr>
                  <td colSpan={5}>No competitor website diagnostics captured on this run.</td>
                </tr>
              ) : (
                diagnostics.competitor_urls.map((entry) => (
                  <tr key={`${entry.cafe}-${entry.url}`}>
                    <td>{entry.cafe}</td>
                    <td>{renderChip(entry.fetched ? "Fetched" : "Needs attention", entry.fetched ? "good" : "warn")}</td>
                    <td className="table-link-cell">{entry.url}</td>
                    <td>{entry.matched_keywords.length > 0 ? entry.matched_keywords.slice(0, 5).join(", ") : "No tracked keywords found"}</td>
                    <td>{entry.error_message ?? (entry.http_status ? `HTTP ${entry.http_status}` : "Website content captured")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
