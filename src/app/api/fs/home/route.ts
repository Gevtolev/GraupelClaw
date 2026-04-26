import { NextResponse } from "next/server";
import os from "node:os";
import path from "node:path";

/**
 * Returns the user's home directory. Used by the folder-picker to choose its
 * starting point. We refuse to answer when home is unsafe (`/` or single
 * path segment), the same guard validate.ts uses.
 */
export function GET() {
  const home = os.homedir();
  if (!home || home.split(path.sep).filter(Boolean).length < 2) {
    return NextResponse.json(
      { error: "cannot determine a safe home directory" },
      { status: 500 },
    );
  }
  return NextResponse.json({ home });
}
