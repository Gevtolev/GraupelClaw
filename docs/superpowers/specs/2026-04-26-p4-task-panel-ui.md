# P4 — 任务面板 UI

> 由 2026-04-26 的双 agent brainstorm（提案者 + 评审者）综合而成。
> 在 **P3** （任务数据层 + API）的基础上构建。评审者的简化建议大量采纳。

## 目标

为当前激活 team 的任务提供一个面向用户的 kanban 面板，从聊天页头部触发，
紧邻 conversation 面板的开关。

## 评审驱动的简化（已采纳）

- **❌ 砍掉 DnD** —— 状态变更通过卡片的下拉菜单（无需选库、无需 a11y 键盘
  reorder 逻辑、无需在 agent 与 user 间区分行为）。
- **❌ 砍掉过滤时 fade** —— 不匹配的卡片直接隐藏；每列显示 "N hidden" 计数徽章。
- **❌ 砍掉 mutation 后立刻 refetch** —— 直接用服务端响应 patch 本地状态，
  避免双向往返。
- **❌ 砍掉 createdBy 在卡片层面的锁定区分** —— 所有卡片都支持下拉变更状态
  （agent 拥有的需要二次确认）。这样 detail drawer 中的 "强制覆盖状态" 就
  不再是特殊路径，而成了常规路径。
- **❌ 砍掉纯轮询模型** —— 把 tasks 缓存进 chatStore，让 badge 在面板未挂载
  时也能工作。轮询只在面板挂载期间运行；chatStore 通过一个轻量 summary 接口
  驱动 badge。

## 设计决策

### D1. tasks 落在 chatStore（不开新 slice、也不只在面板挂载时存在）
- `ChatSliceState` 增加 `teamTasks: Record<conversationId, TeamTask[]>`。
- 增加 `teamTaskSummary: Record<conversationId, { blocked: number; total: number }>`，
  专供 badge 红点使用（轻量，即使面板关闭也由聊天页头部轮询）。
- Action types：`SET_TEAM_TASKS`、`UPDATE_TEAM_TASK`、`SET_TEAM_TASK_SUMMARY`。

### D2. 轮询策略
- **summary 轮询**（当前激活 team 会话期间始终运行）：tab 可见时每 30s 拉一次
  `GET /api/teams/{id}/tasks/summary?conversationId=X`，返回 `{ blocked, total }`。
  驱动 badge。
- **完整轮询**（仅在任务面板打开时运行）：每 3s 拉 `GET .../tasks?...` 返回
  完整列表。`document.hidden` 时暂停。
- 二者分别由 chat slice 中 panel 的 hook + `chat-area.tsx` 中一个轻量 effect
  实现。
- 不走 SSE 的理由：现有聊天 SSE 通道是 per-session-key 的，而非 per-team-task。
  在我们这个量级（每会话 5–10 个任务）上为任务再加一条 SSE 通道，会让网关
  集成工作翻倍，但用户感知收益有限。

### D3. 位置与遮罩

右侧悬浮面板，**与 ConversationPanel 同一种 DOM 模式**（`fixed inset-0
z-50` + 背景遮罩）。在 `< sm`（640px）视口下改用 shadcn `Sheet`（更好的触屏
体感、支持滑动关闭）。

`openPanel: null | "conversations" | "tasks"` 这个状态提升到 `chat-area.tsx`，
两个面板互斥（v1 限制；v2 follow-up 时再讨论是否解除）。

### D4. 头部触发按钮
新增 `<ListTodo>` 按钮，位于 `<Clock>` 左侧。仅当 `target.type === "team"` 时
渲染。当 `chatStore.teamTaskSummary[convId].blocked > 0` 时，按钮右上角显示
红点 badge。

### D5. 面板布局

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

### D6. 卡片布局（结合评审者的 a11y 反馈）

```
┌───────────────────────────────────┐
│ [P0]🚫 Title of task              │  ← priority chip + status icon + title
│ 👤 Eva                            │  ← 24px avatar + name
│ ⛓ depends on TASK-003             │  ← only when has deps
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ │  ← 2px status color (with icon as backup)
└───────────────────────────────────┘
```

状态图标（与颜色配对，色盲友好）：
- pending：`Circle`（muted）
- in_progress：`Loader2` 旋转（蓝）
- blocked：`Ban`（红）
- completed：`CheckCircle2`（绿）
- failed：`XCircle`（destructive）

24px 头像（与头部一致）。标题 `leading-snug` + `line-clamp-2`。

### D7. 状态变更交互
- 卡片右上角有 kebab 菜单（`MoreHorizontal` 图标按钮）。
- 点击 → 弹出状态选项下拉。选择新状态后：
  - user 拥有的任务：立即应用。
  - agent 拥有的任务：弹出确认弹窗 "This task is being managed by
    {agent}. Force override status to {newStatus}?"。
- 点击即乐观更新；失败时回滚 + toast。

### D8. + New 任务弹窗
| 字段 | 必填 | 说明 |
|---|---|---|
| Title | yes | 1–200 字符 |
| Description | no | 上限 2000 |
| Assignee | yes | team 成员下拉 |
| Priority | yes | radio P0/P1/P2，默认 P1 |
| Dependencies | no | **本会话**已有任务的多选 |

提交时：乐观插入；服务端响应回来后用真实任务替换。

### D9. 详情抽屉
shadcn `Sheet`，`side="right"`，`w-[380px]`。分块：
1. 头部 —— 标题（user 拥有时点击行内编辑；agent 拥有时弹出 modal）、优先级、
   状态徽章。
2. Description —— 只读 markdown 渲染；编辑按钮切换为 textarea。
3. Assignee —— 头像 + 名称；下拉选择器（任何人都可改派，需确认）。
4. Dependencies —— chips，点击跳转。
5. Timeline —— createdAt、updatedAt、createdBy、状态变迁列表（如果之后加
   `history?: { status, at }[]` 字段就读它，否则只显示时间戳）。
6. Blocked / Failed 原因 —— 仅在对应状态下可见。

编辑保存策略：**显式 Save 按钮** + Cmd/Ctrl+Enter（**不**走失焦自动保存——
评审者准确指出会有数据丢失风险）。

### D10. 过滤（assignee 头像 pill 行）
- 头像 pill，多选；默认全选。
- "All" pill 等价于全选 / 全清。
- 不命中任意已选 assignee 的卡片**直接隐藏**（`display: none`）。
- 每列下方的 "12 hidden" 链接可清掉该列的过滤贡献。

### D11. Failed 区
底部可折叠区。`ChevronRight` 旋转。该区卡片标题加删除线 + `opacity-60`。

### D12. 空 / 加载 / 错误态
- 空：大号 `ListTodo` 图标 + 标题 + 幽灵 `+ New Task` 按钮。
- 加载：3 张骨架卡 × 4 列。
- 错误：alert 图标 + 重试按钮。
- 轮询出错：面板顶部一个克制的 banner，下次成功时自动消失。

### D13. 实时更新
面板打开期间 3s 轮询。每次响应 dispatch `SET_TEAM_TASKS`。组件读 chatStore。
乐观更新直接 patch chatStore；轮询响应到达后以服务端为准覆盖。

### D14. 可访问性
- 面板：`role="dialog"`，焦点陷阱，Escape 关闭。
- 列：`role="region"` + aria-label。
- 卡片：`role="button"`，完整 aria-label，Enter / Space 打开抽屉。
- 过滤 pill：`role="checkbox"`，`aria-checked`。
- 状态下拉：`role="menu"`，方向键导航。
- 抽屉：`role="dialog"`，打开时焦点移到标题，关闭时还原到触发卡片。
- Badge 红点：触发按钮上 `aria-label="N blocked tasks"`。

## 文件清单

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

测试：
```
src/components/team/__tests__/task-panel.test.tsx
src/components/team/__tests__/task-card.test.tsx
src/components/team/__tests__/task-card-menu.test.tsx
src/components/team/__tests__/task-detail-drawer.test.tsx
src/lib/store/chat/__tests__/team-tasks-reducer.test.ts
src/lib/store/coordinators/__tests__/team-tasks-poll.test.ts
```

## 测试场景

1. 面板渲染 4 列 + Failed 区。
2. + New 流程：乐观卡 → API 成功 → 临时 id 被替换。
3. + New 流程：乐观卡 → API 500 → 回滚 + toast。
4. 卡片状态下拉：user 拥有 → 立即生效；agent 拥有 → 弹确认。
5. 过滤：选 1 个 assignee → 其余卡片被隐藏，每列显示 "N hidden"。
6. Failed 区：默认折叠，点击切换。
7. 抽屉：打开、编辑描述、点 Save → PATCH；取消 → 不保存。
8. 抽屉中 Cmd+Enter 保存。
9. 空态：0 任务 → 空 UI。
10. 轮询：面板打开 → 3s 间隔；tab 隐藏 → 暂停；tab 可见 → 恢复。
11. Badge：chatStore summary 中 `blocked > 0` → 触发按钮红点可见。
12. 互斥：打开任务面板 → conversation 面板自动关闭。
13. 移动端（`width < 640px`）：sheet 取代 overlay。
14. 键盘：Tab 进入面板，焦点被陷阱住，Escape 关闭。

## 不在范围内

- DnD（推迟；状态下拉对 v1 已够）
- 任务级评论 / 串话
- 工时 / 截止日期
- 日历 / 时间线视图
- 跨会话任务
- 批量操作（多选）
- 可调宽侧栏 / 不互斥的多面板共存
- 任务历史详情视图（v1 只显示时间戳）

## 实施顺序

1. [ ] chatStore 增量：types + reducer + actions
2. [ ] 轮询 coordinator + summary 接口
3. [ ] task-card + task-card-menu + task-status-icon
4. [ ] task-create-dialog
5. [ ] task-detail-drawer
6. [ ] task-panel（把上面这些组装起来）
7. [ ] chat-area 集成：头部触发 + 状态提升 + 互斥
8. [ ] 移动端 sheet 变体
9. [ ] 测试
10. [ ] 手工冒烟：UI 创建任务 → chatStore 中可见 → 其它 tab 轮询同步 → 抽屉
   编辑 → 保存 → 其它 tab 看到更新。
