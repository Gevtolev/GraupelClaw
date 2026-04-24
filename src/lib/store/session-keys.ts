import { projectBrand } from "@/lib/project-brand";

export function dmSessionKey(agentId: string, conversationId: string): string {
  if (conversationId.startsWith(`agent:${agentId}:`)) {
    return conversationId;
  }
  return `agent:${agentId}:${projectBrand.sessionNamespace}:${conversationId}`;
}

export function teamSessionKey(
  agentId: string,
  teamId: string,
  conversationId: string,
): string {
  return `agent:${agentId}:${projectBrand.sessionNamespace}:team:${teamId}:${conversationId}`;
}
