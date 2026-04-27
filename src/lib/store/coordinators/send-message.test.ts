import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Agent, AgentTeam, ChatTarget, Company, Conversation, Message,
} from "@/types";
import type { StreamingState } from "@/lib/store/chat/types";
import { sendMessage, abortStreaming } from "./send-message";

function agent(id: string): Agent {
  return {
    id, companyId: "c1", name: `ag-${id}`,
    description: "", specialty: "general", createdAt: 0,
  };
}
function team(id: string, agentIds: string[], tlAgentId?: string): AgentTeam {
  return { id, companyId: "c1", name: `team-${id}`, agentIds, tlAgentId, createdAt: 0 };
}
function company(): Company {
  return {
    id: "c1", name: "co", runtimeType: "openclaw",
    gatewayUrl: "http://gw", gatewayToken: "tk",
    createdAt: 0, updatedAt: 0,
  };
}

function makeDeps(opts: {
  target: ChatTarget | null;
  activeConversationId?: string | null;
  conversations?: Conversation[];
  messages?: Message[];
  teams?: AgentTeam[];
  agents?: Agent[];
  streamingStates?: Record<string, StreamingState>;
  isConnected?: boolean;
}) {
  return {
    getGatewayState: () => ({
      companies: [company()], activeCompanyId: "c1",
      connectionStatus: "connected" as const, initialized: true,
    }),
    getAgentState: () => ({
      agents: opts.agents ?? [], teams: opts.teams ?? [], agentIdentities: {},
    }),
    getSessionState: () => ({
      conversations: opts.conversations ?? [],
      messages: opts.messages ?? [],
      activeChatTarget: opts.target,
      activeConversationId: opts.activeConversationId ?? null,
      nativeSessionsLoading: false, nativeSessionsError: null,
    }),
    getChatState: () => ({
      streamingStates: opts.streamingStates ?? {},
      lastCascadeStatus: null,
    }),
    dispatchSession: vi.fn(),
    dispatchChat: vi.fn(),
    clientRef: {
      current: {
        isConnected: () => opts.isConnected ?? true,
        sendMessage: vi.fn(async () => {}),
        abortChat: vi.fn(async () => {}),
      },
    } as unknown as React.MutableRefObject<{
      isConnected: () => boolean;
      sendMessage: (
        k: string,
        t: string,
        u: undefined,
        a?: unknown,
        s?: string,
      ) => Promise<void>;
      abortChat: (k: string) => Promise<void>;
    } | null>,
    pendingResolvers: new Map<string, (reply: { content: string } | null) => void>(),
    pendingFinalContent: new Map<string, string>(),
    teamAbortedRef: { current: new Map<string, boolean>() },
    dbAddMessage: vi.fn(async () => {}),
    dbUpdateConversation: vi.fn(async () => {}),
    createConversation: vi.fn(async () => "fresh-conv-id"),
    fetchNativeAgentSessions: vi.fn(async () => {}),
    dispatchTeamMessage: vi.fn(async () => {}),
    idFactory: () => "new-id",
  };
}

describe("sendMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-ops when no active chat target", async () => {
    const deps = makeDeps({ target: null });
    await sendMessage("hi", undefined, deps);
    expect(deps.dispatchSession).not.toHaveBeenCalled();
  });

  it("no-ops when gateway not connected", async () => {
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      isConnected: false,
    });
    await sendMessage("hi", undefined, deps);
    expect(deps.dispatchSession).not.toHaveBeenCalled();
  });

  it("agent: creates conversation when none active, adds user msg, starts streaming", async () => {
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      activeConversationId: null,
      agents: [agent("a1")],
    });
    await sendMessage("hello", undefined, deps);
    expect(deps.createConversation).toHaveBeenCalled();
    expect(deps.dispatchSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_MESSAGE" }),
    );
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: true }),
    );
  });

  it("agent: updates conversation title on first message (local path)", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "New Chat", createdAt: 0, updatedAt: 0, source: undefined,
    };
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      activeConversationId: "conv-1",
      conversations: [conv],
      messages: [],
      agents: [agent("a1")],
    });
    await sendMessage("My first question", undefined, deps);
    expect(deps.dbUpdateConversation).toHaveBeenCalledWith("conv-1", { title: "My first question" });
    expect(deps.dispatchSession).toHaveBeenCalledWith({
      type: "UPDATE_CONVERSATION",
      id: "conv-1",
      updates: { title: "My first question" },
    });
  });

  it("agent [native-session]: updates title in state only, NOT via dbUpdateConversation", async () => {
    const conv: Conversation = {
      id: "agent:a1:graupelclaw:x", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "New Session", createdAt: 0, updatedAt: 0, source: "native-session",
      sessionKey: "agent:a1:graupelclaw:x",
    };
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      activeConversationId: conv.id,
      conversations: [conv],
      messages: [],
      agents: [agent("a1")],
    });
    await sendMessage("Hi", undefined, deps);
    expect(deps.dbUpdateConversation).not.toHaveBeenCalled();
    expect(deps.dispatchSession).toHaveBeenCalledWith({
      type: "UPDATE_CONVERSATION",
      id: conv.id,
      updates: { title: "Hi" },
    });
  });

  it("agent [native-session]: does NOT call dbAddMessage for user message", async () => {
    const conv: Conversation = {
      id: "agent:a1:graupelclaw:x", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: "native-session",
      sessionKey: "agent:a1:graupelclaw:x",
    };
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      activeConversationId: conv.id,
      conversations: [conv],
      agents: [agent("a1")],
    });
    await sendMessage("Hi", undefined, deps);
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
  });

  it("team: dispatches team message via team dispatcher + clears cascade status", async () => {
    const t = team("t1", ["a1", "a2"], "a1");
    const deps = makeDeps({
      target: { type: "team", id: "t1" },
      activeConversationId: "conv-1",
      conversations: [{
        id: "conv-1", targetType: "team", targetId: "t1", companyId: "c1",
        title: "t", createdAt: 0, updatedAt: 0,
      }],
      messages: [],
      agents: [agent("a1"), agent("a2")],
      teams: [t],
    });
    await sendMessage("Work on X", undefined, deps);
    expect(deps.dispatchChat).toHaveBeenCalledWith({
      type: "CLEAR_CASCADE_STATUS", conversationId: "conv-1",
    });
    expect(deps.dispatchTeamMessage).toHaveBeenCalled();
  });

  it("team: noops when team not found", async () => {
    const deps = makeDeps({
      target: { type: "team", id: "missing" },
      activeConversationId: "conv-1",
      conversations: [{
        id: "conv-1", targetType: "team", targetId: "missing", companyId: "c1",
        title: "t", createdAt: 0, updatedAt: 0,
      }],
      teams: [],
    });
    await sendMessage("hi", undefined, deps);
    expect(deps.dispatchTeamMessage).not.toHaveBeenCalled();
  });
});

describe("abortStreaming", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-op when no streaming exists for agentId", async () => {
    const deps = makeDeps({ target: null, streamingStates: {} });
    await abortStreaming("ghost", deps);
    expect(deps.dispatchChat).not.toHaveBeenCalled();
  });

  it("flips teamAbortedRef when streaming target is team", async () => {
    const st: StreamingState = {
      isStreaming: true, content: "", toolCalls: [], runId: null,
      targetType: "team", targetId: "t1", conversationId: "conv-1",
      sessionKey: "agent:a1:graupelclaw:team:t1:conv-1", phase: "responding",
    };
    const deps = makeDeps({
      target: { type: "team", id: "t1" },
      streamingStates: { a1: st },
    });
    await abortStreaming("a1", deps);
    expect(deps.teamAbortedRef.current.get("conv-1")).toBe(true);
  });

  it("calls client.abortChat, clears streaming, drains pending resolver", async () => {
    const st: StreamingState = {
      isStreaming: true, content: "", toolCalls: [], runId: null,
      targetType: "agent", targetId: "a1", conversationId: "conv-1",
      sessionKey: "agent:a1:graupelclaw:conv-1", phase: "responding",
    };
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      streamingStates: { a1: st },
    });
    const resolver = vi.fn();
    deps.pendingResolvers.set("a1", resolver);
    await abortStreaming("a1", deps);
    expect(deps.clientRef.current?.abortChat).toHaveBeenCalledWith(st.sessionKey);
    expect(deps.dispatchChat).toHaveBeenCalledWith({ type: "CLEAR_STREAMING", agentId: "a1" });
    expect(resolver).toHaveBeenCalled();
    expect(deps.pendingResolvers.has("a1")).toBe(false);
  });
});
