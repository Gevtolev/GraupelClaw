import type {
  ChatTargetType,
  StreamingPhase,
  ToolCallContent,
} from "@/types";
import type { TeamTask } from "@/lib/team/team-tasks/types";

export interface TeamTaskSummary {
  total: number;
  blocked: number;
  in_progress: number;
}

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
  /** Conversation ids that currently have a team cascade in flight. Set
   * around the entire dispatchTeamMessage span so the UI can show a
   * persistent "team coordinating" indicator across hop boundaries. */
  activeTeamCascades: string[];
  /**
   * Cached team tasks per conversation. Populated by the team-tasks polling
   * coordinator; UI components read from here rather than each panel mount
   * re-fetching from disk.
   */
  teamTasks: Record<string, TeamTask[]>;
  /** Lightweight per-conversation summary for the chat-header badge dot. */
  teamTaskSummary: Record<string, TeamTaskSummary>;
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
  | { type: "CLEAR_CASCADE_STATUS"; conversationId: string }
  | { type: "BEGIN_TEAM_CASCADE"; conversationId: string }
  | { type: "END_TEAM_CASCADE"; conversationId: string }
  | { type: "SET_TEAM_TASKS"; conversationId: string; tasks: TeamTask[] }
  | {
      type: "UPDATE_TEAM_TASK";
      conversationId: string;
      task: TeamTask;
    }
  | {
      type: "REMOVE_TEAM_TASK";
      conversationId: string;
      taskId: string;
    }
  | {
      type: "SET_TEAM_TASK_SUMMARY";
      conversationId: string;
      summary: TeamTaskSummary;
    };
