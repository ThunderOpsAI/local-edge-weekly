import { NextResponse } from "next/server";

import { getAccountContext } from "@/lib/auth";
import { buildApiLoginRedirect } from "@/lib/api-auth";
import { createProjectSchema } from "@/lib/api-contract";
import { createProject, listProjects } from "@/lib/repository";

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

  return NextResponse.json({ data: project }, { status: 201 });
}
