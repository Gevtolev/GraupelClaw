import type { Agent, AgentTeam, AgentIdentity, Message, MessageAttachment } from "@/types";

export interface Mention {
  name: string;
  agentId: string;
}

export interface RosterEntry {
  agentId: string;
  name: string;
  description?: string;
  role: "TL" | "Member";
}

export interface CascadeContext {
  teamId: string;
  conversationId: string;
  rootUserMessageId: string;
  hop: number;
  maxHops: number;
  /** Directed dispatch edges accumulated across hops. Used by the loop
   * detector to flag immediate back-edges (A→B then B→A) without falsely
   * flagging parallel fan-out members as if they triggered each other. */
  activatedEdges: { from: string; to: string }[];
}

export interface DispatchReply {
  fromAgentId: string;
  content: string;
}

export type OnCascadeStoppedReason = "max_hops" | "loop" | "abort";

export type TeamTaskEvent =
  | { type: "dispatch_start"; agentId: string; conversationId: string }
  | {
      type: "reply_complete";
      agentId: string;
      conversationId: string;
      content: string;
    }
  | { type: "reply_empty"; agentId: string; conversationId: string };

export interface TeamDispatchState {
  agents: Agent[];
  teams: AgentTeam[];
  messages: Message[];
  agentIdentities: Record<string, AgentIdentity>;
}

export interface DispatchOpts {
  team: AgentTeam;
  conversationId: string;
  rootUserMessageId: string;
  userContent: string;
  attachments?: MessageAttachment[];
  maxHops?: number;
  getState: () => TeamDispatchState;
  sendToAgent: (
    agentId: string,
    sessionKey: string,
    text: string,
    attachments?: MessageAttachment[],
    systemPrompt?: string,
  ) => Promise<DispatchReply | null>;
  isAborted: (conversationId: string) => boolean;
  onCascadeStopped?: (info: { reason: OnCascadeStoppedReason; hop: number }) => void;
  buildSessionKey: (agentId: string, teamId: string, conversationId: string) => string;
  /**
   * Optional hook that fires at task-relevant moments during cascade.
   * Used by P3 to drive the team-task state machine (in_progress on
   * dispatch_start, blocked/failed/completed via reply_complete parser).
   */
  onTaskEvent?: (event: TeamTaskEvent) => void;
  /**
   * Optional task fetcher invoked once per hop before dispatching agents.
   * The result is split per-agent and injected into each agent's prompt as
   * an `<active_tasks>` block. P3.
   */
  fetchActiveTasks?: () => Promise<ActiveTaskSummary[]>;
  /**
   * Optional decisions fetcher invoked ONCE at cascade start (not per hop).
   * Decisions change rarely; fetching once amortizes the read across all
   * dispatches in a single user turn. The result is injected verbatim
   * (truncated to ~600 chars) into every agent's `<team_context>`. P5.
   */
  fetchRecentDecisions?: () => Promise<string | null>;
}

export interface ActiveTaskSummary {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "blocked" | "failed";
  priority: "P0" | "P1" | "P2";
  assignee: string;
  blockedReason?: string;
}
