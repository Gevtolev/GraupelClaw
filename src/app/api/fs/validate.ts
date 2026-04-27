import os from "node:os";
import path from "node:path";

export interface ValidatedPath {
  ok: true;
  resolved: string;
  home: string;
}
export interface ValidationError {
  ok: false;
  status: 400 | 403 | 500;
  message: string;
}

/**
 * Resolve a user-provided path and verify it stays inside the user's home
 * directory and outside any OpenClaw per-agent private workspace.
 *
 * Rules:
 *   - `os.homedir()` must have at least 2 path segments (rejects root user
 *     containers where homedir is `/`).
 *   - The resolved path must equal home OR start with `home + path.sep` —
 *     this prevents the prefix-attack `/home/userOTHER` matching `/home/user`.
 *   - Paths under `~/.openclaw/workspace-` are reserved for OpenClaw agents
 *     and must never be re-used as a team workspace (per CLAUDE.md OpenClaw
 *     boundary rules).
 *   - Leading `~/` is expanded to `os.homedir()`.
 *   - Empty / non-string inputs are rejected with 400.
 */
export function validatePath(input: unknown): ValidatedPath | ValidationError {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, status: 400, message: "path must be a non-empty string" };
  }

  const home = os.homedir();
  if (!home || home.split(path.sep).filter(Boolean).length < 2) {
    return {
      ok: false,
      status: 500,
      message: "cannot determine a safe home directory",
    };
  }

  // Expand a leading `~/` (or bare `~`) to the home directory.
  const expanded =
    input === "~" || input === "~/"
      ? home
      : input.startsWith("~/")
      ? path.join(home, input.slice(2))
      : input;

  const resolved = path.resolve(expanded);

  // Trailing-sep prefix check protects against `/home/userOTHER` matching
  // `/home/user`. Note: home itself is also acceptable (the user can pick
  // their home directory as the workspace root, even if we don't recommend it).
  const inHome = resolved === home || resolved.startsWith(home + path.sep);
  if (!inHome) {
    return {
      ok: false,
      status: 403,
      message: "path must be inside your home directory",
    };
  }

  // Reject anything in `~/.openclaw/workspace-{agentId}` — those are
  // OpenClaw-managed per-agent private workspaces.
  const openclawWorkspacePrefix = path.join(home, ".openclaw", "workspace-");
  if (
    resolved === openclawWorkspacePrefix ||
    resolved.startsWith(openclawWorkspacePrefix)
  ) {
    return {
      ok: false,
      status: 403,
      message:
        "this path is inside an agent's private OpenClaw workspace and cannot be used as a team workspace",
    };
  }

  return { ok: true, resolved, home };
}
