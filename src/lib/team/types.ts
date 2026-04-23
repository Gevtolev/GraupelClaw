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

import type { AgentTeam, MessageAttachment, AppState } from "@/types";

export interface CascadeContext {
  teamId: string;
  conversationId: string;
  rootUserMessageId: string;
  hop: number;
  maxHops: number;
  activatedChain: string[];
}

export interface DispatchReply {
  fromAgentId: string;
  content: string;
}

export type OnCascadeStoppedReason = "max_hops" | "loop" | "abort";

export interface DispatchOpts {
  team: AgentTeam;
  conversationId: string;
  rootUserMessageId: string;
  userContent: string;
  attachments?: MessageAttachment[];
  maxHops?: number;
  getState: () => AppState;
  sendToAgent: (
    agentId: string,
    sessionKey: string,
    text: string,
    attachments?: MessageAttachment[],
  ) => Promise<DispatchReply | null>;
  isAborted: (conversationId: string) => boolean;
  onCascadeStopped?: (info: { reason: OnCascadeStoppedReason; hop: number }) => void;
  buildSessionKey: (agentId: string, teamId: string, conversationId: string) => string;
}
