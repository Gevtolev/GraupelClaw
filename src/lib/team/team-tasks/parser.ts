/**
 * Parse status-flip markers from an agent's reply.
 *
 * Contract:
 *   - First non-whitespace line of `[BLOCKED: TASK-007 reason]` flips
 *     TASK-007 to blocked with reason.
 *   - First line `[FAILED: TASK-007 reason]` flips to failed.
 *   - Anywhere else (mid-paragraph, inside thinking, etc.) is ignored.
 *   - Reply with no recognized prefix → no implicit flip.
 */
export interface ReplyDirective {
  kind: "blocked" | "failed";
  taskId: string;
  reason: string;
}

const RE = /^\[(BLOCKED|FAILED):\s*(TASK-\d+)\s+(.+?)\]\s*$/;

export function parseReplyDirective(content: string): ReplyDirective | null {
  if (!content) return null;
  // Trim leading whitespace; only inspect the first non-empty line.
  const firstLine = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  const m = RE.exec(firstLine);
  if (!m) return null;
  const [, kind, taskId, reason] = m;
  return {
    kind: kind === "BLOCKED" ? "blocked" : "failed",
    taskId,
    reason: reason.trim(),
  };
}

/**
 * Render the per-agent active tasks section that gets injected into the
 * agent's prompt. Returns null when there are no relevant tasks at all.
 */
export interface ActiveTasksRenderInput {
  myTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    blockedReason?: string;
  }>;
  /** Number of in_progress + pending + blocked tasks for OTHER agents. */
  otherActiveCount: number;
}

export function renderActiveTasks(
  input: ActiveTasksRenderInput,
): string | null {
  if (input.myTasks.length === 0 && input.otherActiveCount === 0) return null;
  const lines: string[] = ["## Active tasks"];
  if (input.myTasks.length > 0) {
    lines.push("### Your tasks");
    for (const t of input.myTasks) {
      const blockedSuffix = t.blockedReason
        ? ` — blocked: ${t.blockedReason}`
        : "";
      lines.push(
        `- ${t.id} [${t.status}] ${t.title} (${t.priority})${blockedSuffix}`,
      );
    }
  }
  if (input.otherActiveCount > 0) {
    if (input.myTasks.length > 0) lines.push("");
    lines.push(`### Other team activity`);
    lines.push(
      `${input.otherActiveCount} other task${input.otherActiveCount === 1 ? "" : "s"} active across the team.`,
    );
  }
  return lines.join("\n");
}
