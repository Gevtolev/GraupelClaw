import type { Mention } from "./types";

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

export function parseMentions(
  text: string,
  validAgentIds: Set<string>
): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    const [, name, id] = m;
    if (!validAgentIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name, agentId: id });
  }
  return out;
}
