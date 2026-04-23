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

describe("assembleAgentPrompt", () => {
  it("injects TL role header when self.role is TL", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null,
      userText: "hi team",
      isDirectMention: false,
    });
    expect(out).toContain(`You are the TL (Team Leader) of "dev"`);
  });

  it("injects Member role header when self.role is Member", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "hi",
      isDirectMention: false,
    });
    expect(out).toContain(`You are a Member of "dev"`);
  });

  it("marks self in the roster with ← You", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "hi",
      isDirectMention: false,
    });
    expect(out).toContain("**Bob**");
    expect(out).toContain("← You");
  });

  it("includes the group_activity block when provided", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: "<group_activity>\nsome activity\n</group_activity>",
      userText: "",
      isDirectMention: false,
    });
    expect(out).toContain("<group_activity>\nsome activity\n</group_activity>");
  });

  it("omits group_activity block when null", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "hello",
      isDirectMention: false,
    });
    expect(out).not.toContain("<group_activity>");
  });

  it("appends 'You were mentioned' trailer when isDirectMention is false", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "",
      isDirectMention: false,
    });
    expect(out).toContain("You (Bob) were mentioned in the group conversation");
  });

  it("does NOT append the trailer when isDirectMention is true", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "@[Bob](a2) do X",
      isDirectMention: true,
    });
    expect(out).not.toContain("were mentioned in the group conversation");
    expect(out).toContain("@[Bob](a2) do X");
  });

  it("includes trigger syntax for every roster member in the team context", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null,
      userText: "hi",
      isDirectMention: false,
    });
    expect(out).toContain("`@[Alice](a1)`");
    expect(out).toContain("`@[Bob](a2)`");
  });
});
