import Link from "next/link";

import { DashboardMetrics } from "@/components/dashboard-metrics";
import { ProjectCard } from "@/components/project-card";
import { MetricCard } from "@/components/metric-card";
import { Mail, TrendingUp, Users, ShieldCheck } from "lucide-react";
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
      <div className="hero-card">
        <div className="hero-left">
          <div className="hero-badge">
            <span>✨</span>
            <span>New: Competitor Alerts</span>
          </div>
          <h2 className="hero-title">
            Know your market <br />
            <span className="hero-accent">without the stress.</span>
          </h2>
          <p className="hero-subtitle">
            We do the research so you don&apos;t have to. Get a simple, plain-English report every week with the actions that matter.
          </p>
          <div className="hero-actions-row">
            {user ? (
              <>
                <Link href="/projects/new" className="hero-btn hero-btn-primary">
                  Create project
                </Link>
                <Link href={projects[0] ? `/projects/${projects[0].id}` : "/projects/new"} className="hero-btn hero-btn-secondary">
                  View dashboard
                </Link>
              </>
            ) : (
              <>
                <Link href="/login" className="hero-btn hero-btn-primary">
                  Start Free Trial
                </Link>
                <Link href="/login" className="hero-btn hero-btn-secondary">
                  Watch Video
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="hero-features">
          <MetricCard
            value="Weekly Email"
            helper="A friendly summary of everything you need to know."
            icon={Mail}
            tone="green"
          />
          <MetricCard
            value="Smart Trends"
            helper="See where the market is going before it gets there."
            icon={TrendingUp}
            tone="purple"
          />
          <MetricCard
            value="Competitors"
            helper="Keep an eye on the local competition, effortlessly."
            icon={Users}
            tone="green"
          />
          <MetricCard
            value="Safe & Secure"
            helper="Your data is yours. We just provide the insights."
            icon={ShieldCheck}
            tone="orange"
          />
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
