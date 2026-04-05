import type { CompetitorDelta, ReportLead, ReportRecord } from "@/types/domain";

interface RunEmailProject {
  id: string;
  name: string;
  location: string;
  industry: string;
}

interface SendRunSummaryEmailInput {
  to: string;
  project: RunEmailProject;
  report: ReportRecord;
}

function getAppBaseUrl() {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    return null;
  }

  return { apiKey, from };
}

function parseLeads(report: ReportRecord): ReportLead[] {
  return report.body.target_leads.map(([name, gap, hook]) => ({ name, gap, hook }));
}

function parseDeltas(report: ReportRecord): CompetitorDelta[] {
  return report.body.competitor_delta.map(([name, summary, impact]) => ({ name, summary, impact }));
}

function renderLeadHtml(leads: ReportLead[]) {
  if (leads.length === 0) {
    return "<p>No target leads were captured on this run.</p>";
  }

  return leads
    .map(
      (lead) => `
        <li style="margin-bottom:12px;">
          <strong>${lead.name}</strong><br />
          <span><strong>Strength:</strong> ${lead.gap}</span><br />
          <span><strong>Action:</strong> ${lead.hook}</span>
        </li>
      `,
    )
    .join("");
}

function renderDeltaHtml(deltas: CompetitorDelta[]) {
  if (deltas.length === 0) {
    return "<p>No competitor shifts were captured on this run.</p>";
  }

  return deltas
    .slice(0, 3)
    .map(
      (delta) => `
        <li style="margin-bottom:12px;">
          <strong>${delta.name}</strong><br />
          <span>${delta.summary}</span><br />
          <span><strong>Impact:</strong> ${delta.impact}</span>
        </li>
      `,
    )
    .join("");
}

export async function sendRunSummaryEmail(input: SendRunSummaryEmailInput) {
  const config = getResendConfig();
  if (!config) {
    return { delivered: false, reason: "missing_config" as const };
  }

  const leads = parseLeads(input.report);
  const deltas = parseDeltas(input.report);
  const keyInsight = deltas[0]?.summary ?? leads[0]?.gap ?? "Fresh market coverage is now available in Local Edge.";
  const actions = [leads[0]?.hook, deltas[0] ? `Review ${deltas[0].name}: ${deltas[0].summary}` : null]
    .filter(Boolean)
    .slice(0, 2);

  const reportUrl = `${getAppBaseUrl()}/projects/${input.project.id}`;
  const html = `
    <div style="font-family: Georgia, serif; color: #1f1a14; line-height: 1.5;">
      <p style="text-transform: uppercase; letter-spacing: 0.12em; color: #0e7c66; font-size: 12px;">Local Edge Run Complete</p>
      <h1 style="margin-bottom: 8px;">${input.project.name}</h1>
      <p style="color: #6b6255; margin-top: 0;">${input.project.location} · ${input.project.industry}</p>
      <p><strong>Coverage:</strong> ${Math.round(input.report.coverageScore * 100)}%</p>
      <p><strong>Market status:</strong> ${input.report.body.market_status}</p>
      <p><strong>Key insight:</strong> ${keyInsight}</p>
      <p><strong>Summary:</strong> ${leads[0]?.hook ?? "The latest run is ready in the dashboard with fresh signals and diagnostics."}</p>

      ${
        actions.length > 0
          ? `<h2>Actions</h2><ul>${actions.map((action) => `<li>${action}</li>`).join("")}</ul>`
          : ""
      }

      <h2>Target leads</h2>
      <ul>${renderLeadHtml(leads)}</ul>

      <h2>Competitor movement</h2>
      <ul>${renderDeltaHtml(deltas)}</ul>

      <p style="margin-top: 24px;">
        <a href="${reportUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1f1a14;color:#ffffff;text-decoration:none;font-weight:700;">
          Open dashboard
        </a>
      </p>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [input.to],
      subject: `${input.project.name} Local Edge update`,
      html,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown email error");
    throw new Error(`Resend request failed: ${errorText}`);
  }

  return { delivered: true as const };
}
