import { describe, it, expect } from "vitest";
import type { AgentTeam } from "@/types";
import { resolveTlAgentId } from "./resolve-tl";

function makeTeam(overrides: Partial<AgentTeam>): AgentTeam {
  return {
    id: "t1",
    companyId: "c1",
    name: "dev",
    agentIds: ["a1", "a2", "a3"],
    createdAt: 0,
    ...overrides,
  };
}

describe("resolveTlAgentId", () => {
  it("returns tlAgentId when valid and present in agentIds", () => {
    expect(resolveTlAgentId(makeTeam({ tlAgentId: "a2" }))).toBe("a2");
  });

  it("falls back to agentIds[0] when tlAgentId is undefined", () => {
    expect(resolveTlAgentId(makeTeam({ tlAgentId: undefined }))).toBe("a1");
  });

  it("falls back to agentIds[0] when tlAgentId is not in agentIds", () => {
    expect(resolveTlAgentId(makeTeam({ tlAgentId: "xx" }))).toBe("a1");
  });

  it("returns undefined when agentIds is empty and no tlAgentId", () => {
    expect(resolveTlAgentId(makeTeam({ agentIds: [], tlAgentId: undefined }))).toBeUndefined();
  });
});
