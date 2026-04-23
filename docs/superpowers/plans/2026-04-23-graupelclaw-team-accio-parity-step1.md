# GraupelClaw Team Accio-Parity Step 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade GraupelClaw's primitive round-robin team chat into Accio-parity multi-agent collaboration with TL role, `@[Name](id)` mention dispatch, `<group_activity>` eavesdrop injection, and cascading dispatch with 8-hop guardrails.

**Architecture:** All team orchestration lives client-side in a new `src/lib/team/` module. OpenClaw remains unchanged — every agent is still its own isolated session; the team illusion is assembled by GraupelClaw via prompt composition and dispatch routing. The existing `store.tsx` team branch is replaced with a call into the new dispatcher; existing `Conversation`/`Message` tables and SSE streaming path are reused.

**Tech Stack:** Next.js 16 + React 19 + TypeScript + Dexie/IndexedDB + Drizzle/SQLite + Vitest (new, for unit tests).

**Spec:** [2026-04-23-graupelclaw-team-accio-parity-design.md](../specs/2026-04-23-graupelclaw-team-accio-parity-design.md)

---

## File Structure

### New files

| Path | Responsibility |
|------|---------------|
| `src/lib/team/types.ts` | Shared internal types: `Mention`, `RosterEntry`, `CascadeContext`, `DispatchOpts`, `DispatchReply`, `OnCascadeStoppedReason` |
| `src/lib/team/resolve-tl.ts` | `resolveTlAgentId(team)` pure function |
| `src/lib/team/mention-parser.ts` | `parseMentions(text, validIds)` regex-based `@[Name](id)` extractor |
| `src/lib/team/loop-detector.ts` | `isRecentLoop(chain, from, to)` check last-3 of cascade chain |
| `src/lib/team/group-activity.ts` | `buildGroupActivity(messages, fromTs, toTs, nameMap)` XML block builder |
| `src/lib/team/prompt-assembler.ts` | `assembleAgentPrompt(opts)` + `buildTeamContext(team, roster, self)` |
| `src/lib/team/dispatcher.ts` | `dispatchTeamMessage(opts)` cascade engine + `dispatchOne` helper |
| `src/lib/team/index.ts` | Public re-exports |
| `src/lib/team/*.test.ts` | Per-module Vitest unit tests |
| `src/components/team/mention-autocomplete.tsx` | `@` popover component for chat-area textarea |
| `vitest.config.ts` | Vitest config |
| `docs/superpowers/manual-test-checklists/2026-04-23-team-step1.md` | Manual QA checklist |

### Modified files

| Path | Change |
|------|--------|
| `src/types/index.ts` | Add `AgentTeam.tlAgentId?: string`; add `AppState.lastCascadeStatus` |
| `src/lib/drizzle/schema.ts` | Add `tlAgentId: text("tl_agent_id")` column on `teams` |
| `src/lib/drizzle/index.ts` | Add `ALTER TABLE teams ADD COLUMN tl_agent_id TEXT` migration |
| `src/lib/db-drizzle.ts` | Map `tlAgentId` in/out in team helpers |
| `src/lib/db-indexeddb.ts` | Pass-through (IndexedDB has no strict schema, but verify helpers accept the field) |
| `src/lib/store.tsx` | Add `SET_CASCADE_STATUS` / `CLEAR_CASCADE_STATUS` reducers; change `teamAbortedRef` to `Map<conversationId, boolean>`; replace team branch in `sendMessageAction` with `dispatchTeamMessage` call |
| `src/components/dialogs/create-team-dialog.tsx` | Add TL dropdown below member checklist |
| `src/components/dialogs/team-settings-dialog.tsx` | Add crown toggle in Members section; auto-clear `tlAgentId` when current TL is unchecked |
| `src/components/chat-area.tsx` | TL crown on team chip + on assistant bubbles; hop indicator bar; cascade-stopped banner; wire MentionAutocomplete to textarea |
| `src/components/markdown-renderer.tsx` | Custom `a` node renderer: if `href` matches a current-team agentId, render as agent chip |
| `package.json` | Add Vitest deps + `test` script |

---

## Task 1: Set up Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/team/__smoke__.test.ts`
- Modify: `package.json` (scripts + devDependencies)

- [ ] **Step 1: Install Vitest**

```bash
pnpm add -D vitest @vitest/ui
```

Expected: dependency added to `package.json` under `devDependencies`. No runtime impact.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/lib/team/**/*.ts"],
    },
  },
});
```

- [ ] **Step 3: Add test scripts to `package.json`**

In the `scripts` section of `package.json`, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:ui": "vitest --ui"
```

- [ ] **Step 4: Write a smoke test to verify the framework works**

Create `src/lib/team/__smoke__.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
  it("runs and imports path alias", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `pnpm test`
Expected: `1 passed` with the smoke test; exits 0.

- [ ] **Step 6: Delete smoke test and commit**

```bash
rm src/lib/team/__smoke__.test.ts
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore(test): scaffold vitest for team module unit tests"
```

---

## Task 2: Data model — `tlAgentId` field + `resolveTlAgentId`

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/drizzle/schema.ts`
- Modify: `src/lib/drizzle/index.ts:59-63`
- Modify: `src/lib/db-drizzle.ts`
- Create: `src/lib/team/resolve-tl.ts`
- Create: `src/lib/team/resolve-tl.test.ts`

- [ ] **Step 1: Add `tlAgentId` to `AgentTeam` type**

In `src/types/index.ts`, modify the `AgentTeam` interface:

```ts
export interface AgentTeam {
  id: string;
  companyId: string;
  name: string;
  avatar?: string;
  description?: string;
  agentIds: string[];
  tlAgentId?: string;
  createdAt: number;
}
```

Also add to `AppState` (near `streamingStates`):

```ts
  lastCascadeStatus: {
    conversationId: string;
    reason: "max_hops" | "loop" | "abort";
    hop: number;
  } | null;
```

- [ ] **Step 2: Add column to Drizzle schema**

In `src/lib/drizzle/schema.ts`, modify the `teams` table:

```ts
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  description: text("description"),
  agentIds: text("agent_ids").notNull().default("[]"),
  tlAgentId: text("tl_agent_id"),
  createdAt: integer("created_at").notNull(),
});
```

- [ ] **Step 3: Add migration ALTER TABLE**

In `src/lib/drizzle/index.ts`, in the `migrations` array (around line 59-63), append:

```ts
const migrations = [
  `ALTER TABLE messages ADD COLUMN attachments TEXT`,
  `ALTER TABLE messages ADD COLUMN tool_calls TEXT`,
  `ALTER TABLE teams ADD COLUMN avatar TEXT`,
  `ALTER TABLE companies ADD COLUMN channels TEXT`,
  `ALTER TABLE teams ADD COLUMN tl_agent_id TEXT`,
];
```

- [ ] **Step 4: Map `tlAgentId` in Drizzle team helpers**

Read `src/lib/db-drizzle.ts` and locate the team helpers (`getTeamsByCompany`, `createTeam`, `updateTeam`). Ensure:

- Read paths decode `tlAgentId` from the row (if stored as `tl_agent_id`, Drizzle handles the camelCase mapping via schema — verify by running a quick test after the next step).
- Write paths include `tlAgentId` when present.
- Partial updates (`updateTeam`) pass through `tlAgentId` unchanged when not in the updates object.

If the existing pattern already spreads an object literally, no change is needed — just verify by reading. If there's an explicit field whitelist, add `tlAgentId`.

- [ ] **Step 5: Write failing test for `resolveTlAgentId`**

Create `src/lib/team/resolve-tl.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { AgentTeam } from "@/types";
import { resolveTlAgentId } from "./resolve-tl";

function makeTeam(overrides: Partial<AgentTeam>): AgentTeam {
  return {
    id: "t1",
    companyId: "c1",
    name: "dev",
    agentIds: ["a1", "a2", "a3"],
    createdAt: 0,
    ...overrides,
  };
}

describe("resolveTlAgentId", () => {
  it("returns tlAgentId when valid and present in agentIds", () => {
    expect(resolveTlAgentId(makeTeam({ tlAgentId: "a2" }))).toBe("a2");
  });

  it("falls back to agentIds[0] when tlAgentId is undefined", () => {
    expect(resolveTlAgentId(makeTeam({ tlAgentId: undefined }))).toBe("a1");
  });

  it("falls back to agentIds[0] when tlAgentId is not in agentIds", () => {
    expect(resolveTlAgentId(makeTeam({ tlAgentId: "xx" }))).toBe("a1");
  });

  it("returns empty string when agentIds is empty and no tlAgentId", () => {
    expect(resolveTlAgentId(makeTeam({ agentIds: [], tlAgentId: undefined }))).toBe(undefined as unknown as string);
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `pnpm test resolve-tl`
Expected: `FAIL` with `Cannot find module './resolve-tl'`.

- [ ] **Step 7: Implement `resolveTlAgentId`**

Create `src/lib/team/resolve-tl.ts`:

```ts
import type { AgentTeam } from "@/types";

export function resolveTlAgentId(team: AgentTeam): string {
  if (team.tlAgentId && team.agentIds.includes(team.tlAgentId)) {
    return team.tlAgentId;
  }
  return team.agentIds[0];
}
```

- [ ] **Step 8: Run test, verify pass**

Run: `pnpm test resolve-tl`
Expected: `4 passed`.

- [ ] **Step 9: Commit**

```bash
git add src/types/index.ts src/lib/drizzle/schema.ts src/lib/drizzle/index.ts src/lib/db-drizzle.ts src/lib/team/resolve-tl.ts src/lib/team/resolve-tl.test.ts
git commit -m "feat(team): add tlAgentId field + resolveTlAgentId"
```

---

## Task 3: mention-parser

**Files:**
- Create: `src/lib/team/mention-parser.ts`
- Create: `src/lib/team/mention-parser.test.ts`
- Create: `src/lib/team/types.ts` (partial — just `Mention`)

- [ ] **Step 1: Define shared types**

Create `src/lib/team/types.ts`:

```ts
export interface Mention {
  name: string;
  agentId: string;
}
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/team/mention-parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMentions } from "./mention-parser";

const valid = new Set(["a1", "a2", "a3"]);

describe("parseMentions", () => {
  it("returns empty array for text with no mentions", () => {
    expect(parseMentions("hello world", valid)).toEqual([]);
  });

  it("parses a single mention", () => {
    expect(parseMentions("hi @[Alice](a1) how are you", valid)).toEqual([
      { name: "Alice", agentId: "a1" },
    ]);
  });

  it("parses multiple mentions in one text", () => {
    expect(parseMentions("@[Alice](a1) and @[Bob](a2) please review", valid)).toEqual([
      { name: "Alice", agentId: "a1" },
      { name: "Bob", agentId: "a2" },
    ]);
  });

  it("deduplicates same agent mentioned twice", () => {
    expect(parseMentions("@[Alice](a1) and @[Alice](a1) again", valid)).toEqual([
      { name: "Alice", agentId: "a1" },
    ]);
  });

  it("drops mentions with invalid agent ids", () => {
    expect(parseMentions("@[Alice](a1) @[Ghost](ghost)", valid)).toEqual([
      { name: "Alice", agentId: "a1" },
    ]);
  });

  it("handles mentions across line breaks", () => {
    expect(parseMentions("line one\n\n@[Alice](a1)\n@[Bob](a2)", valid)).toEqual([
      { name: "Alice", agentId: "a1" },
      { name: "Bob", agentId: "a2" },
    ]);
  });

  it("does not match plain @name without markdown link syntax", () => {
    expect(parseMentions("hey @alice and @Bob", valid)).toEqual([]);
  });

  it("does not match markdown links that are not mentions", () => {
    expect(parseMentions("see [docs](https://example.com) for details", valid)).toEqual([]);
  });

  it("handles names containing spaces", () => {
    expect(parseMentions("@[Ecommerce Mind](a3) check this", valid)).toEqual([
      { name: "Ecommerce Mind", agentId: "a3" },
    ]);
  });
});
```

- [ ] **Step 3: Run test, verify fail**

Run: `pnpm test mention-parser`
Expected: `FAIL` (module not found).

- [ ] **Step 4: Implement `parseMentions`**

Create `src/lib/team/mention-parser.ts`:

```ts
import type { Mention } from "./types";

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

export function parseMentions(text: string, validAgentIds: Set<string>): Mention[] {
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
```

Note: `@[Ecommerce Mind](a3) check this` passes because `[^\]]+` matches "Ecommerce Mind". Markdown link `[docs](https://example.com)` is NOT preceded by `@`, so the leading `@` anchor excludes it.

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm test mention-parser`
Expected: `9 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/team/types.ts src/lib/team/mention-parser.ts src/lib/team/mention-parser.test.ts
git commit -m "feat(team): add @[Name](id) mention parser"
```

---

## Task 4: loop-detector

**Files:**
- Create: `src/lib/team/loop-detector.ts`
- Create: `src/lib/team/loop-detector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/team/loop-detector.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isRecentLoop } from "./loop-detector";

describe("isRecentLoop", () => {
  it("returns false when chain is empty", () => {
    expect(isRecentLoop([], "a", "b")).toBe(false);
  });

  it("returns false when the reverse pair is not in the last 3 entries", () => {
    expect(isRecentLoop(["x", "y", "z"], "a", "b")).toBe(false);
  });

  it("returns true when adjacent pair b→a exists in last 3 entries", () => {
    // chain ends with "b", "a"; now a wants to @ b → forms b→a→b
    expect(isRecentLoop(["x", "b", "a"], "a", "b")).toBe(true);
  });

  it("returns true when adjacent pair b→a is in second-to-last and third-to-last of last 3", () => {
    // last 3 = ["b", "a", "z"]; from=a, to=b; check if b→a adjacent exists → yes
    expect(isRecentLoop(["b", "a", "z"], "a", "b")).toBe(true);
  });

  it("returns false when b→a is older than last 3 entries", () => {
    // chain = [b, a, z, z, z]; last 3 = [z, z, z]; no b→a there
    expect(isRecentLoop(["b", "a", "z", "z", "z"], "a", "b")).toBe(false);
  });

  it("returns false for self-loop attempt (from===to)", () => {
    expect(isRecentLoop(["a", "a"], "a", "a")).toBe(false);
  });

  it("returns false when only from exists in chain but not adjacent to to", () => {
    expect(isRecentLoop(["a", "x", "y"], "x", "a")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm test loop-detector`
Expected: `FAIL` (module not found).

- [ ] **Step 3: Implement `isRecentLoop`**

Create `src/lib/team/loop-detector.ts`:

```ts
/**
 * True iff the `from → to` dispatch would form a recent loop.
 * Checks the last 3 entries of the activation chain for an adjacent
 * `to → from` pair — meaning we already saw `to` trigger `from`, and
 * now `from` wants to trigger `to` back.
 */
export function isRecentLoop(chain: string[], from: string, to: string): boolean {
  if (from === to) return false;
  const recent = chain.slice(-3);
  for (let i = 0; i < recent.length - 1; i++) {
    if (recent[i] === to && recent[i + 1] === from) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm test loop-detector`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team/loop-detector.ts src/lib/team/loop-detector.test.ts
git commit -m "feat(team): add recent-loop detector for cascade guardrail"
```

---

## Task 5: group-activity builder

**Files:**
- Create: `src/lib/team/group-activity.ts`
- Create: `src/lib/team/group-activity.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/team/group-activity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Message } from "@/types";
import { buildGroupActivity } from "./group-activity";

function msg(partial: Partial<Message> & Pick<Message, "id" | "createdAt" | "role" | "content">): Message {
  return {
    conversationId: "c1",
    targetType: "team",
    targetId: "t1",
    ...partial,
  } as Message;
}

const nameMap = new Map([
  ["a1", "Alice"],
  ["a2", "Bob"],
]);

describe("buildGroupActivity", () => {
  it("returns null when slice is empty", () => {
    expect(buildGroupActivity([], null, 100, nameMap)).toBeNull();
  });

  it("returns null when no messages fall in the (fromTs, toTs] window", () => {
    const msgs = [msg({ id: "1", createdAt: 50, role: "user", content: "hi" })];
    expect(buildGroupActivity(msgs, 100, 200, nameMap)).toBeNull();
  });

  it("uses the 'Recent group chat messages' header when fromTs is null", () => {
    const msgs = [msg({ id: "1", createdAt: 10, role: "user", content: "hi" })];
    const out = buildGroupActivity(msgs, null, 100, nameMap);
    expect(out).toContain("Recent group chat messages:");
    expect(out).toContain("[User (human)]: hi");
  });

  it("uses the 'Other team members said since your last response' header when fromTs is set", () => {
    const msgs = [msg({ id: "1", createdAt: 150, role: "user", content: "follow up" })];
    const out = buildGroupActivity(msgs, 100, 200, nameMap);
    expect(out).toContain("Other team members said since your last response:");
  });

  it("labels user messages and agent messages separately", () => {
    const msgs = [
      msg({ id: "1", createdAt: 10, role: "user", content: "plan it" }),
      msg({ id: "2", createdAt: 20, role: "assistant", agentId: "a1", content: "on it" }),
    ];
    const out = buildGroupActivity(msgs, null, 100, nameMap) ?? "";
    expect(out).toContain("[User (human)]: plan it");
    expect(out).toContain("[Alice (AI agent)]: on it");
  });

  it("falls back to agentId when the name map doesn't have the id", () => {
    const msgs = [
      msg({ id: "1", createdAt: 10, role: "assistant", agentId: "unknown", content: "hello" }),
    ];
    const out = buildGroupActivity(msgs, null, 100, nameMap) ?? "";
    expect(out).toContain("[unknown (AI agent)]: hello");
  });

  it("wraps output in <group_activity> tags", () => {
    const msgs = [msg({ id: "1", createdAt: 10, role: "user", content: "hi" })];
    const out = buildGroupActivity(msgs, null, 100, nameMap) ?? "";
    expect(out.startsWith("<group_activity>\n")).toBe(true);
    expect(out.endsWith("\n</group_activity>")).toBe(true);
  });

  it("filters strictly by fromTs < createdAt <= toTs", () => {
    const msgs = [
      msg({ id: "1", createdAt: 100, role: "user", content: "at-from" }),   // excluded (==fromTs)
      msg({ id: "2", createdAt: 150, role: "user", content: "middle" }),    // included
      msg({ id: "3", createdAt: 200, role: "user", content: "at-to" }),     // included
      msg({ id: "4", createdAt: 250, role: "user", content: "after" }),     // excluded
    ];
    const out = buildGroupActivity(msgs, 100, 200, nameMap) ?? "";
    expect(out).not.toContain("at-from");
    expect(out).toContain("middle");
    expect(out).toContain("at-to");
    expect(out).not.toContain("after");
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `pnpm test group-activity`
Expected: `FAIL` (module not found).

- [ ] **Step 3: Implement `buildGroupActivity`**

Create `src/lib/team/group-activity.ts`:

```ts
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
    if (m.role === "user") return `[User (human)]: ${m.content}`;
    const name = m.agentId ? (agentNameMap.get(m.agentId) ?? m.agentId) : "Assistant";
    return `[${name} (AI agent)]: ${m.content}`;
  });

  const header = fromTs !== null
    ? "Other team members said since your last response:"
    : "Recent group chat messages:";
  return `<group_activity>\n${header}\n\n${lines.join("\n\n")}\n</group_activity>`;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm test group-activity`
Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team/group-activity.ts src/lib/team/group-activity.test.ts
git commit -m "feat(team): add <group_activity> builder for eavesdrop injection"
```

---

## Task 6: prompt-assembler

**Files:**
- Modify: `src/lib/team/types.ts` (add `RosterEntry`)
- Create: `src/lib/team/prompt-assembler.ts`
- Create: `src/lib/team/prompt-assembler.test.ts`

- [ ] **Step 1: Extend types**

Append to `src/lib/team/types.ts`:

```ts
export interface RosterEntry {
  agentId: string;
  name: string;
  description?: string;
  role: "TL" | "Member";
}
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/team/prompt-assembler.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { AgentTeam } from "@/types";
import { assembleAgentPrompt } from "./prompt-assembler";
import type { RosterEntry } from "./types";

const team: AgentTeam = {
  id: "t1",
  companyId: "c1",
  name: "dev",
  agentIds: ["a1", "a2"],
  tlAgentId: "a1",
  createdAt: 0,
};

const roster: RosterEntry[] = [
  { agentId: "a1", name: "Alice", description: "team lead", role: "TL" },
  { agentId: "a2", name: "Bob", description: "coder", role: "Member" },
];

describe("assembleAgentPrompt", () => {
  it("injects TL role header when self.role is TL", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null,
      userText: "hi team",
      isDirectMention: false,
    });
    expect(out).toContain(`You are the TL (Team Leader) of "dev"`);
  });

  it("injects Member role header when self.role is Member", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "hi",
      isDirectMention: false,
    });
    expect(out).toContain(`You are a Member of "dev"`);
  });

  it("marks self in the roster with ← You", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "hi",
      isDirectMention: false,
    });
    expect(out).toContain("**Bob**");
    expect(out).toContain("← You");
  });

  it("includes the group_activity block when provided", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: "<group_activity>\nsome activity\n</group_activity>",
      userText: "",
      isDirectMention: false,
    });
    expect(out).toContain("<group_activity>\nsome activity\n</group_activity>");
  });

  it("omits group_activity block when null", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "hello",
      isDirectMention: false,
    });
    expect(out).not.toContain("<group_activity>");
  });

  it("appends 'You were mentioned' trailer when isDirectMention is false", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "",
      isDirectMention: false,
    });
    expect(out).toContain("You (Bob) were mentioned in the group conversation");
  });

  it("does NOT append the trailer when isDirectMention is true", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null,
      userText: "@[Bob](a2) do X",
      isDirectMention: true,
    });
    expect(out).not.toContain("were mentioned in the group conversation");
    expect(out).toContain("@[Bob](a2) do X");
  });

  it("includes trigger syntax for every roster member in the team context", () => {
    const out = assembleAgentPrompt({
      team,
      roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null,
      userText: "hi",
      isDirectMention: false,
    });
    expect(out).toContain("`@[Alice](a1)`");
    expect(out).toContain("`@[Bob](a2)`");
  });
});
```

- [ ] **Step 3: Run test, verify fail**

Run: `pnpm test prompt-assembler`
Expected: `FAIL` (module not found).

- [ ] **Step 4: Implement `assembleAgentPrompt` + `buildTeamContext`**

Create `src/lib/team/prompt-assembler.ts`:

```ts
import type { AgentTeam } from "@/types";
import type { RosterEntry } from "./types";

interface Self {
  agentId: string;
  name: string;
  role: "TL" | "Member";
}

export interface AssembleOpts {
  team: AgentTeam;
  roster: RosterEntry[];
  self: Self;
  groupActivity: string | null;
  userText: string;
  isDirectMention: boolean;
}

export function assembleAgentPrompt(opts: AssembleOpts): string {
  const teamContext = buildTeamContext(opts.team, opts.roster, opts.self);
  const activity = opts.groupActivity ?? "";
  const trailer = opts.isDirectMention
    ? ""
    : `\n\nYou (${opts.self.name}) were mentioned in the group conversation. Please respond to the discussion.`;
  const tail = (opts.userText + trailer).trim();

  return [teamContext, activity, tail].filter(Boolean).join("\n\n");
}

function buildTeamContext(team: AgentTeam, roster: RosterEntry[], self: Self): string {
  const rosterLines = roster
    .map(r => {
      const tag = r.role === "TL" ? " (TL)" : "";
      const youMark = r.agentId === self.agentId ? " ← You" : "";
      const desc = r.description ? ` — ${r.description}` : "";
      return `- **${r.name}**${tag}${youMark}${desc} — trigger: \`@[${r.name}](${r.agentId})\``;
    })
    .join("\n");

  const roleHeader =
    self.role === "TL"
      ? `# You are the TL (Team Leader) of "${team.name}"

**Responsibilities:**
1. Decide whether to handle the request yourself or delegate to other agents.
2. Coordinate work and consolidate results.
3. For simple questions, answer directly without delegating.`
      : `# You are a Member of "${team.name}"
The TL coordinates the team. You respond when @mentioned.`;

  return `<team_context>
${roleHeader}

## Team roster
${rosterLines}

## @mention rules
\`@[Name](agentId)\` immediately activates that agent.
- Use only when assigning a new concrete task.
- Don't @ yourself.
</team_context>`;
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `pnpm test prompt-assembler`
Expected: `8 passed`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/team/types.ts src/lib/team/prompt-assembler.ts src/lib/team/prompt-assembler.test.ts
git commit -m "feat(team): add prompt assembler with TL/Member role + roster"
```

---

## Task 7: dispatcher core

**Files:**
- Modify: `src/lib/team/types.ts` (add `CascadeContext`, `DispatchOpts`, `DispatchReply`, `OnCascadeStoppedReason`)
- Create: `src/lib/team/dispatcher.ts`
- Create: `src/lib/team/dispatcher.test.ts`
- Create: `src/lib/team/index.ts`

- [ ] **Step 1: Extend shared types**

Append to `src/lib/team/types.ts`:

```ts
import type { AgentTeam, Message, MessageAttachment, AppState } from "@/types";

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
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/team/dispatcher.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { Agent, AgentTeam, AppState, Message } from "@/types";
import { dispatchTeamMessage } from "./dispatcher";

function team(agentIds: string[], tlAgentId?: string): AgentTeam {
  return { id: "t1", companyId: "c1", name: "dev", agentIds, tlAgentId, createdAt: 0 };
}

function agent(id: string, name: string): Agent {
  return { id, companyId: "c1", name, description: "", specialty: "general", createdAt: 0 };
}

function state(agents: Agent[], teams: AgentTeam[], messages: Message[] = []): AppState {
  return {
    companies: [], agents, teams, messages, conversations: [],
    activeCompanyId: null, activeChatTarget: null, activeConversationId: null,
    connectionStatus: "connected", agentIdentities: {}, streamingStates: {},
    nativeSessionsLoading: false, nativeSessionsError: null,
    initialized: true, lastCascadeStatus: null,
  } as AppState;
}

const buildSessionKey = (agentId: string, teamId: string, cid: string) =>
  `agent:${agentId}:${teamId}:${cid}`;

describe("dispatchTeamMessage", () => {
  it("activates only the TL when user has no @mentions", async () => {
    const t = team(["a1", "a2", "a3"], "a2");
    const agents = [agent("a1", "A"), agent("a2", "B"), agent("a3", "C")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({ fromAgentId: id, content: "ok" }));

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "just a question", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(sendToAgent.mock.calls[0][0]).toBe("a2");
  });

  it("activates @mentioned agents in parallel, skipping TL when user @s someone else", async () => {
    const t = team(["a1", "a2", "a3"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B"), agent("a3", "C")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({ fromAgentId: id, content: "ok" }));

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "@[B](a2) and @[C](a3) go", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(2);
    const calledIds = sendToAgent.mock.calls.map(c => c[0]).sort();
    expect(calledIds).toEqual(["a2", "a3"]);
  });

  it("cascades: TL reply @s member → member gets dispatched at hop 2", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => {
      if (id === "a1") return { fromAgentId: "a1", content: "let @[B](a2) handle this" };
      return { fromAgentId: "a2", content: "done" };
    });

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "do X", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(2);
    expect(sendToAgent.mock.calls[0][0]).toBe("a1");
    expect(sendToAgent.mock.calls[1][0]).toBe("a2");
  });

  it("drops self-mentions in replies", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({
      fromAgentId: id,
      content: id === "a1" ? "I, @[A](a1), will handle it" : "done",
    }));

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "do X", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
  });

  it("stops at max_hops and invokes onCascadeStopped with max_hops reason", async () => {
    // Chain-forwarding cascade (a1→a2→a3→a4→a5) without any loop, so only max_hops can terminate it.
    const t = team(["a1", "a2", "a3", "a4", "a5"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B"), agent("a3", "C"), agent("a4", "D"), agent("a5", "E")];
    const s = state(agents, [t]);
    const next: Record<string, string> = { a1: "a2", a2: "a3", a3: "a4", a4: "a5", a5: "" };
    const nextName: Record<string, string> = { a1: "B", a2: "C", a3: "D", a4: "E", a5: "" };
    const sendToAgent = vi.fn(async (id: string) => {
      const targetId = next[id];
      const content = targetId ? `@[${nextName[id]}](${targetId})` : "done";
      return { fromAgentId: id, content };
    });
    const onCascadeStopped = vi.fn();

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 3, onCascadeStopped,
    });

    // 3 hops consumed (a1, a2, a3 dispatched); a4 would be hop 4 but maxHops cap stops.
    expect(sendToAgent).toHaveBeenCalledTimes(3);
    expect(onCascadeStopped).toHaveBeenCalledWith({ reason: "max_hops", hop: 3 });
  });

  it("detects recent loop and stops with loop reason", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({
      fromAgentId: id,
      content: id === "a1" ? "@[B](a2)" : "@[A](a1)",
    }));
    const onCascadeStopped = vi.fn();

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8, onCascadeStopped,
    });

    expect(onCascadeStopped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "loop" })
    );
  });

  it("respects isAborted and stops with abort reason", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    let aborted = false;
    const sendToAgent = vi.fn(async (id: string) => {
      aborted = true;
      return { fromAgentId: id, content: "@[B](a2)" };
    });
    const onCascadeStopped = vi.fn();

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => aborted, buildSessionKey, maxHops: 8, onCascadeStopped,
    });

    expect(onCascadeStopped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "abort" })
    );
  });

  it("treats sendToAgent returning null as failure and does not cascade from it", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async () => null);

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
  });

  it("falls back to TL when user @s only invalid agent ids", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({ fromAgentId: id, content: "ok" }));

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "@[Ghost](ghost) do X", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(sendToAgent.mock.calls[0][0]).toBe("a1");
  });

  it("deduplicates targets within a single hop when multiple replies @ the same agent", async () => {
    const t = team(["a1", "a2", "a3", "a4"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B"), agent("a3", "C"), agent("a4", "D")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => {
      if (id === "a1") return { fromAgentId: "a1", content: "split: @[B](a2) @[C](a3)" };
      if (id === "a2") return { fromAgentId: "a2", content: "ping @[D](a4)" };
      if (id === "a3") return { fromAgentId: "a3", content: "also ping @[D](a4)" };
      return { fromAgentId: "a4", content: "done" };
    });

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    const a4Calls = sendToAgent.mock.calls.filter(c => c[0] === "a4");
    expect(a4Calls.length).toBe(1);
  });
});
```

- [ ] **Step 3: Run test, verify fail**

Run: `pnpm test dispatcher`
Expected: `FAIL` (module not found).

- [ ] **Step 4: Implement `dispatchTeamMessage` and `dispatchOne`**

Create `src/lib/team/dispatcher.ts`:

```ts
import type { Message } from "@/types";
import { parseMentions } from "./mention-parser";
import { buildGroupActivity } from "./group-activity";
import { assembleAgentPrompt } from "./prompt-assembler";
import { resolveTlAgentId } from "./resolve-tl";
import { isRecentLoop } from "./loop-detector";
import type {
  CascadeContext,
  DispatchOpts,
  DispatchReply,
  RosterEntry,
} from "./types";

export async function dispatchTeamMessage(opts: DispatchOpts): Promise<void> {
  const maxHops = opts.maxHops ?? 8;
  const ctx: CascadeContext = {
    teamId: opts.team.id,
    conversationId: opts.conversationId,
    rootUserMessageId: opts.rootUserMessageId,
    hop: 0,
    maxHops,
    activatedChain: [],
  };

  const validIds = new Set(opts.team.agentIds);
  const tlId = resolveTlAgentId(opts.team);
  const userMentions = parseMentions(opts.userContent, validIds);

  let currentTargets = userMentions.length > 0 ? userMentions.map(m => m.agentId) : [tlId];
  let isUserHop = true;

  while (currentTargets.length > 0 && ctx.hop < ctx.maxHops) {
    if (opts.isAborted(ctx.conversationId)) {
      opts.onCascadeStopped?.({ reason: "abort", hop: ctx.hop });
      return;
    }

    const replies = await Promise.all(
      currentTargets.map(agentId =>
        dispatchOne({ agentId, ctx, opts, isUserHop }),
      ),
    );

    ctx.hop += 1;
    ctx.activatedChain.push(...currentTargets);
    isUserHop = false;

    if (opts.isAborted(ctx.conversationId)) {
      opts.onCascadeStopped?.({ reason: "abort", hop: ctx.hop });
      return;
    }

    const nextTargets: string[] = [];
    const seen = new Set<string>();
    let loopDetected = false;

    for (const reply of replies) {
      if (!reply) continue;
      const mentions = parseMentions(reply.content, validIds);
      for (const m of mentions) {
        if (m.agentId === reply.fromAgentId) continue;
        if (isRecentLoop(ctx.activatedChain, reply.fromAgentId, m.agentId)) {
          loopDetected = true;
          continue;
        }
        if (seen.has(m.agentId)) continue;
        seen.add(m.agentId);
        nextTargets.push(m.agentId);
      }
    }

    if (loopDetected) {
      opts.onCascadeStopped?.({ reason: "loop", hop: ctx.hop });
      return;
    }

    currentTargets = nextTargets;
  }

  if (ctx.hop >= ctx.maxHops && currentTargets.length > 0) {
    opts.onCascadeStopped?.({ reason: "max_hops", hop: ctx.hop });
  }
}

interface DispatchOneArgs {
  agentId: string;
  ctx: CascadeContext;
  opts: DispatchOpts;
  isUserHop: boolean;
}

async function dispatchOne(args: DispatchOneArgs): Promise<DispatchReply | null> {
  const { agentId, ctx, opts, isUserHop } = args;
  const state = opts.getState();
  const team = state.teams.find(t => t.id === opts.team.id) ?? opts.team;

  if (!team.agentIds.includes(agentId)) return null;

  const teamMessages = state.messages.filter(
    m =>
      m.targetType === "team" &&
      m.targetId === team.id &&
      m.conversationId === ctx.conversationId,
  );

  const lastSelfTs = lastSpeakTs(teamMessages, agentId);
  const triggerTs = Date.now();
  const nameMap = new Map<string, string>();
  for (const a of state.agents) nameMap.set(a.id, a.name);

  const groupActivity = buildGroupActivity(teamMessages, lastSelfTs, triggerTs, nameMap);

  const tlId = resolveTlAgentId(team);
  const selfAgent = state.agents.find(a => a.id === agentId);
  const selfName = selfAgent?.name ?? agentId;
  const self = {
    agentId,
    name: selfName,
    role: (agentId === tlId ? "TL" : "Member") as "TL" | "Member",
  };

  const roster: RosterEntry[] = team.agentIds.map(id => {
    const a = state.agents.find(x => x.id === id);
    return {
      agentId: id,
      name: a?.name ?? id,
      description: a?.description,
      role: id === tlId ? "TL" : "Member",
    };
  });

  const userMentions = parseMentions(
    isUserHop ? opts.userContent : "",
    new Set(team.agentIds),
  );
  const isDirectMention = isUserHop && userMentions.some(m => m.agentId === agentId);

  const prompt = assembleAgentPrompt({
    team,
    roster,
    self,
    groupActivity,
    userText: isUserHop ? opts.userContent : "",
    isDirectMention,
  });

  const sessionKey = opts.buildSessionKey(agentId, team.id, ctx.conversationId);
  const attachments = isUserHop ? opts.attachments : undefined;

  return opts.sendToAgent(agentId, sessionKey, prompt, attachments);
}

function lastSpeakTs(messages: Message[], agentId: string): number | null {
  let max: number | null = null;
  for (const m of messages) {
    if (m.role === "assistant" && m.agentId === agentId) {
      if (max === null || m.createdAt > max) max = m.createdAt;
    }
  }
  return max;
}
```

- [ ] **Step 5: Create index.ts**

Create `src/lib/team/index.ts`:

```ts
export { dispatchTeamMessage } from "./dispatcher";
export { resolveTlAgentId } from "./resolve-tl";
export { parseMentions } from "./mention-parser";
export type { Mention, RosterEntry, OnCascadeStoppedReason } from "./types";
```

- [ ] **Step 6: Run test, verify pass**

Run: `pnpm test dispatcher`
Expected: `10 passed`.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: all team module tests pass (38+ tests total across 6 files).

- [ ] **Step 8: Commit**

```bash
git add src/lib/team/dispatcher.ts src/lib/team/dispatcher.test.ts src/lib/team/types.ts src/lib/team/index.ts
git commit -m "feat(team): add cascade dispatcher with guardrails"
```

---

## Task 8: Store integration

**Files:**
- Modify: `src/lib/store.tsx`

- [ ] **Step 1: Add reducer action types**

In `src/lib/store.tsx`, in the `Action` union (near line 69-98), add:

```ts
  | { type: "SET_CASCADE_STATUS"; status: { conversationId: string; reason: "max_hops" | "loop" | "abort"; hop: number } }
  | { type: "CLEAR_CASCADE_STATUS"; conversationId: string }
```

- [ ] **Step 2: Initialize `lastCascadeStatus` in initialState**

In the `initialState` object (around line 102), add:

```ts
  lastCascadeStatus: null,
```

- [ ] **Step 3: Add reducer cases**

Inside the `reducer` function, add cases:

```ts
    case "SET_CASCADE_STATUS":
      return { ...state, lastCascadeStatus: action.status };

    case "CLEAR_CASCADE_STATUS":
      if (state.lastCascadeStatus?.conversationId === action.conversationId) {
        return { ...state, lastCascadeStatus: null };
      }
      return state;
```

- [ ] **Step 4: Change `teamAbortedRef` to Map**

Replace line 327:

```ts
  const teamAbortedRef = useRef<Map<string, boolean>>(new Map());
```

- [ ] **Step 5: Replace team branch in `sendMessageAction`**

In `sendMessageAction` (the team `else` branch starting around line 1064), **delete** the existing implementation from `const team = current.teams.find...` through the closing `}` of that else block, and **replace** with:

```ts
    } else {
      const team = current.teams.find((t) => t.id === target.id);
      if (!team) return;

      teamAbortedRef.current.set(conversationId, false);
      dispatch({ type: "CLEAR_CASCADE_STATUS", conversationId });

      // userMsg was already inserted at lines 1032-1045 before this branch ran.
      const userMsgId = userMsg.id;

      const STREAM_TIMEOUT = 5 * 60 * 1000;

      const sendToAgent = async (
        agentId: string,
        sessionKey: string,
        text: string,
        atts?: typeof attachments,
      ): Promise<{ fromAgentId: string; content: string } | null> => {
        dispatch({
          type: "SET_STREAMING",
          agentId,
          targetType: "team",
          targetId: target.id,
          conversationId,
          sessionKey,
          isStreaming: true,
        });
        const streamDone = Promise.race([
          new Promise<void>((resolve) => {
            pendingStreamResolvers.current.set(agentId, resolve);
          }),
          new Promise<void>((resolve) =>
            setTimeout(() => {
              pendingStreamResolvers.current.delete(agentId);
              resolve();
            }, STREAM_TIMEOUT),
          ),
        ]);
        const sinceTs = Date.now();
        try {
          await client.sendMessage(sessionKey, text, undefined, atts);
          await streamDone;
        } catch {
          dispatch({
            type: "SET_STREAMING",
            agentId,
            targetType: "team",
            targetId: target.id,
            sessionKey,
            isStreaming: false,
          });
          return null;
        }

        // Pick the reply by agentId + conversationId + timestamp > sinceTs
        // so repeat dispatches in the same cascade don't pick up stale replies.
        const latest = stateRef.current;
        const reply = [...latest.messages]
          .reverse()
          .find(
            (m) =>
              m.role === "assistant" &&
              m.agentId === agentId &&
              m.targetId === target.id &&
              m.conversationId === conversationId &&
              m.createdAt >= sinceTs,
          );
        if (!reply) return null;
        return { fromAgentId: agentId, content: reply.content };
      };

      await dispatchTeamMessage({
        team,
        conversationId,
        rootUserMessageId: userMsgId,
        userContent: content,
        attachments,
        getState: () => stateRef.current,
        sendToAgent,
        isAborted: (cid) => teamAbortedRef.current.get(cid) === true,
        onCascadeStopped: ({ reason, hop }) => {
          dispatch({
            type: "SET_CASCADE_STATUS",
            status: { conversationId, reason, hop },
          });
        },
        buildSessionKey: teamSessionKey,
        maxHops: 8,
      });
    }
```

- [ ] **Step 6: Add import for `dispatchTeamMessage`**

Near the top of `src/lib/store.tsx`, add:

```ts
import { dispatchTeamMessage } from "@/lib/team";
```

- [ ] **Step 7: Update `abortStreamingAction`**

Replace the existing `teamAbortedRef.current = true;` line (around line 1155) with:

```ts
    // Signal the team cascade owning this streaming session to stop.
    if (streaming.conversationId) {
      teamAbortedRef.current.set(streaming.conversationId, true);
    }
```

- [ ] **Step 8: Run the type check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors. If there are type errors, fix them by ensuring imports, `AppState.lastCascadeStatus`, and reducer return types line up.

- [ ] **Step 9: Run dev server and manually verify the team chat still works**

Run: `pnpm dev`

In a browser at http://localhost:3000:
1. Open an existing team (or create one with 2 agents)
2. Send a message without `@`. Expected: only TL replies.
3. Send a message `@[<MemberName>](<memberId>) hi`. Expected: only that member replies (not TL).
4. Send a message that causes no cascade. Expected: no banner.

If any manual check fails, debug via browser devtools network tab + console and fix before commit.

- [ ] **Step 10: Commit**

```bash
git add src/lib/store.tsx
git commit -m "feat(team): replace round-robin with cascade dispatcher"
```

---

## Task 9: CreateTeamDialog TL UI

**Files:**
- Modify: `src/components/dialogs/create-team-dialog.tsx`

- [ ] **Step 1: Read the current file to understand structure**

Read `src/components/dialogs/create-team-dialog.tsx`. Locate the member checklist and the `createTeam` call.

- [ ] **Step 2: Add local TL state**

In the component, add a `tlAgentId` state hook:

```tsx
const [tlAgentId, setTlAgentId] = useState<string | null>(null);
```

- [ ] **Step 3: Keep `tlAgentId` in sync when `selectedAgentIds` changes**

Add an `useEffect`:

```tsx
useEffect(() => {
  if (tlAgentId && !selectedAgentIds.includes(tlAgentId)) {
    setTlAgentId(selectedAgentIds[0] ?? null);
  } else if (!tlAgentId && selectedAgentIds.length > 0) {
    setTlAgentId(selectedAgentIds[0]);
  }
}, [selectedAgentIds, tlAgentId]);
```

- [ ] **Step 4: Render a TL `<select>` below the member checklist**

After the member checklist JSX, before the submit button, add:

```tsx
{selectedAgentIds.length > 0 && (
  <div>
    <Label>Team Leader</Label>
    <select
      value={tlAgentId ?? ""}
      onChange={(e) => setTlAgentId(e.target.value)}
      className="mt-2 block w-full rounded-md border bg-background px-3 py-2 text-sm"
    >
      {selectedAgentIds.map((id) => {
        const a = companyAgents.find((x) => x.id === id);
        return (
          <option key={id} value={id}>
            {a?.name ?? id}
          </option>
        );
      })}
    </select>
    <p className="mt-1 text-xs text-muted-foreground">
      TL coordinates the team. Non-mention user messages go to the TL first.
    </p>
  </div>
)}
```

- [ ] **Step 5: Pass `tlAgentId` to `createTeam`**

In the submit handler, change the `actions.createTeam({...})` call to include `tlAgentId: tlAgentId ?? undefined`:

```tsx
await actions.createTeam({
  companyId: /* existing */,
  name: /* existing */,
  description: /* existing */,
  agentIds: selectedAgentIds,
  tlAgentId: tlAgentId ?? undefined,
});
```

- [ ] **Step 6: Update `createTeamAction` signature in store**

In `src/lib/store.tsx`, update `createTeamAction` and its `CreateTeamOpts` typing to include `tlAgentId?: string`, and pass it through to the created team object:

```ts
const createTeamAction = useCallback(async (opts: {
  companyId: string;
  name: string;
  description?: string;
  agentIds: string[];
  tlAgentId?: string;
}) => {
  const team: AgentTeam = {
    id: uuidv4(),
    companyId: opts.companyId,
    name: opts.name,
    description: opts.description,
    agentIds: opts.agentIds,
    tlAgentId: opts.tlAgentId,
    createdAt: Date.now(),
  };
  await dbCreateTeam(team);
  dispatch({ type: "ADD_TEAM", team });
  return team;
}, []);
```

(Also update the `createTeam` type in the `Actions` type definition.)

- [ ] **Step 7: Type check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Manual verify**

Start dev server, open "Create Team" dialog. Confirm TL dropdown appears after selecting members and defaults to first.

- [ ] **Step 9: Commit**

```bash
git add src/components/dialogs/create-team-dialog.tsx src/lib/store.tsx
git commit -m "feat(team): add TL picker to CreateTeamDialog"
```

---

## Task 10: TeamSettingsDialog TL crown toggle

**Files:**
- Modify: `src/components/dialogs/team-settings-dialog.tsx`

- [ ] **Step 1: Import Crown icon and resolveTlAgentId**

At the top of the file:

```tsx
import { Crown } from "lucide-react";
import { resolveTlAgentId } from "@/lib/team";
```

- [ ] **Step 2: Compute current TL id**

Inside the component body:

```tsx
const currentTlId = resolveTlAgentId(team);
```

- [ ] **Step 3: Replace the member row button to include crown toggle**

Locate the `{companyAgents.map((agent) => { ... })}` block (around line 239). Replace the button body with:

```tsx
{companyAgents.map((agent) => {
  const selected = selectedAgentIds.includes(agent.id);
  const isTl = selected && agent.id === currentTlId;
  return (
    <div
      key={agent.id}
      className={cn(
        "flex w-full items-center gap-2 rounded-md p-2",
        selected ? "bg-primary/20" : "hover:bg-accent/50",
      )}
    >
      <button
        onClick={() => toggleAgent(agent.id)}
        className="flex flex-1 items-center gap-2 text-left"
      >
        {isEmojiAvatar(agent.avatar) ? (
          <span className="h-6 w-6 flex items-center justify-center text-sm">{agent.avatar}</span>
        ) : (
          <img
            src={agent.avatar || getAgentAvatarUrl(agent.id)}
            alt={agent.name}
            className="h-6 w-6 rounded-full bg-muted object-cover"
          />
        )}
        <span className="text-sm">{agent.name}</span>
        {isTl && (
          <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            TL
          </span>
        )}
        {selected && <Check className="ml-auto h-4 w-4 text-green-600" />}
      </button>
      {selected && (
        <button
          onClick={() => {
            if (agent.id !== team.tlAgentId) {
              actions.updateTeam(team.id, { tlAgentId: agent.id });
            }
          }}
          title={isTl ? "Current Team Leader" : "Set as Team Leader"}
          className={cn(
            "rounded p-1 transition-colors",
            isTl
              ? "text-amber-500"
              : "text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10",
          )}
        >
          <Crown className={cn("h-4 w-4", isTl && "fill-current")} />
        </button>
      )}
    </div>
  );
})}
```

- [ ] **Step 4: Auto-clear tlAgentId when current TL is unchecked**

Modify `toggleAgent`:

```tsx
function toggleAgent(id: string) {
  setSelectedAgentIds((prev) => {
    const next = prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id];
    const merged: Partial<AgentTeam> = {
      name: name.trim(),
      avatar: avatar || undefined,
      description: description.trim() || undefined,
      agentIds: next,
    };
    if (team.tlAgentId === id && !next.includes(id)) {
      merged.tlAgentId = undefined;
    }
    if (merged.name && next.length > 0) {
      actions.updateTeam(team.id, merged);
    }
    return next;
  });
}
```

- [ ] **Step 5: Type check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Manual verify**

Open a team's settings → Members. Verify:
- Current TL shows "TL" badge + filled crown
- Click crown on another member → that one becomes TL (badge moves)
- Uncheck current TL → TL falls back to first remaining member

- [ ] **Step 7: Commit**

```bash
git add src/components/dialogs/team-settings-dialog.tsx
git commit -m "feat(team): add crown toggle to set Team Leader"
```

---

## Task 11: chat-area TL crown + cascade banner + hop indicator

**Files:**
- Modify: `src/components/chat-area.tsx`

- [ ] **Step 1: Import what's needed**

At top of `src/components/chat-area.tsx`:

```tsx
import { Crown } from "lucide-react";
import { resolveTlAgentId } from "@/lib/team";
```

- [ ] **Step 2: Compute TL id for current team**

Near where `targetTeam` is computed:

```tsx
const tlAgentId = targetTeam ? resolveTlAgentId(targetTeam) : null;
```

- [ ] **Step 3: Add crown to the TL's member chip**

Find the team chip rendering (around line 401-424). In the map that renders `teamAgents.slice(0, 3).map(...)`, conditionally overlay a crown:

```tsx
{teamAgents.slice(0, 3).map((agent) => {
  const isTl = agent.id === tlAgentId;
  return (
    <div key={agent.id} className="relative" title={isTl ? "Team Leader" : agent.name}>
      {/* existing avatar rendering */}
      {isTl && (
        <Crown
          className="absolute -top-1 -right-1 h-3 w-3 text-amber-500 fill-amber-500"
          aria-label="Team Leader"
        />
      )}
    </div>
  );
})}
```

- [ ] **Step 4: Add cascade hop indicator during streaming**

Above the messages end ref in the chat area rendering, after the last message and before the input form, insert:

```tsx
{target?.type === "team" && streamingEntries.length > 0 && (
  <div className="mx-auto mb-2 max-w-3xl px-4 text-center">
    <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary"></span>
      Dispatching to {streamingEntries.map(([id]) => {
        const a = state.agents.find(x => x.id === id);
        return a?.name ?? id;
      }).join(", ")}
    </div>
  </div>
)}
```

- [ ] **Step 5: Add cascade-stopped banner**

Right below the hop indicator:

```tsx
{target?.type === "team" &&
 state.lastCascadeStatus &&
 state.lastCascadeStatus.conversationId === state.activeConversationId && (
  <div className="mx-auto mb-2 max-w-3xl px-4">
    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {cascadeBanner(state.lastCascadeStatus.reason, state.lastCascadeStatus.hop)}
    </div>
  </div>
)}
```

And at the bottom of the file (inside the module, above/below other helpers):

```tsx
function cascadeBanner(reason: "max_hops" | "loop" | "abort", hop: number): string {
  if (reason === "max_hops") return `⚠ Cascade stopped at hop ${hop} (max 8).`;
  if (reason === "loop") return `⚠ Cascade loop detected. Stopped at hop ${hop}.`;
  return `⏸ Cascade interrupted at hop ${hop}.`;
}
```

- [ ] **Step 6: Crown on TL's assistant message bubbles**

Find where team assistant message bubbles render the agent name (search for usage of `m.agentId` in the bubble rendering). Add next to the name:

```tsx
{m.agentId === tlAgentId && (
  <Crown className="inline-block h-3 w-3 text-amber-500 fill-amber-500 ml-1" />
)}
```

- [ ] **Step 7: Type check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Manual verify**

Start dev server. Open a team chat:
- TL chip has crown
- TL's messages have crown next to name
- Send a message → hop indicator appears during streaming
- After the cascade ends (or is aborted), banner appears if reason is set; sending a new message clears the banner

- [ ] **Step 9: Commit**

```bash
git add src/components/chat-area.tsx
git commit -m "feat(team): add TL crown, hop indicator, and cascade banner to chat area"
```

---

## Task 12: Markdown renderer — agent chips for `@[Name](id)`

**Files:**
- Modify: `src/components/markdown-renderer.tsx`

- [ ] **Step 1: Add an optional `teamAgentIds` prop**

Locate the `MarkdownSegment` / top-level markdown renderer export. Add a prop `teamAgentIds?: Set<string>`:

```tsx
interface MarkdownSegmentProps {
  content: string;
  teamAgentIds?: Set<string>;
}
```

And on the top-level exported component, the same. Thread the prop down.

- [ ] **Step 2: Add a custom `a` renderer**

In the `components={{...}}` object passed to `ReactMarkdown`, add:

```tsx
a({ href, children, ...props }) {
  const agentId = href ?? "";
  if (teamAgentIds?.has(agentId)) {
    const label = Array.isArray(children) ? children.join("") : String(children);
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary-foreground ring-1 ring-primary/30 mx-0.5">
        @{label.replace(/^@/, "")}
      </span>
    );
  }
  return <a href={href} target="_blank" rel="noreferrer noopener" {...props}>{children}</a>;
},
```

Notes:
- `remark-gfm` turns `@[Alice](a1)` into a link node with `href="a1"` and `children="Alice"` — that's why the match is on href being an agent id.
- For this to work the caller must pass `teamAgentIds`.

- [ ] **Step 3: Pass `teamAgentIds` from chat-area**

In `chat-area.tsx`, when rendering team messages, pass `teamAgentIds={new Set(targetTeam.agentIds)}` to the markdown renderer.

- [ ] **Step 4: Type check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Manual verify**

Send a team message where the TL replies with `@[MemberName](memberId)`. Verify the markdown renders as a pill/chip rather than a link.

- [ ] **Step 6: Commit**

```bash
git add src/components/markdown-renderer.tsx src/components/chat-area.tsx
git commit -m "feat(team): render @[Name](id) as agent chip in markdown"
```

---

## Task 13: @mention autocomplete popover

**Files:**
- Create: `src/components/team/mention-autocomplete.tsx`
- Modify: `src/components/chat-area.tsx`

- [ ] **Step 1: Create the autocomplete component**

Create `src/components/team/mention-autocomplete.tsx`:

```tsx
"use client";

import React, { useEffect, useRef } from "react";
import type { Agent } from "@/types";
import { cn } from "@/lib/utils";
import { getAgentAvatarUrl, isEmojiAvatar } from "@/lib/avatar";

export interface MentionCandidate {
  agent: Agent;
}

interface Props {
  candidates: MentionCandidate[];
  query: string;
  onSelect: (agent: Agent) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

export function MentionAutocomplete({ candidates, query, onSelect, onClose, anchorRect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const filtered = candidates.filter(c =>
    c.agent.name.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  if (!anchorRect || filtered.length === 0) return null;

  return (
    <div
      ref={ref}
      className="fixed z-50 w-64 rounded-md border bg-background shadow-md"
      style={{
        top: anchorRect.top - 8,
        left: anchorRect.left,
        transform: "translateY(-100%)",
      }}
    >
      <ul className="max-h-48 overflow-y-auto p-1">
        {filtered.map(c => (
          <li key={c.agent.id}>
            <button
              onClick={() => onSelect(c.agent)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
              )}
            >
              {isEmojiAvatar(c.agent.avatar) ? (
                <span className="h-5 w-5 flex items-center justify-center text-sm">{c.agent.avatar}</span>
              ) : (
                <img
                  src={c.agent.avatar || getAgentAvatarUrl(c.agent.id)}
                  alt={c.agent.name}
                  className="h-5 w-5 rounded-full bg-muted object-cover"
                />
              )}
              <span>{c.agent.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Wire the popover in chat-area**

In `src/components/chat-area.tsx`, near the textarea, add state and handlers:

```tsx
const [mentionQuery, setMentionQuery] = useState<string | null>(null);
const [mentionAnchor, setMentionAnchor] = useState<DOMRect | null>(null);

function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
  setInput(e.target.value);
  // Look backwards from cursor for the most recent unclosed @
  const pos = e.target.selectionStart ?? 0;
  const before = e.target.value.slice(0, pos);
  const match = before.match(/@([\w-]*)$/);
  if (match && target?.type === "team") {
    setMentionQuery(match[1]);
    const rect = e.target.getBoundingClientRect();
    setMentionAnchor(rect);
  } else {
    setMentionQuery(null);
    setMentionAnchor(null);
  }
}

function insertMention(agent: Agent) {
  const textarea = textareaRef.current;
  if (!textarea) return;
  const pos = textarea.selectionStart ?? 0;
  const before = input.slice(0, pos).replace(/@([\w-]*)$/, "");
  const after = input.slice(pos);
  const inserted = `@[${agent.name}](${agent.id}) `;
  setInput(before + inserted + after);
  setMentionQuery(null);
  setMentionAnchor(null);
  requestAnimationFrame(() => {
    const newPos = (before + inserted).length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();
  });
}
```

Replace the textarea's `onChange={...}` with `onChange={handleInputChange}`. Add the popover in the JSX near the textarea:

```tsx
{mentionQuery !== null && target?.type === "team" && (
  <MentionAutocomplete
    candidates={teamAgents.map(a => ({ agent: a }))}
    query={mentionQuery}
    onSelect={insertMention}
    onClose={() => { setMentionQuery(null); setMentionAnchor(null); }}
    anchorRect={mentionAnchor}
  />
)}
```

Import at top:

```tsx
import { MentionAutocomplete } from "@/components/team/mention-autocomplete";
import type { Agent } from "@/types";
```

- [ ] **Step 3: Type check**

Run: `pnpm tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Manual verify**

Type `@` in a team chat input. Verify the popover shows only current team members. Type more characters — candidates filter. Click a candidate → `@[Name](id)` inserted, cursor positioned after.

- [ ] **Step 5: Commit**

```bash
git add src/components/team/mention-autocomplete.tsx src/components/chat-area.tsx
git commit -m "feat(team): add @mention autocomplete popover"
```

---

## Task 14: Manual test checklist + sanity sweep

**Files:**
- Create: `docs/superpowers/manual-test-checklists/2026-04-23-team-step1.md`

- [ ] **Step 1: Create the checklist file**

Create `docs/superpowers/manual-test-checklists/2026-04-23-team-step1.md`:

```markdown
# Team Step 1 Manual Test Checklist

Run against a connected OpenClaw gateway with at least 2 agents available.

## Team CRUD + TL
- [ ] Create a new team with 3 agents. Confirm TL dropdown defaults to first checked; change to second. Save.
- [ ] Open the team's settings → Members. Confirm filled crown on the TL.
- [ ] Click crown on another member → TL changes (badge moves).
- [ ] Uncheck current TL → TL badge falls back to the first remaining.
- [ ] Delete the team. Agents unaffected.

## Routing
- [ ] In team chat, send "hello team" (no @). Expected: only TL replies; other members silent.
- [ ] Send `@[MemberB](<memberB-id>) do X`. Expected: MemberB replies; TL does not reply first.
- [ ] Send `@[MemberB](<memberB-id>) and @[MemberC](<memberC-id>) plan Y`. Expected: both reply in parallel.

## Cascade
- [ ] Ask TL a question that nudges it to delegate. Manually verify TL's reply contains `@[Member](...)` and that member then replies (hop 2).
- [ ] Send a prompt designed to loop ("you two keep @'ing each other"). Expected: cascade stops at some hop with "⚠ Cascade loop detected" banner (or max_hops banner at 8).
- [ ] Mid-cascade, click stop button. Expected: current reply completes; no further @ dispatch; "⏸ Cascade interrupted" banner.

## Eavesdrop
- [ ] After a 2-hop cascade (user → TL → Member), open the member's OpenClaw session (via gateway file browser or sessions panel). Confirm the injected user message contains `<group_activity>` with the TL's prior reply, and the team_context describes it as a Member.

## UI
- [ ] @mention autocomplete: type `@` in team input, popover appears with current team members only; filtering works; clicking inserts `@[Name](id)`.
- [ ] Markdown chip: TL's reply containing `@[Name](id)` renders as a pill/chip, not a bare link.
- [ ] TL crown: visible on TL's message bubbles and on the team header chip.
- [ ] Hop indicator: "Dispatching to ..." shows during cascade; disappears when cascade ends.

## Edge
- [ ] Send a message with `@[Ghost](invalid-id)` → the invalid @ is dropped; falls back to TL if nothing else.
- [ ] Send a message while another cascade is running on the same conversation → the old cascade is aborted; new dispatch proceeds.
- [ ] Create a second team in the same company. Ensure the two teams' cascades don't interfere (open both in two tabs, send concurrently).
```

- [ ] **Step 2: Run the checklist and fix any failures**

Go through every box. For any failure, create a follow-up fix commit tied to the specific task # that should have covered it. Re-run that task's unit tests if relevant.

- [ ] **Step 3: Final test suite run + typecheck + lint**

```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
```

Expected: all green.

- [ ] **Step 4: Commit checklist + any fixes**

```bash
git add docs/superpowers/manual-test-checklists/2026-04-23-team-step1.md
git commit -m "docs(team): add Step 1 manual QA checklist"
```

---

## Done

After Task 14 the implementation matches the [Step 1 design spec](../specs/2026-04-23-graupelclaw-team-accio-parity-design.md). Technical debt from the spec's Section 10 is carried to Step 2+.
