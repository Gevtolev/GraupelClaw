import { describe, it, expect } from "vitest";
import type { AgentTeam } from "@/types";
import { assembleAgentPrompt } from "./prompt-assembler";
import type { RosterEntry } from "./types";

const team: AgentTeam = {
  id: "t1",
  companyId: "c1",
  name: "dev",
  agentIds: ["a1", "a2"],
  tlAgentId: "a1",
  createdAt: 0,
};

const roster: RosterEntry[] = [
  { agentId: "a1", name: "Alice", description: "team lead", role: "TL" },
  { agentId: "a2", name: "Bob", description: "coder", role: "Member" },
];

describe("assembleAgentPrompt — system channel (stable team context)", () => {
  it("injects TL role header into systemPrompt when self.role is TL", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi team", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain(`You are the TL (Team Leader) of "dev"`);
    expect(out.userPrompt).not.toContain(`You are the TL`);
  });

  it("injects Member role header into systemPrompt when self.role is Member", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain(`You are a Member of "dev"`);
  });

  it("marks self in the roster with ← You inside systemPrompt", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain("**Bob**");
    expect(out.systemPrompt).toContain("← You");
  });

  it("includes trigger syntax for every roster member in systemPrompt", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain("`@[Alice](a1)`");
    expect(out.systemPrompt).toContain("`@[Bob](a2)`");
    expect(out.userPrompt).not.toContain("`@[Alice](a1)`");
  });

  it("includes the four global protocol XML blocks in systemPrompt only", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    for (const tag of [
      "<delivering_results>",
      "<proactiveness>",
      "<task_management>",
      "<circuit_breaker>",
    ]) {
      expect(out.systemPrompt).toContain(tag);
      expect(out.userPrompt).not.toContain(tag);
    }
  });

  it("includes Identity protection guidance in systemPrompt", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain("Identity protection");
  });

  it("omits the recent_decisions block when not provided", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).not.toContain("<recent_decisions>");
    expect(out.systemPrompt).not.toContain("Recent team decisions");
    expect(out.userPrompt).not.toContain("<recent_decisions>");
  });

  it("omits the recent_decisions block when value is empty/whitespace", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
      recentDecisions: "   \n  ",
    });
    expect(out.systemPrompt).not.toContain("<recent_decisions>");
  });

  it("injects raw decisions content into systemPrompt verbatim when under cap", () => {
    const decisions = `# Team Decisions\n\n---\n\n## [2026-04-26] Use SSE\n\n**Decided by**: Alice\n**Rationale**: lower latency\n\n---\n`;
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
      recentDecisions: decisions,
    });
    expect(out.systemPrompt).toContain("<recent_decisions>");
    expect(out.systemPrompt).toContain("[2026-04-26] Use SSE");
    expect(out.systemPrompt).toContain("**Decided by**: Alice");
    expect(out.systemPrompt).toContain("Do not relitigate these");
    expect(out.systemPrompt).not.toContain("(log truncated");
    expect(out.userPrompt).not.toContain("<recent_decisions>");
  });

  it("truncates the decisions block when it exceeds the size cap", () => {
    const long =
      `# Team Decisions\n\n---\n\n` +
      Array.from({ length: 30 }, (_, i) =>
        `## [2026-04-${String(i + 1).padStart(2, "0")}] Decision ${i}\n\n**Decided by**: Alice\n**Rationale**: lorem ipsum dolor sit amet consectetur adipiscing elit ${i}\n\n---\n`
      ).join("\n");
    expect(long.length).toBeGreaterThan(600);
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
      recentDecisions: long,
    });
    expect(out.systemPrompt).toContain("<recent_decisions>");
    expect(out.systemPrompt).toContain("(log truncated");
    const start = out.systemPrompt.indexOf("<recent_decisions>");
    const end = out.systemPrompt.indexOf("</recent_decisions>");
    expect(end - start).toBeLessThan(900);
  });
});

describe("assembleAgentPrompt — user channel (per-turn dynamic)", () => {
  it("includes the group_activity block in userPrompt when provided", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: "<group_activity>\nsome activity\n</group_activity>",
      userText: "", isDirectMention: false,
    });
    expect(out.userPrompt).toContain("<group_activity>\nsome activity\n</group_activity>");
    expect(out.systemPrompt).not.toContain("<group_activity>");
  });

  it("omits the group_activity block when null", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "hello", isDirectMention: false,
    });
    expect(out.userPrompt).not.toContain("<group_activity>");
  });

  it("includes the active_tasks block in userPrompt when provided", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "", isDirectMention: false,
      activeTasks: "<active_tasks>\n- T1 in_progress\n</active_tasks>",
    });
    expect(out.userPrompt).toContain("<active_tasks>");
    expect(out.systemPrompt).not.toContain("<active_tasks>");
  });

  it("appends 'You were mentioned' trailer in userPrompt when isDirectMention is false", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "", isDirectMention: false,
    });
    expect(out.userPrompt).toContain("You (Bob) were mentioned in the group conversation");
    expect(out.systemPrompt).not.toContain("were mentioned in the group conversation");
  });

  it("does NOT append the trailer when isDirectMention is true", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "@[Bob](a2) do X", isDirectMention: true,
    });
    expect(out.userPrompt).not.toContain("were mentioned in the group conversation");
    expect(out.userPrompt).toContain("@[Bob](a2) do X");
  });

  it("returns systemPrompt as a non-empty string even with minimal inputs", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "", isDirectMention: true,
    });
    expect(out.systemPrompt.length).toBeGreaterThan(0);
    expect(out.systemPrompt).toContain("dev");
  });
});
