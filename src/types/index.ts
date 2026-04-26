// ── Chat Streaming ──────────────────────────────────────────────────

export type StreamingPhase = "connecting" | "thinking" | "tool-calling" | "responding";

export type ChatEventState = "delta" | "message_done" | "final" | "error" | "aborted";

export interface ChatMessageTextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "tool_call";
  id: string;
  name: string;
  arguments: string;
  status: "calling" | "completed" | "error";
  result?: string;
}

export type ChatMessageContent = ChatMessageTextContent | ToolCallContent;

export interface ChatMessage {
  role: "user" | "assistant";
  content: ChatMessageContent[];
  timestamp: number;
}

export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  state: ChatEventState;
  message: ChatMessage;
  error?: string;
  toolCalls?: ToolCallContent[];
  phase?: StreamingPhase;
}

// ── Agent Identity (from gateway) ──────────────────────────────────

export interface AgentIdentity {
  name: string;
  avatar?: string;
  emoji?: string;
}

// ── Connection Status ───────────────────────────────────────────────

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// ── Chat Target ─────────────────────────────────────────────────────

export type ChatTargetType = "agent" | "team";
export type ConversationSource = "local" | "native-session";

export interface ChatTarget {
  type: ChatTargetType;
  id: string;
  conversationId?: string;
}

// ── Runtime Types ──────────────────────────────────────────────────

export type RuntimeType = "openclaw" | "openai" | "custom";

// ── Database Models ─────────────────────────────────────────────────

export interface Company {
  id: string;
  userId?: string;
  name: string;
  logo?: string;
  description?: string;
  runtimeType: RuntimeType;
  gatewayUrl: string;
  gatewayToken: string;
  gatewayProxyUrl?: string;
  deviceToken?: string;
  model?: string;
  channels?: string;
  customHeaders?: string;
  createdAt: number;
  updatedAt: number;
}

export type AgentSpecialty = "coding" | "research" | "writing" | "design" | "product" | "general";

export interface Agent {
  id: string;
  companyId: string;
  name: string;
  avatar?: string;
  description: string;
  specialty: AgentSpecialty;
  customName?: boolean; // true = user manually renamed, skip gateway sync for name
  createdAt: number;
}

export interface AgentTeam {
  id: string;
  companyId: string;
  name: string;
  avatar?: string;
  description?: string;
  agentIds: string[];
  tlAgentId?: string | null;
  /**
   * Absolute filesystem path on the user's machine that this team uses as a
   * shared workspace. Agents read/write artifacts here via their existing
   * OpenClaw file tools. Optional — when undefined, the team has no shared
   * workspace and agents fall back to their per-agent OpenClaw workspaces.
   */
  workspaceRoot?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  targetType: ChatTargetType;
  targetId: string;
  companyId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source?: ConversationSource;
  sessionKey?: string;
}

export interface MessageAttachment {
  id: string;
  type: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  url: string;
  base64?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  targetType: ChatTargetType;
  targetId: string;
  role: "user" | "assistant";
  agentId?: string;
  content: string;
  attachments?: MessageAttachment[];
  toolCalls?: ToolCallContent[];
  createdAt: number;
}

