import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, AgentTeam, Company } from "@/types";
import type { AgentAction, AgentState } from "@/lib/store/agent/types";
import type { GatewayState } from "@/lib/store/gateway/types";
import { syncAgents } from "./agent-sync";

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "c1",
    name: "co",
    runtimeType: "openclaw",
    gatewayUrl: "http://gw",
    gatewayToken: "tk",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id, companyId: "c1", name: `ag-${id}`,
    description: "", specialty: "general", createdAt: 0,
    ...overrides,
  };
}

function mockEnv(opts: {
  gateway: Partial<GatewayState>;
  agent: Partial<AgentState>;
  fetchResponse: unknown;
  fetchOk?: boolean;
}) {
  const gatewayState: GatewayState = {
    companies: [], activeCompanyId: null, connectionStatus: "disconnected", initialized: true,
    ...opts.gateway,
  };
  const agentState: AgentState = {
    agents: [], teams: [], agentIdentities: {},
    ...opts.agent,
  };
  const dispatchAgent = vi.fn<(a: AgentAction) => void>();
  const dbUpdateAgent = vi.fn(async () => {});
  const dbCreateAgent = vi.fn(async () => {});
  const dbDeleteAgent = vi.fn(async () => {});
  const dbUpdateTeam = vi.fn(async () => {});
  const fetchFn = vi.fn(async () => ({
    ok: opts.fetchOk ?? true,
    json: async () => opts.fetchResponse,
  })) as unknown as typeof fetch;
  // Live state read so the coordinator sees ADD/UPDATE/REMOVE dispatched during the
  // run when it re-reads via getAgentState() (mirrors Provider's stateRef behaviour).
  const stateRef = { current: agentState };
  dispatchAgent.mockImplementation((action: AgentAction) => {
    if (action.type === "REMOVE_AGENT") {
      stateRef.current = { ...stateRef.current, agents: stateRef.current.agents.filter(a => a.id !== action.id) };
    }
    if (action.type === "UPDATE_TEAM") {
      stateRef.current = {
        ...stateRef.current,
        teams: stateRef.current.teams.map(t => t.id === action.id ? { ...t, ...action.updates } : t),
      };
    }
  });
  return {
    getGatewayState: () => gatewayState,
    getAgentState: () => stateRef.current,
    dispatchAgent,
    dbUpdateAgent,
    dbCreateAgent,
    dbDeleteAgent,
    dbUpdateTeam,
    fetchFn,
  };
}

describe("syncAgents coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-op when no active company", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: null },
      agent: {},
      fetchResponse: { agents: [] },
    });
    await syncAgents(env);
    expect(env.fetchFn).not.toHaveBeenCalled();
    expect(env.dispatchAgent).not.toHaveBeenCalled();
  });

  it("no-op when company is not openclaw", async () => {
    const env = mockEnv({
      gateway: {
        companies: [company({ runtimeType: "custom" })],
        activeCompanyId: "c1",
      },
      agent: {},
      fetchResponse: { agents: [] },
    });
    await syncAgents(env);
    expect(env.fetchFn).not.toHaveBeenCalled();
  });

  it("creates new agents not present locally", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [] },
      fetchResponse: { agents: [{ id: "a1", name: "New", avatar: "a.png" }] },
    });
    await syncAgents(env);
    expect(env.dbCreateAgent).toHaveBeenCalledOnce();
    expect(env.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_AGENT",
        agent: expect.objectContaining({ id: "a1", name: "New" }),
      }),
    );
  });

  it("updates existing agent name when NOT customName", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [agent("a1", { name: "Old", customName: false })] },
      fetchResponse: { agents: [{ id: "a1", name: "New" }] },
    });
    await syncAgents(env);
    expect(env.dispatchAgent).toHaveBeenCalledWith({
      type: "UPDATE_AGENT",
      id: "a1",
      updates: { name: "New" },
    });
  });

  it("does NOT update name when customName=true (user rename protection)", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [agent("a1", { name: "MyCustom", customName: true })] },
      fetchResponse: { agents: [{ id: "a1", name: "New" }] },
    });
    await syncAgents(env);
    const nameUpdate = env.dispatchAgent.mock.calls.find(
      c => c[0].type === "UPDATE_AGENT" && "name" in (c[0] as { updates?: { name?: string } }).updates!,
    );
    expect(nameUpdate).toBeUndefined();
  });

  it("still updates avatar even when customName=true", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [agent("a1", { name: "MyCustom", customName: true, avatar: "old.png" })] },
      fetchResponse: { agents: [{ id: "a1", name: "ignored", avatar: "new.png" }] },
    });
    await syncAgents(env);
    expect(env.dispatchAgent).toHaveBeenCalledWith({
      type: "UPDATE_AGENT",
      id: "a1",
      updates: { avatar: "new.png" },
    });
  });

  it("swallows fetch failure silently (matches legacy behavior)", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: {},
      fetchResponse: null,
      fetchOk: false,
    });
    env.fetchFn = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    await expect(syncAgents(env)).resolves.toBeUndefined();
    expect(env.dispatchAgent).not.toHaveBeenCalled();
  });

  it("removes local orphan agents not present in the gateway response", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: {
        agents: [agent("a1"), agent("orphan-1"), agent("orphan-2")],
      },
      fetchResponse: { agents: [{ id: "a1", name: "A1" }] },
    });
    await syncAgents(env);
    expect(env.dbDeleteAgent).toHaveBeenCalledWith("orphan-1");
    expect(env.dbDeleteAgent).toHaveBeenCalledWith("orphan-2");
    expect(env.dispatchAgent).toHaveBeenCalledWith({ type: "REMOVE_AGENT", id: "orphan-1" });
    expect(env.dispatchAgent).toHaveBeenCalledWith({ type: "REMOVE_AGENT", id: "orphan-2" });
  });

  it("does NOT delete agents from other companies (orphan check is scoped)", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: {
        agents: [
          agent("a1"),
          agent("from-c2", { companyId: "c2" }),
        ],
      },
      fetchResponse: { agents: [{ id: "a1", name: "A1" }] },
    });
    await syncAgents(env);
    expect(env.dbDeleteAgent).not.toHaveBeenCalledWith("from-c2");
  });

  it("prunes team.agentIds of removed orphans and clears tlAgentId when TL is orphaned", async () => {
    const team: AgentTeam = {
      id: "t1", companyId: "c1", name: "Team",
      agentIds: ["a1", "orphan-1", "orphan-2"],
      tlAgentId: "orphan-1",
      createdAt: 0,
    };
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: {
        agents: [agent("a1"), agent("orphan-1"), agent("orphan-2")],
        teams: [team],
      },
      fetchResponse: { agents: [{ id: "a1", name: "A1" }] },
    });
    await syncAgents(env);
    expect(env.dbUpdateTeam).toHaveBeenCalledWith("t1", expect.objectContaining({
      agentIds: ["a1"],
      tlAgentId: null,
    }));
    expect(env.dispatchAgent).toHaveBeenCalledWith({
      type: "UPDATE_TEAM",
      id: "t1",
      updates: expect.objectContaining({ agentIds: ["a1"], tlAgentId: null }),
    });
  });

  it("leaves team.tlAgentId alone when TL is not among orphans", async () => {
    const team: AgentTeam = {
      id: "t1", companyId: "c1", name: "Team",
      agentIds: ["a1", "orphan-1"],
      tlAgentId: "a1",
      createdAt: 0,
    };
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: {
        agents: [agent("a1"), agent("orphan-1")],
        teams: [team],
      },
      fetchResponse: { agents: [{ id: "a1", name: "A1" }] },
    });
    await syncAgents(env);
    const teamUpdate = env.dbUpdateTeam.mock.calls.find(c => c[0] === "t1");
    expect(teamUpdate?.[1]).toEqual({ agentIds: ["a1"] });
  });

  it("does NOT prune teams that have no orphan ids", async () => {
    const team: AgentTeam = {
      id: "t1", companyId: "c1", name: "Team",
      agentIds: ["a1"], tlAgentId: "a1", createdAt: 0,
    };
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [agent("a1")], teams: [team] },
      fetchResponse: { agents: [{ id: "a1", name: "A1" }] },
    });
    await syncAgents(env);
    expect(env.dbUpdateTeam).not.toHaveBeenCalled();
  });
});
