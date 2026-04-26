import { NextRequest, NextResponse } from "next/server";

import { validatePath } from "@/app/api/fs/validate";
import { listTasks } from "@/lib/team/team-tasks/store";

/**
 * GET /api/team-tasks/summary?workspaceRoot=&conversationId=
 *
 * Lightweight summary used by the chat-header badge dot. Reads the same
 * tasks store but returns aggregate counts only.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const v = validatePath(sp.get("workspaceRoot"));
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }
  const conversationId = sp.get("conversationId") ?? undefined;
  try {
    const tasks = await listTasks(v.resolved, { conversationId });
    let total = 0;
    let blocked = 0;
    let in_progress = 0;
    for (const t of tasks) {
      total += 1;
      if (t.status === "blocked") blocked += 1;
      if (t.status === "in_progress") in_progress += 1;
    }
    return NextResponse.json({ summary: { total, blocked, in_progress } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "summary failed" },
      { status: 500 },
    );
  }
}
