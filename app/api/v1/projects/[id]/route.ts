import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth";
import { buildApiLoginRedirect } from "@/lib/api-auth";
import { updateProjectSchema } from "@/lib/api-contract";
import { archiveProject, getProject, updateProject } from "@/lib/repository";

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

  return NextResponse.json({ data: project });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const payload = await request.json().catch(() => null);
  const parsed = updateProjectSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project payload", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const project = await updateProject(params.id, parsed.data);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ data: project });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const removed = await archiveProject(params.id);
  if (!removed) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ data: { id: params.id, archived: true } });
}
