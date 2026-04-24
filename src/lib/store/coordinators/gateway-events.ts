import type { ChatEventPayload, Message } from "@/types";
import type { ChatSliceState, ChatAction } from "@/lib/store/chat/types";
import type { SessionState, SessionAction } from "@/lib/store/session/types";

export interface GatewayEventsDeps {
  getChatState: () => ChatSliceState;
  getSessionState: () => SessionState;
  dispatchChat: (a: ChatAction) => void;
  dispatchSession: (a: SessionAction) => void;
  dbAddMessage: (m: Message) => Promise<unknown>;
  pendingResolvers: Map<string, () => void>;
  idFactory: () => string;
}

function resolveAgentFromSession(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match ? match[1] : null;
}

export function handleGatewayChatEvent(
  payload: ChatEventPayload,
  deps: GatewayEventsDeps,
): void {
  const agentId = resolveAgentFromSession(payload.sessionKey);
  if (!agentId) return;

  const chat = deps.getChatState();
  const streaming = chat.streamingStates[agentId];
  const session = deps.getSessionState();
  const streamingConversation = streaming
    ? session.conversations.find(c => c.id === streaming.conversationId)
    : undefined;
  const shouldPersistLocal = streamingConversation?.source !== "native-session";

  const firstContent = payload.message?.content?.[0];
  const text = firstContent && firstContent.type === "text" ? firstContent.text : "";

  switch (payload.state) {
    case "delta": {
      deps.dispatchChat({
        type: "SET_STREAMING_CONTENT",
        agentId,
        content: text,
        runId: payload.runId,
        phase: payload.phase,
        toolCalls: payload.toolCalls,
      });
      return;
    }

    case "message_done": {
      const doneText = text || streaming?.content || "";
      if (
        (doneText || (payload.toolCalls && payload.toolCalls.length > 0)) &&
        streaming
      ) {
        const msg: Message = {
          id: deps.idFactory(),
          conversationId: streaming.conversationId,
          targetType: streaming.targetType,
          targetId: streaming.targetId,
          role: "assistant",
          agentId,
          content: doneText,
          toolCalls: payload.toolCalls?.length ? payload.toolCalls : undefined,
          createdAt: payload.message?.timestamp ?? Date.now(),
        };
        if (session.activeConversationId === streaming.conversationId) {
          deps.dispatchSession({ type: "ADD_MESSAGE", message: msg });
        }
        if (shouldPersistLocal) {
          deps.dbAddMessage(msg);
        }
      }
      deps.dispatchChat({
        type: "SET_STREAMING_CONTENT",
        agentId,
        content: "",
        runId: null,
      });
      return;
    }

    case "final": {
      deps.dispatchChat({
        type: "SET_STREAMING",
        agentId,
        targetType: streaming?.targetType ?? "agent",
        targetId: streaming?.targetId ?? "",
        sessionKey: "",
        isStreaming: false,
      });
      const resolver = deps.pendingResolvers.get(agentId);
      if (resolver) {
        deps.pendingResolvers.delete(agentId);
        resolver();
      }
      return;
    }

    case "error": {
      const errText = payload.error || text || "An error occurred";
      if (streaming) {
        const msg: Message = {
          id: deps.idFactory(),
          conversationId: streaming.conversationId,
          targetType: streaming.targetType,
          targetId: streaming.targetId,
          role: "assistant",
          agentId,
          content: `Error: ${errText}`,
          createdAt: Date.now(),
        };
        applyErrorOrAbortMessage(msg, streaming.conversationId, shouldPersistLocal, deps);
      }
      deps.dispatchChat({
        type: "SET_STREAMING",
        agentId,
        targetType: streaming?.targetType ?? "agent",
        targetId: streaming?.targetId ?? "",
        sessionKey: "",
        isStreaming: false,
      });
      const resolver = deps.pendingResolvers.get(agentId);
      if (resolver) {
        deps.pendingResolvers.delete(agentId);
        resolver();
      }
      return;
    }

    case "aborted": {
      const abortedText = streaming?.content;
      if (abortedText && streaming) {
        const msg: Message = {
          id: deps.idFactory(),
          conversationId: streaming.conversationId,
          targetType: streaming.targetType,
          targetId: streaming.targetId,
          role: "assistant",
          agentId,
          content: abortedText,
          createdAt: Date.now(),
        };
        applyErrorOrAbortMessage(msg, streaming.conversationId, shouldPersistLocal, deps);
      }
      deps.dispatchChat({
        type: "SET_STREAMING",
        agentId,
        targetType: streaming?.targetType ?? "agent",
        targetId: streaming?.targetId ?? "",
        sessionKey: "",
        isStreaming: false,
      });
      const resolver = deps.pendingResolvers.get(agentId);
      if (resolver) {
        deps.pendingResolvers.delete(agentId);
        resolver();
      }
      return;
    }
  }
}

function applyErrorOrAbortMessage(
  msg: Message,
  conversationId: string,
  shouldPersistLocal: boolean,
  deps: GatewayEventsDeps,
): void {
  if (shouldPersistLocal) {
    deps.dbAddMessage(msg).then(() => {
      const s = deps.getSessionState();
      if (s.activeConversationId === conversationId) {
        deps.dispatchSession({ type: "ADD_MESSAGE", message: msg });
      }
    });
  } else {
    const s = deps.getSessionState();
    if (s.activeConversationId === conversationId) {
      deps.dispatchSession({ type: "ADD_MESSAGE", message: msg });
    }
  }
}
