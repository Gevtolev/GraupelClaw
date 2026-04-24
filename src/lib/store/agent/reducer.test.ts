import { describe, it, expect } from "vitest";
import type { Agent, AgentTeam } from "@/types";
import { agentReducer, initialAgentState } from "./reducer";

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id, companyId: "c1", name: `ag-${id}`,
    description: "", specialty: "general", createdAt: 0,
    ...overrides,
  };
}
function team(id: string, overrides: Partial<AgentTeam> = {}): AgentTeam {
  return {
    id, companyId: "c1", name: `team-${id}`,
    agentIds: [], createdAt: 0,
    ...overrides,
  };
}

describe("agentReducer", () => {
  it("initialAgentState is empty", () => {
    expect(initialAgentState).toEqual({ agents: [], teams: [], agentIdentities: {} });
  });

  it("SET_AGENTS replaces", () => {
    const s = agentReducer(initialAgentState, {
      type: "SET_AGENTS", agents: [agent("a"), agent("b")],
    });
    expect(s.agents.map(a => a.id)).toEqual(["a", "b"]);
  });

  it("UPDATE_AGENT merges fields for matching id", () => {
    const s1 = agentReducer(initialAgentState, {
      type: "SET_AGENTS", agents: [agent("a"), agent("b")],
    });
    const s2 = agentReducer(s1, {
      type: "UPDATE_AGENT", id: "a", updates: { name: "renamed", customName: true },
    });
    expect(s2.agents.find(a => a.id === "a")?.name).toBe("renamed");
    expect(s2.agents.find(a => a.id === "a")?.customName).toBe(true);
    expect(s2.agents.find(a => a.id === "b")?.name).toBe("ag-b");
  });

  it("REMOVE_AGENT filters", () => {
    const s1 = agentReducer(initialAgentState, {
      type: "SET_AGENTS", agents: [agent("a"), agent("b")],
    });
    const s2 = agentReducer(s1, { type: "REMOVE_AGENT", id: "a" });
    expect(s2.agents.map(a => a.id)).toEqual(["b"]);
  });

  it("SET_TEAMS / ADD_TEAM / UPDATE_TEAM / REMOVE_TEAM", () => {
    const s1 = agentReducer(initialAgentState, { type: "SET_TEAMS", teams: [team("t1")] });
    const s2 = agentReducer(s1, { type: "ADD_TEAM", team: team("t2") });
    const s3 = agentReducer(s2, { type: "UPDATE_TEAM", id: "t1", updates: { name: "x" } });
    const s4 = agentReducer(s3, { type: "REMOVE_TEAM", id: "t2" });
    expect(s4.teams.map(t => t.id)).toEqual(["t1"]);
    expect(s4.teams[0].name).toBe("x");
  });

  it("SET_AGENT_IDENTITY stores by agentId", () => {
    const s = agentReducer(initialAgentState, {
      type: "SET_AGENT_IDENTITY",
      agentId: "a1",
      identity: { name: "Alice", avatar: "a.png" },
    });
    expect(s.agentIdentities["a1"]).toEqual({ name: "Alice", avatar: "a.png" });
  });

  it("CLEAR_AGENTS_FOR_COMPANY removes both agents and teams tied to that company", () => {
    const s1 = agentReducer(initialAgentState, {
      type: "SET_AGENTS",
      agents: [agent("a", { companyId: "c1" }), agent("b", { companyId: "c2" })],
    });
    const s2 = agentReducer(s1, {
      type: "SET_TEAMS",
      teams: [team("t1", { companyId: "c1" }), team("t2", { companyId: "c2" })],
    });
    const s3 = agentReducer(s2, { type: "CLEAR_AGENTS_FOR_COMPANY", companyId: "c1" });
    expect(s3.agents.map(a => a.id)).toEqual(["b"]);
    expect(s3.teams.map(t => t.id)).toEqual(["t2"]);
  });
});
