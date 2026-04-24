import type { SessionState, SessionAction } from "./types";

export const initialSessionState: SessionState = {
  conversations: [],
  messages: [],
  activeChatTarget: null,
  activeConversationId: null,
  nativeSessionsLoading: false,
  nativeSessionsError: null,
};

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "SET_CONVERSATIONS":
      return { ...state, conversations: action.conversations };
    case "ADD_CONVERSATION":
      return {
        ...state,
        conversations: [action.conversation, ...state.conversations],
      };
    case "UPDATE_CONVERSATION":
      return {
        ...state,
        conversations: state.conversations.map(c =>
          c.id === action.id ? { ...c, ...action.updates } : c,
        ),
      };
    case "DELETE_CONVERSATION": {
      const conversations = state.conversations.filter(c => c.id !== action.id);
      if (state.activeConversationId === action.id) {
        return {
          ...state,
          conversations,
          activeConversationId: null,
          messages: [],
        };
      }
      return { ...state, conversations };
    }
    case "SET_ACTIVE_CONVERSATION":
      return { ...state, activeConversationId: action.id };
    case "SET_MESSAGES":
      return { ...state, messages: action.messages };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "SET_CHAT_TARGET":
      return { ...state, activeChatTarget: action.target };
    case "SET_NATIVE_SESSIONS_LOADING":
      return { ...state, nativeSessionsLoading: action.loading };
    case "SET_NATIVE_SESSIONS_ERROR":
      return { ...state, nativeSessionsError: action.error };
    case "RESET_SESSION_ON_COMPANY_CHANGE":
      return {
        ...state,
        conversations: [],
        messages: [],
        activeChatTarget: null,
        activeConversationId: null,
      };
    default:
      return state;
  }
}
