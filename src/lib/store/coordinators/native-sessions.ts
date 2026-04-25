import type { ChatTarget, Conversation, Message } from "@/types";
import type { GatewayState } from "@/lib/store/gateway/types";
import type { SessionAction } from "@/lib/store/session/types";

export type GatewayRpcFn = (
  url: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<{ ok: boolean; payload?: unknown; error?: { message?: string } }>;

export type ParseSessionsFn = (
  payload: unknown,
  agentId: string,
  companyId: string,
) => Conversation[];

export type ParseMessagesFn = (
  payload: unknown,
  agentId: string,
  conversationId: string,
) => Message[];

export interface FetchNativeSessionsDeps {
  getGatewayState: () => GatewayState;
  dispatchSession: (a: SessionAction) => void;
  gatewayRpc: GatewayRpcFn;
  parseSessions: ParseSessionsFn;
  parseMessages: ParseMessagesFn;
}

export async function fetchNativeAgentSessions(
  agentId: string,
  deps: FetchNativeSessionsDeps,
  preferredSessionKey?: string,
  opts?: { listOnly?: boolean },
): Promise<void> {
  const gateway = deps.getGatewayState();
  const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);

  if (!company?.gatewayUrl || !company?.gatewayToken) {
    deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: [] });
    if (!opts?.listOnly) {
      deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: null });
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
    }
    return;
  }

  if (!opts?.listOnly) {
    deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_LOADING", loading: true });
  }
  deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_ERROR", error: null });

  try {
    const result = await deps.gatewayRpc(
      company.gatewayUrl, company.gatewayToken, "sessions.list", { agentId },
    );

    if (!result.ok) {
      deps.dispatchSession({
        type: "SET_NATIVE_SESSIONS_ERROR",
        error: result.error?.message ?? "Failed to load sessions",
      });
      deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: [] });
      if (!opts?.listOnly) {
        deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: null });
        deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
      }
      return;
    }

    const sessions = deps.parseSessions(
      result.payload, agentId, gateway.activeCompanyId ?? "",
    );
    deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: sessions });

    if (opts?.listOnly) {
      if (preferredSessionKey) {
        deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: preferredSessionKey });
      }
      return;
    }

    const nextSessionId =
      preferredSessionKey && sessions.some(s => s.id === preferredSessionKey)
        ? preferredSessionKey
        : sessions[0]?.id ?? null;

    deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: nextSessionId });

    if (!nextSessionId) {
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
      return;
    }

    const history = await deps.gatewayRpc(
      company.gatewayUrl, company.gatewayToken, "chat.history",
      { sessionKey: nextSessionId },
    );
    deps.dispatchSession({
      type: "SET_MESSAGES",
      messages: deps.parseMessages(
        history.ok ? history.payload : undefined,
        agentId,
        nextSessionId,
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load sessions";
    deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_ERROR", error: message });
    if (!opts?.listOnly) {
      deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: [] });
      deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: null });
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
    }
  } finally {
    if (!opts?.listOnly) {
      deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_LOADING", loading: false });
    }
  }
}

export interface SelectChatTargetDeps extends FetchNativeSessionsDeps {
  getConversationsByTarget: (
    targetType: "agent" | "team",
    targetId: string,
    companyId?: string,
  ) => Promise<Conversation[]>;
  getMessagesByConversation: (id: string) => Promise<Message[]>;
}

export async function selectChatTarget(
  target: ChatTarget,
  deps: SelectChatTargetDeps,
): Promise<void> {
  deps.dispatchSession({ type: "SET_CHAT_TARGET", target });

  const gateway = deps.getGatewayState();
  const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);

  if (target.type === "agent" && company?.runtimeType === "openclaw") {
    await fetchNativeAgentSessions(target.id, deps);
    return;
  }

  const convs = await deps.getConversationsByTarget(
    target.type, target.id, gateway.activeCompanyId ?? undefined,
  );
  deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: convs });

  if (convs.length > 0) {
    const latest = convs[0];
    deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: latest.id });
    const msgs = await deps.getMessagesByConversation(latest.id);
    deps.dispatchSession({ type: "SET_MESSAGES", messages: msgs });
  } else {
    deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: null });
    deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
  }
}

export interface SelectConversationDeps {
  getGatewayState: () => GatewayState;
  getConversations: () => Conversation[];
  getActiveChatTarget: () => ChatTarget | null;
  dispatchSession: (a: SessionAction) => void;
  gatewayRpc: GatewayRpcFn;
  parseMessages: ParseMessagesFn;
  getMessagesByConversation: (id: string) => Promise<Message[]>;
}

export async function selectConversation(
  id: string,
  deps: SelectConversationDeps,
): Promise<void> {
  const target = deps.getActiveChatTarget();
  const conversation = deps.getConversations().find(c => c.id === id);

  deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id });

  if (target?.type === "agent" && conversation?.source === "native-session") {
    const gateway = deps.getGatewayState();
    const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);
    if (!company?.gatewayUrl || !company?.gatewayToken) {
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
      return;
    }

    deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_LOADING", loading: true });
    deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_ERROR", error: null });

    try {
      const history = await deps.gatewayRpc(
        company.gatewayUrl, company.gatewayToken, "chat.history",
        { sessionKey: conversation.sessionKey ?? conversation.id },
      );

      if (!history.ok) {
        deps.dispatchSession({
          type: "SET_NATIVE_SESSIONS_ERROR",
          error: history.error?.message ?? "Failed to load messages",
        });
        deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
        return;
      }

      deps.dispatchSession({
        type: "SET_MESSAGES",
        messages: deps.parseMessages(history.payload, target.id, conversation.id),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load messages";
      deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_ERROR", error: message });
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
    } finally {
      deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_LOADING", loading: false });
    }
    return;
  }

  const msgs = await deps.getMessagesByConversation(id);
  deps.dispatchSession({ type: "SET_MESSAGES", messages: msgs });
}

export interface DeleteConversationDeps {
  getGatewayState: () => GatewayState;
  getConversations: () => Conversation[];
  dispatchSession: (a: SessionAction) => void;
  gatewayRpc: GatewayRpcFn;
  dbDeleteConversation: (id: string) => Promise<unknown>;
}

export async function deleteConversation(
  id: string,
  deps: DeleteConversationDeps,
): Promise<void> {
  const conversation = deps.getConversations().find(c => c.id === id);
  if (conversation?.source === "native-session") {
    const gateway = deps.getGatewayState();
    const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);
    if (company?.gatewayUrl && company?.gatewayToken) {
      const sessionKey = conversation.sessionKey ?? conversation.id;
      const result = await deps.gatewayRpc(
        company.gatewayUrl, company.gatewayToken, "sessions.delete",
        { key: sessionKey, deleteTranscript: true, emitLifecycleHooks: false },
      );
      if (!result.ok) {
        deps.dispatchSession({
          type: "SET_NATIVE_SESSIONS_ERROR",
          error: result.error?.message ?? "Failed to delete session",
        });
        return;
      }
    }
    deps.dispatchSession({ type: "DELETE_CONVERSATION", id });
    return;
  }
  await deps.dbDeleteConversation(id);
  deps.dispatchSession({ type: "DELETE_CONVERSATION", id });
}
