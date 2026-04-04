import { notFound } from "next/navigation";

import { DiagnosticsTable } from "@/components/diagnostics-table";
import { getDiagnostics, getProject } from "@/lib/repository";

export default async function DiagnosticsPage({
  params,
}: {
  params: { id: string };
}) {
  const project = await getProject(params.id);
  if (!project) {
    notFound();
  }

  const diagnostics = await getDiagnostics(project.id);

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
      </div>

      <DiagnosticsTable diagnostics={diagnostics} diagnosticsEnabled={project.diagnosticsEnabled} />
    </section>
  );
}
