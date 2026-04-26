# P4 — Task Panel UI

> Spec synthesized from a 2-agent brainstorm (proposer + critic) on 2026-04-26.
> Builds on **P3** (task data layer + API). Critic's simplifications heavily adopted.

## Goal

A user-facing kanban panel for the active team's tasks. Mounted from the chat
header next to the conversation panel toggle.

## Critic-driven simplifications adopted

- **❌ DROP DnD** — status changes via a card dropdown menu (no library decision,
  no a11y kbd-reorder code, no agent-vs-user inconsistency).
- **❌ DROP fade-on-filter** — actually hide non-matching cards; show "N hidden"
  count badge per column.
- **❌ DROP eager mutation refetch** — patch local state with the server response
  directly. No double round-trip.
- **❌ DROP createdBy lock distinction at card level** — every card supports
  status change via dropdown (with confirm on agent-owned). The drawer's
  "Force status override" thus becomes the regular path.
- **❌ DROP polling-only model** — store tasks in chatStore (cached) so badge
  works without panel mount. Polling lives in the panel mount only when it's
  open; chatStore subscribes to a lightweight summary endpoint for the badge.

## Design decisions

### D1. Tasks live in chatStore (not a fresh slice or per-mount only)
- Add `teamTasks: Record<conversationId, TeamTask[]>` to `ChatSliceState`.
- Adds `teamTaskSummary: Record<conversationId, { blocked: number; total: number }>`
  for the badge dot (lightweight, polled by chat header even when panel closed).
- Action types: `SET_TEAM_TASKS`, `UPDATE_TEAM_TASK`, `SET_TEAM_TASK_SUMMARY`.

### D2. Polling strategy
- **Summary poll** (always running for active team conversation): every 30s,
  while tab is visible. `GET /api/teams/{id}/tasks/summary?conversationId=X`
  returns `{ blocked, total }`. Drives the badge.
- **Full poll** (only while task panel is open): every 3s, `GET .../tasks?...`
  returns full list. Pause on `document.hidden`.
- Both implemented in the chat slice's panel hook + a lightweight effect in
  `chat-area.tsx` for the summary.
- Rationale for not using SSE: existing chat SSE pipe is per-session-key, not
  per-team-task. Adding SSE for tasks doubles the gateway integration work
  without measurable user benefit at our scale (5-10 tasks per conv).

### D3. Placement & overlay

Right-side overlay panel, **same DOM pattern as ConversationPanel** (`fixed inset-0
z-50` + backdrop). On viewports `< sm` (640px), use shadcn `Sheet` instead of the
overlay (better touch UX, swipe-to-dismiss).

`openPanel: null | "conversations" | "tasks"` lifted to `chat-area.tsx` state.
Mutually exclusive (v1 limitation; documented for v2 follow-up).

### D4. Header trigger
New `<ListTodo>` button left of `<Clock>`. Renders only when `target.type === "team"`.
Red-dot badge top-right corner when `chatStore.teamTaskSummary[convId].blocked > 0`.

### D5. Panel layout

```
┌────────────────────────────────────────────────┐
│ Tasks (N)                  + New     [×]       │
├────────────────────────────────────────────────┤
│ [All] [👤Slico] [👤Eva] [👤Tian] [👤Luna]      │  ← assignee filter row
├────────────────────────────────────────────────┤
│ Pending(3)  In Progress(2)  Blocked(1)  Done(N)│  ← columns
│                                                │
│ ┌──────┐    ┌──────┐       ┌──────┐    ┌──┐  │
│ │ card │    │ card │       │ card │    │..│  │
│ └──────┘    └──────┘       └──────┘    └──┘  │
│ ┌──────┐    "12 hidden"                       │  ← per-column hidden count
│                                                │
├────────────────────────────────────────────────┤
│ ▶ Failed (2)                                   │  ← collapsible
└────────────────────────────────────────────────┘
```

### D6. Card layout (per critic's a11y feedback)

```
┌───────────────────────────────────┐
│ [P0]🚫 Title of task              │  ← priority chip + status icon + title
│ 👤 Eva                            │  ← 24px avatar + name
│ ⛓ depends on TASK-003             │  ← only when has deps
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ │  ← 2px status color (with icon as backup)
└───────────────────────────────────┘
```

Status icons (paired with color so colorblind-safe):
- pending: `Circle` (muted)
- in_progress: `Loader2` rotating (blue)
- blocked: `Ban` (red)
- completed: `CheckCircle2` (green)
- failed: `XCircle` (destructive)

24px avatar (matches header). `leading-snug` on title. `line-clamp-2`.

### D7. Status change UX
- Card has a kebab menu (`MoreHorizontal` icon button, top-right of card).
- Click → dropdown with status options. Selecting a different status:
  - For user-owned tasks: applies immediately
  - For agent-owned tasks: confirmation modal "This task is being managed by
    {agent}. Force override status to {newStatus}?"
- Optimistic update on click; rollback + toast on error.

### D8. + New task dialog
| Field | Required | Notes |
|---|---|---|
| Title | yes | 1-200 chars |
| Description | no | max 2000 |
| Assignee | yes | dropdown of team members |
| Priority | yes | radio P0/P1/P2, default P1 |
| Dependencies | no | multi-select of THIS conversation's tasks only |

On submit: optimistic insert; replace with server-returned task on response.

### D9. Detail drawer
shadcn `Sheet`, side="right", w-[380px]. Sections:
1. Header — title (inline-edit on click for user-owned; modal for agent-owned),
   priority, status badge.
2. Description — read-only markdown render; edit button to switch to textarea.
3. Assignee — avatar + name; dropdown picker (everyone gets to reassign with
   confirm).
4. Dependencies — chips; click navigates.
5. Timeline — createdAt, updatedAt, createdBy, list of status transitions
   (read from a `history?: { status, at }[]` field if we add it; otherwise
   just the timestamps).
6. Blocked / Failed reason — visible only in those states.

Edit save model: **explicit Save button** + Cmd/Ctrl+Enter (NOT auto-save on
blur — critic correctly flagged the data loss risk).

### D10. Filter (assignee pill row)
- Avatar pills, multi-select. Default: all selected.
- "All" pill toggles select-all/clear.
- Cards not matching ANY selected assignee are **hidden** (`display: none`).
- Per-column "12 hidden" link clears that column's filter contribution.

### D11. Failed bucket
Collapsible at bottom. `ChevronRight` rotates. Cards have line-through title +
opacity-60.

### D12. Empty / loading / error
- Empty: large `ListTodo` icon + heading + ghost `+ New Task` button.
- Loading: 3 skeleton cards × 4 columns.
- Error: alert icon + retry button.
- Polling error: subtle banner at panel top, auto-dismiss next success.

### D13. Real-time updates
While panel open: 3s polling. On poll response, `dispatchChat({ SET_TEAM_TASKS })`.
Components read from chatStore. Optimistic updates patch chatStore directly;
poll response replaces (server truth wins).

### D14. Accessibility
- Panel: `role="dialog"`, focus trap, Escape closes.
- Columns: `role="region"` + aria-label.
- Cards: `role="button"`, full aria-label, Enter/Space opens drawer.
- Filter pills: `role="checkbox"`, `aria-checked`.
- Status dropdown: `role="menu"`, arrow keys navigate.
- Drawer: `role="dialog"`, focus moves to title on open, restores to triggering card on close.
- Badge dot: `aria-label="N blocked tasks"` on the trigger button.

## File inventory

```
src/components/team/task-panel.tsx              // shell, columns, filter
src/components/team/task-card.tsx               // single card
src/components/team/task-card-menu.tsx          // status dropdown menu
src/components/team/task-detail-drawer.tsx      // Sheet detail view
src/components/team/task-create-dialog.tsx      // + New form
src/components/team/task-status-icon.tsx        // shared icon helper
src/components/chat-area.tsx                    // header trigger + state lift

src/lib/store/chat/types.ts                     // + teamTasks + teamTaskSummary fields + actions
src/lib/store/chat/reducer.ts                   // handle new actions
src/lib/store/coordinators/team-tasks-poll.ts   // polling logic + cleanup

src/app/api/teams/[teamId]/tasks/summary/route.ts   // GET — for badge
```

Tests:
```
src/components/team/__tests__/task-panel.test.tsx
src/components/team/__tests__/task-card.test.tsx
src/components/team/__tests__/task-card-menu.test.tsx
src/components/team/__tests__/task-detail-drawer.test.tsx
src/lib/store/chat/__tests__/team-tasks-reducer.test.ts
src/lib/store/coordinators/__tests__/team-tasks-poll.test.ts
```

## Test scenarios

1. Panel renders 4 columns + Failed bucket.
2. + New flow: optimistic card → API success → temp id replaced.
3. + New flow: optimistic card → API 500 → rollback + toast.
4. Card status dropdown: user-owned applies immediately; agent-owned → confirm modal.
5. Filter: select 1 assignee → other cards hidden, "N hidden" shown per column.
6. Failed bucket: collapsed by default; click toggles.
7. Drawer: open, edit description, click Save → PATCH; cancel → no save.
8. Cmd+Enter saves in drawer.
9. Empty state: 0 tasks → empty UI.
10. Polling: panel open → 3s interval; tab hidden → pause; tab visible → resume.
11. Badge: chatStore summary has blocked > 0 → red dot visible on trigger.
12. Mutual exclusion: open task panel → conversation panel closes.
13. Mobile (`width < 640px`): sheet replaces overlay.
14. Keyboard: Tab into panel, focus trapped, Escape closes.

## Out of scope

- DnD (deferred; status dropdown sufficient for v1)
- Per-task comments / threading
- Time tracking / due dates
- Calendar / timeline view
- Cross-conversation tasks
- Bulk operations (multi-select)
- Resizable side rail / non-mutually-exclusive panels
- Per-task history detail view (just timestamps for v1)

## Implementation order

1. [ ] chatStore additions: types + reducer + actions
2. [ ] Polling coordinator + summary endpoint
3. [ ] task-card + task-card-menu + task-status-icon
4. [ ] task-create-dialog
5. [ ] task-detail-drawer
6. [ ] task-panel (assembling all the above)
7. [ ] chat-area integration: header trigger + state lift + mutual exclusion
8. [ ] Mobile sheet variant
9. [ ] Tests
10. [ ] Manual smoke: create task via UI → see in chatStore → other tabs polling
   pick up → drawer edit → save → other tabs see updated.
