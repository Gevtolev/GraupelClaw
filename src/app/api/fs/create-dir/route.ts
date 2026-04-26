import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";

import { validatePath } from "../validate";

/**
 * POST /api/fs/create-dir  body: { path }
 *
 * Recursive mkdir, idempotent on existing dirs. Honors the same path
 * validation as validate.ts.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const target = (body as { path?: unknown })?.path;

  const v = validatePath(target);
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: v.status });
  }

  try {
    await fs.mkdir(v.resolved, { recursive: true });
    return NextResponse.json({ created: true, path: v.resolved });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EACCES") {
      return NextResponse.json({ error: "access denied" }, { status: 403 });
    }
    if (e.code === "ENOTDIR") {
      return NextResponse.json(
        { error: "a non-directory file already exists at this path" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: e.message ?? "filesystem error" },
      { status: 500 },
    );
  }
}
