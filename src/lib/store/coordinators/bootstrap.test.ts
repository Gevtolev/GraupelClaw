import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, Company, AgentTeam } from "@/types";
import type { GatewayAction } from "@/lib/store/gateway/types";
import type { AgentAction } from "@/lib/store/agent/types";
import { initializeApp } from "./bootstrap";

function makeDeps(overrides: {
  existingCompanies?: Company[];
  existingAgents?: Agent[];
  existingTeams?: AgentTeam[];
  bootstrapResponse?: unknown;
  agentsSyncResponse?: unknown;
} = {}) {
  const dispatchGateway = vi.fn<(a: GatewayAction) => void>();
  const dispatchAgent = vi.fn<(a: AgentAction) => void>();

  const getAllCompanies = vi.fn(async () => overrides.existingCompanies ?? []);
  const getAgentsByCompany = vi.fn(async () => overrides.existingAgents ?? []);
  const getTeamsByCompany = vi.fn(async () => overrides.existingTeams ?? []);
  const dbCreateCompany = vi.fn(async () => {});
  const dbCreateAgent = vi.fn(async () => {});
  const dbUpdateAgent = vi.fn(async () => {});

  const fetchFn = vi.fn(async (url: string) => {
    if (url.endsWith("/api/bootstrap")) {
      return {
        ok: true,
        json: async () => overrides.bootstrapResponse ?? { found: false },
      };
    }
    if (url.endsWith("/api/agents/sync")) {
      return {
        ok: true,
        json: async () => overrides.agentsSyncResponse ?? { agents: [] },
      };
    }
    return { ok: false, json: async () => ({}) };
  }) as unknown as typeof fetch;

  return {
    dispatchGateway, dispatchAgent,
    getAllCompanies, getAgentsByCompany, getTeamsByCompany,
    dbCreateCompany, dbCreateAgent, dbUpdateAgent,
    fetchFn,
  };
}

describe("initializeApp coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no existing companies + bootstrap miss → only SET_INITIALIZED", async () => {
    const deps = makeDeps({ bootstrapResponse: { found: false } });
    await initializeApp(deps);
    expect(deps.dispatchGateway).toHaveBeenCalledWith({ type: "SET_INITIALIZED" });
    expect(deps.dispatchGateway).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_COMPANY" }),
    );
  });

  it("no existing companies + bootstrap hit creates company + agents", async () => {
    const deps = makeDeps({
      bootstrapResponse: {
        found: true,
        gateway: { url: "http://gw", token: "tk" },
        agents: [{ id: "a1", name: "A1" }],
      },
      agentsSyncResponse: { agents: [{ id: "a1", name: "A1" }] },
    });
    await initializeApp(deps);
    expect(deps.dispatchGateway).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_COMPANY" }),
    );
    expect(deps.dispatchGateway).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_ACTIVE_COMPANY" }),
    );
    expect(deps.dbCreateAgent).toHaveBeenCalled();
    expect(deps.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_AGENT" }),
    );
    expect(deps.dispatchGateway).toHaveBeenLastCalledWith({ type: "SET_INITIALIZED" });
  });

  it("existing companies → loads first + activates + fetches agents/teams", async () => {
    const co: Company = {
      id: "c1", name: "Existing", runtimeType: "openclaw",
      gatewayUrl: "http://gw", gatewayToken: "tk",
      createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      existingCompanies: [co],
      existingAgents: [{
        id: "a1", companyId: "c1", name: "X",
        description: "", specialty: "general", createdAt: 0,
      }],
      existingTeams: [{
        id: "t1", companyId: "c1", name: "Team", agentIds: ["a1"], createdAt: 0,
      }],
    });
    await initializeApp(deps);
    expect(deps.dispatchGateway).toHaveBeenCalledWith({
      type: "SET_COMPANIES", companies: [co],
    });
    expect(deps.dispatchGateway).toHaveBeenCalledWith({
      type: "SET_ACTIVE_COMPANY", id: "c1",
    });
    expect(deps.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_AGENTS" }),
    );
    expect(deps.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_TEAMS" }),
    );
    expect(deps.dispatchGateway).toHaveBeenLastCalledWith({ type: "SET_INITIALIZED" });
  });

  it("swallows bootstrap fetch failure silently", async () => {
    const deps = makeDeps();
    deps.fetchFn = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    await expect(initializeApp(deps)).resolves.toBeUndefined();
    expect(deps.dispatchGateway).toHaveBeenCalledWith({ type: "SET_INITIALIZED" });
  });
});
