import { notFound } from "next/navigation";

import { DiagnosticsTable } from "@/components/diagnostics-table";
import { getAccountContext } from "@/lib/auth";
import { getDiagnostics, getProject } from "@/lib/repository";

export default async function DiagnosticsPage({
  params,
}: {
  params: { id: string };
}) {
  const [context, project] = await Promise.all([getAccountContext(), getProject(params.id)]);
  if (!project) {
    notFound();
  }

  const diagnostics = await getDiagnostics(project.id);
  const internalAccess = context?.role === "owner";

  return (
    <section className="stack">
      <div className="panel">
        <p className="eyebrow">Diagnostics</p>
        <h2>{project.name}</h2>
        <p className="muted">
          Diagnostics are part of the trust layer for Local Edge. They explain what resolved,
          whether Google place lookups were healthy, and how much of the report was based on real
          public signals.
        </p>
        {internalAccess ? (
          <p className="muted">Owner preview is active so you can inspect hidden diagnostics while shaping the product.</p>
        ) : null}
      </div>

      <DiagnosticsTable
        diagnostics={diagnostics}
        diagnosticsEnabled={project.diagnosticsEnabled}
        internalAccess={internalAccess}
      />
    </section>
  );
}
