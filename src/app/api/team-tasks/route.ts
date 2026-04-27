import { NextRequest, NextResponse } from "next/server";

import { validatePath } from "@/app/api/fs/validate";
import {
  createTask,
  listTasks,
} from "@/lib/team/team-tasks/store";
import type { CreateTaskInput, TaskStatus } from "@/lib/team/team-tasks/types";

// POST /api/team-tasks
//   body: { workspaceRoot, teamId, ...CreateTaskInput }
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const workspaceRoot = body.workspaceRoot;
  const v = validatePath(workspaceRoot);
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }

  const teamId = body.teamId;
  if (typeof teamId !== "string" || !teamId) {
    return NextResponse.json(
      { error: "teamId required" },
      { status: 400 },
    );
  }

  const input = body as unknown as CreateTaskInput;
  if (
    typeof input.title !== "string" ||
    typeof input.assignee !== "string" ||
    typeof input.conversationId !== "string"
  ) {
    return NextResponse.json(
      { error: "title, assignee, conversationId required" },
      { status: 400 },
    );
  }
  if (input.title.length === 0 || input.title.length > 200) {
    return NextResponse.json(
      { error: "title must be 1-200 chars" },
      { status: 400 },
    );
  }
  try {
    const task = await createTask(v.resolved, teamId, input);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create failed" },
      { status: 500 },
    );
  }
}

// GET /api/team-tasks?workspaceRoot=&conversationId=&status=&assignee=&limit=
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const workspaceRoot = sp.get("workspaceRoot");
  const v = validatePath(workspaceRoot);
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }
  const status = sp.get("status") as TaskStatus | null;
  const limit = Number(sp.get("limit")) || undefined;
  try {
    const tasks = await listTasks(v.resolved, {
      conversationId: sp.get("conversationId") ?? undefined,
      status: status ?? undefined,
      assignee: sp.get("assignee") ?? undefined,
      limit,
    });
    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 },
    );
  }
}
