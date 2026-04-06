import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth";
import { buildApiLoginRedirect } from "@/lib/api-auth";
import { createProjectSchema } from "@/lib/api-contract";
import { getDispatchRunsUrl } from "@/lib/internal-jobs";
import { createProject, listProjects } from "@/lib/repository";
import { enqueueProjectRun } from "@/lib/run-executor";

export async function GET(request: Request) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const projects = await listProjects();
  return NextResponse.json({ data: projects });
}

export async function POST(request: Request) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const payload = await request.json().catch(() => null);
  const parsed = createProjectSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const project = await createProject(parsed.data);
  if (!project) {
    return NextResponse.json({ error: "Unable to create project" }, { status: 500 });
  }

  let initialRun:
    | {
        runId: string;
        status: "queued";
      }
    | null = null;

  try {
    initialRun = await enqueueProjectRun(project.id, context);

    const internalJobSecret =
      process.env.INTERNAL_JOB_SECRET ??
      (process.env.NODE_ENV === "production" ? undefined : "local-edge-dev-secret");

    if (internalJobSecret) {
      void fetch(getDispatchRunsUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-job-secret": internalJobSecret,
        },
        body: JSON.stringify({ limit: 1 }),
        cache: "no-store",
      }).catch((error) => {
        console.error("Failed to trigger initial project run", error);
      });
    }
  } catch (error) {
    console.error("Project created but initial run could not be queued", error);
  }

  return NextResponse.json({ data: project, initialRun }, { status: 201 });
}
