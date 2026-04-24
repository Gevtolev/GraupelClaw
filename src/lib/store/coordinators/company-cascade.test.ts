import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, AgentTeam, Company } from "@/types";
import { selectCompany, deleteCompany } from "./company-cascade";

function company(id: string, overrides: Partial<Company> = {}): Company {
  return {
    id, name: `co-${id}`, runtimeType: "openclaw",
    gatewayUrl: "http://gw", gatewayToken: "tk",
    createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

function makeDeps(activeId: string | null = null, cos: Company[] = []) {
  return {
    getGatewayState: () => ({
      companies: cos,
      activeCompanyId: activeId,
      connectionStatus: "connected" as const,
      initialized: true,
    }),
    dispatchGateway: vi.fn(),
    dispatchAgent: vi.fn(),
    dispatchSession: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    dbDeleteCompany: vi.fn(async () => {}),
    getAgentsByCompany: vi.fn(async (_id: string): Promise<Agent[]> => []),
    getTeamsByCompany: vi.fn(async (_id: string): Promise<AgentTeam[]> => []),
    syncAgents: vi.fn(async () => {}),
  };
}

describe("selectCompany coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disconnects, sets active, resets session, loads agents/teams, schedules connect + syncAgents", async () => {
    const co = company("c1");
    const deps = makeDeps("c0", [co]);
    deps.getAgentsByCompany = vi.fn(async () => [
      { id: "a1", companyId: "c1", name: "X", description: "", specialty: "general", createdAt: 0 } as Agent,
    ]);
    deps.getTeamsByCompany = vi.fn(async () => [
      { id: "t1", companyId: "c1", name: "T", agentIds: ["a1"], createdAt: 0 } as AgentTeam,
    ]);

    await selectCompany("c1", deps);

    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(deps.dispatchGateway).toHaveBeenCalledWith({ type: "SET_ACTIVE_COMPANY", id: "c1" });
    expect(deps.dispatchSession).toHaveBeenCalledWith({ type: "RESET_SESSION_ON_COMPANY_CHANGE" });
    expect(deps.dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({ type: "SET_AGENTS" }));
    expect(deps.dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({ type: "SET_TEAMS" }));
    expect(deps.syncAgents).toHaveBeenCalled();
  });
});

describe("deleteCompany coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disconnects only when deleting the active company", async () => {
    const deps = makeDeps("c1", [company("c1")]);
    await deleteCompany("c1", deps);
    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(deps.dbDeleteCompany).toHaveBeenCalledWith("c1");
    expect(deps.dispatchGateway).toHaveBeenCalledWith({ type: "REMOVE_COMPANY", id: "c1" });
    expect(deps.dispatchAgent).toHaveBeenCalledWith({
      type: "CLEAR_AGENTS_FOR_COMPANY",
      companyId: "c1",
    });
  });

  it("does NOT disconnect when deleting a non-active company", async () => {
    const deps = makeDeps("c1", [company("c1"), company("c2")]);
    await deleteCompany("c2", deps);
    expect(deps.disconnect).not.toHaveBeenCalled();
    expect(deps.dispatchAgent).toHaveBeenCalledWith({
      type: "CLEAR_AGENTS_FOR_COMPANY",
      companyId: "c2",
    });
  });

  it("resets session when deleting active company", async () => {
    const deps = makeDeps("c1", [company("c1")]);
    await deleteCompany("c1", deps);
    expect(deps.dispatchSession).toHaveBeenCalledWith({ type: "RESET_SESSION_ON_COMPANY_CHANGE" });
  });

  it("reloads agents/teams for the fallback active company after deleting the active one", async () => {
    // The coordinator computes the fallback from the pre-dispatch snapshot,
    // mirroring the reducer's REMOVE_COMPANY behaviour (first remaining company).
    const deps = makeDeps("c1", [company("c1"), company("c2")]);
    deps.getAgentsByCompany = vi.fn(async () => [
      { id: "a2", companyId: "c2", name: "Y", description: "", specialty: "general", createdAt: 0 } as Agent,
    ]);
    deps.getTeamsByCompany = vi.fn(async () => []);

    await deleteCompany("c1", deps);

    expect(deps.getAgentsByCompany).toHaveBeenCalledWith("c2");
    expect(deps.getTeamsByCompany).toHaveBeenCalledWith("c2");
    expect(deps.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_AGENTS" }),
    );
    expect(deps.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_TEAMS" }),
    );
  });

  it("does NOT reload agents when no companies remain after deletion", async () => {
    // Single-company deletion: no fallback possible.
    const deps = makeDeps("c1", [company("c1")]);

    await deleteCompany("c1", deps);

    expect(deps.getAgentsByCompany).not.toHaveBeenCalled();
    expect(deps.getTeamsByCompany).not.toHaveBeenCalled();
  });
});
