# P2 — Team Workspace + Visual Folder Picker

> Spec synthesized from a 2-agent brainstorm (proposer + critic) on 2026-04-26.
> Decisions noted **inline** with rationale. Out-of-scope items at the end.

## Goal

Each team gets a **local folder** on the user's machine that all team agents share.
Agents read/write artifacts (research, drafts, code, docs) via their existing
OpenClaw `read_file` / `write_file` tools using absolute paths. Path is set once
per team via UI; injected into every team agent's prompt.

## Scope (what changes)

| Area | Change |
|---|---|
| `AgentTeam` schema | + `workspaceRoot?: string` (absolute path, optional) |
| Dexie | bump to `db.version(3)` with explicit upgrade hook (set `workspaceRoot: undefined`) |
| Drizzle | `ALTER TABLE teams ADD COLUMN workspace_root TEXT NULL` |
| Next.js API | `GET /api/fs/home`, `GET /api/fs/list-dirs?path=`, `POST /api/fs/create-dir` |
| New component | `folder-picker-dialog.tsx` |
| Dialogs | `create-team-dialog.tsx` + `team-settings-dialog.tsx` get a Workspace section |
| `prompt-assembler.ts` | inject workspace path (only when set) into `<team_context>` |
| Marker file | `{workspaceRoot}/.graupelclaw-workspace.json` written on first use |

## Key design decisions (after critic round)

### D1. **Lazy creation**, not eager
- Critic's biggest win: eager `mkdir` on team-create surprises users, breaks on
  read-only volumes, and complicates slug-collision handling.
- **Decision**: workspace stays **unset** at team creation by default. The
  team-settings dialog shows "No workspace configured — Set up workspace".
  Folder is created only when user explicitly picks one (or accepts the
  default in the picker, which DOES create at that moment).
- Side benefit: eliminates the slug-collision issue entirely.

### D2. Path validation: trailing-sep prefix check + home-segment guard
- Reject prefix-attack: use `resolved === home || resolved.startsWith(home + path.sep)`,
  NOT raw `startsWith(home)`. Standalone `..` rejection is removed
  (redundant after `path.resolve()` normalizes).
- If `os.homedir()` returns `/` or has < 2 path segments, reject all requests
  with `500 — cannot determine safe home directory`.
- Reject paths under `~/.openclaw/workspace-` (per CLAUDE.md OpenClaw boundary).

### D3. Default-path suggestion: `~/Documents/GraupelClaw/teams/{slug}-{shortId}/`
- Linux/macOS users: `~/Documents/...` keeps user files visible & conventional.
- Slug = lowercase + `[^a-z0-9]+ -> -` + trim dashes; collision-free via
  `-{first8(uuid)}` suffix (always present, even on first team — uniform).
- This is the **suggestion** displayed in the picker; user can change before clicking "Use".

### D4. `list-dirs` hardening
- Cap result at 200 entries; flag `truncated: true` when reached.
- `AbortController` with 3s timeout — return `408` on slow mounts.
- `withFileTypes: true`; sort alphabetically; skip `.dot` dirs unless
  `?showHidden=true`.
- Skip known-heavy: `node_modules`, `.git`, `__pycache__` (configurable; safe defaults).

### D5. Picker UI: tree-style with breadcrumb (NOT minimalistic text+autocomplete)
- Critic argued for a text-input-with-autocomplete to ship simpler. Synthesis:
  user explicitly asked for **visual** picker — keep tree-style. But scope it
  tight: breadcrumb + dir list + new-folder inline + cancel/use buttons. No
  drag, no preview, no recent-paths history.
- Component: `src/components/folder-picker-dialog.tsx`. Props:
  ```ts
  interface FolderPickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultPath?: string;          // if undefined, picker starts at $HOME
    onSelect: (path: string) => void;
  }
  ```

### D6. Marker file `.graupelclaw-workspace.json`
- Written when workspace is first set. Contents:
  ```json
  {
    "teamId": "...", "teamName": "...",
    "createdAt": "2026-04-26T...",
    "schemaVersion": 1
  }
  ```
- Purpose:
  1. Agent can `ls` and find context if prompt-injected path scrolls out of attention.
  2. User opening folder manually understands its purpose.
  3. Future GraupelClaw startups can detect "this is OUR workspace" vs random folder.

### D7. Prompt injection (guarded)
In `prompt-assembler.ts buildTeamContext`, after roster:
```ts
const workspaceSection = team.workspaceRoot
  ? `\n\n## Team workspace
Shared folder: \`${team.workspaceRoot}\`
All team files (research, drafts, code, output) go here. Use absolute paths
when reading/writing. Do not write outside this folder unless the user explicitly
asks. The folder also contains \`.graupelclaw-workspace.json\` you can inspect
for team metadata.`
  : "";
```
**Critical**: omit entirely when undefined (existing teams pre-migration).

### D8. Settings UI: Workspace tab
- New nav item in `team-settings-dialog.tsx`: "Workspace" with `FolderOpen` icon.
- Body:
  - Path display (read-only Input, value or "(not set)")
  - "Browse..." button → opens FolderPickerDialog → on Use, calls
    `actions.updateTeam({ workspaceRoot: chosenPath })` and writes the marker
    file via a new server action.
  - "Reset to default" button (only when `workspaceRoot` is set):
    moves it back to undefined; doesn't delete folder contents.

### D9. Team-create dialog
- Add an optional Workspace row at the bottom of the dialog. Default text:
  "Configure later in Team Settings (recommended for now)".
- Provide a "Set workspace" link that opens FolderPickerDialog inline. If user
  picks one, save with team. If skipped, team is created with no workspace.

### D10. Team deletion
- On delete, show inline alert: "Workspace at `/path/...` was used by this team."
  Two options: **Keep** (default) | **Move to trash**.
- Move-to-trash uses the system trash via `trash` npm package (cross-platform).
- This is a polish item; if `trash` adds significant deps, defer to a follow-up.

## API contracts

### `GET /api/fs/home`
```
200: { home: string }
500: { error: "cannot determine safe home directory" }
```

### `GET /api/fs/list-dirs?path={absolute}&showHidden=true`
```
200: { path, dirs: { name: string; hasChildren: boolean }[]; truncated: boolean }
403: { error: "path outside user home" }
404: { error: "not found" }
408: { error: "timeout" }
```

### `POST /api/fs/create-dir`  body `{ path: string }`
```
200: { created: true, path: string }
403/404/500 with descriptive error.
```

All three: `validatePath(path)` first; reject anything not under
`os.homedir()` or under `~/.openclaw/workspace-`.

## File inventory

```
src/types/index.ts                          // + workspaceRoot field
src/lib/db.ts                               // dexie v3 upgrade
src/lib/db-drizzle.ts                       // workspace_root column
src/app/api/fs/validate.ts                  // shared path validation
src/app/api/fs/home/route.ts                // new
src/app/api/fs/list-dirs/route.ts           // new
src/app/api/fs/create-dir/route.ts          // new
src/components/folder-picker-dialog.tsx     // new
src/components/dialogs/create-team-dialog.tsx   // + workspace section
src/components/dialogs/team-settings-dialog.tsx // + Workspace tab
src/lib/team/prompt-assembler.ts            // + workspace section in team_context
src/lib/store/agent/store.tsx               // updateTeam handles workspaceRoot
```

Tests:
```
src/app/api/fs/__tests__/validate.test.ts
src/app/api/fs/__tests__/list-dirs.test.ts
src/app/api/fs/__tests__/create-dir.test.ts
src/components/__tests__/folder-picker-dialog.test.tsx
src/lib/team/prompt-assembler.test.ts       // + workspace block emit/omit cases
```

## Test scenarios (must cover)

1. `validatePath`:
   - `/home/user/foo` (in home) → ok
   - `/home/userOTHER/x` (prefix attack) → reject  ← **D2 fix verified**
   - `/etc/passwd` → reject
   - `~/.openclaw/workspace-abc` → reject
   - `os.homedir() === "/"` → reject all
2. `list-dirs`:
   - 200 normal entries → returned, sorted
   - 5000 entries → truncated to 200, flag set
   - mount hangs → 408 after 3s
   - dot-dirs hidden by default; visible with `?showHidden=true`
3. `create-dir`:
   - new path → created
   - existing path → idempotent ok (no error)
   - parent missing → recursive create
   - outside home → 403
4. `prompt-assembler`:
   - team with workspaceRoot → block present
   - team without (undefined) → block omitted (no `undefined` literal)
5. Folder picker:
   - opens at default path
   - breadcrumb segments navigate up
   - "New folder" creates + auto-selects
   - keyboard: Enter to enter dir, Backspace up, Escape close, Arrow nav

## Out of scope

- Cross-team workspace sharing
- Remote workspaces (SSH, S3)
- Cloud sync / backup
- Browse workspace contents IN GraupelClaw UI
- File watching / live preview
- Team deletion → wipe folder

## Risks captured

1. **Existing teams have no workspaceRoot** — handled via D7 guard + lazy creation D1.
2. **User edits marker file** — agents only read it; corruption is recoverable.
3. **NFS / network mount path validation** — same `path.resolve()` rules apply;
   if mount is dead at runtime, agent's circuit breaker handles it.
4. **Windows path separators** — out of scope for now (GraupelClaw targets Linux/macOS).
   `path.sep` used everywhere so future Windows support is non-breaking.

## Implementation checklist (in order)

1. [ ] Schema additions (types + dexie + drizzle migration)
2. [ ] Path validation utility + tests
3. [ ] Three fs API routes + tests
4. [ ] FolderPickerDialog component + tests
5. [ ] Wire picker into team-create dialog
6. [ ] Wire picker into team-settings dialog
7. [ ] Marker file write on workspace set
8. [ ] Prompt-assembler workspace block (guarded) + tests
9. [ ] Manual smoke: create team without workspace → no prompt change → set in
   settings → folder created → prompt now contains path → agent's next reply
   should reference / use the path naturally.
