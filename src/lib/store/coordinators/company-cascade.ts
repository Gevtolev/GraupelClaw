import type { Agent, AgentTeam } from "@/types";
import type { GatewayState, GatewayAction } from "@/lib/store/gateway/types";
import type { AgentAction } from "@/lib/store/agent/types";
import type { SessionAction } from "@/lib/store/session/types";

export interface CompanyCascadeDeps {
  getGatewayState: () => GatewayState;
  dispatchGateway: (a: GatewayAction) => void;
  dispatchAgent: (a: AgentAction) => void;
  dispatchSession: (a: SessionAction) => void;
  disconnect: () => void;
  connect: () => void;
  dbDeleteCompany: (id: string) => Promise<unknown>;
  getAgentsByCompany: (id: string) => Promise<Agent[]>;
  getTeamsByCompany: (id: string) => Promise<AgentTeam[]>;
  syncAgents: () => Promise<void>;
}

export async function selectCompany(
  id: string,
  deps: CompanyCascadeDeps,
): Promise<void> {
  deps.disconnect();
  deps.dispatchGateway({ type: "SET_ACTIVE_COMPANY", id });
  deps.dispatchSession({ type: "RESET_SESSION_ON_COMPANY_CHANGE" });

  const [agents, teams] = await Promise.all([
    deps.getAgentsByCompany(id),
    deps.getTeamsByCompany(id),
  ]);
  deps.dispatchAgent({ type: "SET_AGENTS", agents });
  deps.dispatchAgent({ type: "SET_TEAMS", teams });

  // Gateway auto-connect effect (§5.3 铁律) will pick up the new activeCompanyId.
  // Explicit sync for agents.
  await deps.syncAgents();
}

export async function deleteCompany(
  id: string,
  deps: CompanyCascadeDeps,
): Promise<void> {
  const current = deps.getGatewayState();
  const wasActive = current.activeCompanyId === id;

  if (wasActive) {
    deps.disconnect();
  }

  await deps.dbDeleteCompany(id);
  deps.dispatchGateway({ type: "REMOVE_COMPANY", id });
  deps.dispatchAgent({ type: "CLEAR_AGENTS_FOR_COMPANY", companyId: id });

  if (wasActive) {
    deps.dispatchSession({ type: "RESET_SESSION_ON_COMPANY_CHANGE" });
  }
}
