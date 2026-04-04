import type { ReportRecord, ReportLead, CompetitorDelta, ProjectSummary } from "@/types/domain";

interface SendApprovedReportEmailInput {
  to: string;
  project: ProjectSummary;
  report: ReportRecord;
  leads: ReportLead[];
  deltas: CompetitorDelta[];
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

export async function sendApprovedReportEmail(input: SendApprovedReportEmailInput) {
  const config = getResendConfig();
  if (!config) {
    return { delivered: false, reason: "missing_config" as const };
  }

  const reportUrl = `${getAppBaseUrl()}/projects/${input.project.id}`;
  const html = `
    <div style="font-family: Georgia, serif; color: #1f1a14; line-height: 1.5;">
      <p style="text-transform: uppercase; letter-spacing: 0.12em; color: #0e7c66; font-size: 12px;">Local Edge Approved Report</p>
      <h1 style="margin-bottom: 8px;">${input.project.name}</h1>
      <p style="color: #6b6255; margin-top: 0;">${input.project.location} · ${input.project.industry}</p>
      <p><strong>Coverage:</strong> ${Math.round(input.report.coverageScore * 100)}%</p>
      <p><strong>Market status:</strong> ${input.report.body.market_status}</p>

      <h2>Target leads</h2>
      <ul>${renderLeadHtml(input.leads)}</ul>

      <h2>Competitor movement</h2>
      <ul>${renderDeltaHtml(input.deltas)}</ul>

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
      subject: `${input.project.name} approved Local Edge report`,
      html,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown email error");
    throw new Error(`Resend request failed: ${errorText}`);
  }

  return { delivered: true as const };
}
