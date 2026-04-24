import type { Conversation, Message, ChatTarget } from "@/types";

export interface SessionState {
  conversations: Conversation[];
  messages: Message[];
  activeChatTarget: ChatTarget | null;
  activeConversationId: string | null;
  nativeSessionsLoading: boolean;
  nativeSessionsError: string | null;
}

export type SessionAction =
  | { type: "SET_CONVERSATIONS"; conversations: Conversation[] }
  | { type: "ADD_CONVERSATION"; conversation: Conversation }
  | { type: "UPDATE_CONVERSATION"; id: string; updates: Partial<Conversation> }
  | { type: "DELETE_CONVERSATION"; id: string }
  | { type: "SET_ACTIVE_CONVERSATION"; id: string | null }
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "SET_CHAT_TARGET"; target: ChatTarget | null }
  | { type: "SET_NATIVE_SESSIONS_LOADING"; loading: boolean }
  | { type: "SET_NATIVE_SESSIONS_ERROR"; error: string | null }
  | { type: "RESET_SESSION_ON_COMPANY_CHANGE" };
