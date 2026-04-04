import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth";
import { buildApiLoginRedirect } from "@/lib/api-auth";
import { triggerRunSchema } from "@/lib/api-contract";
import { getProject, listRuns } from "@/lib/repository";

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

  return NextResponse.json(
    {
      data: {
        runId: "queued-run",
        projectId: params.id,
        status: "queued",
        note: "Queue wiring is still pending. Current analysis runs from the Python engine.",
      },
    },
    { status: 202 },
  );
}
