# P5 — Decisions Log (minimal version)

> Spec synthesized from 2-agent brainstorm on 2026-04-26.
> Critic's "simplest alternative" (point #7) heavily adopted.

## Goal

Persist key team decisions to a markdown file the team agents can see across
sessions. Solves "decision缺位" pain point — without overengineering.

## Critic-driven simplification (the big one)

**❌ DROP CLI integration, structured TS interface, regex parser, lockfile,
ID embedding via HTML comment.**

**Adopt** the minimal flow:
1. UI button "Mark as decision" on assistant messages → POSTs to API → API
   `fs.appendFile` to `{workspaceRoot}/.team/decisions.md` (atomic on POSIX
   for small writes; no lock).
2. (No CLI command — agents already have `write_file`. They can append to
   `decisions.md` directly if they want.)
3. Prompt-assembler reads the **last N bytes** (or last N markdown sections)
   of the file as raw text and injects.
4. Decisions popover in chat header reads the same file as raw text and
   renders it as parsed markdown (no regex extraction — just a markdown
   render).

This drops ~70% of the proposer's design and still hits the user value.

## Design decisions

### D1. Storage format (markdown, append-newest-on-top)

`{workspaceRoot}/.team/decisions.md`:
```markdown
# Team Decisions

---

## [2026-04-26] Pick direction A: long-term memory product

**Decided by**: Slico (TL)
**Context**: User asked us to pick between three product directions.
**Rationale**: 9.2K star validation, our team is primary user, MVP ships in 2 weeks.
**Rejected**: direction B (too research-heavy), direction C (cost optimization, deferred).
**Affects**: All team members. Eva to start PRD; Tian on tech research.

---

## [earlier decision...]
```

- `# Team Decisions` header + a `---` divider written ONCE on first append (if file empty).
- Each entry = `## [date] title` heading + body. Newest entries inserted right
  after the `---` divider (not appended at end — newest-on-top is what the user wants).
- No HTML comment IDs (visible-text identity by `(date, title)` is enough for
  prompt injection and UI display).
- 1MB file size limit; reject creation when reached with `413` and a clear
  error. Realistic teams will not hit this.

### D2. API routes

```
POST   /api/teams/{teamId}/decisions
   body: { title, decidedBy, context?, rationale, rejected?, affects? }
   action: format markdown section, prepend after header divider, write file
   returns: 200 { ok: true }
   422 if no workspaceRoot configured
   413 if file > 1MB

GET    /api/teams/{teamId}/decisions
   returns: { content: string, sectionCount: number }
   action: read file as raw text; count `## [` occurrences for sectionCount
   404 → return { content: "", sectionCount: 0 } (lazy-create on first POST)
```

No PATCH/DELETE in v1 (per critic — "user can hand-edit"). User who wants to
fix typos opens the file directly.

### D3. Atomic write (no lockfile)

Use `fs.appendFile` for the divider header (only once). For prepending new
entries: read full file, insert new section after divider, write to tmp, rename.
Same atomic-rename pattern as P3 tasks. **No `proper-lockfile` dep**.

Concurrent writes are extremely rare (decisions logged seconds-to-minutes
apart). On the rare race, last-writer-wins; lost decisions are recoverable
because user sees them in chat history. We accept this trade for simplicity.

### D4. "Mark as decision" UX

- Trigger: hover on `role: "assistant"` message in team chats → action bar
  shows `Bookmark` icon button "Mark as decision".
- Click → modal with fields:
  - **Title** (required, no pre-fill — placeholder "Summarize the decision").
  - **Context** (optional, pre-fill: "From {agentName} in {teamName} team chat").
  - **Rationale** (required, pre-fill: first 200 chars of message, marked as editable).
  - **Rejected** (optional).
  - **Affects** (optional).
  - **Decided by** (read-only, agent name).
- Submit → POST → toast → modal dismisses.

Mobile/touch: action bar is hidden on hover but always visible on touch (the
existing pattern in chat-area).

### D5. Decisions popover in chat header

- New `<Scale>` icon button next to `<Clock>`. Visible when `target.type === "team"`.
- Click → shadcn `Popover` (align="end", `max-h-[60vh] overflow-auto w-96`).
- Content: render the GET response's `content` as markdown (using existing
  `MarkdownRenderer`). Add a "Add manual decision" link at the top
  → opens the same modal as D4 (without pre-fill).
- Empty state: "No decisions logged yet."

### D6. Prompt injection

In `prompt-assembler.ts buildTeamContext`, after the `## Active tasks` block
(P3) — i.e., **above** `## @mention protocol` per critic's #12 (decisions are
context the agent should consider before deciding to delegate):

```
## Recent decisions
{first ~600 chars of decisions.md, starting with the most recent ## section}

If a question touches a topic already decided above, honor the decision unless
the user explicitly asks to revisit it.
```

- Truncated by **bytes**, not section count — simpler. Cap at 600 chars; if
  truncated, append `\n\n*(...older decisions in {workspaceRoot}/.team/decisions.md)*`.
- If file is missing/empty: omit the section entirely.
- **NO** parsing into TS interface — just bytes injected.

Fetched **once per cascade** in `dispatchTeamMessage`, not per `dispatchOne`
(critic's #1 — avoids per-hop disk read).

### D7. Agent self-write path
Agents have `write_file`. They can append to `{workspaceRoot}/.team/decisions.md`
directly if they want, e.g., the TL deciding to log autonomously. Format:
they write the same `## [date] title\n\n**Field**: value` pattern. No tool
required, no API hop. They learn the format from the prompt-injected sample
of recent decisions (in-context learning — they imitate the format they see).

If we want stricter format adherence later, we can add a "decisions" entry
to the team-coordination skill (not for v1).

### D8. Schema + storage path
- **No new schema fields** on `AgentTeam` — workspace already has the path.
- **No new chatStore slice** — popover content fetched on open, not cached
  (decisions are infrequent reads).

### D9. Tests
- API POST: appends correctly, prepends to existing file, lazy-creates if missing,
  rejects when > 1MB, returns 422 when workspaceRoot unset.
- API GET: returns full content + section count; 404-equivalent (empty content) when missing.
- prompt-assembler: includes recent_decisions block when content present;
  omits when empty.
- Modal: form validation, pre-fill behavior, submit flow.
- Popover: renders markdown, empty state, "Add manual" link opens modal.

### D10. Out of scope (v1)
- Edit / delete decision (use file editor)
- Decision search / filter
- Cross-team decisions
- Per-decision tagging or categorization
- Decision history / amendments
- CLI integration (agents use existing `write_file`)
- Lockfile-backed concurrent write protection

## File inventory

```
src/app/api/teams/[teamId]/decisions/route.ts      // GET + POST
src/app/api/teams/[teamId]/decisions/__tests__/

src/components/team/decisions-popover.tsx           // header popover
src/components/team/mark-decision-dialog.tsx        // modal triggered from message hover

src/components/chat-area.tsx                        // header trigger button + hover button on assistant messages
src/lib/team/prompt-assembler.ts                    // <recent_decisions> injection
src/lib/team/dispatcher.ts                          // fetch decisions ONCE in dispatchTeamMessage; pass to prompt
```

Test files:
```
src/app/api/teams/[teamId]/decisions/__tests__/route.test.ts
src/components/team/__tests__/decisions-popover.test.tsx
src/components/team/__tests__/mark-decision-dialog.test.tsx
src/lib/team/prompt-assembler.test.ts                 // + recent_decisions cases
```

## Test scenarios

1. POST when no workspace set → 422.
2. POST when workspace empty → file created with header + first section.
3. POST when file has prior decisions → new section inserted after divider, before old.
4. POST when file > 1MB → 413.
5. GET when no file → empty content + count 0.
6. GET when file present → full text returned.
7. prompt-assembler: empty content → block omitted; 200-char content → full
   inclusion; 5000-char content → truncated to 600 + "older in" footer.
8. Modal validates required fields (title, rationale).
9. Popover renders markdown correctly; "Add manual" opens modal.
10. Concurrent POST simulation (last write wins, no corruption).

## Implementation order

1. [ ] API routes + tests (just `fs.appendFile` + read + truncate)
2. [ ] prompt-assembler `<recent_decisions>` block + tests
3. [ ] Dispatcher: read decisions once at cascade start; pass to assembleAgentPrompt
4. [ ] mark-decision-dialog component
5. [ ] Hover button on assistant messages → opens dialog
6. [ ] decisions-popover component + chat-area trigger button
7. [ ] Manual smoke: log a decision via UI → verify file → next agent turn
   sees decision in prompt → log via agent's write_file → file format
   maintained.
