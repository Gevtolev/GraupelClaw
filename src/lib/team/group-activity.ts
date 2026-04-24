import type { Message } from "@/types";

export function buildGroupActivity(
  teamMessages: Message[],
  fromTs: number | null,
  toTs: number,
  agentNameMap: Map<string, string>,
): string | null {
  const slice = teamMessages.filter(m =>
    m.createdAt > (fromTs ?? -Infinity) && m.createdAt <= toTs
  );
  if (slice.length === 0) return null;

  const lines = slice.map(m => {
    const content = escapeGroupActivity(m.content);
    if (m.role === "user") return `[User (human)]: ${content}`;
    const name = m.agentId ? (agentNameMap.get(m.agentId) ?? m.agentId) : "Assistant";
    return `[${name} (AI agent)]: ${content}`;
  });

  const header = fromTs !== null
    ? "Other team members said since your last response:"
    : "Recent group chat messages:";
  return `<group_activity>\n${header}\n\n${lines.join("\n\n")}\n</group_activity>`;
}

function escapeGroupActivity(content: string): string {
  // Prevent a message body from prematurely closing the <group_activity> block.
  return content.replace(/<\/group_activity>/gi, "<\\/group_activity>");
}
