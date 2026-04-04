import { NextResponse } from "next/server";

import { buildApiLoginRedirect } from "@/lib/api-auth";
import { getAccountContext } from "@/lib/auth";
import { deleteProjectTarget, getProject } from "@/lib/repository";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; tid: string } },
) {
  const context = await getAccountContext();
  if (!context) {
    return buildApiLoginRedirect(request);
  }

  const project = await getProject(params.id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const removed = await deleteProjectTarget(params.id, params.tid);
    if (!removed) {
      return NextResponse.json({ error: "Target not found" }, { status: 404 });
    }

    return NextResponse.json({ data: { id: params.tid, deleted: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete target";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
