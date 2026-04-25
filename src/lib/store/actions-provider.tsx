"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import type {
  Agent, AgentSpecialty, ChatTarget, MessageAttachment,
} from "@/types";
import {
  createCompany as dbCreateCompany,
  deleteCompany as dbDeleteCompany,
  createAgent as dbCreateAgent,
  updateAgent as dbUpdateAgent,
  deleteAgent as dbDeleteAgent,
  updateTeam as dbUpdateTeam,
  deleteTeam as dbDeleteTeam,
  getAgentsByCompany,
  getTeamsByCompany,
  getConversationsByTarget,
  getMessagesByConversation,
  getAllCompanies,
  addMessage as dbAddMessage,
  updateConversation as dbUpdateConversation,
  deleteConversation as dbDeleteConversation,
} from "@/lib/db";
import {
  parseNativeSessionConversations,
  parseNativeSessionMessages,
} from "@/lib/openclaw-sessions";
import { gatewayRpc } from "@/lib/runtime";
import { dispatchTeamMessage } from "@/lib/team";
import { v4 as uuidv4 } from "uuid";

import { useGatewayStore } from "./gateway/store";
import { useAgentStore } from "./agent/store";
import { useSessionStore } from "./session/store";
import { useChatStore } from "./chat/store";

import { initializeApp } from "./coordinators/bootstrap";
import { syncAgents } from "./coordinators/agent-sync";
import { selectCompany, deleteCompany } from "./coordinators/company-cascade";
import {
  fetchNativeAgentSessions,
  selectChatTarget,
  selectConversation,
  deleteConversation,
} from "./coordinators/native-sessions";
import type { ParseSessionsFn, ParseMessagesFn } from "./coordinators/native-sessions";
import { handleGatewayChatEvent } from "./coordinators/gateway-events";
import { sendMessage, abortStreaming } from "./coordinators/send-message";

export interface StoreActions {
  selectCompany: (id: string) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;

  createAgent: (opts: {
    companyId: string;
    name: string;
    description: string;
    specialty: AgentSpecialty;
  }) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;
  syncAgents: () => Promise<void>;

  selectChatTarget: (target: ChatTarget) => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  sendMessage: (content: string, attachments?: MessageAttachment[]) => Promise<void>;
  abortStreaming: (agentId: string) => Promise<void>;
}

const ActionsContext = createContext<StoreActions | null>(null);

export function ActionsProvider({ children }: { children: React.ReactNode }) {
  const gateway = useGatewayStore();
  const agent = useAgentStore();
  const session = useSessionStore();
  const chat = useChatStore();

  // Wire chat event handler into gateway runtime — unique cross-slice subscription
  // that must live here (§5.3).
  useEffect(() => {
    gateway.registerChatEventHandler(payload => {
      handleGatewayChatEvent(payload, {
        getChatState: chat.getState,
        getSessionState: session.getState,
        dispatchChat: chat.dispatch,
        dispatchSession: session.dispatch,
        dbAddMessage,
        pendingResolvers: chat.pendingStreamResolvers.current,
        pendingFinalContent: chat.pendingFinalContent.current,
        idFactory: () => uuidv4(),
      });
    });
    return () => gateway.registerChatEventHandler(null);
  }, [gateway, chat, session]);

  // Bootstrap once on mount
  useEffect(() => {
    void initializeApp({
      dispatchGateway: gateway.dispatch,
      dispatchAgent: agent.dispatch,
      getAllCompanies,
      getAgentsByCompany,
      getTeamsByCompany,
      dbCreateCompany,
      dbCreateAgent,
      dbUpdateAgent,
    });
    // Intentionally empty deps: run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncAgentsAction = useCallback(async () => {
    await syncAgents({
      getGatewayState: gateway.getState,
      getAgentState: agent.getState,
      dispatchAgent: agent.dispatch,
      dbUpdateAgent,
      dbCreateAgent,
      dbDeleteAgent,
      dbUpdateTeam,
    });
  }, [gateway, agent]);

  const selectCompanyAction = useCallback(async (id: string) => {
    await selectCompany(id, {
      getGatewayState: gateway.getState,
      dispatchGateway: gateway.dispatch,
      dispatchAgent: agent.dispatch,
      dispatchSession: session.dispatch,
      disconnect: gateway.disconnect,
      connect: gateway.connect,
      dbDeleteCompany,
      getAgentsByCompany,
      getTeamsByCompany,
      syncAgents: syncAgentsAction,
    });
  }, [gateway, agent, session, syncAgentsAction]);

  const deleteCompanyAction = useCallback(async (id: string) => {
    await deleteCompany(id, {
      getGatewayState: gateway.getState,
      dispatchGateway: gateway.dispatch,
      dispatchAgent: agent.dispatch,
      dispatchSession: session.dispatch,
      disconnect: gateway.disconnect,
      connect: gateway.connect,
      dbDeleteCompany,
      getAgentsByCompany,
      getTeamsByCompany,
      syncAgents: syncAgentsAction,
    });
  }, [gateway, agent, session, syncAgentsAction]);

  const createAgentAction = useCallback(
    async (opts: {
      companyId: string;
      name: string;
      description: string;
      specialty: AgentSpecialty;
    }) => {
      const newAgent: Agent = {
        id: uuidv4(),
        companyId: opts.companyId,
        name: opts.name,
        description: opts.description,
        specialty: opts.specialty,
        createdAt: Date.now(),
      };
      const gw = gateway.getState();
      const company = gw.companies.find(c => c.id === opts.companyId);
      if (company?.gatewayUrl && company?.gatewayToken) {
        const res = await fetch("/api/agents/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: newAgent.id,
            name: newAgent.name,
            description: newAgent.description,
            specialty: newAgent.specialty,
            gatewayUrl: company.gatewayUrl,
            gatewayToken: company.gatewayToken,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data.error ?? `Failed to create agent on gateway (${res.status})`,
          );
        }
      }
      await dbCreateAgent(newAgent);
      agent.dispatch({ type: "ADD_AGENT", agent: newAgent });
      return newAgent;
    },
    [gateway, agent],
  );

  const deleteAgentAction = useCallback(async (id: string) => {
    const ag = agent.getState().agents.find(a => a.id === id);
    const company = ag
      ? gateway.getState().companies.find(c => c.id === ag.companyId)
      : undefined;

    await dbDeleteAgent(id);
    agent.dispatch({ type: "REMOVE_AGENT", id });

    // Prune the deleted agent from any team rosters in this company so the UI
    // count and dispatcher stay in sync.
    const teamsAfter = agent.getState().teams.filter(t => t.companyId === ag?.companyId);
    for (const team of teamsAfter) {
      if (!team.agentIds.includes(id) && team.tlAgentId !== id) continue;
      const updates: Partial<typeof team> = {
        agentIds: team.agentIds.filter(x => x !== id),
      };
      if (team.tlAgentId === id) updates.tlAgentId = null;
      await dbUpdateTeam(team.id, updates);
      agent.dispatch({ type: "UPDATE_TEAM", id: team.id, updates });
    }

    try {
      await fetch("/api/agents/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: id,
          gatewayUrl: company?.gatewayUrl,
          gatewayToken: company?.gatewayToken,
        }),
      });
    } catch {
      // Gateway update failed silently (matches legacy)
    }

    const sess = session.getState();
    if (sess.activeChatTarget?.type === "agent" && sess.activeChatTarget.id === id) {
      session.dispatch({ type: "SET_CHAT_TARGET", target: null });
      session.dispatch({ type: "SET_MESSAGES", messages: [] });
    }
  }, [gateway, agent, session]);

  const deleteTeamAction = useCallback(async (id: string) => {
    await dbDeleteTeam(id);
    agent.dispatch({ type: "REMOVE_TEAM", id });
    const sess = session.getState();
    if (sess.activeChatTarget?.type === "team" && sess.activeChatTarget.id === id) {
      session.dispatch({ type: "SET_CHAT_TARGET", target: null });
      session.dispatch({ type: "SET_MESSAGES", messages: [] });
    }
  }, [agent, session]);

  const selectChatTargetAction = useCallback(async (target: ChatTarget) => {
    await selectChatTarget(target, {
      getGatewayState: gateway.getState,
      dispatchSession: session.dispatch,
      gatewayRpc,
      parseSessions: parseNativeSessionConversations as ParseSessionsFn,
      parseMessages: parseNativeSessionMessages as ParseMessagesFn,
      getConversationsByTarget,
      getMessagesByConversation,
    });
  }, [gateway, session]);

  const selectConversationAction = useCallback(async (id: string) => {
    await selectConversation(id, {
      getGatewayState: gateway.getState,
      getConversations: () => session.getState().conversations,
      getActiveChatTarget: () => session.getState().activeChatTarget,
      dispatchSession: session.dispatch,
      gatewayRpc,
      parseMessages: parseNativeSessionMessages as ParseMessagesFn,
      getMessagesByConversation,
    });
  }, [gateway, session]);

  const deleteConversationAction = useCallback(async (id: string) => {
    await deleteConversation(id, {
      getGatewayState: gateway.getState,
      getConversations: () => session.getState().conversations,
      dispatchSession: session.dispatch,
      gatewayRpc,
      dbDeleteConversation,
    });
  }, [gateway, session]);

  const fetchNative = useCallback(
    async (
      agentId: string,
      preferredSessionKey?: string,
      opts?: { listOnly?: boolean },
    ) => {
      await fetchNativeAgentSessions(agentId, {
        getGatewayState: gateway.getState,
        dispatchSession: session.dispatch,
        gatewayRpc,
        parseSessions: parseNativeSessionConversations as ParseSessionsFn,
        parseMessages: parseNativeSessionMessages as ParseMessagesFn,
      }, preferredSessionKey, opts);
    },
    [gateway, session],
  );

  const sendMessageAction = useCallback(
    async (content: string, attachments?: MessageAttachment[]) => {
      await sendMessage(content, attachments, {
        getGatewayState: gateway.getState,
        getAgentState: agent.getState,
        getSessionState: session.getState,
        getChatState: chat.getState,
        dispatchSession: session.dispatch,
        dispatchChat: chat.dispatch,
        clientRef: gateway.clientRef,
        pendingResolvers: chat.pendingStreamResolvers.current,
        pendingFinalContent: chat.pendingFinalContent.current,
        teamAbortedRef: chat.teamAbortedRef,
        dbAddMessage,
        dbUpdateConversation,
        createConversation: session.createConversation,
        fetchNativeAgentSessions: fetchNative,
        dispatchTeamMessage,
        idFactory: () => uuidv4(),
      });
    },
    [gateway, agent, session, chat, fetchNative],
  );

  const abortStreamingAction = useCallback(async (agentId: string) => {
    await abortStreaming(agentId, {
      getGatewayState: gateway.getState,
      getAgentState: agent.getState,
      getSessionState: session.getState,
      getChatState: chat.getState,
      dispatchSession: session.dispatch,
      dispatchChat: chat.dispatch,
      clientRef: gateway.clientRef,
      pendingResolvers: chat.pendingStreamResolvers.current,
      pendingFinalContent: chat.pendingFinalContent.current,
      teamAbortedRef: chat.teamAbortedRef,
      dbAddMessage,
      dbUpdateConversation,
      createConversation: session.createConversation,
      fetchNativeAgentSessions: fetchNative,
      dispatchTeamMessage,
      idFactory: () => uuidv4(),
    });
  }, [gateway, agent, session, chat, fetchNative]);

  const actions = useMemo<StoreActions>(
    () => ({
      selectCompany: selectCompanyAction,
      deleteCompany: deleteCompanyAction,
      createAgent: createAgentAction,
      deleteAgent: deleteAgentAction,
      deleteTeam: deleteTeamAction,
      syncAgents: syncAgentsAction,
      selectChatTarget: selectChatTargetAction,
      selectConversation: selectConversationAction,
      deleteConversation: deleteConversationAction,
      sendMessage: sendMessageAction,
      abortStreaming: abortStreamingAction,
    }),
    [
      selectCompanyAction,
      deleteCompanyAction,
      createAgentAction,
      deleteAgentAction,
      deleteTeamAction,
      syncAgentsAction,
      selectChatTargetAction,
      selectConversationAction,
      deleteConversationAction,
      sendMessageAction,
      abortStreamingAction,
    ],
  );

  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}

export function useActions(): StoreActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useActions must be used within ActionsProvider");
  return ctx;
}
