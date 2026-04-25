import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatEventPayload, Conversation } from "@/types";
import type { StreamingState } from "@/lib/store/chat/types";
import { handleGatewayChatEvent } from "./gateway-events";

function streaming(overrides: Partial<StreamingState> = {}): StreamingState {
  return {
    isStreaming: true,
    content: "",
    toolCalls: [],
    runId: null,
    targetType: "agent",
    targetId: "a1",
    conversationId: "conv-1",
    sessionKey: "agent:a1:graupelclaw:conv-1",
    phase: "connecting",
    ...overrides,
  };
}

function payload(
  state: ChatEventPayload["state"],
  overrides: Partial<ChatEventPayload> = {},
): ChatEventPayload {
  return {
    runId: "r1",
    sessionKey: "agent:a1:graupelclaw:conv-1",
    state,
    message: { role: "assistant", content: [], timestamp: 100 },
    ...overrides,
  };
}

function makeDeps(opts: {
  streamingStates?: Record<string, StreamingState>;
  conversations?: Conversation[];
  activeConversationId?: string | null;
} = {}) {
  return {
    getChatState: () => ({
      streamingStates: opts.streamingStates ?? {},
      lastCascadeStatus: null,
    }),
    getSessionState: () => ({
      conversations: opts.conversations ?? [],
      messages: [],
      activeChatTarget: null,
      activeConversationId: opts.activeConversationId ?? null,
      nativeSessionsLoading: false,
      nativeSessionsError: null,
    }),
    dispatchChat: vi.fn(),
    dispatchSession: vi.fn(),
    dbAddMessage: vi.fn(async () => {}),
    pendingResolvers: new Map<string, (reply: { content: string } | null) => void>(),
    pendingFinalContent: new Map<string, string>(),
    idFactory: () => "new-msg-id",
  };
}

describe("handleGatewayChatEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delta: dispatches SET_STREAMING_CONTENT only", () => {
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
    });
    const p = payload("delta", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        timestamp: 100,
      },
    });
    handleGatewayChatEvent(p, deps);
    expect(deps.dispatchChat).toHaveBeenCalledWith({
      type: "SET_STREAMING_CONTENT",
      agentId: "a1",
      content: "hi",
      runId: "r1",
      phase: undefined,
      toolCalls: undefined,
    });
  });

  it("message_done [local persist]: adds message + dbAddMessage + resets content", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: undefined,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming({ content: "partial" }) },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    const p = payload("message_done", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done text" }],
        timestamp: 200,
      },
    });
    handleGatewayChatEvent(p, deps);
    expect(deps.dispatchSession).toHaveBeenCalledWith({
      type: "ADD_MESSAGE",
      message: expect.objectContaining({
        role: "assistant", agentId: "a1", content: "done text",
      }),
    });
    expect(deps.dbAddMessage).toHaveBeenCalled();
    expect(deps.dispatchChat).toHaveBeenCalledWith({
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "", runId: null,
    });
  });

  it("message_done [native-session persist]: adds message but does NOT call dbAddMessage", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: "native-session",
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    const p = payload("message_done", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "x" }],
        timestamp: 1,
      },
    });
    handleGatewayChatEvent(p, deps);
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
    expect(deps.dispatchSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_MESSAGE" }),
    );
  });

  it("message_done: does NOT dispatch ADD_MESSAGE when user viewing a different conversation", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "other-conv",
    });
    const p = payload("message_done", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "bg" }],
        timestamp: 1,
      },
    });
    handleGatewayChatEvent(p, deps);
    const addCalls = deps.dispatchSession.mock.calls.filter(
      c => c[0].type === "ADD_MESSAGE",
    );
    expect(addCalls).toHaveLength(0);
    // dbAddMessage still called for local conversation
    expect(deps.dbAddMessage).toHaveBeenCalled();
  });

  it("final: clears streaming + resolves pending resolver with last final content", () => {
    const resolver = vi.fn();
    const pending = new Map([["a1", resolver]]);
    const finals = new Map([["a1", "hello world"]]);
    const deps = {
      ...makeDeps({ streamingStates: { a1: streaming() } }),
      pendingResolvers: pending,
      pendingFinalContent: finals,
    };
    handleGatewayChatEvent(payload("final"), deps);
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: false, agentId: "a1" }),
    );
    expect(resolver).toHaveBeenCalledWith({ content: "hello world" });
    expect(pending.has("a1")).toBe(false);
    expect(finals.has("a1")).toBe(false);
  });

  it("final: resolves with null if no message_done captured content", () => {
    const resolver = vi.fn();
    const pending = new Map([["a1", resolver]]);
    const deps = {
      ...makeDeps({ streamingStates: { a1: streaming() } }),
      pendingResolvers: pending,
    };
    handleGatewayChatEvent(payload("final"), deps);
    expect(resolver).toHaveBeenCalledWith(null);
  });

  it("message_done: stores latest text in pendingFinalContent for the resolver", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    const p = payload("message_done", {
      message: { role: "assistant", content: [{ type: "text", text: "first chunk" }], timestamp: 1 },
    });
    handleGatewayChatEvent(p, deps);
    expect(deps.pendingFinalContent.get("a1")).toBe("first chunk");
    // A second message_done overwrites (model output advanced)
    const p2 = payload("message_done", {
      message: { role: "assistant", content: [{ type: "text", text: "final answer" }], timestamp: 2 },
    });
    handleGatewayChatEvent(p2, deps);
    expect(deps.pendingFinalContent.get("a1")).toBe("final answer");
  });

  it("error [local]: adds error message via dbAddMessage + dispatches ADD_MESSAGE + clears streaming", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    const p = payload("error", { error: "boom" });
    handleGatewayChatEvent(p, deps);
    // wait for the async dbAddMessage chain before asserting
    await Promise.resolve(); await Promise.resolve();
    expect(deps.dbAddMessage).toHaveBeenCalled();
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: false }),
    );
  });

  it("error [native-session]: does NOT call dbAddMessage but still dispatches + clears streaming", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: "native-session",
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    handleGatewayChatEvent(payload("error", { error: "boom" }), deps);
    await Promise.resolve(); await Promise.resolve();
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
  });

  it("aborted [local]: persists partial content if any + clears streaming", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming({ content: "partial answer" }) },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    handleGatewayChatEvent(payload("aborted"), deps);
    await Promise.resolve(); await Promise.resolve();
    expect(deps.dbAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "partial answer" }),
    );
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: false }),
    );
  });

  it("aborted [native-session]: no dbAddMessage, dispatches ADD_MESSAGE when viewing", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: "native-session",
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming({ content: "partial" }) },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    handleGatewayChatEvent(payload("aborted"), deps);
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
    expect(deps.dispatchSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_MESSAGE" }),
    );
  });

  it("aborted with empty content: no message persisted, still clears streaming", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming({ content: "" }) },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    handleGatewayChatEvent(payload("aborted"), deps);
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: false }),
    );
  });

  it("ignores events whose sessionKey does not resolve to an agentId", () => {
    const deps = makeDeps();
    handleGatewayChatEvent(
      payload("delta", { sessionKey: "not-a-session" }),
      deps,
    );
    expect(deps.dispatchChat).not.toHaveBeenCalled();
  });
});
