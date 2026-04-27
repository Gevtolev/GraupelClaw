# P3 — 任务系统（gpw CLI + skill + tasks API + dispatcher 状态机）

> 由 2026-04-26 的双 agent brainstorm（提案者 + 评审者）综合而成。
> 在 **P2** （`AgentTeam.workspaceRoot`）的基础上构建。

## 目标

给每个 team 一个结构化的任务存储，agent 可通过 CLI（走 OpenClaw 既有的
`exec` 工具）操作；同时把待办任务通过 prompt 注入给 agent（accio 的
Zeigarnik 机制），让 agent 持续聚焦在任务上。

## 范围裁剪（评审轮过后）

- **❌ 砍掉隐式任务创建**（按回复中解析出的 @-mention 自动创建任务）。评审者指出：
  跨语言抽取标题脆弱、去重会折叠掉合法的重复指派、显式创建可调试性更高。
  如果显式创建体感太重，再考虑回滚此决策。
- **❌ 砍掉 `_index.json`**（用于 `getById`）。单文件读已是 O(1)；在没测到瓶颈
  之前不必要复杂化。
- 其它提案者的设计点全部保留，并按评审者的加固意见修正（见下）。

## 关键设计决策

### D1. 任务 ID 采用人类可读形式：`TASK-001`、`TASK-002` ……
评审者说得对：UUID 在 agent 互相引用任务时几乎无法用。改为按 team 维护一个
计数器 `{workspaceRoot}/.team/tasks/_counter.json`：
```json
{ "next": 7 }
```
每次创建时在文件锁下做原子的 read-modify-write。格式：`TASK-` + 三位零填充
数字。仅当用户手动删除计数器文件时才会重置。

### D2. 任务 JSON 带 schema 版本号
每条任务都包含 `schemaVersion: 1`。读取路径：缺失或与当前版本不一致时，走
迁移表处理。一份廉价保险。

### D3. 任务数据模型
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
存储：`{workspaceRoot}/.team/tasks/{conversationId}/{taskId}.json`。
一任务一文件；通过 tmp 文件 + `fs.rename` 原子写入。

### D4. CLI 安装：以配置驱动，不硬编码路径
评审者说得对：shim 中硬编码 `<graupelclaw-install-path>` 在用户挪 GraupelClaw
或维护多个 checkout 时会失效。**修复**：

- GraupelClaw 在 team 激活时写入：
  - `{workspaceRoot}/.team/gpw-config.json`：
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
  - `{workspaceRoot}/.team/bin/gpw` shim（可执行 bash 脚本）：
    ```bash
    #!/usr/bin/env bash
    set -euo pipefail
    DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    CONFIG="$DIR/../gpw-config.json"
    ROOT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG','utf8')).graupelclawRoot)")"
    exec node "$ROOT/tools/gpw/dist/index.js" "$@"
    ```
  - CLI 内部从同一份配置读 `apiBase` 和 `teamId`；绝不假设端口。

- 幂等：仅当内容（hash）有差异时才重写 shim 与 config，避免两次 team 激活
  落在同一秒时的竞态。

- shim 在多次 team 激活之间复用；只有 config 内容会变。

### D5. Skill 安装：带版本号、不覆盖用户已编辑的文件
评审者准确地指出，无脑覆盖 `team-coordination/SKILL.md` 违背 "不修改用户文件"
的原则。

**修复**：frontmatter 中加入 `x-graupelclaw-version: <n>`。启动时：
1. skill 文件不存在 → 安装我们的版本。
2. 文件存在但缺版本号 → 记 warning，**不**覆盖（视为用户已编辑）。
3. 文件存在但版本 < 当前 → 升级写入新版本。
4. 文件存在且版本 >= 当前 → 不动。

如此一来：首次安装、平滑升级、尊重用户定制三件事都满足。

### D6. Skill 内容（agent 看到的版本）

`~/.openclaw/workspace/skills/team-coordination/SKILL.md`：
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

### D7. CLI ↔ API 鉴权：仅 localhost + 端口由配置注入
- 不引入鉴权 token，仅本机可达即可。
- 端口来自 D4 中的 `apiBase` —— Next.js 启动时写入实际绑定的端口，不假设 3000。
- 多个浏览器标签页：最后一次 team 激活会覆盖配置（这是可接受的 —— 配置是
  per-team-workspace 的，不是全局的）。

### D8. 并发写安全
- 一任务一文件本身已经把大部分竞争消除。
- 同一任务的 PATCH 通过内存中的 `Map<taskId, Promise>` 锁串行（单 Next.js 进程，
  对当前部署形态足够）。
- 原子写：`writeFile(tmp)` + `fs.rename(tmp, target)`。同一文件系统、POSIX 下原子。
- LIST 端点：`try { JSON.parse(readFile(file)) } catch (ENOENT|SyntaxError)
  { skip with debug log }` —— 处理 "原子 rename 中途读取" 的竞态。
- 计数器文件（`_counter.json`）走同样的 mutex 模式。

### D9. 任务 ↔ 回复关联（状态翻转）
**提案者的设计缺这一点**：一个 agent 可能同时有多条 `in_progress` 任务，
回复前缀 `[BLOCKED:]` 没说是哪一条。

**修复**：
- 当 dispatcher 派发某个 agent，且其在该会话下有 `in_progress` 任务时，
  prompt 里的 `<active_tasks>` 区块加入标记：
  `### Your current task → TASK-007 (use this id when you update status)`
- 回复前缀协议更严格：
  - `[BLOCKED: TASK-007 reason here]`（必须带 id）→ 翻 TASK-007 为 blocked
  - `[FAILED: TASK-007 reason here]`（必须带 id）→ 翻 TASK-007 为 failed
  - 没前缀 / 没 id → 不做隐式翻转；agent 必须自己调 `gpw task update`
- 空回复 → 把该 agent 最近一次被派发的 in_progress 任务翻为 `failed`，原因
  填 "empty reply"。

如此既避免了幻象的 completion，又保持状态机由显式信号驱动。

### D10. Pending 任务在 prompt 中的注入（按 agent）
评审者说得对：把 20 条任务全注给每个 agent 太浪费 token。

**修复**：按 agent 定制。在 `prompt-assembler.ts` 中，roster 之后（且在 P2 的
workspace 区块之后）：

```
## Active tasks
### Your tasks
- TASK-007 [in_progress] Research user pain points (P0)
- TASK-009 [pending] Write PRD framework (P1, blocked by TASK-007)

### Other team activity
3 other tasks in progress across the team.
```

"Your tasks" 上限 10 条；其余团队任务以一行计数概括。最坏情况每 agent ~600 字符。

如果该 agent 任何状态的任务都为 0 条，整个 `### Your tasks` 子块省略，仅保留
团队计数行。

如果整个 team 没有任务：整段 `## Active tasks` 都省略。

### D11. Dispatcher 集成
- 在 `DispatchOpts` 上新增可选 `onTaskEvent?: (e: TaskEvent) => void` 回调。
- 在 `send-message.ts sendToTeam` 中接入。
- 触发的事件：
  - `dispatch_start { agentId, conversationId }` → 把该 agent 名下最近一条
    `pending` 任务（如有）翻为 `in_progress`。
  - `reply_complete { agentId, conversationId, content }` → 若回复匹配
    `^\s*\[BLOCKED: (TASK-\d+) (.+)\]$` 或 `^\s*\[FAILED: ...$`，翻该任务；
    否则不做隐式翻转（D9 —— 不自动 completed）。
  - `reply_empty { agentId, conversationId }` → 该 agent 最近一条 in_progress
    任务翻 failed，原因 "empty reply"。

handler 实现位于 `src/lib/store/coordinators/team-tasks.ts`（新文件），由
`send-message.ts` 调用。

### D12. API 路由

全部位于 `src/app/api/teams/[teamId]/tasks/`：

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

`workspaceRoot` 由共享的 `resolveTeamWorkspace(teamId)` 在服务端解析（从 app
store / DB 读）。

### D13. 没有 in_progress 任务时的兜底
若 `dispatch_start` 时该 agent 没有 pending 任务，不自动建任务（隐式创建已被砍）。
TL 或 agent 必须手动 `gpw task create` 来追踪此次工作。

## 文件清单

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

## 测试场景（必须覆盖）

1. **计数器原子性**：5 个并发 create → 得到 `TASK-001..005`，无跳号、无重复。
2. **原子写**：写到一半被 kill → 下次读到的是旧值或新值，不会损坏。
3. **PATCH mutex**：同一任务 5 个并发 PATCH → 全部串行，最后写入胜出。
4. **LIST 竞态**：rename 中途的文件 → LIST 优雅跳过。
5. **Skill 安装**：
   - 文件不存在 → 安装我们的版本
   - 文件存在但无版本号 → 跳过 + warn
   - 文件存在但版本较旧 → 升级
   - 文件存在且版本更新或相同 → 跳过
6. **回复前缀解析**：
   - `[BLOCKED: TASK-007 reason]` → 仅翻 TASK-007
   - `[BLOCKED:` 出现在段落中部 → 忽略（仅识别首个非空白行）
   - 空回复 → 该 agent 最近一条 in_progress → failed
7. **per-agent prompt 注入**：
   - agent 有 2 条任务 → "Your tasks" 列出 2 条
   - agent 任务数 0、team 总数 3 → 仅保留 "3 other tasks" 行
   - team 任务数 0 → 整段省略
8. **端口可移植性**：GraupelClaw 跑在 3001 → CLI 从配置取到 3001。
9. **schema 迁移**：`schemaVersion: 0` 的任务 → 读取时迁移到 v1。

## 实施顺序

1. [ ] 任务数据模型 + parser + store（无 UI 依赖）
2. [ ] API 路由 + 测试
3. [ ] CLI + esbuild + 测试
4. [ ] Skill 安装器 + 测试
5. [ ] team 激活时：写 gpw-config + shim + 确保 skill 已安装
6. [ ] dispatcher 的 onTaskEvent hook + send-message 接线
7. [ ] prompt-assembler `<active_tasks>` 注入
8. [ ] 手工端到端冒烟：发一条 team 消息 → agent 调 CLI → 后续 agent 在 prompt
   里看到该任务 → 状态翻转生效。

## 不在范围内（明确）

- 由 @-mention 隐式创建任务（推迟到后续 PR）
- `_index.json` 全局索引（在测出慢之前不做）
- 跨会话任务
- 任务模板
- 工时记录 / 截止日期
- 任务子任务（`parentTaskId`）
