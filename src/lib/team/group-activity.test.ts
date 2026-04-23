import { describe, it, expect } from "vitest";
import type { Message } from "@/types";
import { buildGroupActivity } from "./group-activity";

function msg(partial: Partial<Message> & Pick<Message, "id" | "createdAt" | "role" | "content">): Message {
  return {
    conversationId: "c1",
    targetType: "team",
    targetId: "t1",
    ...partial,
  } as Message;
}

const nameMap = new Map([
  ["a1", "Alice"],
  ["a2", "Bob"],
]);

describe("buildGroupActivity", () => {
  it("returns null when slice is empty", () => {
    expect(buildGroupActivity([], null, 100, nameMap)).toBeNull();
  });

  it("returns null when no messages fall in the (fromTs, toTs] window", () => {
    const msgs = [msg({ id: "1", createdAt: 50, role: "user", content: "hi" })];
    expect(buildGroupActivity(msgs, 100, 200, nameMap)).toBeNull();
  });

  it("uses the 'Recent group chat messages' header when fromTs is null", () => {
    const msgs = [msg({ id: "1", createdAt: 10, role: "user", content: "hi" })];
    const out = buildGroupActivity(msgs, null, 100, nameMap);
    expect(out).toContain("Recent group chat messages:");
    expect(out).toContain("[User (human)]: hi");
  });

  it("uses the 'Other team members said since your last response' header when fromTs is set", () => {
    const msgs = [msg({ id: "1", createdAt: 150, role: "user", content: "follow up" })];
    const out = buildGroupActivity(msgs, 100, 200, nameMap);
    expect(out).toContain("Other team members said since your last response:");
  });

  it("labels user messages and agent messages separately", () => {
    const msgs = [
      msg({ id: "1", createdAt: 10, role: "user", content: "plan it" }),
      msg({ id: "2", createdAt: 20, role: "assistant", agentId: "a1", content: "on it" }),
    ];
    const out = buildGroupActivity(msgs, null, 100, nameMap) ?? "";
    expect(out).toContain("[User (human)]: plan it");
    expect(out).toContain("[Alice (AI agent)]: on it");
  });

  it("falls back to agentId when the name map doesn't have the id", () => {
    const msgs = [
      msg({ id: "1", createdAt: 10, role: "assistant", agentId: "unknown", content: "hello" }),
    ];
    const out = buildGroupActivity(msgs, null, 100, nameMap) ?? "";
    expect(out).toContain("[unknown (AI agent)]: hello");
  });

  it("wraps output in <group_activity> tags", () => {
    const msgs = [msg({ id: "1", createdAt: 10, role: "user", content: "hi" })];
    const out = buildGroupActivity(msgs, null, 100, nameMap) ?? "";
    expect(out.startsWith("<group_activity>\n")).toBe(true);
    expect(out.endsWith("\n</group_activity>")).toBe(true);
  });

  it("filters strictly by fromTs < createdAt <= toTs", () => {
    const msgs = [
      msg({ id: "1", createdAt: 100, role: "user", content: "at-from" }),
      msg({ id: "2", createdAt: 150, role: "user", content: "middle" }),
      msg({ id: "3", createdAt: 200, role: "user", content: "at-to" }),
      msg({ id: "4", createdAt: 250, role: "user", content: "after" }),
    ];
    const out = buildGroupActivity(msgs, 100, 200, nameMap) ?? "";
    expect(out).not.toContain("at-from");
    expect(out).toContain("middle");
    expect(out).toContain("at-to");
    expect(out).not.toContain("after");
  });
});
