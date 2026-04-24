import { describe, it, expect } from "vitest";
import type { Conversation, Message } from "@/types";
import { sessionReducer, initialSessionState } from "./reducer";

function conv(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id, targetType: "agent", targetId: "a1", companyId: "c1",
    title: `conv-${id}`, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}
function msg(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id, conversationId: "c-1", targetType: "agent", targetId: "a1",
    role: "user", content: "hi", createdAt: 0,
    ...overrides,
  };
}

describe("sessionReducer", () => {
  it("initialSessionState is empty", () => {
    expect(initialSessionState).toEqual({
      conversations: [],
      messages: [],
      activeChatTarget: null,
      activeConversationId: null,
      nativeSessionsLoading: false,
      nativeSessionsError: null,
    });
  });

  it("ADD_CONVERSATION prepends (newest first)", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a")],
    });
    const s2 = sessionReducer(s1, {
      type: "ADD_CONVERSATION", conversation: conv("b"),
    });
    expect(s2.conversations.map(c => c.id)).toEqual(["b", "a"]);
  });

  it("UPDATE_CONVERSATION merges updates", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a", { title: "old" })],
    });
    const s2 = sessionReducer(s1, {
      type: "UPDATE_CONVERSATION", id: "a", updates: { title: "new" },
    });
    expect(s2.conversations[0].title).toBe("new");
  });

  it("DELETE_CONVERSATION removes and clears active/messages if it was active", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a"), conv("b")],
    });
    const s2 = sessionReducer(s1, { type: "SET_ACTIVE_CONVERSATION", id: "a" });
    const s3 = sessionReducer(s2, { type: "SET_MESSAGES", messages: [msg("m1")] });
    const s4 = sessionReducer(s3, { type: "DELETE_CONVERSATION", id: "a" });
    expect(s4.conversations.map(c => c.id)).toEqual(["b"]);
    expect(s4.activeConversationId).toBe(null);
    expect(s4.messages).toEqual([]);
  });

  it("DELETE_CONVERSATION of non-active conversation leaves active untouched", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a"), conv("b")],
    });
    const s2 = sessionReducer(s1, { type: "SET_ACTIVE_CONVERSATION", id: "a" });
    const s3 = sessionReducer(s2, { type: "SET_MESSAGES", messages: [msg("m1")] });
    const s4 = sessionReducer(s3, { type: "DELETE_CONVERSATION", id: "b" });
    expect(s4.activeConversationId).toBe("a");
    expect(s4.messages.map(m => m.id)).toEqual(["m1"]);
  });

  it("ADD_MESSAGE appends", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_MESSAGES", messages: [msg("m1")],
    });
    const s2 = sessionReducer(s1, { type: "ADD_MESSAGE", message: msg("m2") });
    expect(s2.messages.map(m => m.id)).toEqual(["m1", "m2"]);
  });

  it("SET_CHAT_TARGET sets target only (doesn't touch conversations)", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a")],
    });
    const s2 = sessionReducer(s1, {
      type: "SET_CHAT_TARGET",
      target: { type: "agent", id: "a1" },
    });
    expect(s2.activeChatTarget).toEqual({ type: "agent", id: "a1" });
    expect(s2.conversations).toHaveLength(1);
  });

  it("SET_NATIVE_SESSIONS_LOADING / ERROR flip their fields", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_NATIVE_SESSIONS_LOADING", loading: true,
    });
    expect(s1.nativeSessionsLoading).toBe(true);
    const s2 = sessionReducer(s1, {
      type: "SET_NATIVE_SESSIONS_ERROR", error: "oops",
    });
    expect(s2.nativeSessionsError).toBe("oops");
  });

  it("RESET_SESSION_ON_COMPANY_CHANGE wipes target/active/messages/conversations", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a")],
    });
    const s2 = sessionReducer(s1, {
      type: "SET_CHAT_TARGET", target: { type: "agent", id: "a1" },
    });
    const s3 = sessionReducer(s2, { type: "SET_ACTIVE_CONVERSATION", id: "a" });
    const s4 = sessionReducer(s3, { type: "SET_MESSAGES", messages: [msg("m1")] });
    const s5 = sessionReducer(s4, { type: "RESET_SESSION_ON_COMPANY_CHANGE" });
    expect(s5.conversations).toEqual([]);
    expect(s5.activeChatTarget).toBe(null);
    expect(s5.activeConversationId).toBe(null);
    expect(s5.messages).toEqual([]);
  });
});
