import Link from "next/link";

import { DashboardMetrics } from "@/components/dashboard-metrics";
import { ProjectCard } from "@/components/project-card";
import { getAuthenticatedUser } from "@/lib/auth";
import { getAccountSummary, listProjects } from "@/lib/repository";

export default async function HomePage() {
  const [user, account, projects] = await Promise.all([
    getAuthenticatedUser(),
    getAccountSummary(),
    listProjects(),
  ]);

  const overviewMetrics = [
    {
      label: "Plan",
      value: account ? (account.plan === "edge" ? "Edge" : account.plan === "solo" ? "Solo" : "Trial") : "Login required",
      helper: "Server-enforced plan logic controls cadence, diagnostics, and manual reruns.",
      tone: "neutral" as const,
    },
    {
      label: "Cadence",
      value: account ? (account.cadence === "weekly" ? "Weekly" : "Monthly") : "Protected",
      helper: "Owners receive a summary email after each completed run.",
      tone: account ? ("good" as const) : ("neutral" as const),
    },
    {
      label: "Projects",
      value: String(projects.length),
      helper: "Each account tracks one primary business with competitor monitoring.",
      tone: projects.length > 0 ? ("good" as const) : ("neutral" as const),
    },
    {
      label: "Diagnostics",
      value: account ? (account.diagnosticsEnabled ? "Included" : "Hidden") : "Protected",
      helper: "Only Edge customers see the full source diagnostics view.",
      tone: account ? (account.diagnosticsEnabled ? ("good" as const) : ("warn" as const)) : ("neutral" as const),
    },
  ];

  return (
    <section className="stack">
      <div className="panel hero-panel hero-grid">
        <div className="stack">
          <p className="eyebrow">Owner-facing early warning system</p>
          <h2>Know what is changing in your local market without doing the research yourself.</h2>
          <p className="muted">
            Local Edge turns public signals from Google, websites, and competitor movement into a
            plain-English report with one clear action to take next.
          </p>
          <div className="page-actions">
            {user ? (
              <>
                <Link href="/projects/new" className="button button-primary">
                  Create project
                </Link>
                <Link href={projects[0] ? `/projects/${projects[0].id}` : "/projects/new"} className="button button-secondary">
                  View latest dashboard
                </Link>
              </>
            ) : (
              <Link href="/login" className="button button-primary">
                Sign in
              </Link>
            )}
          </div>
        </div>

        <div className="hero-stat-block">
          <div className="hero-stat">
            <span className="metric-label">Email output</span>
            <strong>3 insights + 1 action</strong>
          </div>
          <div className="hero-stat">
            <span className="metric-label">Trend unlock</span>
            <strong>After run 2</strong>
          </div>
          <div className="hero-stat">
            <span className="metric-label">Competitors</span>
            <strong>Up to 5 on Edge</strong>
          </div>
        </div>
      </div>

      <DashboardMetrics metrics={overviewMetrics} />

      {user ? (
        <>
          <div className="section-header">
            <div>
              <p className="eyebrow">Projects</p>
              <h3>Customer dashboards</h3>
            </div>
            <p className="muted">Projects show the latest report, source health, and what changed since the last run.</p>
          </div>

          <div className="project-list">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </>
      ) : (
        <article className="panel">
          <p className="eyebrow">Protected Workspace</p>
          <h3>Projects, reports, and APIs are now account-scoped.</h3>
          <p className="muted">
            Sign in with a magic link to access only the data owned by your account.
          </p>
        </article>
      )}
    </section>
  );
}
