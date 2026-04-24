import type React from "react";
import type {
  AppState, ChatTarget, Message, MessageAttachment, Conversation,
} from "@/types";
import type { RuntimeClient } from "@/lib/runtime";
import type { GatewayState } from "@/lib/store/gateway/types";
import type { AgentState } from "@/lib/store/agent/types";
import type { SessionState, SessionAction } from "@/lib/store/session/types";
import type { ChatSliceState, ChatAction } from "@/lib/store/chat/types";
import type { DispatchOpts } from "@/lib/team/types";
import { dmSessionKey, teamSessionKey } from "@/lib/store/session-keys";

type MinimalClient = Pick<RuntimeClient, "isConnected" | "sendMessage" | "abortChat">;

export interface SendMessageDeps {
  getGatewayState: () => GatewayState;
  getAgentState: () => AgentState;
  getSessionState: () => SessionState;
  getChatState: () => ChatSliceState;
  dispatchSession: (a: SessionAction) => void;
  dispatchChat: (a: ChatAction) => void;
  clientRef: React.MutableRefObject<MinimalClient | null>;
  pendingResolvers: Map<string, () => void>;
  teamAbortedRef: React.MutableRefObject<Map<string, boolean>>;
  dbAddMessage: (m: Message) => Promise<unknown>;
  dbUpdateConversation: (id: string, updates: Partial<Conversation>) => Promise<unknown>;
  createConversation: (
    targetType: "agent" | "team",
    targetId: string,
    activeCompanyId: string | null,
  ) => Promise<string>;
  fetchNativeAgentSessions: (
    agentId: string,
    preferredSessionKey?: string,
    opts?: { listOnly?: boolean },
  ) => Promise<void>;
  dispatchTeamMessage: (opts: DispatchOpts) => Promise<void>;
  idFactory: () => string;
}

const STREAM_TIMEOUT = 5 * 60 * 1000;

export async function sendMessage(
  content: string,
  attachments: MessageAttachment[] | undefined,
  deps: SendMessageDeps,
): Promise<void> {
  const session = deps.getSessionState();
  const target = session.activeChatTarget;
  if (!target) return;

  const client = deps.clientRef.current;
  if (!client || !client.isConnected()) return;

  const gateway = deps.getGatewayState();

  let conversationId = session.activeConversationId;
  let activeConversation = conversationId
    ? session.conversations.find(c => c.id === conversationId)
    : undefined;
  if (!conversationId) {
    conversationId = await deps.createConversation(
      target.type, target.id, gateway.activeCompanyId,
    );
    activeConversation = deps
      .getSessionState()
      .conversations.find(c => c.id === conversationId);
  }

  if (session.messages.length === 0) {
    const title = content.slice(0, 50);
    if (activeConversation?.source === "native-session") {
      deps.dispatchSession({
        type: "UPDATE_CONVERSATION",
        id: conversationId,
        updates: { title },
      });
    } else {
      await deps.dbUpdateConversation(conversationId, { title });
      deps.dispatchSession({
        type: "UPDATE_CONVERSATION",
        id: conversationId,
        updates: { title },
      });
    }
  }

  const userMsg: Message = {
    id: deps.idFactory(),
    conversationId,
    targetType: target.type,
    targetId: target.id,
    role: "user",
    content,
    attachments: attachments?.length ? attachments : undefined,
    createdAt: Date.now(),
  };
  if (activeConversation?.source !== "native-session") {
    await deps.dbAddMessage(userMsg);
  }
  deps.dispatchSession({ type: "ADD_MESSAGE", message: userMsg });

  if (target.type === "agent") {
    await sendToAgent(target, conversationId, content, attachments, activeConversation, client, deps);
    return;
  }
  await sendToTeam(target, conversationId, content, attachments, userMsg.id, deps, client);
}

async function sendToAgent(
  target: ChatTarget,
  conversationId: string,
  content: string,
  attachments: MessageAttachment[] | undefined,
  activeConversation: Conversation | undefined,
  client: MinimalClient,
  deps: SendMessageDeps,
): Promise<void> {
  const sessionKey =
    activeConversation?.sessionKey ?? dmSessionKey(target.id, conversationId);
  deps.dispatchChat({
    type: "SET_STREAMING",
    agentId: target.id,
    targetType: "agent",
    targetId: target.id,
    conversationId,
    sessionKey,
    isStreaming: true,
  });
  try {
    await client.sendMessage(sessionKey, content, undefined, attachments);
    await deps.fetchNativeAgentSessions(target.id, sessionKey, { listOnly: true });
  } catch {
    deps.dispatchChat({
      type: "SET_STREAMING",
      agentId: target.id,
      targetType: "agent",
      targetId: target.id,
      sessionKey,
      isStreaming: false,
    });
  }
}

async function sendToTeam(
  target: ChatTarget,
  conversationId: string,
  content: string,
  attachments: MessageAttachment[] | undefined,
  userMsgId: string,
  deps: SendMessageDeps,
  client: MinimalClient,
): Promise<void> {
  const agentState = deps.getAgentState();
  const team = agentState.teams.find(t => t.id === target.id);
  if (!team) return;

  deps.teamAbortedRef.current.set(conversationId, false);
  deps.dispatchChat({ type: "CLEAR_CASCADE_STATUS", conversationId });

  const sendToAgentFn = async (
    agentId: string,
    sessionKey: string,
    text: string,
    atts?: MessageAttachment[],
  ): Promise<{ fromAgentId: string; content: string } | null> => {
    deps.dispatchChat({
      type: "SET_STREAMING",
      agentId,
      targetType: "team",
      targetId: target.id,
      conversationId,
      sessionKey,
      isStreaming: true,
    });
    const streamDone = Promise.race([
      new Promise<void>(resolve => {
        deps.pendingResolvers.set(agentId, resolve);
      }),
      new Promise<void>(resolve =>
        setTimeout(() => {
          deps.pendingResolvers.delete(agentId);
          resolve();
        }, STREAM_TIMEOUT),
      ),
    ]);
    const sinceTs = Date.now();
    try {
      await client.sendMessage(sessionKey, text, undefined, atts);
      await streamDone;
    } catch {
      deps.dispatchChat({
        type: "SET_STREAMING",
        agentId,
        targetType: "team",
        targetId: target.id,
        sessionKey,
        isStreaming: false,
      });
      return null;
    }

    const latestSession = deps.getSessionState();
    const reply = [...latestSession.messages].reverse().find(
      m =>
        m.role === "assistant" &&
        m.agentId === agentId &&
        m.targetId === target.id &&
        m.conversationId === conversationId &&
        m.createdAt > sinceTs,
    );
    if (!reply) return null;
    return { fromAgentId: agentId, content: reply.content };
  };

  await deps.dispatchTeamMessage({
    team,
    conversationId,
    rootUserMessageId: userMsgId,
    userContent: content,
    attachments,
    // TODO: Task 10 narrow team DispatchOpts.getState
    getState: () => ({
      agents: agentState.agents,
      teams: agentState.teams,
      messages: deps.getSessionState().messages,
      agentIdentities: agentState.agentIdentities,
    }) as unknown as AppState,
    sendToAgent: sendToAgentFn,
    isAborted: cid => deps.teamAbortedRef.current.get(cid) === true,
    onCascadeStopped: ({ reason, hop }) => {
      deps.dispatchChat({
        type: "SET_CASCADE_STATUS",
        status: { conversationId, reason, hop },
      });
    },
    buildSessionKey: teamSessionKey,
    maxHops: 8,
  });
  deps.teamAbortedRef.current.delete(conversationId);
}

export async function abortStreaming(
  agentId: string,
  deps: SendMessageDeps,
): Promise<void> {
  const chat = deps.getChatState();
  const streaming = chat.streamingStates[agentId];
  if (!streaming) return;

  if (streaming.targetType === "team" && streaming.conversationId) {
    deps.teamAbortedRef.current.set(streaming.conversationId, true);
  }

  const client = deps.clientRef.current;
  if (client) {
    try {
      await client.abortChat(streaming.sessionKey);
    } catch {
      // Abort failed; clean up state manually
    }
    deps.dispatchChat({ type: "CLEAR_STREAMING", agentId });
    const resolver = deps.pendingResolvers.get(agentId);
    if (resolver) {
      deps.pendingResolvers.delete(agentId);
      resolver();
    }
  }
}
