import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Company, Conversation } from "@/types";
import {
  fetchNativeAgentSessions,
  selectChatTarget,
  selectConversation,
  deleteConversation,
} from "./native-sessions";

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "c1", name: "co", runtimeType: "openclaw",
    gatewayUrl: "http://gw", gatewayToken: "tk",
    createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

describe("fetchNativeAgentSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears conversations when no gateway credentials", async () => {
    const dispatchSession = vi.fn();
    await fetchNativeAgentSessions("a1", {
      getGatewayState: () => ({
        companies: [company({ gatewayUrl: "", gatewayToken: "" })],
        activeCompanyId: "c1",
        connectionStatus: "disconnected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: vi.fn(),
      parseSessions: vi.fn(() => []),
      parseMessages: vi.fn(() => []),
    });
    expect(dispatchSession).toHaveBeenCalledWith({ type: "SET_CONVERSATIONS", conversations: [] });
    expect(dispatchSession).toHaveBeenCalledWith({ type: "SET_ACTIVE_CONVERSATION", id: null });
    expect(dispatchSession).toHaveBeenCalledWith({ type: "SET_MESSAGES", messages: [] });
  });

  it("listOnly mode preserves active conversation + messages", async () => {
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async () => ({ ok: true, payload: {} }));
    await fetchNativeAgentSessions("a1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: rpc,
      parseSessions: () => [
        {
          id: "s1", targetType: "agent", targetId: "a1", companyId: "c1",
          title: "S", createdAt: 0, updatedAt: 0, source: "native-session",
        } as Conversation,
      ],
      parseMessages: () => [],
    }, "s1", { listOnly: true });
    expect(dispatchSession).toHaveBeenCalledWith({
      type: "SET_CONVERSATIONS",
      conversations: expect.any(Array),
    });
    expect(dispatchSession).toHaveBeenCalledWith({
      type: "SET_ACTIVE_CONVERSATION",
      id: "s1",
    });
    // listOnly must NOT clear messages
    const clearedMessages = dispatchSession.mock.calls.some(
      c => c[0].type === "SET_MESSAGES" && (c[0] as { messages: unknown[] }).messages.length === 0,
    );
    expect(clearedMessages).toBe(false);
  });

  it("full fetch: picks preferred session when present, then loads history", async () => {
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async (_url: string, _tk: string, method: string) => {
      if (method === "sessions.list") return { ok: true, payload: {} };
      if (method === "chat.history") return { ok: true, payload: {} };
      return { ok: false };
    });
    const parseMessages = vi.fn(() => []);
    await fetchNativeAgentSessions("a1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: rpc,
      parseSessions: () => [
        { id: "s1" } as Conversation,
        { id: "s2" } as Conversation,
      ],
      parseMessages,
    }, "s2");
    expect(dispatchSession).toHaveBeenCalledWith({ type: "SET_ACTIVE_CONVERSATION", id: "s2" });
    expect(parseMessages).toHaveBeenCalled();
  });
});

describe("selectChatTarget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("agent + openclaw: delegates to fetchNativeAgentSessions path via rpc", async () => {
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async () => ({ ok: true, payload: {} }));
    await selectChatTarget({ type: "agent", id: "a1" }, {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: rpc,
      parseSessions: () => [],
      parseMessages: () => [],
      getConversationsByTarget: vi.fn(),
      getMessagesByConversation: vi.fn(),
    });
    expect(dispatchSession).toHaveBeenCalledWith({
      type: "SET_CHAT_TARGET",
      target: { type: "agent", id: "a1" },
    });
    expect(rpc).toHaveBeenCalledWith(
      "http://gw", "tk", "sessions.list", expect.anything(),
    );
  });

  it("team: loads conversations from local DB", async () => {
    const dispatchSession = vi.fn();
    const getConversationsByTarget = vi.fn(async () => [
      { id: "x" } as Conversation,
    ]);
    const getMessagesByConversation = vi.fn(async () => []);
    await selectChatTarget({ type: "team", id: "t1" }, {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: vi.fn(),
      parseSessions: () => [],
      parseMessages: () => [],
      getConversationsByTarget,
      getMessagesByConversation,
    });
    expect(getConversationsByTarget).toHaveBeenCalledWith("team", "t1", "c1");
    expect(dispatchSession).toHaveBeenCalledWith({
      type: "SET_ACTIVE_CONVERSATION",
      id: "x",
    });
  });
});

describe("selectConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("native-session: calls chat.history via rpc", async () => {
    const conversation = {
      id: "s1", source: "native-session", sessionKey: "agent:a1:x:s1",
    } as Conversation;
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async () => ({ ok: true, payload: {} }));
    await selectConversation("s1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      getConversations: () => [conversation],
      getActiveChatTarget: () => ({ type: "agent", id: "a1" }),
      dispatchSession,
      gatewayRpc: rpc,
      parseMessages: () => [],
      getMessagesByConversation: vi.fn(),
    });
    expect(rpc).toHaveBeenCalledWith(
      "http://gw", "tk", "chat.history", { sessionKey: "agent:a1:x:s1" },
    );
  });

  it("local conversation: reads from DB", async () => {
    const conversation = { id: "local-1", source: undefined } as Conversation;
    const dispatchSession = vi.fn();
    const getMessagesByConversation = vi.fn(async () => []);
    await selectConversation("local-1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      getConversations: () => [conversation],
      getActiveChatTarget: () => ({ type: "team", id: "t1" }),
      dispatchSession,
      gatewayRpc: vi.fn(),
      parseMessages: () => [],
      getMessagesByConversation,
    });
    expect(getMessagesByConversation).toHaveBeenCalledWith("local-1");
  });
});

describe("deleteConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("native-session: calls sessions.delete via rpc, then dispatches DELETE_CONVERSATION", async () => {
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async () => ({ ok: true, payload: {} }));
    await deleteConversation("s1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      getConversations: () => [{
        id: "s1", source: "native-session", sessionKey: "agent:a1:x:s1",
      } as Conversation],
      dispatchSession,
      gatewayRpc: rpc,
      dbDeleteConversation: vi.fn(),
    });
    expect(rpc).toHaveBeenCalledWith(
      "http://gw", "tk", "sessions.delete", {
        key: "agent:a1:x:s1",
        deleteTranscript: true,
        emitLifecycleHooks: false,
      },
    );
    expect(dispatchSession).toHaveBeenCalledWith({ type: "DELETE_CONVERSATION", id: "s1" });
  });

  it("local conversation: calls dbDeleteConversation", async () => {
    const dispatchSession = vi.fn();
    const db = vi.fn(async () => {});
    await deleteConversation("local-1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      getConversations: () => [{ id: "local-1" } as Conversation],
      dispatchSession,
      gatewayRpc: vi.fn(),
      dbDeleteConversation: db,
    });
    expect(db).toHaveBeenCalledWith("local-1");
    expect(dispatchSession).toHaveBeenCalledWith({ type: "DELETE_CONVERSATION", id: "local-1" });
  });
});
