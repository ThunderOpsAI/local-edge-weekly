import Link from "next/link";

import { getStatusTone, StatusChip } from "@/components/status-chip";
import type { ProjectSummary } from "@/types/domain";

interface ProjectCardProps {
  project: ProjectSummary;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <article className="panel project-card">
      <div className="project-card-header">
        <div>
          <p className="eyebrow">
            {project.industry} - {project.plan}
          </p>
          <h3>{project.name}</h3>
        </div>
        <StatusChip tone={getStatusTone(project.reportStatus)} label={project.reportStatus} />
      </div>
      <p className="muted">{project.location}</p>
      <p>
        <strong>Target:</strong> {project.primaryTarget}
      </p>
      <p>
        <strong>Competitors:</strong> {project.competitors.join(", ")}
      </p>
      <p>
        <strong>Coverage:</strong> {Math.round(project.coverageScore * 100)}%
      </p>
      <p>
        <strong>Cadence:</strong> {project.cadence}
      </p>
      <div className="project-card-actions">
        <Link href={`/projects/${project.id}`} className="button button-primary">
          Open Dashboard
        </Link>
      </div>
    </article>
  );
}
