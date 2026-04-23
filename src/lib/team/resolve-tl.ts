import type { AgentTeam } from "@/types";

export function resolveTlAgentId(team: AgentTeam): string {
  if (team.tlAgentId && team.agentIds.includes(team.tlAgentId)) {
    return team.tlAgentId;
  }
  return team.agentIds[0];
}
