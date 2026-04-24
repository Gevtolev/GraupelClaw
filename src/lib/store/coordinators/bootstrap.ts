import { v4 as uuidv4 } from "uuid";
import type {
  Agent, AgentSpecialty, AgentTeam, Company,
} from "@/types";
import type { GatewayAction } from "@/lib/store/gateway/types";
import type { AgentAction } from "@/lib/store/agent/types";

export interface InitializeAppOpts {
  dispatchGateway: (a: GatewayAction) => void;
  dispatchAgent: (a: AgentAction) => void;

  getAllCompanies: () => Promise<Company[]>;
  getAgentsByCompany: (companyId: string) => Promise<Agent[]>;
  getTeamsByCompany: (companyId: string) => Promise<AgentTeam[]>;

  dbCreateCompany: (c: Company) => Promise<unknown>;
  dbCreateAgent: (a: Agent) => Promise<unknown>;
  dbUpdateAgent: (id: string, updates: Partial<Agent>) => Promise<unknown>;

  fetchFn?: typeof fetch;
}

interface BootstrapPayload {
  found: boolean;
  gateway?: { url: string; token: string };
  agents?: { id: string; name: string; avatar?: string }[];
}

interface SyncPayload {
  agents?: { id: string; name?: string; avatar?: string }[];
}

export async function initializeApp(opts: InitializeAppOpts): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;

  try {
    const companies = await opts.getAllCompanies();

    if (companies.length === 0) {
      await bootstrapFromGateway(opts, fetchFn);
    } else {
      await loadExistingCompany(opts, companies);
    }
  } finally {
    opts.dispatchGateway({ type: "SET_INITIALIZED" });
  }
}

async function bootstrapFromGateway(
  opts: InitializeAppOpts,
  fetchFn: typeof fetch,
): Promise<void> {
  try {
    const res = await fetchFn("/api/bootstrap");
    const data = (await res.json()) as BootstrapPayload;
    if (!data.found || !data.gateway) return;

    const companyId = uuidv4();
    const company: Company = {
      id: companyId,
      name: "OpenClaw",
      description: "Auto-configured from OpenClaw Gateway",
      runtimeType: "openclaw",
      gatewayUrl: data.gateway.url,
      gatewayToken: data.gateway.token,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await opts.dbCreateCompany(company);
    opts.dispatchGateway({ type: "ADD_COMPANY", company });
    opts.dispatchGateway({ type: "SET_ACTIVE_COMPANY", id: companyId });

    let agentsToCreate = data.agents ?? [];
    try {
      const syncRes = await fetchFn("/api/agents/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gatewayUrl: data.gateway.url,
          gatewayToken: data.gateway.token,
        }),
      });
      const syncData = (await syncRes.json()) as SyncPayload;
      if (syncData.agents?.length) {
        agentsToCreate = syncData.agents.map(a => ({
          id: a.id, name: a.name ?? a.id, avatar: a.avatar,
        }));
      }
    } catch {
      // Fallback to config file agents
    }

    for (const agentConfig of agentsToCreate) {
      const agent: Agent = {
        id: agentConfig.id,
        companyId,
        name: agentConfig.name,
        avatar: agentConfig.avatar,
        description: `OpenClaw agent: ${agentConfig.name}`,
        specialty: "general" as AgentSpecialty,
        createdAt: Date.now(),
      };
      await opts.dbCreateAgent(agent);
      opts.dispatchAgent({ type: "ADD_AGENT", agent });
    }
  } catch {
    // Bootstrap failed silently; user can configure manually
  }
}

async function loadExistingCompany(
  opts: InitializeAppOpts,
  companies: Company[],
): Promise<void> {
  opts.dispatchGateway({ type: "SET_COMPANIES", companies });
  const firstId = companies[0].id;
  opts.dispatchGateway({ type: "SET_ACTIVE_COMPANY", id: firstId });

  const [agents, teams] = await Promise.all([
    opts.getAgentsByCompany(firstId),
    opts.getTeamsByCompany(firstId),
  ]);
  opts.dispatchAgent({ type: "SET_AGENTS", agents });
  opts.dispatchAgent({ type: "SET_TEAMS", teams });

  // Background agent sync (ignored on failure)
  const company = companies[0];
  if (
    company?.runtimeType === "openclaw" &&
    company?.gatewayUrl &&
    company?.gatewayToken
  ) {
    const fetchFn = opts.fetchFn ?? fetch;
    fetchFn("/api/agents/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gatewayUrl: company.gatewayUrl,
        gatewayToken: company.gatewayToken,
      }),
    })
      .then(r => r.json())
      .then(async (data: SyncPayload) => {
        if (!data.agents?.length) return;
        const existingMap = new Map(agents.map(a => [a.id, a]));
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
              companyId: firstId,
              name: agentData.name ?? agentData.id,
              avatar: agentData.avatar,
              description: "",
              specialty: "general" as AgentSpecialty,
              createdAt: Date.now(),
            };
            try {
              await opts.dbCreateAgent(agent);
              opts.dispatchAgent({ type: "ADD_AGENT", agent });
            } catch { /* skip duplicate */ }
          }
        }
      })
      .catch(() => { /* sync failed silently */ });
  }
}
