"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { Agent, AgentTeam } from "@/types";
import {
  updateAgent as dbUpdateAgent,
  createTeam as dbCreateTeam,
  updateTeam as dbUpdateTeam,
} from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { agentReducer, initialAgentState } from "./reducer";
import type { AgentState, AgentAction } from "./types";

export interface AgentStoreValue {
  state: AgentState;
  dispatch: React.Dispatch<AgentAction>;
  getState: () => AgentState;
  updateAgent: (id: string, updates: Partial<Agent>) => Promise<void>;
  createTeam: (opts: {
    companyId: string;
    name: string;
    description?: string;
    agentIds: string[];
    tlAgentId?: string;
  }) => Promise<AgentTeam>;
  updateTeam: (id: string, updates: Partial<AgentTeam>) => Promise<void>;
}

const AgentContext = createContext<AgentStoreValue | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(agentReducer, initialAgentState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);

  const updateAgent = useCallback(async (id: string, updates: Partial<Agent>) => {
    await dbUpdateAgent(id, updates);
    dispatch({ type: "UPDATE_AGENT", id, updates });
  }, []);

  const createTeam = useCallback(
    async (opts: {
      companyId: string;
      name: string;
      description?: string;
      agentIds: string[];
      tlAgentId?: string;
    }) => {
      const team: AgentTeam = {
        id: uuidv4(),
        companyId: opts.companyId,
        name: opts.name,
        description: opts.description,
        agentIds: opts.agentIds,
        tlAgentId: opts.tlAgentId,
        createdAt: Date.now(),
      };
      await dbCreateTeam(team);
      dispatch({ type: "ADD_TEAM", team });
      return team;
    },
    [],
  );

  const updateTeam = useCallback(async (id: string, updates: Partial<AgentTeam>) => {
    await dbUpdateTeam(id, updates);
    dispatch({ type: "UPDATE_TEAM", id, updates });
  }, []);

  const value = useMemo<AgentStoreValue>(
    () => ({ state, dispatch, getState, updateAgent, createTeam, updateTeam }),
    [state, getState, updateAgent, createTeam, updateTeam],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgentStore(): AgentStoreValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgentStore must be used within AgentProvider");
  return ctx;
}
