import type { Agent, AgentSpecialty } from "@/types";
import type { GatewayState } from "@/lib/store/gateway/types";
import type { AgentState, AgentAction } from "@/lib/store/agent/types";

export interface SyncAgentsOpts {
  getGatewayState: () => GatewayState;
  getAgentState: () => AgentState;
  dispatchAgent: (action: AgentAction) => void;
  dbUpdateAgent: (id: string, updates: Partial<Agent>) => Promise<unknown>;
  dbCreateAgent: (agent: Agent) => Promise<unknown>;
  fetchFn?: typeof fetch;
}

interface GatewayAgentPayload {
  id: string;
  name?: string;
  avatar?: string;
}

export async function syncAgents(opts: SyncAgentsOpts): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  const gateway = opts.getGatewayState();
  const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);
  if (!company?.gatewayUrl || !company?.gatewayToken) return;
  if (company.runtimeType !== "openclaw") return;

  try {
    const res = await fetchFn("/api/agents/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gatewayUrl: company.gatewayUrl,
        gatewayToken: company.gatewayToken,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { agents?: GatewayAgentPayload[] };
    if (!data.agents) return;

    const agentState = opts.getAgentState();
    const existingAgents = agentState.agents.filter(a => a.companyId === company.id);
    const existingMap = new Map(existingAgents.map(a => [a.id, a]));

    for (const agentData of data.agents) {
      const existing = existingMap.get(agentData.id);
      if (existing) {
        const updates: Partial<Agent> = {};
        if (!existing.customName && agentData.name && agentData.name !== existing.name) {
          updates.name = agentData.name;
        }
        if (agentData.avatar !== undefined && agentData.avatar !== existing.avatar) {
          updates.avatar = agentData.avatar;
        }
        if (Object.keys(updates).length > 0) {
          await opts.dbUpdateAgent(existing.id, updates);
          opts.dispatchAgent({ type: "UPDATE_AGENT", id: existing.id, updates });
        }
      } else {
        const agent: Agent = {
          id: agentData.id,
          companyId: company.id,
          name: agentData.name ?? agentData.id,
          avatar: agentData.avatar,
          description: agentData.name ? `OpenClaw agent: ${agentData.name}` : "",
          specialty: "general" as AgentSpecialty,
          createdAt: Date.now(),
        };
        try {
          await opts.dbCreateAgent(agent);
          opts.dispatchAgent({ type: "ADD_AGENT", agent });
        } catch {
          // Agent may already exist in another company — skip silently (matches legacy)
        }
      }
    }
  } catch {
    // Sync failed silently (matches legacy)
  }
}
