import type { StreamingPhase } from "@/types";
import type { ChatSliceState, ChatAction } from "./types";

export const initialChatState: ChatSliceState = {
  streamingStates: {},
  lastCascadeStatus: null,
};

export function chatReducer(
  state: ChatSliceState,
  action: ChatAction,
): ChatSliceState {
  switch (action.type) {
    case "SET_STREAMING": {
      if (action.isStreaming) {
        return {
          ...state,
          streamingStates: {
            ...state.streamingStates,
            [action.agentId]: {
              isStreaming: true,
              content: "",
              toolCalls: [],
              runId: null,
              targetType: action.targetType,
              targetId: action.targetId,
              conversationId: action.conversationId ?? "",
              sessionKey: action.sessionKey,
              phase: "connecting" as StreamingPhase,
            },
          },
        };
      }
      return {
        ...state,
        streamingStates: Object.fromEntries(
          Object.entries(state.streamingStates).filter(
            ([k]) => k !== action.agentId,
          ),
        ),
      };
    }
    case "SET_STREAMING_CONTENT": {
      const existing = state.streamingStates[action.agentId];
      if (!existing) return state;
      const phase =
        action.phase ??
        ((action.content ? "responding" : "thinking") as StreamingPhase);
      return {
        ...state,
        streamingStates: {
          ...state.streamingStates,
          [action.agentId]: {
            ...existing,
            content: action.content,
            runId: action.runId,
            phase,
            toolCalls: action.toolCalls ?? existing.toolCalls,
          },
        },
      };
    }
    case "CLEAR_STREAMING":
      return {
        ...state,
        streamingStates: Object.fromEntries(
          Object.entries(state.streamingStates).filter(
            ([k]) => k !== action.agentId,
          ),
        ),
      };
    case "SET_CASCADE_STATUS":
      return { ...state, lastCascadeStatus: action.status };
    case "CLEAR_CASCADE_STATUS":
      if (state.lastCascadeStatus?.conversationId === action.conversationId) {
        return { ...state, lastCascadeStatus: null };
      }
      return state;
    default:
      return state;
  }
}
