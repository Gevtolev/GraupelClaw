import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

import { validatePath } from "@/app/api/fs/validate";

const MAX_BYTES = 1_000_000; // 1MB
const HEADER = `# Team Decisions\n\n---\n\n`;

interface DecisionInput {
  title: string;
  decidedBy: string;
  context?: string;
  rationale: string;
  rejected?: string;
  affects?: string;
}

function decisionsFile(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".team", "decisions.md");
}

function formatDecision(d: DecisionInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const safeTitle = d.title.replace(/\n/g, " ").trim();
  const lines = [
    `## [${today}] ${safeTitle}`,
    "",
    `**Decided by**: ${d.decidedBy}`,
  ];
  if (d.context) lines.push(`**Context**: ${d.context.replace(/\n/g, " ")}`);
  lines.push(`**Rationale**: ${d.rationale.replace(/\n/g, " ")}`);
  if (d.rejected) lines.push(`**Rejected**: ${d.rejected.replace(/\n/g, " ")}`);
  if (d.affects) lines.push(`**Affects**: ${d.affects.replace(/\n/g, " ")}`);
  lines.push("", "---", "", "");
  return lines.join("\n");
}

/**
 * GET /api/team-decisions?workspaceRoot=
 *
 * Returns the raw decisions.md content + a count of `## [` headings.
 * No 404 — missing file returns empty string.
 */
export async function GET(req: NextRequest) {
  const v = validatePath(req.nextUrl.searchParams.get("workspaceRoot"));
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }
  const file = decisionsFile(v.resolved);
  try {
    const content = await fs.readFile(file, "utf8");
    const sectionCount = (content.match(/^## \[/gm) ?? []).length;
    return NextResponse.json({ content, sectionCount });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return NextResponse.json({ content: "", sectionCount: 0 });
    }
    return NextResponse.json(
      { error: e.message ?? "read failed" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/team-decisions  body: { workspaceRoot, ...DecisionInput }
 *
 * Prepends a new decision section after the file header. Lazy-creates file
 * if missing. No lockfile — concurrent writes are extremely rare; last-
 * writer-wins is acceptable.
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
  const input = body as unknown as DecisionInput;
  if (
    typeof input.title !== "string" ||
    typeof input.rationale !== "string" ||
    typeof input.decidedBy !== "string" ||
    !input.title.trim() ||
    !input.rationale.trim()
  ) {
    return NextResponse.json(
      { error: "title, rationale, decidedBy required" },
      { status: 400 },
    );
  }

  const file = decisionsFile(v.resolved);
  await fs.mkdir(path.dirname(file), { recursive: true });

  let existing = "";
  try {
    existing = await fs.readFile(file, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      return NextResponse.json(
        { error: e.message ?? "read failed" },
        { status: 500 },
      );
    }
  }
  if (existing.length >= MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          "decisions log exceeds 1MB; please archive or trim manually",
      },
      { status: 413 },
    );
  }

  const formatted = formatDecision(input);
  let next: string;
  if (!existing) {
    next = HEADER + formatted;
  } else {
    // Insert after the header (after the first `---` divider). If we cannot
    // find the divider, prepend the formatted section after a fresh header.
    const headerEnd = existing.indexOf("\n---\n");
    if (headerEnd === -1) {
      next = HEADER + formatted + existing;
    } else {
      const before = existing.slice(0, headerEnd + 5); // include "\n---\n"
      const after = existing.slice(headerEnd + 5);
      next = before + "\n" + formatted + after.replace(/^\n+/, "");
    }
  }

  // Atomic write via temp + rename
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, next, "utf8");
  await fs.rename(tmp, file);
  return NextResponse.json({ ok: true });
}
