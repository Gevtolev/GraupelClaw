import { describe, it, expect } from "vitest";
import { chatReducer, initialChatState } from "./reducer";

describe("chatReducer", () => {
  it("initialChatState is empty", () => {
    expect(initialChatState).toEqual({
      streamingStates: {},
      lastCascadeStatus: null,
      activeTeamCascades: [],
      teamTasks: {},
      teamTaskSummary: {},
    });
  });

  it("BEGIN_TEAM_CASCADE adds the conversation; END removes it; both idempotent", () => {
    const s1 = chatReducer(initialChatState, { type: "BEGIN_TEAM_CASCADE", conversationId: "c1" });
    expect(s1.activeTeamCascades).toEqual(["c1"]);
    const s2 = chatReducer(s1, { type: "BEGIN_TEAM_CASCADE", conversationId: "c1" });
    expect(s2).toBe(s1);
    const s3 = chatReducer(s1, { type: "BEGIN_TEAM_CASCADE", conversationId: "c2" });
    expect(s3.activeTeamCascades).toEqual(["c1", "c2"]);
    const s4 = chatReducer(s3, { type: "END_TEAM_CASCADE", conversationId: "c1" });
    expect(s4.activeTeamCascades).toEqual(["c2"]);
    const s5 = chatReducer(s4, { type: "END_TEAM_CASCADE", conversationId: "missing" });
    expect(s5).toBe(s4);
  });

  it("SET_STREAMING isStreaming=true creates a fresh entry with 'connecting' phase", () => {
    const s = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1",
      targetType: "agent",
      targetId: "a1",
      conversationId: "c1",
      sessionKey: "k1",
      isStreaming: true,
    });
    expect(s.streamingStates["a1"]).toEqual({
      isStreaming: true,
      content: "",
      toolCalls: [],
      runId: null,
      targetType: "agent",
      targetId: "a1",
      conversationId: "c1",
      sessionKey: "k1",
      phase: "connecting",
    });
  });

  it("SET_STREAMING isStreaming=false removes the entry", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      sessionKey: "", isStreaming: false,
    });
    expect(s2.streamingStates["a1"]).toBeUndefined();
  });

  it("SET_STREAMING_CONTENT is a no-op if the agent has no active streaming entry", () => {
    const s = chatReducer(initialChatState, {
      type: "SET_STREAMING_CONTENT",
      agentId: "ghost", content: "abc", runId: "r1",
    });
    expect(s.streamingStates["ghost"]).toBeUndefined();
  });

  it("SET_STREAMING_CONTENT updates content/runId; derives phase 'responding' when content present", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "hello", runId: "r1",
    });
    expect(s2.streamingStates["a1"].content).toBe("hello");
    expect(s2.streamingStates["a1"].runId).toBe("r1");
    expect(s2.streamingStates["a1"].phase).toBe("responding");
  });

  it("SET_STREAMING_CONTENT derives phase 'thinking' when content empty and no explicit phase", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "", runId: null,
    });
    expect(s2.streamingStates["a1"].phase).toBe("thinking");
  });

  it("SET_STREAMING_CONTENT with explicit phase overrides derived", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "anything", runId: null, phase: "tool-calling",
    });
    expect(s2.streamingStates["a1"].phase).toBe("tool-calling");
  });

  it("SET_STREAMING_CONTENT preserves existing toolCalls when action.toolCalls is undefined", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "x", runId: "r1",
      toolCalls: [{ id: "tc1", type: "tool_call", name: "t", arguments: "{}", status: "calling" }],
    });
    const s3 = chatReducer(s2, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "y", runId: "r1",
    });
    expect(s3.streamingStates["a1"].toolCalls).toHaveLength(1);
  });

  it("CLEAR_STREAMING removes the agent entry", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, { type: "CLEAR_STREAMING", agentId: "a1" });
    expect(s2.streamingStates).toEqual({});
  });

  it("SET_CASCADE_STATUS stores status", () => {
    const s = chatReducer(initialChatState, {
      type: "SET_CASCADE_STATUS",
      status: { conversationId: "c1", reason: "max_hops", hop: 8 },
    });
    expect(s.lastCascadeStatus).toEqual({ conversationId: "c1", reason: "max_hops", hop: 8 });
  });

  it("CLEAR_CASCADE_STATUS clears only if conversationId matches", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_CASCADE_STATUS",
      status: { conversationId: "c1", reason: "abort", hop: 2 },
    });
    const s2 = chatReducer(s1, { type: "CLEAR_CASCADE_STATUS", conversationId: "other" });
    expect(s2.lastCascadeStatus?.conversationId).toBe("c1");
    const s3 = chatReducer(s1, { type: "CLEAR_CASCADE_STATUS", conversationId: "c1" });
    expect(s3.lastCascadeStatus).toBe(null);
  });
});
