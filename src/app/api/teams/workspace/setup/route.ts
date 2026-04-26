import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { validatePath } from "@/app/api/fs/validate";

const SKILL_DIR = path.join(os.homedir(), ".openclaw", "workspace", "skills", "team-coordination");
const SKILL_FILE = path.join(SKILL_DIR, "SKILL.md");
const SKILL_VERSION = 1;

const SKILL_CONTENT = `---
name: team-coordination
description: Coordinate tasks with team members in a GraupelClaw team. Trigger when delegating, accepting a task, updating status, or reporting blockers.
x-graupelclaw-version: ${SKILL_VERSION}
---

# Team Coordination

You are part of a GraupelClaw team. Use the \`gpw\` CLI to track team work.

## Quick reference (the binary lives in your team workspace)

\`\`\`bash
WS="$TEAM_WORKSPACE"   # absolute path injected via team_context

# Create a task (assigned to yourself or a teammate)
$WS/.team/bin/gpw task create --title "Research user pain points" --assignee Eva [--priority P0|P1|P2] [--depends TASK-003]

# Update status (use the TASK-NNN id)
$WS/.team/bin/gpw task update TASK-007 --status completed
$WS/.team/bin/gpw task update TASK-007 --status blocked --reason "Waiting for X"

# List / get
$WS/.team/bin/gpw task list [--status pending|in_progress|blocked]
$WS/.team/bin/gpw task get TASK-007
\`\`\`

## When to create a task
- Multi-step work (3+ subtasks or spans multiple turns)
- Handing a sub-task off to a teammate (create + @mention)
- Tracking your own progress on substantial work

## When NOT to create a task
- One-shot answers
- Casual chat / clarifying questions

## Status discipline
- \`pending\` → \`in_progress\`: declare BEFORE you start
- \`in_progress\` → \`completed\`: declare IMMEDIATELY after done
- \`in_progress\` → \`blocked\` (always include \`--reason\`)
- \`in_progress\` → \`failed\` (always include \`--reason\`)

## Blocked / failed reply prefix shortcut
If you are returning a reply that ENDS your turn on a blocker, you can
declare it inline with a leading line:
\`\`\`
[BLOCKED: TASK-007 reason here]
... rest of the reply ...
\`\`\`
The dispatcher recognizes this and flips TASK-007 to blocked. Same for
\`[FAILED: TASK-NNN reason]\`. Do NOT use these prefixes mid-paragraph.
`;

interface ExistingFrontmatter {
  exists: boolean;
  hasVersion: boolean;
  version: number;
}

async function inspectExistingSkill(): Promise<ExistingFrontmatter> {
  try {
    const raw = await fs.readFile(SKILL_FILE, "utf8");
    const match = /^---[\s\S]*?x-graupelclaw-version:\s*(\d+)[\s\S]*?---/m.exec(raw);
    if (!match) {
      return { exists: true, hasVersion: false, version: 0 };
    }
    return { exists: true, hasVersion: true, version: Number(match[1]) || 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return { exists: false, hasVersion: false, version: 0 };
    }
    throw err;
  }
}

async function ensureSkillInstalled(): Promise<{ action: "installed" | "upgraded" | "skipped-newer" | "skipped-user-edited" }> {
  const info = await inspectExistingSkill();

  if (!info.exists) {
    await fs.mkdir(SKILL_DIR, { recursive: true });
    await fs.writeFile(SKILL_FILE, SKILL_CONTENT, "utf8");
    return { action: "installed" };
  }
  if (!info.hasVersion) {
    // Existing file with no version marker — assume user-edited; do not overwrite.
    return { action: "skipped-user-edited" };
  }
  if (info.version >= SKILL_VERSION) {
    return { action: "skipped-newer" };
  }
  await fs.writeFile(SKILL_FILE, SKILL_CONTENT, "utf8");
  return { action: "upgraded" };
}

async function ensureGpwShim(workspaceRoot: string): Promise<string> {
  const dir = path.join(workspaceRoot, ".team", "bin");
  await fs.mkdir(dir, { recursive: true });
  const shim = path.join(dir, "gpw");
  // The shim looks up `graupelclawRoot` from gpw-config.json in the parent
  // dir, so the shim itself is portable. Idempotent: only rewrite when content
  // differs to avoid lock contention on rapid team activations.
  const desired = `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$DIR/../gpw-config.json"
ROOT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).graupelclawRoot)")"
exec node "$ROOT/tools/gpw/dist/index.js" "$@"
`;
  let current = "";
  try {
    current = await fs.readFile(shim, "utf8");
  } catch {
    // missing — write fresh below
  }
  if (current !== desired) {
    await fs.writeFile(shim, desired, "utf8");
    await fs.chmod(shim, 0o755);
  }
  return shim;
}

async function writeGpwConfig(opts: {
  workspaceRoot: string;
  apiBase: string;
  graupelclawRoot: string;
  teamId: string;
  teamName: string;
  conversationId: string | null;
  agentNameById: Record<string, string>;
}): Promise<string> {
  const dir = path.join(opts.workspaceRoot, ".team");
  await fs.mkdir(dir, { recursive: true });
  const config = {
    schemaVersion: 1,
    apiBase: opts.apiBase,
    graupelclawRoot: opts.graupelclawRoot,
    teamId: opts.teamId,
    teamName: opts.teamName,
    conversationId: opts.conversationId,
    agentNameById: opts.agentNameById,
  };
  const target = path.join(dir, "gpw-config.json");
  let current = "";
  try {
    current = await fs.readFile(target, "utf8");
  } catch {
    // missing
  }
  const desired = JSON.stringify(config, null, 2) + "\n";
  if (current !== desired) {
    await fs.writeFile(target, desired, "utf8");
  }
  return target;
}

/**
 * POST /api/teams/workspace/setup
 *  body: { workspaceRoot, teamId, teamName, conversationId?, agentNameById? }
 *
 * Idempotent. Performs the per-team-activation setup:
 *   1. Install or upgrade the team-coordination skill (respects user-edited
 *      versions).
 *   2. Ensure {workspaceRoot}/.team/bin/gpw shim exists.
 *   3. Write {workspaceRoot}/.team/gpw-config.json with the actual port +
 *      graupelclawRoot + team metadata.
 */
export async function POST(req: NextRequest) {
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
  const teamId = body.teamId;
  const teamName = body.teamName;
  if (typeof teamId !== "string" || typeof teamName !== "string") {
    return NextResponse.json(
      { error: "teamId, teamName required" },
      { status: 400 },
    );
  }
  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : null;
  const agentNameById =
    typeof body.agentNameById === "object" && body.agentNameById
      ? (body.agentNameById as Record<string, string>)
      : {};

  const apiBase = `http://localhost:${process.env.PORT ?? "3000"}`;
  const graupelclawRoot = process.cwd();

  try {
    const skill = await ensureSkillInstalled();
    const shim = await ensureGpwShim(v.resolved);
    const configPath = await writeGpwConfig({
      workspaceRoot: v.resolved,
      apiBase,
      graupelclawRoot,
      teamId,
      teamName,
      conversationId,
      agentNameById,
    });
    return NextResponse.json({
      ok: true,
      skill: skill.action,
      shim,
      configPath,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "setup failed" },
      { status: 500 },
    );
  }
}
