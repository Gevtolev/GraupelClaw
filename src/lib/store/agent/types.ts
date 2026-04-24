import type { Agent, AgentTeam, AgentIdentity } from "@/types";

export interface AgentState {
  agents: Agent[];
  teams: AgentTeam[];
  agentIdentities: Record<string, AgentIdentity>;
}

export type AgentAction =
  | { type: "SET_AGENTS"; agents: Agent[] }
  | { type: "ADD_AGENT"; agent: Agent }
  | { type: "UPDATE_AGENT"; id: string; updates: Partial<Agent> }
  | { type: "REMOVE_AGENT"; id: string }
  | { type: "SET_TEAMS"; teams: AgentTeam[] }
  | { type: "ADD_TEAM"; team: AgentTeam }
  | { type: "UPDATE_TEAM"; id: string; updates: Partial<AgentTeam> }
  | { type: "REMOVE_TEAM"; id: string }
  | { type: "SET_AGENT_IDENTITY"; agentId: string; identity: AgentIdentity }
  | { type: "CLEAR_AGENTS_FOR_COMPANY"; companyId: string };
