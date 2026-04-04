import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { createTargetSchema } from "@/lib/api-contract";
import { getAccountContext } from "@/lib/auth";
import { addProjectTarget, getProject, listProjectTargets } from "@/lib/repository";

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

  const targets = await listProjectTargets(params.id);
  return NextResponse.json({ data: targets });
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

  const payload = await request.json().catch(() => null);
  const parsed = createTargetSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid target payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const target = await addProjectTarget(params.id, parsed.data);
    if (!target) {
      return NextResponse.json({ error: "Unable to create target" }, { status: 500 });
    }

    return NextResponse.json({ data: target }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create target";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
