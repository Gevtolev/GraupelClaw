import { describe, it, expect } from "vitest";
import { parseReplyDirective, renderActiveTasks } from "../parser";

describe("parseReplyDirective", () => {
  it("parses [BLOCKED: TASK-007 reason] on first line", () => {
    expect(parseReplyDirective("[BLOCKED: TASK-007 waiting on data]")).toEqual({
      kind: "blocked",
      taskId: "TASK-007",
      reason: "waiting on data",
    });
  });

  it("parses [FAILED: TASK-007 reason]", () => {
    expect(parseReplyDirective("[FAILED: TASK-001 connection refused]")).toEqual({
      kind: "failed",
      taskId: "TASK-001",
      reason: "connection refused",
    });
  });

  it("ignores [BLOCKED: ...] mid-paragraph", () => {
    expect(
      parseReplyDirective("Sometimes a task is [BLOCKED: TASK-001 foo] but we worked it out"),
    ).toBeNull();
  });

  it("ignores reply without any directive prefix", () => {
    expect(parseReplyDirective("Just a normal reply")).toBeNull();
  });

  it("ignores empty / null content", () => {
    expect(parseReplyDirective("")).toBeNull();
  });

  it("requires a TASK-NNN id (no implicit attribution)", () => {
    expect(parseReplyDirective("[BLOCKED: just a reason]")).toBeNull();
  });

  it("trims surrounding whitespace from the reason", () => {
    expect(parseReplyDirective("[BLOCKED: TASK-002    spaces  ]")).toEqual({
      kind: "blocked",
      taskId: "TASK-002",
      reason: "spaces",
    });
  });

  it("looks at the first non-empty line, not literally the first byte", () => {
    expect(parseReplyDirective("\n\n   [BLOCKED: TASK-005 reason]\nrest")).toEqual({
      kind: "blocked",
      taskId: "TASK-005",
      reason: "reason",
    });
  });
});

describe("renderActiveTasks", () => {
  it("returns null when no tasks at all", () => {
    expect(renderActiveTasks({ myTasks: [], otherActiveCount: 0 })).toBeNull();
  });

  it("renders only 'Other team activity' when agent has no tasks", () => {
    const out = renderActiveTasks({ myTasks: [], otherActiveCount: 3 });
    expect(out).toMatch(/Other team activity/);
    expect(out).toMatch(/3 other tasks/);
    expect(out).not.toMatch(/Your tasks/);
  });

  it("renders my tasks list", () => {
    const out = renderActiveTasks({
      myTasks: [
        { id: "TASK-001", title: "Research", status: "in_progress", priority: "P0" },
      ],
      otherActiveCount: 0,
    });
    expect(out).toMatch(/Your tasks/);
    expect(out).toMatch(/TASK-001 \[in_progress\] Research \(P0\)/);
  });

  it("appends blocked reason suffix", () => {
    const out = renderActiveTasks({
      myTasks: [
        {
          id: "TASK-002",
          title: "Deploy",
          status: "blocked",
          priority: "P1",
          blockedReason: "CI pipeline broken",
        },
      ],
      otherActiveCount: 0,
    });
    expect(out).toMatch(/blocked: CI pipeline broken/);
  });

  it("uses singular 'task' when otherActiveCount is 1", () => {
    const out = renderActiveTasks({ myTasks: [], otherActiveCount: 1 });
    expect(out).toMatch(/1 other task active/);
  });
});
