import type { AgentState, AgentAction } from "./types";

export const initialAgentState: AgentState = {
  agents: [],
  teams: [],
  agentIdentities: {},
};

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "SET_AGENTS":
      return { ...state, agents: action.agents };
    case "ADD_AGENT":
      return { ...state, agents: [...state.agents, action.agent] };
    case "UPDATE_AGENT":
      return {
        ...state,
        agents: state.agents.map(a =>
          a.id === action.id ? { ...a, ...action.updates } : a,
        ),
      };
    case "REMOVE_AGENT":
      return { ...state, agents: state.agents.filter(a => a.id !== action.id) };
    case "SET_TEAMS":
      return { ...state, teams: action.teams };
    case "ADD_TEAM":
      return { ...state, teams: [...state.teams, action.team] };
    case "UPDATE_TEAM":
      return {
        ...state,
        teams: state.teams.map(t =>
          t.id === action.id ? { ...t, ...action.updates } : t,
        ),
      };
    case "REMOVE_TEAM":
      return { ...state, teams: state.teams.filter(t => t.id !== action.id) };
    case "SET_AGENT_IDENTITY":
      return {
        ...state,
        agentIdentities: {
          ...state.agentIdentities,
          [action.agentId]: action.identity,
        },
      };
    case "CLEAR_AGENTS_FOR_COMPANY":
      return {
        ...state,
        agents: state.agents.filter(a => a.companyId !== action.companyId),
        teams: state.teams.filter(t => t.companyId !== action.companyId),
      };
    default:
      return state;
  }
}
