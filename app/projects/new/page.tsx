import Link from "next/link";
import { CreateProjectForm } from "@/components/create-project-form";
import { getAuthenticatedUser } from "@/lib/auth";
import { getAccountSummary } from "@/lib/repository";
import { redirect } from "next/navigation";

export default async function NewProjectPage() {
  const [user, account] = await Promise.all([getAuthenticatedUser(), getAccountSummary()]);

  if (!user) {
    redirect("/login");
  }

  if (!account) {
    return (
      <section className="stack">
        <div className="panel hero-panel">
          <p className="eyebrow">Account Setup</p>
          <h2>We could not finish preparing your workspace yet.</h2>
          <p className="muted">
            Your sign-in worked, but the account record your dashboard needs is still missing.
            Sign out, request a fresh magic link, and try again.
          </p>
          <div className="page-actions">
            <Link href="/" className="button button-secondary">
              Back home
            </Link>
            <Link href="/login" className="button button-primary">
              Re-open sign in
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="stack">
      <div className="panel hero-panel">
        <p className="eyebrow">New Project</p>
        <h2>Set up a local business once, then let Local Edge watch the market.</h2>
        <p className="muted">
          The owner adds their primary URL, the direct competitors, and the region. The product
          uses plan rules server-side so the dashboard always reflects what the customer actually
          bought.
        </p>
      </div>

      <CreateProjectForm defaultPlan={account.plan} />
    </section>
  );
}
