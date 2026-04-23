---
title: GraupelClaw 团队模式 Accio 对标设计（Step 1）
tags: [spec, team, graupelclaw, accio]
created: 2026-04-23
type: design
status: draft
---

# GraupelClaw 团队模式 Accio 对标设计（Step 1）

> 设计目标：在不修改 OpenClaw 的前提下，把 GraupelClaw 现有的幼稚 team 轮转实现升级为 Accio 式多 Agent 协作（TL / 成员 / @mention 派发 / 旁听 / 级联）。

---

## 1. 背景与动机

### 1.1 现状

GraupelClaw 已经具备 team 骨架：`AgentTeam` 类型、双 DB 层、store reducers、TeamSettingsDialog、CreateTeamDialog、chat-area 对 `targetType="team"` 的渲染。但发送逻辑（[src/lib/store.tsx:1064-1146](../../src/lib/store.tsx#L1064-L1146)）是**串行轮转**：

```
for (const agentId of team.agentIds)
  send(team history + currentRoundReplies + user msg)
```

即每条用户消息把所有成员从头到尾轮一遍，各说一句。无 TL、无 @、无级联、无 `<group_activity>`。

### 1.2 目标

对标 Accio Work 的团队协作体验。通过逆向 `docs/.accio/` 得到的关键事实：

- Accio 底层就是 OpenClaw；team 是客户端虚构的抽象，不在 gateway 里体现
- 每个 agent 的 team 会话各有一份独立 session（`agent:{did}:...group...:cid:{cid}` 命名）
- 旁听不是天然共享——是客户端在每次派发前，把"上次该 agent 发言到现在"的团队消息拼成 `<group_activity>` XML 块，塞到 user message 前缀
- `@[Name](DID-xxx)` 是 markdown-link 语法，既给用户点击也给 LLM 识别

### 1.3 结论

OpenClaw 作为隔离大脑不动，GraupelClaw 升级成 Accio 架构图里"书记官层"——Prompt Assembly、Roster Generator、Delegation Router、group_activity 注入器全都在客户端这一层。

---

## 2. 范围

### 2.1 Step 1 内

- Team CRUD + 显式 TL 字段
- `@[Name](agentId)` 语法解析 + 派发
- `<team_context>` + `<group_activity>` 注入
- 级联派发（最多 8 跳）+ 护栏（自环 / 近距 loop / 同 hop 去重 / abort）
- 动态 roster 每次派发前拼装
- CreateTeamDialog / TeamSettingsDialog / chat-area 的对应 UI

### 2.2 Step 1 外（延后）

- 任务系统（task_create/update/list + 意志引擎）
- 7 段 XML 行为协议注入
- Skill 三层加载 / 触发匹配
- Cron 定时触发
- sessions_spawn 子 agent 通道
- diary / self-improvement
- 级联状态跨刷新恢复
- Hop 图可视化
- Agent profile hover card
- Per-team 模型配置

---

## 3. 架构

### 3.1 模块边界

```
src/lib/team/
├── mention-parser.ts    # parseMentions(text, validIds) → Mention[]
├── group-activity.ts    # buildGroupActivity(messages, fromTs, toTs, names) → string | null
├── prompt-assembler.ts  # assembleAgentPrompt({team, roster, self, groupActivity, userText, isDirectMention}) → string
├── dispatcher.ts        # dispatchTeamMessage(opts) 级联引擎
├── loop-detector.ts     # isRecentLoop(chain, from, to) → boolean
├── types.ts             # CascadeContext, Mention, DispatchHop 等内部类型
└── index.ts             # 对外 API: { dispatchTeamMessage, resolveTlAgentId, parseMentions }
```

关键约束：**dispatcher 不直接依赖 store**。通过注入的 callback 读状态 / 发消息 / 查 abort，保证纯逻辑可单测。

### 3.2 职责划分

| 层 | 职责 |
|---|---|
| OpenClaw | 每 `(agentId, teamSessionKey)` 一个隔离 session；无 team 概念 |
| GraupelClaw DB | 团队消息流（`Message` 表按 `targetType="team" && targetId && conversationId` 过滤） |
| GraupelClaw team 模块 | @ 解析 / group_activity 拼装 / prompt 组装 / 派发循环 / 护栏 |
| OpenClaw 每 agent 的 session | 只含该 agent 自己参与的轮次（含 `<group_activity>` 注入的前缀） |

### 3.3 典型时序

```
用户发 "调研下水晶店"（无 @）
  │
  ▼
dispatchTeamMessage
  │
  ├─ parseMentions → []
  ├─ initialTargets = [resolveTlAgentId(team)]  （用户无 @ → 只激活 TL）
  │
  ▼ Hop 1：并行派发（此例只有 TL）
  │  ├─ buildGroupActivity(fromTs=null) → null（首次，无 activity）
  │  ├─ assembleAgentPrompt → "<team_context>You are TL of ...</team_context>\n\n调研下水晶店"
  │  ├─ sendToAgent(TL) → 等 streamDone → reply
  │  └─ TL reply: "好，让 @[Ecommerce Mind](DID-xxx) 做市场调研"
  │
  ▼ 扫 reply @ → [EcommerceMind]（去重 / 过滤失效 / 自环 / 近距 loop 检查通过）
  ▼ Hop 2：并行派发
  │  ├─ buildGroupActivity(fromTs=EM上次发言时间或null, toTs=now) → <group_activity>[User]: ... [TL]: ...</group_activity>
  │  ├─ assembleAgentPrompt → "<team_context>You are Member of ...</team_context>\n\n<group_activity>...</group_activity>\n\n@[Ecommerce Mind] 做市场调研"
  │  └─ sendToAgent(EM) → 等 streamDone → reply
  │
  ├─ 继续扫 @ ...
  │
  ▼ 某 hop 所有 reply 都无 @ 或 hop == 8 → 终止
```

---

## 4. 数据模型

### 4.1 类型改动

[src/types/index.ts](../../src/types/index.ts)：

```ts
export interface AgentTeam {
  id: string;
  companyId: string;
  name: string;
  avatar?: string;
  description?: string;
  agentIds: string[];
  tlAgentId?: string;   // 新增：显式指定 TL；未设或失效则 fallback 到 agentIds[0]
  createdAt: number;
}
```

`Message` / `Conversation` 不动。级联元数据（hop 数 / 激活链）是运行时内存，不落库。

### 4.2 TL 解析函数

```ts
export function resolveTlAgentId(team: AgentTeam): string {
  if (team.tlAgentId && team.agentIds.includes(team.tlAgentId)) return team.tlAgentId;
  return team.agentIds[0];
}
```

**失效处理**：
- 删除当前 TL 成员：移除后 `tlAgentId` 失效，resolve 自动回落到新首位
- `updateTeam` 的 agentIds 更新时：若 `tlAgentId` 不在新 agentIds 中，清空它（可在 DB 层或 store action 层处理）

### 4.3 持久化层

**Dexie / IndexedDB**：无 schema 约束，新字段直接写入。

**Drizzle / SQLite**：

```ts
// schema.ts
export const teams = sqliteTable("teams", {
  ...
  tlAgentId: text("tl_agent_id"),     // 新增，可空
  createdAt: integer("created_at").notNull(),
});

// index.ts 的 migrations 数组追加
`ALTER TABLE teams ADD COLUMN tl_agent_id TEXT`,
```

### 4.4 运行时 CascadeContext（不落库）

```ts
interface CascadeContext {
  teamId: string;
  conversationId: string;
  rootUserMessageId: string;
  hop: number;                    // 当前跳数
  maxHops: number;                // 默认 8
  activatedChain: string[];       // 激活过的 agentId 顺序，loop 检测用
  abortRequested: boolean;
}
```

### 4.5 新 AppState 字段

```ts
interface AppState {
  ...
  lastCascadeStatus?: {
    conversationId: string;
    reason: "max_hops" | "loop" | "abort" | null;
    hop: number;
  } | null;
}
```

用户下一次发送消息时清空，仅用于 chat-area banner 展示。

### 4.6 `teamAbortedRef` 改造

从全局 `useRef<boolean>` 改为 `useRef<Map<string, boolean>>`，按 `conversationId` 键。避免并发跨 team / 跨 conversation 的级联互相误伤。

---

## 5. Dispatch 详细设计

### 5.1 Mention Parser

```ts
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

**规则**：
- 只认 `@[Name](agentId)` markdown-link 格式，不做模糊匹配
- 不在当前 team 的 agentId 静默丢弃
- 同回复内去重

### 5.2 Group Activity Builder

```ts
export function buildGroupActivity(
  teamMessages: Message[],
  fromTs: number | null,
  toTs: number,
  agentNameMap: Map<string, string>,
): string | null {
  const slice = teamMessages.filter(m =>
    m.createdAt > (fromTs ?? 0) && m.createdAt <= toTs
  );
  if (slice.length === 0) return null;

  const lines = slice.map(m => {
    if (m.role === "user") return `[User (human)]: ${m.content}`;
    const name = m.agentId ? (agentNameMap.get(m.agentId) ?? m.agentId) : "Assistant";
    return `[${name} (AI agent)]: ${m.content}`;
  });

  const header = fromTs
    ? "Other team members said since your last response:"
    : "Recent group chat messages:";
  return `<group_activity>\n${header}\n\n${lines.join("\n\n")}\n</group_activity>`;
}
```

**fromTs 算法**：查 teamMessages 中 `m.agentId === selfAgentId` 的最大 `createdAt`；没有则 `null`。

### 5.3 Prompt Assembler

```ts
export function assembleAgentPrompt(opts: {
  team: AgentTeam;
  roster: RosterEntry[];
  self: { agentId: string; name: string; role: "TL" | "Member" };
  groupActivity: string | null;
  userText: string;
  isDirectMention: boolean;
}): string {
  const teamContext = buildTeamContext(opts.team, opts.roster, opts.self);
  const activityBlock = opts.groupActivity ?? "";
  const trailer = opts.isDirectMention
    ? ""
    : `\n\nYou (${opts.self.name}) were mentioned in the group conversation. Please respond to the discussion.`;

  return [teamContext, activityBlock, opts.userText + trailer]
    .filter(Boolean)
    .join("\n\n");
}
```

`buildTeamContext` 根据 self.role 产出两份 role header（TL 的职责说明 vs Member 简短说明）+ roster 列表（标注"← You"减少自 @ 概率）+ @mention 规则。

**每 hop 完整注入**（stateless）。token 成本相对 group_activity 可忽略。

### 5.4 Dispatcher 算法

```ts
export async function dispatchTeamMessage(opts: DispatchOpts) {
  const ctx: CascadeContext = {
    teamId: opts.team.id,
    conversationId: opts.conversationId,
    rootUserMessageId: opts.rootUserMessageId,
    hop: 0,
    maxHops: opts.maxHops ?? 8,
    activatedChain: [],
    abortRequested: false,
  };

  const validIds = new Set(opts.team.agentIds);
  const userMentions = parseMentions(opts.userContent, validIds);
  const tlId = resolveTlAgentId(opts.team);

  // 用户无 @ → 只激活 TL；有 @ → 激活被 @ 的（过滤失效后若空则回退 TL）
  const initialTargets = userMentions.length > 0
    ? userMentions.map(m => m.agentId)
    : [tlId];

  let currentTargets = initialTargets;
  let isUserHop = true;   // 仅 hop 0 true；后续 hop 都是级联

  while (currentTargets.length > 0 && ctx.hop < ctx.maxHops) {
    if (opts.isAborted(ctx.conversationId)) {
      opts.onCascadeStopped?.({ reason: "abort", hop: ctx.hop });
      return;
    }

    // 并行派发本 hop
    const replies = await Promise.all(
      currentTargets.map(agentId => dispatchOne({
        agentId, ctx, opts, isUserHop,
      }))
    );

    ctx.hop += 1;
    ctx.activatedChain.push(...currentTargets);
    isUserHop = false;

    if (opts.isAborted(ctx.conversationId)) {
      opts.onCascadeStopped?.({ reason: "abort", hop: ctx.hop });
      return;
    }

    // 扫 reply → 下一 hop targets
    const nextTargets: string[] = [];
    const seen = new Set<string>();
    let loopDetected = false;

    for (const reply of replies) {
      if (!reply) continue;
      const mentions = parseMentions(reply.content, validIds);
      for (const m of mentions) {
        if (m.agentId === reply.fromAgentId) continue;           // 自环
        if (isRecentLoop(ctx.activatedChain, reply.fromAgentId, m.agentId)) {
          loopDetected = true;
          continue;
        }
        if (seen.has(m.agentId)) continue;                        // 同 hop 去重
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
```

`dispatchOne`：查状态 → 构造 group_activity → 构造 prompt → `sendToAgent` → 等 streamDone → 返回 `{fromAgentId, content}` 或 `null`。

**`userText` 与 `isDirectMention` 的取值规则**：

| 场景 | userText | isDirectMention | trailer 结果 |
|------|----------|-----------------|--------------|
| hop 0，用户 @ 了本 agent | 用户原始消息（含 `@[Self](id)`） | true | 无 trailer |
| hop 0，用户无 @，只激活 TL | 用户原始消息（无 @） | false | "You (TL name) were mentioned in the group conversation..." |
| hop N > 0，级联激活 | `""`（空） | false | "You (Self name) were mentioned in the group conversation..." |

即：**级联 hop 的上下文由 group_activity 承载，userText 留空，trailer 引导 agent 响应讨论**。不需要合并上一跳 reply 文本。

**Attachments 只在 hop 0 透传**；后续 hop 不带。

### 5.5 护栏

| 机制 | 实现 |
|------|------|
| Max hops = 8 | `ctx.hop < ctx.maxHops` 循环条件；超限 `onCascadeStopped({reason:"max_hops"})` |
| 自环 | `m.agentId === reply.fromAgentId` 丢弃 |
| 近距 loop | `isRecentLoop(chain, from, to)`：查 `chain.slice(-3)` 里是否存在"to → from"相邻对；命中返回 true |
| 同 hop 去重 | `seen: Set<string>` |
| Abort | 每 hop 前 + 每 `sendToAgent` 前检查 `isAborted(conversationId)`；已在途回复允许完成，但其 @ 不触发下一跳 |

---

## 6. UI 设计

### 6.1 CreateTeamDialog

选完成员后新增 TL 下拉（候选 = 已勾选成员，默认 `agentIds[0]`）。保存时 `createTeam({..., agentIds, tlAgentId})`。

### 6.2 TeamSettingsDialog → Members

每个成员右侧加 crown 图标按钮；当前 TL 用金色填充 + "TL" 标签，其他成员 crown outline（点击设为 TL）。

取消勾选当前 TL：自动清空 `tlAgentId`，resolve 回落到新 agentIds[0]。

### 6.3 chat-area

**团队 chip 区**：TL 的成员 chip 叠小皇冠角标 + tooltip "Team Leader"。

**消息气泡**：每条 assistant 消息左侧显示 agent avatar + 名字；TL 的名字旁加皇冠符号。

**并行流可视化**：多个 `streamingEntries` 同时存在时，chat-area 已按 `filter(isStreaming)` 渲染，天然支持。每条 streaming 气泡带 agent 名字 + "正在输入..."。

**级联 hop 指示条**（细线，级联中显示在消息流底部）：
```
Hop 2 / 8 · 正在派发到 @Coder, @Ecommerce Mind
```

**级联终止 banner**（不落 DB，读 `lastCascadeStatus`）：
- 正常终止（回复无 @）：不显示
- `max_hops`：⚠ 级联在第 8 跳终止
- `loop`：⚠ 检测到循环 @（从 activatedChain 推导文案），已终止
- `abort`：⏸ 已中断（不再派发后续 @）

**输入框 @mention autocomplete**（最小版）：
- 监听 textarea 的 `@` 字符 + 光标位置
- 弹出 popover，候选 = 当前 `team.agentIds` 对应的 agents
- 键入过滤 by name
- 选中插入 `@[Name](agentId)` 字面字符串（非富文本 token）

### 6.4 Markdown Renderer

[src/components/markdown-renderer.tsx](../../src/components/markdown-renderer.tsx) 给 `a` 节点加自定义渲染：若 `href` 匹配当前 team 的某个 agentId，渲染成 agent chip（头像 + 名字，可 hover）；不匹配则普通链接。

### 6.5 Store 胶水

- `abortStreamingAction` 对 team 级联：设 `teamAbortedMap.set(conversationId, true)` → dispatcher 的下一次 `isAborted` 检查触发 `onCascadeStopped({reason:"abort"})`
- `onCascadeStopped` 回调通过闭包写入 store 的 `lastCascadeStatus`（reason + hop）
- 新 action `clearCascadeStatus(conversationId)`：在下次用户发送到该 conversation 时调用，清掉上次 banner
- `lastCascadeStatus` 的 conversationId 字段用于匹配；切换 conversation 时 banner 不跨显示

### 6.6 Step 1 不做的 UI 项

- 级联过程折叠成"协作中..."卡片
- Hop graph 可视化
- 派发树时间轴
- @hover agent 名片弹窗
- @mention autocomplete 键盘导航（简化为鼠标选择 + 基础上下键）

---

## 7. 边界情况与错误处理

### 7.1 网络层

| 场景 | 处理 |
|------|------|
| SSE 断流 / 504 | 分支 reply=null，其他分支正常；不扫 @；UI 显示该气泡 error 态 |
| Gateway 502/503 | `/api/chat` 现有错误路径触发 "error"；dispatcher 视为失败，停本分支 |
| STREAM_TIMEOUT 5min | 现有 `Promise.race` 保留；超时 resolve 后继续扫 @（可能是截断文本） |
| pending resolver 清理 | 沿用 `pendingStreamResolvers.current.delete` |

### 7.2 数据一致性

| 场景 | 处理 |
|------|------|
| 级联中 agent 被移除 | `dispatchOne` 前重查 `team.agentIds`；不在则跳过 |
| 级联中 team 被删除 | `getState().teams.find(...)` 不到 → 级联中断 |
| 级联中 TL 被改 | `resolveTlAgentId` 每跳重算；下一跳按最新角色注入 |
| 级联中切 conversation / team | 级联继续（后台跑完）；UI 切回时能看到完整流 |
| 级联中用户发新消息同 team | 中断旧级联（teamAbortedMap），起新 dispatch |
| 并发跨 team 级联 | `teamAbortedMap` 按 conversationId 键，互不干扰 |

### 7.3 LLM 输出异常

| 场景 | 处理 |
|------|------|
| @ 不存在的 agentId | `parseMentions` 过滤 |
| @ 自己 | 丢弃（显式规则） |
| 变种格式 `@DID-xxx` / `@Name` | 不识别不派发，文本照显 |
| 空回复 | `parseMentions` 空数组 → 级联正常终止 |
| 只 tool_call 无 text | content 为空 → 同空回复 |
| token 超限 | OpenClaw 自理，GraupelClaw 不干预 |

### 7.4 级联边界

| 场景 | 处理 |
|------|------|
| 用户 @ 3 个含 1 个失效 | 过滤后 2 个并行；失效静默忽略 |
| 用户 @ 全失效 | 回退 TL |
| hop 爆炸（扇出过宽） | 受 8 跳限制；`activatedChain` 即便累积也只是内存列表 |
| A @ B，B @ A | `isRecentLoop(chain.slice(-3), B, A)` 命中 → 终止 + `reason: loop` |

### 7.5 Abort 语义

1. `teamAbortedMap.set(conversationId, true)`
2. 已在途 agent：`RuntimeClient.abortStreamingAction(agentId)` 中断 SSE
3. 已完成但 reply 里 @ 了下一 hop：不派发下一 hop
4. UI 显示 "⏸ 已中断"
5. 已落库消息保留可见

### 7.6 持久化与刷新

级联进行中刷新：state 丢失，级联断；OpenClaw 已收到的请求可能跑完但回复不会回到 GraupelClaw DB（abort 不掉已在途的）。

**不做级联恢复**——Step 1 明确不保证跨刷新。

### 7.7 错误可观测性

- 分支失败：气泡红色错误态（Step 1 不做重试按钮）
- `onCascadeStopped` 的 reason 通过 `lastCascadeStatus` 上 banner
- loop 命中：`console.warn("[team-dispatch] loop detected:", ctx.activatedChain)`

### 7.8 安全

| 场景 | 处理 |
|------|------|
| 用户消息含 `<group_activity>` 字面串 | 不转义，LLM 理解上下文（同 Accio） |
| LLM 被 prompt injection 改写 @ 目标 | `validAgentIds` 过滤越界 id；团队内互 @ 的 prompt injection 防御不在 dispatcher 责任范围 |

---

## 8. 测试策略

### 8.1 纯函数单测（必需）

| 模块 | 关键 case |
|------|----------|
| `mention-parser` | 单/多 @、重复去重、无效 id、混合文本、跨行、markdown 嵌套 |
| `group-activity` | 空切片 null、fromTs=null、非首次、名字缺失 fallback、user+agent 混合 |
| `prompt-assembler` | TL/Member、isDirectMention、roster self 标记、group_activity 为 null 时不产生空块 |
| `resolveTlAgentId` | 有效、tlAgentId 失效 fallback、agentIds 空边界 |
| `isRecentLoop` | A→B→A 命中、超 3 跳不命中、chain 空 |

### 8.2 Dispatcher 逻辑测（mock `sendToAgent` + `getState`）

- 用户无 @ → 只激活 TL
- 用户 @ 2 个 → 并行两分支，不激活 TL
- TL 回复 @ 成员 → hop 2 激活
- 回复 @ 自己 → 丢弃
- A @ B，B @ A → loop 命中
- 达 max_hops → `onCascadeStopped({reason:"max_hops"})`
- `isAborted(cid)` 返回 true → 不派发 + 触发 `onCascadeStopped({reason:"abort"})`
- `sendToAgent` 抛错 → 该分支 null，不影响其他

### 8.3 手动测清单（Step 1 不做 e2e）

1. 创建 3 人团队，默认 TL 是第一个；settings 里改 TL
2. 发"介绍下团队" → 只有 TL 回复
3. TL 回复里手写 `@[Member](id)` → Member 激活，看 group_activity
4. 用户 `@[Member](id) 做 X` → Member 直接激活，跳过 TL
5. 构造会 loop 的 prompt → 看 "⚠ 检测到循环" banner
6. 级联中点 stop → 当前回复流完，不再 @ 下一跳
7. 删除 TL → team 状态 TL 自动回落

---

## 9. 落地顺序

按依赖从低到高的 8 个增量 commit，每步自成闭环可 review 可回滚：

1. **数据模型**  
   - `AgentTeam.tlAgentId` + Drizzle 迁移 + `resolveTlAgentId`  
   - CreateTeamDialog + TeamSettingsDialog 加 TL 选择 UI  
   - 行为不变，现有轮转逻辑不读 `tlAgentId`

2. **纯函数库**  
   - `mention-parser.ts` + `group-activity.ts` + `prompt-assembler.ts` + `loop-detector.ts` + 单测  
   - 未接入 store

3. **Dispatcher 骨架 + 单测**  
   - `dispatcher.ts` + `CascadeContext` + 护栏  
   - mock sendToAgent 覆盖算法

4. **Store 胶水层（不启用级联与 group_activity）**  
   - `teamAbortedRef` 改 `Map<conversationId, boolean>`  
   - 新 state `lastCascadeStatus` + action  
   - `sendMessageAction` team 分支接 dispatcher **但只跑 hop 0**（禁用级联 + 不注 group_activity）  
   - 此时"用户无 @ → TL 回"、"@ 多个 → 并发回"生效

5. **启用 group_activity + team_context 注入**  
   - dispatcher 的 `dispatchOne` 拼 prompt  
   - 此时 agent 能看见旁听，仍不级联

6. **启用级联**  
   - dispatcher 扫 reply 的 @ → 下一 hop；护栏生效  
   - TL 自主派发跑通；cascade banner 显示

7. **UI 打磨**  
   - Markdown renderer 的 agent chip  
   - @mention autocomplete popover  
   - hop 指示条、级联终止 banner  
   - TL 皇冠标记

8. **手动测清单跑一遍 + 修边界**

---

## 10. 技术债清单（写进 Step 2+ 背包）

- 级联状态不跨刷新恢复 → 需要服务端 orchestrator 或 worker
- 错误气泡的"重试"按钮
- @mention autocomplete 的完整键盘导航（上下选择 + ESC 关闭 + Tab 确认）
- Team-scoped 模型配置（per-team 默认模型）
- 级联 Hop 图可视化
- Agent profile hover card
- 级联过程折叠成"协作中..."卡片（UI 简化）
- 并发跨 team 级联的更优抽象（当前按 conversationId 隔离足够但可进化）
- Accio 的任务系统 / 意志引擎 / XML 行为协议 / Skill / Cron / sessions_spawn / diary —— 均留给 Step 2+

---

## 11. 开放问题

无。所有关键决策已在 brainstorming 阶段确认。
