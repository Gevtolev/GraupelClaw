# P3 — Task System (gpw CLI + skill + tasks API + dispatcher state machine)

> Spec synthesized from a 2-agent brainstorm (proposer + critic) on 2026-04-26.
> Builds on **P2** (`AgentTeam.workspaceRoot`).

## Goal

Give every team a structured task store the agents can manipulate via a CLI
(over OpenClaw's existing `exec` tool), with prompt-injected pending tasks
(accio's Zeigarnik mechanism) so agents stay on-task.

## Scope cuts (after critic round)

- **❌ DROP implicit task creation** (auto-create task per @-mention parsed from
  reply). Critic argued: title extraction is fragile across languages, dedup
  collapses legitimate re-tasks, and explicit creation is debuggable. Phase
  back in later if the explicit-only experience feels too high-friction.
- **❌ DROP `_index.json`** for `getById`. Single-file read is O(1); unneeded
  complexity until measured.
- All other proposer ideas survive with the critic's hardenings below.

## Key design decisions

### D1. Human-readable task IDs: `TASK-001`, `TASK-002`, ...
Critic was right: UUIDs are unusable for agent-to-agent task references. We
keep a per-team counter `{workspaceRoot}/.team/tasks/_counter.json`:
```json
{ "next": 7 }
```
Incremented atomically (read-modify-write under file lock) on each create.
Format: `TASK-` + zero-padded-3-digit number. Resets only if user manually
deletes the counter.

### D2. Schema versioned task JSON
Every task includes `schemaVersion: 1`. Read path: if missing or different,
run a migration table. Cheap insurance.

### D3. Task data model
```ts
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed";
export type TaskPriority = "P0" | "P1" | "P2";
export type TaskCreator = "user" | "tl" | "agent" | "system";

export interface TeamTask {
  schemaVersion: 1;
  id: string;                     // "TASK-007"
  title: string;
  description?: string;
  assignee: string;               // agentId
  assigneeName?: string;          // denormalized snapshot at create time
  status: TaskStatus;
  priority: TaskPriority;
  dependencies: string[];         // task ids that must complete first
  createdAt: string;              // ISO 8601
  updatedAt: string;              // ISO 8601
  createdBy: TaskCreator;
  conversationId: string;
  teamId: string;
  blockedReason?: string;
  failedReason?: string;
}
```
Storage: `{workspaceRoot}/.team/tasks/{conversationId}/{taskId}.json`.
One file per task; atomic write via tmp-file + `fs.rename`.

### D4. CLI install — config-driven, no hardcoded paths
Critic was right: the shim's hardcoded `<graupelclaw-install-path>` breaks if
user moves GraupelClaw or has multiple checkouts. **Fix**:

- GraupelClaw on team activation writes:
  - `{workspaceRoot}/.team/gpw-config.json`:
    ```json
    {
      "schemaVersion": 1,
      "apiBase": "http://localhost:3057",   // actual running port, not hardcoded 3000
      "graupelclawRoot": "/abs/path/to/graupelclaw",
      "teamId": "...",
      "conversationId": "...",
      "agentNameById": { "main": "Slico", "...": "Eva" }
    }
    ```
  - `{workspaceRoot}/.team/bin/gpw` shim (executable bash):
    ```bash
    #!/usr/bin/env bash
    set -euo pipefail
    DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CONFIG="$DIR/../gpw-config.json"
    ROOT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).graupelclawRoot)")"
    exec node "$ROOT/tools/gpw/dist/index.js" "$@"
    ```
  - Read `apiBase` and `teamId` from same config inside CLI; never assume port.

- Idempotent: rewrite shim+config only when content differs (compare hash) to
  avoid race when two team activations land in the same second.

- Same shim is used across team activations; only config content changes.

### D5. Skill installation — versioned, never overwrites user-edited
Critic correctly flagged that blanket-overwriting `team-coordination/SKILL.md`
violates the spirit of "don't modify user files."

**Fix**: Frontmatter includes `x-graupelclaw-version: <n>`. On startup:
1. If skill file doesn't exist → install (write our version).
2. If exists and version is missing → log warning, do NOT overwrite (user-edited).
3. If exists and version < current → write new version.
4. If exists and version >= current → no-op.

This installs once, upgrades cleanly, and respects user customization.

### D6. Skill content (what agents see)

`~/.openclaw/workspace/skills/team-coordination/SKILL.md`:
```markdown
---
name: team-coordination
description: Coordinate tasks with team members in a GraupelClaw team. Trigger when delegating, accepting a task, updating status, or reporting blockers.
x-graupelclaw-version: 1
---

# Team Coordination

You are part of a GraupelClaw team. Use the `gpw` CLI to track work.

## Quick reference (the binary lives in your team workspace)

```bash
WS="$TEAM_WORKSPACE"   # absolute path injected via team_context

# Create a task (assigned to yourself or someone else)
$WS/.team/bin/gpw task create --title "Research user pain points" --assignee Eva [--priority P0|P1|P2] [--depends TASK-003]

# Update status (use the TASK-NNN id)
$WS/.team/bin/gpw task update TASK-007 --status completed
$WS/.team/bin/gpw task update TASK-007 --status blocked --reason "Waiting for X"

# List / get
$WS/.team/bin/gpw task list [--status pending|in_progress|blocked]
$WS/.team/bin/gpw task get TASK-007
```

## When to create a task
- Multi-step work (3+ subtasks or spans multiple turns)
- Handing a sub-task off to a teammate (create + @mention)
- Tracking your own progress on substantial work

## When NOT to create a task
- One-shot answer
- Casual chat / clarifying question

## Status discipline
- `pending` → `in_progress`: declare BEFORE you start (so the team sees it)
- `in_progress` → `completed`: declare IMMEDIATELY after done
- `in_progress` → `blocked` (always include `--reason`)
- `in_progress` → `failed` (always include `--reason`)
```

### D7. CLI ↔ API auth: localhost-only + port pinned in config
- No auth tokens. Only reachable from same machine.
- Port comes from `apiBase` in config (D4) — Next.js startup writes the actual
  bound port, never assumes 3000.
- Multiple browser tabs: last team activation wins on writing config (this is
  fine — config is per-team-workspace, not global).

### D8. Concurrent write safety
- Per-task file isolation removes most contention.
- Same-task PATCH serialized via in-memory `Map<taskId, Promise>` mutex (single
  Next.js process, OK for our deployment).
- Atomic write: `writeFile(tmp)` + `fs.rename(tmp, target)`. Same FS, atomic
  on POSIX.
- LIST endpoint: `try { JSON.parse(readFile(file)) } catch (ENOENT|SyntaxError)
  { skip with debug log }` — handles "read during atomic rename" race.
- Counter file (`_counter.json`) increments under the same mutex pattern.

### D9. Task-to-reply attribution (status flips)
**The proposer's design lacked this**: an agent can have multiple `in_progress`
tasks; reply prefix `[BLOCKED:]` doesn't say which task.

**Fix**:
- When dispatcher dispatches an agent who has tasks `in_progress` for that
  conversation, the prompt's `<active_tasks>` block includes a marker:
  `### Your current task → TASK-007 (use this id when you update status)`
- Reply prefix protocol is more strict:
  - `[BLOCKED: TASK-007 reason here]` (id required) → flip TASK-007 to blocked
  - `[FAILED: TASK-007 reason here]` (id required) → flip TASK-007 to failed
  - No prefix or no id → no implicit flip; agent must call `gpw task update`
- Empty reply → flip the agent's most-recently-dispatched in_progress task to
  `failed` with reason "empty reply".

This avoids phantom completions while keeping the status machine driven by
explicit signals.

### D10. Pending-task injection in prompt (per-agent)
Critic was right — injecting all 20 tasks to every agent wastes tokens.

**Fix**: agent-specific. In `prompt-assembler.ts`, after roster (and after the
workspace block from P2):

```
## Active tasks
### Your tasks
- TASK-007 [in_progress] Research user pain points (P0)
- TASK-009 [pending] Write PRD framework (P1, blocked by TASK-007)

### Other team activity
3 other tasks in progress across the team.
```

Cap "Your tasks" at 10. Other-team count is a one-liner. Worst case ~600
chars per agent.

If agent has 0 tasks of any status, omit `### Your tasks` entirely and just
show the team count.

If team has 0 tasks: omit the whole `## Active tasks` section.

### D11. Dispatcher integration
- New optional `onTaskEvent?: (e: TaskEvent) => void` callback on `DispatchOpts`.
- Wired in `send-message.ts sendToTeam`.
- Events emitted:
  - `dispatch_start { agentId, conversationId }` → flip the agent's most-recent
    `pending` task assigned to them to `in_progress` (if any).
  - `reply_complete { agentId, conversationId, content }` → if reply matches
    `^\s*\[BLOCKED: (TASK-\d+) (.+)\]$` or `^\s*\[FAILED: ...$`, flip that
    task. Otherwise no implicit flip (D9 — no auto-completed).
  - `reply_empty { agentId, conversationId }` → flip most recent in_progress
    of this agent to failed with reason "empty reply".

The handler implementation lives in `src/lib/store/coordinators/team-tasks.ts`
(new file), invoked from `send-message.ts`.

### D12. API routes

All under `src/app/api/teams/[teamId]/tasks/`:

```
POST    /api/teams/{teamId}/tasks
   body: { title, description?, assignee, priority?, dependencies?, conversationId, createdBy? }
   returns: { task: TeamTask }

GET     /api/teams/{teamId}/tasks?conversationId=&status=&assignee=&limit=
   returns: { tasks: TeamTask[] }   // sorted by status priority then createdAt asc

GET     /api/teams/{teamId}/tasks/{taskId}
   returns: { task: TeamTask } | 404

PATCH   /api/teams/{teamId}/tasks/{taskId}
   body: { status?, priority?, blockedReason?, failedReason?, description?, title? }
   returns: { task: TeamTask } | 404
```

`workspaceRoot` resolved server-side via shared `resolveTeamWorkspace(teamId)`
(reads from app store / DB).

### D13. Default fallback if reply has no in_progress task
If `dispatch_start` fires for an agent with no pending tasks, no task is
auto-created (we dropped implicit creation). The TL or agent must call
`gpw task create` to track this work.

## File inventory

```
tools/gpw/index.ts                        // CLI source
tools/gpw/package.json                    // bin: { "gpw": "dist/index.js" }
tools/gpw/build.config.ts                 // esbuild config
tools/gpw/__tests__/cli.test.ts           // CLI parsing/output tests

src/app/api/teams/[teamId]/tasks/route.ts             // POST + GET (list)
src/app/api/teams/[teamId]/tasks/[taskId]/route.ts    // GET + PATCH
src/app/api/teams/[teamId]/tasks/__tests__/route.test.ts

src/lib/team/team-tasks/                   // new module
  types.ts                                 // TeamTask schema + helpers
  store.ts                                 // file-system CRUD with mutex
  parser.ts                                // BLOCKED/FAILED prefix parsing
  resolver.ts                              // resolveTeamWorkspace(teamId)
  __tests__/

src/lib/store/coordinators/team-tasks.ts   // dispatcher hook adapter

src/lib/team/dispatcher.ts                 // calls onTaskEvent callback
src/lib/team/prompt-assembler.ts           // active_tasks injection (D10)

src/lib/store/agent/store.tsx              // on team activation, write
                                           // gpw-config.json + shim + skill

src/lib/openclaw-skill-installer.ts        // new — handles versioned install
                                           // of team-coordination/SKILL.md
```

## Test scenarios (must cover)

1. **Counter atomicity**: 5 concurrent task creates → ids `TASK-001..005`, no skips/dups.
2. **Atomic write**: simulate kill mid-write → next read sees old or new, not corrupt.
3. **Mutex on PATCH**: 5 concurrent PATCHes on same task → all serialized, last wins.
4. **LIST race**: file mid-rename → LIST skips it gracefully.
5. **Skill install**:
   - file missing → installs ours
   - file present without version → skip + warn
   - file present older version → upgrade
   - file present newer version → skip
6. **Reply prefix parsing**:
   - `[BLOCKED: TASK-007 reason]` → flip TASK-007 only
   - `[BLOCKED:` mid-paragraph → ignored (only first non-whitespace line)
   - empty reply → most recent in_progress → failed
7. **Per-agent prompt injection**:
   - agent with 2 tasks → "Your tasks" lists 2
   - agent with 0 tasks but team has 3 → only "3 other tasks" line
   - team with 0 tasks → section omitted entirely
8. **Port portability**: GraupelClaw on 3001 → CLI uses 3001 from config.
9. **Schema migration**: task with `schemaVersion: 0` → migrated on read to v1.

## Implementation order

1. [ ] Task data model + parser + store (no deps on UI)
2. [ ] API routes + tests
3. [ ] CLI + esbuild + tests
4. [ ] Skill installer + tests
5. [ ] On team activation: write gpw-config + shim + ensure skill installed
6. [ ] Dispatcher onTaskEvent hook + send-message wiring
7. [ ] prompt-assembler `<active_tasks>` injection
8. [ ] Manual end-to-end smoke: send a team message → agent uses CLI →
   subsequent agents see the task in their prompt → status flips work.

## Out of scope (explicitly)

- Implicit task creation from @-mentions (deferred to a later PR)
- `_index.json` global lookup (deferred until measured slow)
- Cross-conversation tasks
- Task templates
- Time tracking / due dates
- Task subtasks (`parentTaskId`)
