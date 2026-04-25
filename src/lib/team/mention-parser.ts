import type { Mention } from "./types";

// Structured form: `@[Display Name](agent-id)` — preferred, lossless.
const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

// Bare form: `@Name` where the @ is at a word/line boundary. We allow CJK
// letters as well as Latin letters/digits/dashes inside the name. The match
// stops at the first non-name character so the dispatcher can resolve as much
// as possible against the roster (longest-prefix wins below).
//
// The lookbehind rejects matches where `@` is part of an email or URL
// (`name@host`, `path/@scope`) and avoids double-counting the leading `@` of
// a structured `@[...](...)` mention.
const BARE_MENTION_RE = /(?<![A-Za-z0-9_@\[/.])@([\p{L}][\p{L}\p{N}._\-]*)/gu;

export function parseMentions(
  text: string,
  validAgentIds: Set<string>,
  /**
   * Optional case-insensitive lookup from agent display name to id. When
   * provided, the parser also resolves bare `@Name` references — useful when
   * a model writes `@Slico` instead of `@[Slico](main)`.
   */
  nameToId?: Map<string, string>,
): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();

  // Track byte ranges already consumed by structured mentions so the bare
  // pass doesn't double-match the `@` inside `@[Name](id)`.
  const consumed: Array<[number, number]> = [];

  for (const m of text.matchAll(MENTION_RE)) {
    const [, name, id] = m;
    consumed.push([m.index!, m.index! + m[0].length]);
    if (!validAgentIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name, agentId: id });
  }

  if (nameToId && nameToId.size > 0) {
    // Build a sorted list of candidate names (desc length) so longer names
    // win when one is a prefix of another (e.g. "NovaPro" vs "Nova").
    const candidates = [...nameToId.entries()].sort(
      ([a], [b]) => b.length - a.length,
    );

    for (const m of text.matchAll(BARE_MENTION_RE)) {
      const start = m.index!;
      const end = start + m[0].length;
      // Skip if this match overlaps a structured mention already consumed.
      if (consumed.some(([s, e]) => start >= s && start < e)) continue;
      const captured = m[1];
      // Try longest-first match against the candidate names so we don't
      // accidentally resolve "Novara" as "Nova" plus stray "ra".
      let resolved: { name: string; id: string } | null = null;
      const lc = captured.toLowerCase();
      for (const [candidateLc, id] of candidates) {
        if (lc === candidateLc) {
          // Exact match — prefer it.
          resolved = { name: captured, id };
          break;
        }
        if (lc.startsWith(candidateLc)) {
          // Prefix match: only accept if the boundary char in `captured` is a
          // separator-ish char. Since BARE_MENTION_RE captures continuous
          // name chars, a "prefix match" would only happen if the candidate
          // name itself is shorter than the captured token — meaning the
          // model glued an extra word to the mention. Reject to avoid false
          // positives like `@allowance` matching `@all`.
          continue;
        }
      }
      if (!resolved) continue;
      if (!validAgentIds.has(resolved.id)) continue;
      if (seen.has(resolved.id)) continue;
      seen.add(resolved.id);
      out.push({ name: resolved.name, agentId: resolved.id });
      consumed.push([start, end]);
    }
  }

  return out;
}
