---
title: store.tsx 按领域拆分为多 slice + coordinator 设计
tags: [spec, store, refactor, state-management]
created: 2026-04-24
type: design
status: draft
---

# store.tsx 按领域拆分为多 slice + coordinator 设计

> 设计目标：把 1436 行的 god-object [store.tsx](../../../src/lib/store.tsx) 拆成 4 个按领域切分的 slice（gateway / agent / session / chat）+ 6 个跨切编排 coordinator。通过 per-slice hooks 实现真正的 re-render 隔离。保留 useReducer 模式，不引入新状态库。一次 PR 大爆炸式迁移，以分 commit + 测试硬门槛 + 手工 QA 控制风险。

---

## 1. 背景与动机

### 1.1 现状

[src/lib/store.tsx](../../../src/lib/store.tsx) 当前是全局状态中枢，1436 行包含：

- 9 个领域的 state 字段混在同一个 `AppState`：companies / agents / teams / agentIdentities / messages / conversations / activeChatTarget / activeConversationId / connectionStatus / streamingStates / lastCascadeStatus / nativeSessions loading/error / initialized
- 25 个 reducer case
- 21 个 Action 类型
- 10 个 action creator（部分跨 4 个领域，如 `sendMessage`）
- 3 个共享 ref（`stateRef` / `gatewayRef` / `teamAbortedRef` / `pendingStreamResolvers`）
- 1 个 140 行的 init useEffect
- 1 个 70 行的 `onChatEvent` 回调（5 个 state 分支 × 2 种持久化路径）

### 1.2 问题

1. **god-object**：任何改动都要在整份 1436 行文件里绕。
2. **订阅粒度过粗**：全部 9 个消费者用 `const { state, actions } = useStore()`，任何字段变化触发所有消费者 re-render。实测含义：streaming delta 每次触发所有 dialog / sidebar 无谓 re-render。
3. **测试覆盖低**：除了 `team/` 子目录，核心状态转移和副作用链无单元测试保护。
4. **无边界**：新功能倾向继续往 store.tsx 堆，复杂度线性增长。

### 1.3 目标

- 状态按领域隔离，订阅按切片粒度
- 跨切编排逻辑沉到独立可测模块
- 引入单元测试覆盖 reducer 和 coordinator 的关键路径
- 不引入新依赖（不上 Zustand / Redux）
- 对外 API 清晰：简单 CRUD 从切片 hook 出，跨切 action 从 `useActions()` 出

### 1.4 非目标

- 不改 [runtime/](../../../src/lib/runtime/) 的 RuntimeClient
- 不改 [team/](../../../src/lib/team/) 已有模块（样板已正确，只改动被传入的 state mock shape）
- 不改 API routes
- 不新增组件层测试 / E2E 测试
- 不追求 coverage 数字

---

## 2. 范围

### 2.1 Scope 内

- 创建 4 个 slice（gateway / agent / session / chat），各自独立 reducer + Provider + types
- 创建 6 个 coordinator（bootstrap / company-cascade / agent-sync / native-sessions / gateway-events / send-message）
- 创建顶层 `<StoreProvider>` + `<ActionsProvider>` 组合
- 迁移 9 个消费者到 per-slice hooks + `useActions()`
- 删除老 store.tsx 与 `AppState` 类型
- 补充 ~60 个新单元测试（reducer + coordinator）
- 更新 `.project-journal/` 与 `CLAUDE.md`

### 2.2 Scope 外

- 组件拆分 / UI 重构
- 状态管理库替换
- 任何 `team/` 已有文件内部逻辑的修改
- 任何 API route 的修改
- `src/lib/db.ts` / drizzle schema 的修改

---

## 3. 架构决策

### 3.1 Slice 边界（方案 A）

| Slice | 归属字段 | 归属 ref |
|---|---|---|
| gatewayStore | companies, activeCompanyId, connectionStatus, initialized | gatewayRef (RuntimeClient) |
| agentStore | agents, teams, agentIdentities | — |
| sessionStore | conversations, messages, activeChatTarget, activeConversationId, nativeSessionsLoading, nativeSessionsError | — |
| chatStore | streamingStates, lastCascadeStatus | pendingStreamResolvers, teamAbortedRef |

决策理由：

- company 与 gateway 连接状态在运行时紧耦合（connect 读 company.url/token），同切片避免跨切订阅
- agent + team 同生命周期（都挂 company 下，删 company 一起清）
- conversations + messages + active chat target/conversation 是"浏览会话"的完整闭环，不拆
- streaming + cascade 属于 chat 特有的运行时状态，与持久化的 conversations/messages 分离

**已拒绝的替代**：
- 5 切片（company 单独）：纯 CRUD 才 4 个 action，过度拆分
- 3 切片（conversations + streaming 合并）：sendMessage 这个最复杂的协调点没有独立位置

### 3.2 Per-slice hooks（方案 1）

```tsx
// 新 API
const { state: session } = useSessionStore();
const { state: chat } = useChatStore();
const { sendMessage } = useActions();
```

**已拒绝的替代**：
- 单一 `useStore()` facade：re-render 隔离收益归零，本次重构的核心动机落空
- 双轨（per-slice + deprecated facade）：facade 易成永久债务

### 3.3 跨切动作归入 coordinator（方案 A）

Coordinator 是纯函数，接收各切片的 `getState` / `dispatch` / `ref` 作为参数，不依赖 React。样板已存在：[team/dispatcher.ts](../../../src/lib/team/dispatcher.ts) 就是这个模式。

**已拒绝的替代**：
- 切片内 effect 订阅其他切片变化：隐式依赖难追踪，sendMessage 这种需同步协调的场景无法实现
- 所有动作塞顶层 StoreProvider：切片降级为 dumb container，复杂度只是搬家

---

## 4. 目录结构

```
src/lib/store/
├── index.tsx              # <StoreProvider> + <ActionsProvider>
│
├── gateway/
│   ├── types.ts           # GatewayState, GatewayAction
│   ├── reducer.ts         # gatewayReducer + initialGatewayState
│   ├── reducer.test.ts
│   └── store.tsx          # GatewayProvider + useGatewayStore + 切片内 CRUD
├── agent/                 # 同构
├── session/               # 同构
├── chat/                  # 同构（ChatState 类型含 StreamingState / CascadeStatus）
│
├── coordinators/
│   ├── bootstrap.ts       # init 流程
│   ├── bootstrap.test.ts
│   ├── company-cascade.ts # selectCompany / deleteCompany
│   ├── company-cascade.test.ts
│   ├── agent-sync.ts      # syncAgents
│   ├── agent-sync.test.ts
│   ├── native-sessions.ts # fetchNativeAgentSessions / selectConversation / delete / rename
│   ├── native-sessions.test.ts
│   ├── gateway-events.ts  # onChatEvent handler（5 个 state 分支）
│   ├── gateway-events.test.ts
│   ├── send-message.ts    # sendMessage / abortStreaming
│   └── send-message.test.ts
│
├── session-keys.ts        # dmSessionKey / teamSessionKey
└── test-helpers.ts        # buildGatewayState / buildChatState 等 state factory
```

**路径策略**：新代码直接住 `src/lib/store/`；老文件先改名为 `src/lib/store-legacy.tsx` 避免模块解析歧义，最后一个 commit 删除。

---

## 5. Slice 契约

### 5.1 Slice 内部结构（以 gateway 为例，其他同构）

**`gateway/reducer.ts`** — 纯函数：

```ts
export interface GatewayState {
  companies: Company[];
  activeCompanyId: string | null;
  connectionStatus: ConnectionStatus;
  initialized: boolean;
}

export type GatewayAction =
  | { type: "SET_COMPANIES"; companies: Company[] }
  | { type: "ADD_COMPANY"; company: Company }
  | { type: "UPDATE_COMPANY"; id: string; updates: Partial<Company> }
  | { type: "REMOVE_COMPANY"; id: string }
  | { type: "SET_ACTIVE_COMPANY"; id: string | null }
  | { type: "SET_CONNECTION_STATUS"; status: ConnectionStatus }
  | { type: "SET_INITIALIZED" };

export const initialGatewayState: GatewayState = { /* ... */ };

export function gatewayReducer(state: GatewayState, action: GatewayAction): GatewayState {
  switch (action.type) { /* ... */ }
}
```

**`gateway/store.tsx`** — Provider 层：

```tsx
interface GatewayStoreValue {
  state: GatewayState;
  dispatch: React.Dispatch<GatewayAction>;
  getState: () => GatewayState;                // stableRef，给 coordinator 用
  clientRef: React.MutableRefObject<RuntimeClient | null>;
  registerChatEventHandler: (fn: (p: ChatEventPayload) => void) => void;

  // 切片内简单 CRUD（不跨切）
  createCompany: (name, url, token, desc?) => Promise<Company>;
  updateCompany: (id, updates) => Promise<void>;
  // 注：deleteCompany / selectCompany 是跨切，归 coordinator
}
```

### 5.2 切片暴露的 action creator vs coordinator 驱动的跨切动作

区分两层概念：

- **Action 类型**（Action union 成员，如 `SET_STREAMING`）：reducer 的输入，内部实现细节。coordinator 和切片内部逻辑都会直接 `dispatch({type: "SET_STREAMING", ...})`。
- **Action creator**（切片 hook 上暴露的函数，如 `updateAgent`）：消费者或 coordinator 可调用的 API，内部封装 db 写入 + dispatch。

下表列的是 **action creator 层**——消费者能从各 hook 拿到的函数：

| Slice | 切片 hook 暴露的 action creator（仅本切片副作用） | 走 `useActions()` 的 coordinator-backed 动作 |
|---|---|---|
| gateway | createCompany, updateCompany, restartGateway | selectCompany, deleteCompany |
| agent | updateAgent, createTeam, updateTeam | createAgent, deleteAgent, deleteTeam, syncAgents |
| session | createConversation, renameConversation | selectChatTarget, selectConversation, deleteConversation |
| chat | — | sendMessage, abortStreaming |

归属判据：**action creator 是否只 dispatch 本切片 action + 写入自己关心的 db？** 是则留切片；否则归 coordinator。

- `restartGateway` 只做 gateway 内部 disconnect + 等待 + connect，未动其他切片 → 切片内
- `createConversation` / `renameConversation` 虽有 `source` 分支，两条分支都只 dispatch session action（分别有无 db 写），不触达其他切片 → 切片内
- `deleteConversation` 的 native 分支要通过 gatewayRef 调 sessions.delete → 跨切，归 coordinator
- chat 切片对外不暴露任何 action creator：streaming 状态全部由 coordinator 驱动（`sendMessage` / `abortStreaming` / `handleGatewayChatEvent`），消费者只读 state

"薄切片"是预期结果：业务本来就以跨切协调为主，切片的价值是**状态与订阅隔离**，不是代码聚合。

### 5.3 Slice 内部的自治 effect（铁律）

**切片 Provider 内的 useEffect 只订阅自己切片的 state**，严禁订阅外层或任何其他切片。例如：

- gatewayStore 的 Provider 用 useEffect 监听 `state.initialized && state.activeCompanyId`（**都是 gateway 自己的字段**），变化时自动调用切片内 `connect()`
- updateCompany 改了 gatewayUrl/token → gatewayReducer 更新 → gateway 自己的 effect 监听到变化 → 自动 disconnect + connect

**跨切片的反应**（例如"当 session 清空 active target 时，chat 要清 streaming"）**全部放在 `<ActionsProvider>` 的 useEffect 里**——它是唯一能合法跨切订阅的位置。这条铁律保证切片 Provider 互相独立，可单独 mount 和测试。

违反此规则会触发 §11 R4 的运行时隐患。

### 5.4 Ref 所有权

| Ref | 所有者 | 访问方式 |
|---|---|---|
| gatewayRef (RuntimeClient) | gatewayStore | 通过 `useGatewayStore().clientRef` 读，coordinator 以参数接收 |
| pendingStreamResolvers | chatStore | 同上 |
| teamAbortedRef | chatStore | 同上 |
| ~~stateRef~~ | 不再存在 | 每切片独立 `stateRef` → `getState()` |

---

## 6. Coordinator 契约

### 6.1 签名模板

所有 coordinator 遵循**纯函数 + 显式参数**：

```ts
// coordinators/send-message.ts
export async function sendMessage(params: {
  content: string;
  attachments?: MessageAttachment[];

  // 只读快照 getter
  getGatewayState: () => GatewayState;
  getAgentState: () => AgentState;
  getSessionState: () => SessionState;
  getChatState: () => ChatState;

  // 各切片 dispatch
  dispatchSession: React.Dispatch<SessionAction>;
  dispatchChat: React.Dispatch<ChatAction>;

  // 共享 refs
  gatewayRef: React.MutableRefObject<RuntimeClient | null>;
  pendingStreamResolvers: React.MutableRefObject<Map<string, () => void>>;
  teamAbortedRef: React.MutableRefObject<Map<string, boolean>>;

  // 嵌套依赖（便于 mock）
  fetchNativeAgentSessions: FetchNativeAgentSessionsFn;
}): Promise<void>;
```

**不变量**：

- coordinator 不 `import React` 的 hooks
- coordinator 不 `import` 任何 `store.tsx`
- coordinator 只 `import` slice 的 `types.ts`
- coordinator 测试直接调函数传 mock，不需要 render

### 6.2 装配点 `<ActionsProvider>`

位于所有切片 Provider 最内层：

```tsx
<GatewayProvider>
  <AgentProvider>
    <SessionProvider>
      <ChatProvider>
        <ActionsProvider>   {/* 组合 coordinators + expose useActions() */}
          {children}
        </ActionsProvider>
      </ChatProvider>
    </SessionProvider>
  </AgentProvider>
</GatewayProvider>
```

嵌套顺序 = 依赖方向（外层不依赖内层）。`<ActionsProvider>` 通过 `useXxxStore()` 拿到所有切片的 `getState` / `dispatch` / `ref`，用 `useCallback` 预绑定 coordinator 成 action，`useMemo` 组成 actions 对象对外暴露 `useActions()`。

### 6.3 6 个 Coordinator 职责

| Coordinator | 承载的跨切动作 | 对应老代码 |
|---|---|---|
| `bootstrap` | init 流程：getAllCompanies → 若无则 /api/bootstrap 引导 → syncAgents → 激活第一个 company | [store.tsx:1261-1388](../../../src/lib/store.tsx#L1261-L1388) |
| `company-cascade` | selectCompany（disconnect → 设 active → 载 agents/teams → connect → syncAgents）；deleteCompany（断连 + 级联清 agents/teams/session） | [store.tsx:654-742](../../../src/lib/store.tsx#L654-L742) |
| `agent-sync` | syncAgents：/api/agents/sync → 对账（customName 保护）→ 增量 dispatch | [store.tsx:1199-1247](../../../src/lib/store.tsx#L1199-L1247) + selectCompany 内重复片段 |
| `native-sessions` | fetchNativeAgentSessions（内部复用）；selectChatTarget、selectConversation、deleteConversation 的 source 分叉处理（调 gatewayRef 时是跨切） | [store.tsx:349-441, 856-1002](../../../src/lib/store.tsx#L349-L441) |
| `gateway-events` | onChatEvent 的 5 个 state 分支（delta / message_done / final / error / aborted）× 2 种持久化路径 | [store.tsx:469-607](../../../src/lib/store.tsx#L469-L607) |
| `send-message` | sendMessage（确保 conversation → 加 user message → agent 或 team 分叉 → 流式生命周期）；abortStreaming | [store.tsx:1015-1197](../../../src/lib/store.tsx#L1015-L1197) |

> 注：`renameConversation` 不在 coordinator 列——它的两条 source 分支都只动 session 切片自己的 state，归 session 切片内。`restartGateway` 同理归 gateway 切片内。判据见 §5.2。

---

## 7. 消费者 API

### 7.1 Hook 划分

- **`useGatewayStore()` / `useAgentStore()` / `useSessionStore()` / `useChatStore()`** → 拿 state + 切片内简单 CRUD
- **`useActions()`** → 跨切编排动作（扁平）

按"action 的影响范围"划分，看 hook 来源就知道 action 是否跨切。

### 7.2 Before/After 样例

**chat-area.tsx**：

```tsx
// Before
const { state, actions } = useStore();
const messages = state.messages;
const target = state.activeChatTarget;
const streaming = target ? state.streamingStates[target.id] : undefined;
actions.sendMessage(content, attachments);

// After
const { state: session } = useSessionStore();
const { state: chat } = useChatStore();
const { sendMessage, abortStreaming } = useActions();
const messages = session.messages;
const target = session.activeChatTarget;
const streaming = target ? chat.streamingStates[target.id] : undefined;
sendMessage(content, attachments);
```

**agent-settings-dialog.tsx**：

```tsx
// Before
const { state, actions } = useStore();
actions.updateAgent(agentId, { name });     // 简单 CRUD
actions.deleteAgent(agentId);               // 其实跨切（要清 active target）

// After
const { updateAgent } = useAgentStore();    // 切片内简单
const { deleteAgent } = useActions();       // 跨切
```

---

## 8. 类型组织

- **每切片独立 `types.ts`**：`GatewayState` / `GatewayAction`（分别在 `gateway/types.ts` 等）
- **`StreamingState`** 从 `src/types/index.ts` 迁到 `chat/types.ts`（chat 切片内部形状）
- **共享领域类型**保留在 `src/types/index.ts`：Company / Agent / AgentTeam / Conversation / Message / ChatTarget / ConnectionStatus / StreamingPhase / ToolCallContent / AgentIdentity / MessageAttachment / AgentSpecialty / ChatEventPayload
- **删除**：`AppState`（不保留 union 过渡类型，防止复辟）

---

## 9. 测试策略

### 9.1 测试类型与覆盖

| 对象 | 测试类型 | 估算数量 |
|---|---|---|
| 4 个 slice reducer | 纯函数单元测试（无 mock） | ~24 |
| 4 个 slice 内简单 action | 集成（mock db） | ~10 |
| 6 个 coordinator | 纯函数单元测试（mock 注入参数） | ~24 |
| Slice Provider | 不单独测（由 reducer + coordinator 覆盖） | 0 |
| 消费者组件 | 不在本次 scope | 0 |
| **合计** | | **~60** |

### 9.2 硬门槛

每个 commit merge 前必须满足：

1. `pnpm build` 通过
2. `pnpm test` 全绿
3. `pnpm lint` 全绿
4. 新增源文件配套 `*.test.ts` 在**同 commit** 内交付（禁止先交代码再补测试）

### 9.3 关键覆盖路径

1. **native-session 分叉**：每个涉及 `conversation.source` 的 coordinator 要分别覆盖"native" / "local"两条路径
2. **跨 company 清理**：REMOVE_COMPANY 级联清 agents / teams / messages 的 reducer 单元测试
3. **流式生命周期**：SET_STREAMING → SET_STREAMING_CONTENT × N → CLEAR_STREAMING；message_done 中间消息分裂；abort 路径

### 9.4 State Factory 助手

`test-helpers.ts` 提供 `buildGatewayState(overrides)` 等工厂：**mock state 通过 reducer + 一系列已知 action dispatch 生成，不手写字面量**，确保 mock 是 reducer 可产出的合法 state。

### 9.5 不做的事

- 不加 E2E / Playwright 测试
- 不加 React Testing Library 组件测试（项目无现成 setup）
- 不追求 coverage 数字
- 不重测 team/ 已测逻辑（仅调整传入 state 的 mock shape）

---

## 10. 迁移计划

### 10.1 Commit 序列

单 PR，13 个有序 commit，每个独立可构建、测试全绿。

| # | Commit | 估算 LoC |
|---|---|---|
| 0 | chore(store): 老代码改名避路径冲突（store.tsx → store-legacy.tsx + 10 处 import 更新） | ±20 |
| 1 | chore(store): 抽出纯助手（session-keys.ts + StreamingState 迁入 chat/types.ts） | +40 / -15 |
| 2 | feat(store): gateway slice reducer + 测试 | +200 |
| 3 | feat(store): agent slice reducer + 测试 | +180 |
| 4 | feat(store): session slice reducer + 测试 | +220 |
| 5 | feat(store): chat slice reducer + 测试 | +180 |
| 6 | feat(store): 4 个 slice Provider + 切片内简单 action | +400 |
| 7 | feat(store/coordinators): bootstrap + agent-sync + 测试 | +300 |
| 8 | feat(store/coordinators): company-cascade + native-sessions + 测试 | +350 |
| 9 | feat(store/coordinators): gateway-events + send-message + 测试 | +450 |
| 10 | feat(store): StoreProvider + ActionsProvider 组装 | +150 |
| 11 | refactor(consumers): 迁 9 个消费者到新 API | ±600 |
| 12 | chore(store): 删除 store-legacy.tsx 与 AppState 导出 | -1500 |
| 13 | docs(journal+claude): 固化新模式 | ±50 |

**分段含义**：

- **commit 0–10**：新老共存；老系统一直正常工作（消费者仍用 `store-legacy`）
- **commit 11**：单一切换闸门；一次性迁所有消费者
- **commit 12**：清理，无死代码残留
- **commit 13**：同 PR 内固化到 journal + CLAUDE.md（不允许推迟）

### 10.2 顺序理由

- reducer 先于 Provider（纯函数无依赖，先稳类型）
- Provider 先于 coordinator（coordinator 参数类型依赖切片类型）
- coordinator 按复杂度排序：独立的（bootstrap / agent-sync）先；最复杂的（gateway-events / send-message）最后
- 消费者迁移单独一个 commit（review 时看此 commit 即能对照新老 API）

### 10.3 Rollback Playbook

| 场景 | 操作 |
|---|---|
| commit 11 merge 后大面积回归 | `git revert <commit11-sha>`；消费者回到 `store-legacy`，新代码留存无害 |
| commit 12 merge 后需要对照老代码 | `git show <commit12-sha>~1:src/lib/store-legacy.tsx` |
| 个别 slice 或 coordinator 设计错 | revert 对应 commit，其他保留，重新修正提交 |

---

## 11. 风险与缓解

### R1. 流式生命周期回归（高 × 高）

**风险**：`onChatEvent` 5 个 state 分支 × 2 种持久化路径。任何错位导致消息丢失 / 重复 / streaming 卡死。

**缓解**：
- `gateway-events.test.ts` 强制覆盖 5×2=10 个分支组合
- commit 11 后 QA 手工验证：agent DM 流式 / 团队派发流式 / message_done 分裂中间消息 / 中断 / 重连
- `gateway-events.ts` 写完后对照 [store.tsx:469-607](../../../src/lib/store.tsx#L469-L607) 做一次 diff review

### R2. Ref 跨切所有权错乱（中 × 高）

**风险**：同类型的不同 ref 互传 TypeScript 无法捕获（如两个 `MutableRefObject<Map<string, boolean>>`）。

**缓解**：
- ref 通过 named helper 从切片 hook 取用，装配层不手动按位置传
- 必要时用 type branding（如 `& { __brand: "teamAbort" }`）强制区分

### R3. 消费者迁移漏改（中 × 中）

**风险**：commit 11 约 600 行 diff，字段误认或 action 迁移到不同 hook 未同步更新。

**缓解**：
- TypeScript strict mode 把字段不存在 / 未导出全部暴露
- `pnpm build` + `pnpm lint` 配合 QA checklist

### R4. 切片 Provider 的 useEffect 跨切订阅（低 × 高）

**风险**：切片 Provider 内 useEffect 订阅了其他切片的 state → 要么 context 未 mount 导致 null，要么形成双向反应链难追踪。

**缓解**：
- 铁律（§5.3）：切片 Provider 的 useEffect 只订阅自己的 state。跨切反应放在 `<ActionsProvider>` 内的 useEffect
- `store/index.tsx` 注释固化此规则
- Code review 清单：审查每个切片 Provider 内的 useEffect 依赖数组——只能引用本切片 state 字段

### R5. 测试 mock 与真实 state shape 漂移（中 × 中）

**风险**：手写 mock state 不满足 reducer 的不变量。

**缓解**：
- `test-helpers.ts` 的 state factory 通过 dispatch 生成 mock，不手写字面量

### R6. 文档固化延迟（中 × 低）

**风险**：commit 13 被拖后，下次 AI 读到旧 CLAUDE.md 仍以为 store 未拆。

**缓解**：commit 13 强制在同 PR 内；未完成此 commit 的 PR 不允许 merge。

---

## 12. QA Checklist 大纲

commit 11 之后、commit 12 之前手工执行；固化到 `.project-journal/` 或 `docs/` 作为本次重构验收清单。

1. **初始化**：清 localStorage + IndexedDB → 启动 → `/api/bootstrap` 引导出第一个 Company + 默认 Agent
2. **Company 切换**：创建第二个 Company → 切换 → agents / teams / conversations / messages 正确切换 + 网关重连到新 URL
3. **Company 删除**：删当前 Company → 自动切到剩余；agents / teams / messages 清空
4. **Agent**：创建 / 改名（customName 保护）/ 删除 → gateway 同步正确；删除时 active chat target 正确清理
5. **Team**：创建 / 改名 / 删除；删除时 active chat target 正确清理
6. **DM（native-session）**：新对话 / 发消息 / 查历史 / 删对话 / 重命名（内存层）
7. **本地对话（非 native-session，drizzle 后端）**：同上 6 项；对比 dexie 后端行为一致
8. **流式**：普通回复 / 工具调用 >3 秒空闲导致分裂 / 手动中断 / 网关断连中断
9. **团队派发**：@mention / 级联 hop / 手动中断 / max_hops 触发 / loop detection
10. **Gateway 生命周期**：restartGateway / 断网重连 / connectionStatus 指示器

---

## 13. 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-04-24 | 初稿 | 小天 |
