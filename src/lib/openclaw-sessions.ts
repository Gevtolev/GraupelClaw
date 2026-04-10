import type { Conversation, Message } from "@/types";

interface NativeSessionSummary {
  key: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const asDate = Date.parse(value);
    if (Number.isFinite(asDate)) return asDate;
  }
  return null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readTextContent(value: unknown): string {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const maybeText = (part as Record<string, unknown>).text;
          if (typeof maybeText === "string") return maybeText;
          const maybeContent = (part as Record<string, unknown>).content;
          if (typeof maybeContent === "string") return maybeContent;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const directText = record.text;
    if (typeof directText === "string") return directText;
    const directContent = record.content;
    if (typeof directContent === "string") return directContent;
    if (Array.isArray(directContent)) return readTextContent(directContent);
  }

  return "";
}

function readTimestamp(record: Record<string, unknown>, fallback: number): number {
  const candidates = [
    record.updatedAt,
    record.updated_at,
    record.lastMessageAt,
    record.last_message_at,
    record.lastActivityAt,
    record.last_activity_at,
    record.createdAt,
    record.created_at,
    record.ts,
    record.timestamp,
    record.time,
  ];

  for (const candidate of candidates) {
    const parsed = readNumber(candidate);
    if (parsed !== null) return parsed;
  }

  return fallback;
}

export function parseNativeSessionConversations(
  payload: Record<string, unknown> | undefined,
  targetId: string,
  companyId: string
): Conversation[] {
  const rawSessions = asArray(payload?.sessions)
    .concat(asArray(payload?.items))
    .concat(asArray(payload?.list));

  const summaries: NativeSessionSummary[] = rawSessions
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const key =
        readString(record.key) ||
        readString(record.sessionKey) ||
        readString(record.session_key) ||
        readString(record.id);

      if (!key) return null;

      const updatedAt = readTimestamp(record, Date.now());
      const createdAt =
        readNumber(record.createdAt) ??
        readNumber(record.created_at) ??
        updatedAt;

      const title =
        readString(record.title) ||
        readString(record.name) ||
        readString(record.preview) ||
        readString(record.summary) ||
        key;

      return { key, title, createdAt, updatedAt };
    })
    .filter((entry): entry is NativeSessionSummary => !!entry)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return summaries.map((session) => ({
    id: session.key,
    targetType: "agent",
    targetId,
    companyId,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    source: "native-session",
    sessionKey: session.key,
  }));
}

export function parseNativeSessionMessages(
  payload: Record<string, unknown> | undefined,
  targetId: string,
  conversationId: string
): Message[] {
  const rawMessages = asArray(payload?.messages)
    .concat(asArray(payload?.items))
    .concat(asArray(payload?.history))
    .concat(asArray(payload?.transcript));

  const parsedMessages: Array<Message | null> = rawMessages
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const messageRecord =
        record.message && typeof record.message === "object"
          ? (record.message as Record<string, unknown>)
          : record;

      const role = readString(messageRecord.role) || readString(record.role);
      const content = readTextContent(
        messageRecord.content ?? messageRecord.text ?? record.content ?? record.text
      ).trim();

      if (!role || !content) return null;

      const normalizedRole: "user" | "assistant" = role === "user" ? "user" : "assistant";
      const createdAt = readTimestamp(messageRecord, Date.now() + index);
      const id =
        readString(messageRecord.id) ||
        readString(record.id) ||
        `${conversationId}:${index}:${createdAt}`;

      return {
        id,
        conversationId,
        targetType: "agent",
        targetId,
        role: normalizedRole,
        agentId: normalizedRole === "assistant" ? targetId : undefined,
        content,
        createdAt,
      };
    });

  return parsedMessages
    .filter((entry): entry is Message => entry !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}
