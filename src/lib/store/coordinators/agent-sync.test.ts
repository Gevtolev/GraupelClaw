import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, Company } from "@/types";
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
  const fetchFn = vi.fn(async () => ({
    ok: opts.fetchOk ?? true,
    json: async () => opts.fetchResponse,
  })) as unknown as typeof fetch;
  return {
    getGatewayState: () => gatewayState,
    getAgentState: () => agentState,
    dispatchAgent,
    dbUpdateAgent,
    dbCreateAgent,
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
});
