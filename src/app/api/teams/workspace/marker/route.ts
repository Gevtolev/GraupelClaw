import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

import { validatePath } from "@/app/api/fs/validate";

/**
 * POST /api/teams/workspace/marker
 *
 * Writes a `.graupelclaw-workspace.json` file inside the team's workspace
 * root so the agent (and the user) can identify the folder later. Best-effort.
 */
export async function POST(req: NextRequest) {
  let body: { teamId?: string; teamName?: string; workspaceRoot?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { teamId, teamName, workspaceRoot } = body;
  if (!teamId || !teamName || !workspaceRoot) {
    return NextResponse.json(
      { error: "teamId, teamName, workspaceRoot required" },
      { status: 400 },
    );
  }

  const v = validatePath(workspaceRoot);
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }

  try {
    await fs.mkdir(v.resolved, { recursive: true });
    const marker = {
      schemaVersion: 1,
      teamId,
      teamName,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(v.resolved, ".graupelclaw-workspace.json"),
      JSON.stringify(marker, null, 2) + "\n",
      "utf8",
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return NextResponse.json(
      { error: e.message ?? "failed to write marker" },
      { status: 500 },
    );
  }
}
