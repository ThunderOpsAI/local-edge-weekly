import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth";
import { buildApiLoginRedirect } from "@/lib/api-auth";
import { triggerRunSchema } from "@/lib/api-contract";
import { triggerQueuedRunsInBackground } from "@/lib/internal-jobs";
import { getProject, listRuns } from "@/lib/repository";
import { enqueueProjectRun } from "@/lib/run-executor";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const runs = await listRuns(params.id);
  return NextResponse.json({ data: runs });
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const payload = await request.json().catch(() => ({ projectId: params.id }));
  const parsed = triggerRunSchema.safeParse({
    projectId: params.id,
    ...(payload ?? {}),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid run payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const internalJobSecret =
      process.env.INTERNAL_JOB_SECRET ??
      (process.env.NODE_ENV === "production" ? undefined : "local-edge-dev-secret");

    if (!internalJobSecret) {
      return NextResponse.json(
        {
          error: "INTERNAL_JOB_SECRET is missing, so the background worker cannot be started.",
        },
        { status: 500 },
      );
    }

    const result = await enqueueProjectRun(params.id, context);

    triggerQueuedRunsInBackground(1, "manual-run");

    return NextResponse.json(
      {
        data: {
          runId: result.runId,
          projectId: params.id,
          status: result.status,
          message: "Run queued successfully.",
        },
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run execution failed";
    const status = /already queued or running/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
