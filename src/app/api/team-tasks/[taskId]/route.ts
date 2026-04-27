import { NextRequest, NextResponse } from "next/server";

import { validatePath } from "@/app/api/fs/validate";
import { getTask, updateTask } from "@/lib/team/team-tasks/store";
import type { UpdateTaskInput } from "@/lib/team/team-tasks/types";

// GET /api/team-tasks/{taskId}?workspaceRoot=&conversationId=
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const sp = req.nextUrl.searchParams;
  const v = validatePath(sp.get("workspaceRoot"));
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }
  const conversationId = sp.get("conversationId");
  if (!conversationId) {
    return NextResponse.json(
      { error: "conversationId required" },
      { status: 400 },
    );
  }
  try {
    const task = await getTask(v.resolved, conversationId, taskId);
    if (!task) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "read failed" },
      { status: 500 },
    );
  }
}

// PATCH /api/team-tasks/{taskId}
//   body: { workspaceRoot, conversationId, ...UpdateTaskInput }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const v = validatePath(body.workspaceRoot);
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }
  const conversationId = body.conversationId;
  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json(
      { error: "conversationId required" },
      { status: 400 },
    );
  }
  // Strip control fields.
  const patch: UpdateTaskInput = {};
  for (const key of [
    "title",
    "description",
    "status",
    "priority",
    "blockedReason",
    "failedReason",
  ] as const) {
    if (key in body) (patch as Record<string, unknown>)[key] = body[key];
  }
  try {
    const updated = await updateTask(v.resolved, conversationId, taskId, patch);
    if (!updated) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ task: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "update failed" },
      { status: 500 },
    );
  }
}
