import { CreateProjectForm } from "@/components/create-project-form";
import { getAccountSummary } from "@/lib/repository";
import { redirect } from "next/navigation";

export default async function NewProjectPage() {
  const account = await getAccountSummary();
  if (!account) {
    redirect("/login");
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
