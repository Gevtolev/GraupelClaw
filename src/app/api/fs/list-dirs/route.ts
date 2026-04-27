import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";

import { validatePath } from "../validate";

const MAX_ENTRIES = 200;
// Skip directories that are pathologically large or noisy and unlikely to be
// chosen as a team workspace. Users can still type/navigate into them via
// `?showHidden=true` if they really want to.
const SKIP_NAMES = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".cache",
  ".npm",
  ".pnpm-store",
]);

/**
 * GET /api/fs/list-dirs?path=&showHidden=
 *
 * Returns immediate subdirectories of `path`, capped at MAX_ENTRIES.
 * Sorted alphabetically. Honors the same
 * path validation as validate.ts.
 */
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("path") ?? "";
  const showHidden = req.nextUrl.searchParams.get("showHidden") === "true";

  const v = validatePath(target);
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }

  try {
    const entries = await fs.readdir(v.resolved, {
      withFileTypes: true,
      encoding: "utf8",
    });

    const dirs: { name: string; hasChildren: boolean }[] = [];
    let truncated = false;

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!showHidden && e.name.startsWith(".")) continue;
      if (SKIP_NAMES.has(e.name)) continue;
      if (dirs.length >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      dirs.push({ name: e.name, hasChildren: false });
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ path: v.resolved, dirs, truncated });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (e.code === "EACCES") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }
    return NextResponse.json(
      { error: e.message ?? "filesystem error" },
      { status: 500 },
    );
  }
}

