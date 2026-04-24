import type {
  ChatTargetType,
  StreamingPhase,
  ToolCallContent,
} from "@/types";

export interface StreamingState {
  isStreaming: boolean;
  content: string;
  toolCalls: ToolCallContent[];
  runId: string | null;
  targetType: ChatTargetType;
  targetId: string;
  conversationId: string;
  sessionKey: string;
  phase: StreamingPhase;
}

export interface CascadeStatus {
  conversationId: string;
  reason: "max_hops" | "loop" | "abort";
  hop: number;
}

export interface ChatSliceState {
  streamingStates: Record<string, StreamingState>;
  lastCascadeStatus: CascadeStatus | null;
}

export type ChatAction =
  | {
      type: "SET_STREAMING";
      agentId: string;
      targetType: ChatTargetType;
      targetId: string;
      conversationId?: string;
      sessionKey: string;
      isStreaming: boolean;
    }
  | {
      type: "SET_STREAMING_CONTENT";
      agentId: string;
      content: string;
      runId: string | null;
      phase?: StreamingPhase;
      toolCalls?: ToolCallContent[];
    }
  | { type: "CLEAR_STREAMING"; agentId: string }
  | { type: "SET_CASCADE_STATUS"; status: CascadeStatus }
  | { type: "CLEAR_CASCADE_STATUS"; conversationId: string };
