# store.tsx 按领域拆分为多 slice 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 1436 行的 god-object [src/lib/store.tsx](../../../src/lib/store.tsx) 拆成 4 个按领域切分的 slice（gateway / agent / session / chat）+ 6 个跨切编排 coordinator，通过 per-slice hooks 实现真正的 re-render 隔离。单 PR 14 commit，每 commit 独立可构建、测试全绿。

**Architecture:** 4 个 slice 各自独立 `reducer + Provider + types`，每个 slice 暴露 `useXxxStore()` 拿 state + 本切片 CRUD。跨切编排逻辑以纯函数写入 `store/coordinators/`（仿 [team/dispatcher.ts](../../../src/lib/team/dispatcher.ts) 样板，显式接收 `getState/dispatch/ref`），在顶层 `<ActionsProvider>` 装配后通过 `useActions()` 暴露。Provider 嵌套顺序即依赖方向：`Gateway > Agent > Session > Chat > Actions`。

**Tech Stack:** React 19 useReducer + Context（不引入新状态库）; TypeScript strict; Vitest + node 环境; Tailwind/shadcn 消费者层无变化。

**参考文档:**
- 设计 spec：[docs/superpowers/specs/2026-04-24-store-domain-split-design.md](../specs/2026-04-24-store-domain-split-design.md)
- Coordinator 样板：[src/lib/team/dispatcher.ts](../../../src/lib/team/dispatcher.ts) + [dispatcher.test.ts](../../../src/lib/team/dispatcher.test.ts)

---

## Task 0: 老代码改名避路径冲突

**为什么这一步单独做：** `src/lib/store.tsx` 文件与即将创建的 `src/lib/store/` 目录同路径会让 Next.js/TS 模块解析歧义。先把老文件改名为 `store-legacy.tsx`，更新 10 处 import，保证 commit 0 末老系统仍正常工作。

**Files:**
- Rename: `src/lib/store.tsx` → `src/lib/store-legacy.tsx`
- Modify: `src/app/page.tsx` (import path)
- Modify: `src/components/chat-area.tsx` (import path)
- Modify: `src/components/conversation-panel.tsx` (import path)
- Modify: `src/components/app-sidebar.tsx` (import path)
- Modify: `src/components/dialogs/create-company-dialog.tsx` (import path)
- Modify: `src/components/dialogs/create-agent-dialog.tsx` (import path)
- Modify: `src/components/dialogs/create-team-dialog.tsx` (import path)
- Modify: `src/components/dialogs/agent-settings-dialog.tsx` (import path)
- Modify: `src/components/dialogs/team-settings-dialog.tsx` (import path)
- Modify: `src/components/dialogs/gateway-settings-dialog.tsx` (import path)

- [ ] **Step 1: 改名文件**

```bash
git mv src/lib/store.tsx src/lib/store-legacy.tsx
```

- [ ] **Step 2: 更新所有消费者的 import**

对以下 10 个文件执行替换：把 `from "@/lib/store"` 改为 `from "@/lib/store-legacy"`。

```bash
# 一次性批量替换
grep -rl "from \"@/lib/store\"" src/ | xargs sed -i 's|from "@/lib/store"|from "@/lib/store-legacy"|g'
```

- [ ] **Step 3: 确认替换完整**

```bash
grep -rn "from \"@/lib/store\"" src/ && echo "ERROR: still references" || echo "OK: no legacy references"
grep -rn "from \"@/lib/store-legacy\"" src/ | wc -l
```

Expected：第一条输出 `OK: no legacy references`；第二条输出 `10`。

- [ ] **Step 4: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected：三项全部通过。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(store): rename store.tsx to store-legacy.tsx to free up store/ path"
```

---

## Task 1: 抽取纯助手 + 解决 ChatState 命名冲突

**目的：** 把 `dmSessionKey` / `teamSessionKey` 抽成独立 pure-function 模块并加测试。同时重命名 `types/index.ts` 中的 SSE 事件类型 `ChatState → ChatEventState`，避免与后面 chat slice 的 `ChatState`（状态形状）冲突。

**Files:**
- Create: `src/lib/store/session-keys.ts`
- Create: `src/lib/store/session-keys.test.ts`
- Modify: `src/types/index.ts` (rename `ChatState` to `ChatEventState`)
- Modify: `src/lib/store-legacy.tsx` (consume `ChatEventState` if it referenced `ChatState`; it does not, so no change needed — but `ChatEventPayload` uses `ChatState` type, needs update)

- [ ] **Step 1: 先写 session-keys 失败测试**

Create `src/lib/store/session-keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dmSessionKey, teamSessionKey } from "./session-keys";
import { projectBrand } from "@/lib/project-brand";

describe("dmSessionKey", () => {
  it("returns conversationId unchanged when it already has the agent session prefix", () => {
    const cid = "agent:a1:graupelclaw:abc-123";
    expect(dmSessionKey("a1", cid)).toBe(cid);
  });

  it("builds a fresh key when conversationId does not carry the prefix", () => {
    expect(dmSessionKey("a1", "abc-123")).toBe(
      `agent:a1:${projectBrand.sessionNamespace}:abc-123`,
    );
  });

  it("does not re-wrap a key that carries a different agent's prefix", () => {
    const cid = "agent:other:graupelclaw:abc-123";
    expect(dmSessionKey("a1", cid)).toBe(
      `agent:a1:${projectBrand.sessionNamespace}:${cid}`,
    );
  });
});

describe("teamSessionKey", () => {
  it("builds a namespaced team session key", () => {
    expect(teamSessionKey("a1", "team-1", "c-1")).toBe(
      `agent:a1:${projectBrand.sessionNamespace}:team:team-1:c-1`,
    );
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
pnpm test src/lib/store/session-keys.test.ts
```

Expected：`Cannot find module './session-keys'`（模块未创建）。

- [ ] **Step 3: 实现 session-keys.ts**

Create `src/lib/store/session-keys.ts`:

```ts
import { projectBrand } from "@/lib/project-brand";

export function dmSessionKey(agentId: string, conversationId: string): string {
  if (conversationId.startsWith(`agent:${agentId}:`)) {
    return conversationId;
  }
  return `agent:${agentId}:${projectBrand.sessionNamespace}:${conversationId}`;
}

export function teamSessionKey(
  agentId: string,
  teamId: string,
  conversationId: string,
): string {
  return `agent:${agentId}:${projectBrand.sessionNamespace}:team:${teamId}:${conversationId}`;
}
```

- [ ] **Step 4: 确认 session-keys 测试通过**

```bash
pnpm test src/lib/store/session-keys.test.ts
```

Expected：4 个测试 PASS。

- [ ] **Step 5: 重命名 ChatState → ChatEventState in types/index.ts**

Edit `src/types/index.ts`:
- 第 5 行：`export type ChatState = "delta" | ...` 改为 `export type ChatEventState = "delta" | ...`
- 第 33 行：`ChatEventPayload.state: ChatState` 改为 `state: ChatEventState`

- [ ] **Step 6: 更新 store-legacy.tsx 中对 ChatState 的引用**

在 `src/lib/store-legacy.tsx` 中查找是否有 `ChatState` 的 import 或使用。该文件不直接 import `ChatState`（只通过 `ChatEventPayload` 间接使用），但为避免漏改：

```bash
grep -n "ChatState" src/lib/store-legacy.tsx src/lib/runtime/**/*.ts src/app/api/**/*.ts 2>/dev/null
```

对每处出现，如果是 SSE 状态字符串的引用，替换为 `ChatEventState`。

- [ ] **Step 7: 验证全局替换完整**

```bash
grep -rn "\\bChatState\\b" src/ --include="*.ts" --include="*.tsx" \
  | grep -v "test\\." \
  | grep -v "interface.*State" \
  && echo "CHECK manually" || echo "OK: clean"
```

- [ ] **Step 8: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected：全部通过。

- [ ] **Step 9: Commit**

```bash
git add src/lib/store/ src/types/index.ts src/lib/store-legacy.tsx src/lib/runtime src/app/api
git commit -m "chore(store): extract session-keys helper; rename SSE ChatState → ChatEventState"
```

---

## Task 2: gateway slice reducer

**目的：** 第一个 slice。gateway 含 `companies / activeCompanyId / connectionStatus / initialized`，是后面 coordinator 依赖的基础。

**Files:**
- Create: `src/lib/store/gateway/types.ts`
- Create: `src/lib/store/gateway/reducer.ts`
- Create: `src/lib/store/gateway/reducer.test.ts`

- [ ] **Step 1: 定义类型**

Create `src/lib/store/gateway/types.ts`:

```ts
import type { Company, ConnectionStatus } from "@/types";

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
```

- [ ] **Step 2: 写失败测试**

Create `src/lib/store/gateway/reducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Company } from "@/types";
import { gatewayReducer, initialGatewayState } from "./reducer";

function company(id: string, overrides: Partial<Company> = {}): Company {
  return {
    id,
    name: `co-${id}`,
    runtimeType: "openclaw",
    gatewayUrl: `http://example/${id}`,
    gatewayToken: "tk",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("gatewayReducer", () => {
  it("initialGatewayState has sensible defaults", () => {
    expect(initialGatewayState).toEqual({
      companies: [],
      activeCompanyId: null,
      connectionStatus: "disconnected",
      initialized: false,
    });
  });

  it("SET_COMPANIES replaces companies array", () => {
    const s = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    expect(s.companies.map(c => c.id)).toEqual(["a", "b"]);
  });

  it("ADD_COMPANY appends", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a")],
    });
    const s2 = gatewayReducer(s1, { type: "ADD_COMPANY", company: company("b") });
    expect(s2.companies.map(c => c.id)).toEqual(["a", "b"]);
  });

  it("UPDATE_COMPANY merges updates for matching id only", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    const s2 = gatewayReducer(s1, {
      type: "UPDATE_COMPANY",
      id: "a",
      updates: { name: "renamed" },
    });
    expect(s2.companies.find(c => c.id === "a")?.name).toBe("renamed");
    expect(s2.companies.find(c => c.id === "b")?.name).toBe("co-b");
  });

  it("REMOVE_COMPANY filters out the removed company", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    const s2 = gatewayReducer(s1, { type: "REMOVE_COMPANY", id: "a" });
    expect(s2.companies.map(c => c.id)).toEqual(["b"]);
  });

  it("REMOVE_COMPANY does NOT touch agents/teams/messages (those live in other slices)", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a")],
    });
    const s2 = gatewayReducer(s1, { type: "SET_ACTIVE_COMPANY", id: "a" });
    const s3 = gatewayReducer(s2, { type: "REMOVE_COMPANY", id: "a" });
    // active company cleared by reducer — coordinator handles cascading into other slices
    expect(s3.activeCompanyId).toBe(null);
    expect(s3.companies).toEqual([]);
  });

  it("REMOVE_COMPANY falls back activeCompanyId to first remaining company when active was removed", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    const s2 = gatewayReducer(s1, { type: "SET_ACTIVE_COMPANY", id: "a" });
    const s3 = gatewayReducer(s2, { type: "REMOVE_COMPANY", id: "a" });
    expect(s3.activeCompanyId).toBe("b");
  });

  it("REMOVE_COMPANY leaves activeCompanyId untouched when a different company is removed", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    const s2 = gatewayReducer(s1, { type: "SET_ACTIVE_COMPANY", id: "a" });
    const s3 = gatewayReducer(s2, { type: "REMOVE_COMPANY", id: "b" });
    expect(s3.activeCompanyId).toBe("a");
  });

  it("SET_ACTIVE_COMPANY sets only the id (cross-slice resets belong to coordinators)", () => {
    const s = gatewayReducer(initialGatewayState, { type: "SET_ACTIVE_COMPANY", id: "x" });
    expect(s.activeCompanyId).toBe("x");
  });

  it("SET_CONNECTION_STATUS updates status only", () => {
    const s = gatewayReducer(initialGatewayState, { type: "SET_CONNECTION_STATUS", status: "connected" });
    expect(s.connectionStatus).toBe("connected");
  });

  it("SET_INITIALIZED flips initialized flag", () => {
    const s = gatewayReducer(initialGatewayState, { type: "SET_INITIALIZED" });
    expect(s.initialized).toBe(true);
  });
});
```

- [ ] **Step 3: 确认测试失败**

```bash
pnpm test src/lib/store/gateway/reducer.test.ts
```

Expected：`Cannot find module './reducer'`.

- [ ] **Step 4: 实现 reducer**

Create `src/lib/store/gateway/reducer.ts`:

```ts
import type { GatewayState, GatewayAction } from "./types";

export const initialGatewayState: GatewayState = {
  companies: [],
  activeCompanyId: null,
  connectionStatus: "disconnected",
  initialized: false,
};

export function gatewayReducer(
  state: GatewayState,
  action: GatewayAction,
): GatewayState {
  switch (action.type) {
    case "SET_COMPANIES":
      return { ...state, companies: action.companies };
    case "ADD_COMPANY":
      return { ...state, companies: [...state.companies, action.company] };
    case "UPDATE_COMPANY":
      return {
        ...state,
        companies: state.companies.map(c =>
          c.id === action.id ? { ...c, ...action.updates } : c,
        ),
      };
    case "REMOVE_COMPANY": {
      const companies = state.companies.filter(c => c.id !== action.id);
      let activeCompanyId = state.activeCompanyId;
      if (state.activeCompanyId === action.id) {
        activeCompanyId = companies[0]?.id ?? null;
      }
      return { ...state, companies, activeCompanyId };
    }
    case "SET_ACTIVE_COMPANY":
      return { ...state, activeCompanyId: action.id };
    case "SET_CONNECTION_STATUS":
      return { ...state, connectionStatus: action.status };
    case "SET_INITIALIZED":
      return { ...state, initialized: true };
    default:
      return state;
  }
}
```

- [ ] **Step 5: 确认测试通过**

```bash
pnpm test src/lib/store/gateway/reducer.test.ts
```

Expected：11 个测试全 PASS。

- [ ] **Step 6: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected：全部通过。

- [ ] **Step 7: Commit**

```bash
git add src/lib/store/gateway/
git commit -m "feat(store): add gateway slice reducer with tests"
```

---

## Task 3: agent slice reducer

**目的：** `agents / teams / agentIdentities` 的纯状态。

**Files:**
- Create: `src/lib/store/agent/types.ts`
- Create: `src/lib/store/agent/reducer.ts`
- Create: `src/lib/store/agent/reducer.test.ts`

- [ ] **Step 1: 定义类型**

Create `src/lib/store/agent/types.ts`:

```ts
import type { Agent, AgentTeam, AgentIdentity } from "@/types";

export interface AgentState {
  agents: Agent[];
  teams: AgentTeam[];
  agentIdentities: Record<string, AgentIdentity>;
}

export type AgentAction =
  | { type: "SET_AGENTS"; agents: Agent[] }
  | { type: "ADD_AGENT"; agent: Agent }
  | { type: "UPDATE_AGENT"; id: string; updates: Partial<Agent> }
  | { type: "REMOVE_AGENT"; id: string }
  | { type: "SET_TEAMS"; teams: AgentTeam[] }
  | { type: "ADD_TEAM"; team: AgentTeam }
  | { type: "UPDATE_TEAM"; id: string; updates: Partial<AgentTeam> }
  | { type: "REMOVE_TEAM"; id: string }
  | { type: "SET_AGENT_IDENTITY"; agentId: string; identity: AgentIdentity }
  | { type: "CLEAR_AGENTS_FOR_COMPANY"; companyId: string };
```

> 注：`CLEAR_AGENTS_FOR_COMPANY` 供 `company-cascade` coordinator 在删 company 时使用；留出纯 reducer 入口避免 coordinator 手写 filter。

- [ ] **Step 2: 写失败测试**

Create `src/lib/store/agent/reducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Agent, AgentTeam } from "@/types";
import { agentReducer, initialAgentState } from "./reducer";

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id, companyId: "c1", name: `ag-${id}`,
    description: "", specialty: "general", createdAt: 0,
    ...overrides,
  };
}
function team(id: string, overrides: Partial<AgentTeam> = {}): AgentTeam {
  return {
    id, companyId: "c1", name: `team-${id}`,
    agentIds: [], createdAt: 0,
    ...overrides,
  };
}

describe("agentReducer", () => {
  it("initialAgentState is empty", () => {
    expect(initialAgentState).toEqual({ agents: [], teams: [], agentIdentities: {} });
  });

  it("SET_AGENTS replaces", () => {
    const s = agentReducer(initialAgentState, {
      type: "SET_AGENTS", agents: [agent("a"), agent("b")],
    });
    expect(s.agents.map(a => a.id)).toEqual(["a", "b"]);
  });

  it("UPDATE_AGENT merges fields for matching id", () => {
    const s1 = agentReducer(initialAgentState, {
      type: "SET_AGENTS", agents: [agent("a"), agent("b")],
    });
    const s2 = agentReducer(s1, {
      type: "UPDATE_AGENT", id: "a", updates: { name: "renamed", customName: true },
    });
    expect(s2.agents.find(a => a.id === "a")?.name).toBe("renamed");
    expect(s2.agents.find(a => a.id === "a")?.customName).toBe(true);
    expect(s2.agents.find(a => a.id === "b")?.name).toBe("ag-b");
  });

  it("REMOVE_AGENT filters", () => {
    const s1 = agentReducer(initialAgentState, {
      type: "SET_AGENTS", agents: [agent("a"), agent("b")],
    });
    const s2 = agentReducer(s1, { type: "REMOVE_AGENT", id: "a" });
    expect(s2.agents.map(a => a.id)).toEqual(["b"]);
  });

  it("SET_TEAMS / ADD_TEAM / UPDATE_TEAM / REMOVE_TEAM", () => {
    const s1 = agentReducer(initialAgentState, { type: "SET_TEAMS", teams: [team("t1")] });
    const s2 = agentReducer(s1, { type: "ADD_TEAM", team: team("t2") });
    const s3 = agentReducer(s2, { type: "UPDATE_TEAM", id: "t1", updates: { name: "x" } });
    const s4 = agentReducer(s3, { type: "REMOVE_TEAM", id: "t2" });
    expect(s4.teams.map(t => t.id)).toEqual(["t1"]);
    expect(s4.teams[0].name).toBe("x");
  });

  it("SET_AGENT_IDENTITY stores by agentId", () => {
    const s = agentReducer(initialAgentState, {
      type: "SET_AGENT_IDENTITY",
      agentId: "a1",
      identity: { name: "Alice", avatar: "a.png" },
    });
    expect(s.agentIdentities["a1"]).toEqual({ name: "Alice", avatar: "a.png" });
  });

  it("CLEAR_AGENTS_FOR_COMPANY removes both agents and teams tied to that company", () => {
    const s1 = agentReducer(initialAgentState, {
      type: "SET_AGENTS",
      agents: [agent("a", { companyId: "c1" }), agent("b", { companyId: "c2" })],
    });
    const s2 = agentReducer(s1, {
      type: "SET_TEAMS",
      teams: [team("t1", { companyId: "c1" }), team("t2", { companyId: "c2" })],
    });
    const s3 = agentReducer(s2, { type: "CLEAR_AGENTS_FOR_COMPANY", companyId: "c1" });
    expect(s3.agents.map(a => a.id)).toEqual(["b"]);
    expect(s3.teams.map(t => t.id)).toEqual(["t2"]);
  });
});
```

- [ ] **Step 3: 确认测试失败**

```bash
pnpm test src/lib/store/agent/reducer.test.ts
```

Expected：`Cannot find module './reducer'`.

- [ ] **Step 4: 实现 reducer**

Create `src/lib/store/agent/reducer.ts`:

```ts
import type { AgentState, AgentAction } from "./types";

export const initialAgentState: AgentState = {
  agents: [],
  teams: [],
  agentIdentities: {},
};

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case "SET_AGENTS":
      return { ...state, agents: action.agents };
    case "ADD_AGENT":
      return { ...state, agents: [...state.agents, action.agent] };
    case "UPDATE_AGENT":
      return {
        ...state,
        agents: state.agents.map(a =>
          a.id === action.id ? { ...a, ...action.updates } : a,
        ),
      };
    case "REMOVE_AGENT":
      return { ...state, agents: state.agents.filter(a => a.id !== action.id) };
    case "SET_TEAMS":
      return { ...state, teams: action.teams };
    case "ADD_TEAM":
      return { ...state, teams: [...state.teams, action.team] };
    case "UPDATE_TEAM":
      return {
        ...state,
        teams: state.teams.map(t =>
          t.id === action.id ? { ...t, ...action.updates } : t,
        ),
      };
    case "REMOVE_TEAM":
      return { ...state, teams: state.teams.filter(t => t.id !== action.id) };
    case "SET_AGENT_IDENTITY":
      return {
        ...state,
        agentIdentities: {
          ...state.agentIdentities,
          [action.agentId]: action.identity,
        },
      };
    case "CLEAR_AGENTS_FOR_COMPANY":
      return {
        ...state,
        agents: state.agents.filter(a => a.companyId !== action.companyId),
        teams: state.teams.filter(t => t.companyId !== action.companyId),
      };
    default:
      return state;
  }
}
```

- [ ] **Step 5: 确认测试通过**

```bash
pnpm test src/lib/store/agent/reducer.test.ts
```

Expected：7 个测试全 PASS。

- [ ] **Step 6: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/store/agent/
git commit -m "feat(store): add agent slice reducer with tests"
```

---

## Task 4: session slice reducer

**目的：** `conversations / messages / activeChatTarget / activeConversationId / nativeSessionsLoading / nativeSessionsError` 的纯状态。

**Files:**
- Create: `src/lib/store/session/types.ts`
- Create: `src/lib/store/session/reducer.ts`
- Create: `src/lib/store/session/reducer.test.ts`

- [ ] **Step 1: 定义类型**

Create `src/lib/store/session/types.ts`:

```ts
import type { Conversation, Message, ChatTarget } from "@/types";

export interface SessionState {
  conversations: Conversation[];
  messages: Message[];
  activeChatTarget: ChatTarget | null;
  activeConversationId: string | null;
  nativeSessionsLoading: boolean;
  nativeSessionsError: string | null;
}

export type SessionAction =
  | { type: "SET_CONVERSATIONS"; conversations: Conversation[] }
  | { type: "ADD_CONVERSATION"; conversation: Conversation }
  | { type: "UPDATE_CONVERSATION"; id: string; updates: Partial<Conversation> }
  | { type: "DELETE_CONVERSATION"; id: string }
  | { type: "SET_ACTIVE_CONVERSATION"; id: string | null }
  | { type: "SET_MESSAGES"; messages: Message[] }
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "SET_CHAT_TARGET"; target: ChatTarget | null }
  | { type: "SET_NATIVE_SESSIONS_LOADING"; loading: boolean }
  | { type: "SET_NATIVE_SESSIONS_ERROR"; error: string | null }
  | { type: "RESET_SESSION_ON_COMPANY_CHANGE" };
```

> 注：`RESET_SESSION_ON_COMPANY_CHANGE` 一次性清 `activeChatTarget / activeConversationId / messages / conversations`，供 company-cascade coordinator 使用。

- [ ] **Step 2: 写失败测试**

Create `src/lib/store/session/reducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Conversation, Message } from "@/types";
import { sessionReducer, initialSessionState } from "./reducer";

function conv(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id, targetType: "agent", targetId: "a1", companyId: "c1",
    title: `conv-${id}`, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}
function msg(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id, conversationId: "c-1", targetType: "agent", targetId: "a1",
    role: "user", content: "hi", createdAt: 0,
    ...overrides,
  };
}

describe("sessionReducer", () => {
  it("initialSessionState is empty", () => {
    expect(initialSessionState).toEqual({
      conversations: [],
      messages: [],
      activeChatTarget: null,
      activeConversationId: null,
      nativeSessionsLoading: false,
      nativeSessionsError: null,
    });
  });

  it("ADD_CONVERSATION prepends (newest first)", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a")],
    });
    const s2 = sessionReducer(s1, {
      type: "ADD_CONVERSATION", conversation: conv("b"),
    });
    expect(s2.conversations.map(c => c.id)).toEqual(["b", "a"]);
  });

  it("UPDATE_CONVERSATION merges updates", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a", { title: "old" })],
    });
    const s2 = sessionReducer(s1, {
      type: "UPDATE_CONVERSATION", id: "a", updates: { title: "new" },
    });
    expect(s2.conversations[0].title).toBe("new");
  });

  it("DELETE_CONVERSATION removes and clears active/messages if it was active", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a"), conv("b")],
    });
    const s2 = sessionReducer(s1, { type: "SET_ACTIVE_CONVERSATION", id: "a" });
    const s3 = sessionReducer(s2, { type: "SET_MESSAGES", messages: [msg("m1")] });
    const s4 = sessionReducer(s3, { type: "DELETE_CONVERSATION", id: "a" });
    expect(s4.conversations.map(c => c.id)).toEqual(["b"]);
    expect(s4.activeConversationId).toBe(null);
    expect(s4.messages).toEqual([]);
  });

  it("DELETE_CONVERSATION of non-active conversation leaves active untouched", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a"), conv("b")],
    });
    const s2 = sessionReducer(s1, { type: "SET_ACTIVE_CONVERSATION", id: "a" });
    const s3 = sessionReducer(s2, { type: "SET_MESSAGES", messages: [msg("m1")] });
    const s4 = sessionReducer(s3, { type: "DELETE_CONVERSATION", id: "b" });
    expect(s4.activeConversationId).toBe("a");
    expect(s4.messages.map(m => m.id)).toEqual(["m1"]);
  });

  it("ADD_MESSAGE appends", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_MESSAGES", messages: [msg("m1")],
    });
    const s2 = sessionReducer(s1, { type: "ADD_MESSAGE", message: msg("m2") });
    expect(s2.messages.map(m => m.id)).toEqual(["m1", "m2"]);
  });

  it("SET_CHAT_TARGET sets target only (doesn't touch conversations)", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a")],
    });
    const s2 = sessionReducer(s1, {
      type: "SET_CHAT_TARGET",
      target: { type: "agent", id: "a1" },
    });
    expect(s2.activeChatTarget).toEqual({ type: "agent", id: "a1" });
    expect(s2.conversations).toHaveLength(1);
  });

  it("SET_NATIVE_SESSIONS_LOADING / ERROR flip their fields", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_NATIVE_SESSIONS_LOADING", loading: true,
    });
    expect(s1.nativeSessionsLoading).toBe(true);
    const s2 = sessionReducer(s1, {
      type: "SET_NATIVE_SESSIONS_ERROR", error: "oops",
    });
    expect(s2.nativeSessionsError).toBe("oops");
  });

  it("RESET_SESSION_ON_COMPANY_CHANGE wipes target/active/messages/conversations", () => {
    const s1 = sessionReducer(initialSessionState, {
      type: "SET_CONVERSATIONS", conversations: [conv("a")],
    });
    const s2 = sessionReducer(s1, {
      type: "SET_CHAT_TARGET", target: { type: "agent", id: "a1" },
    });
    const s3 = sessionReducer(s2, { type: "SET_ACTIVE_CONVERSATION", id: "a" });
    const s4 = sessionReducer(s3, { type: "SET_MESSAGES", messages: [msg("m1")] });
    const s5 = sessionReducer(s4, { type: "RESET_SESSION_ON_COMPANY_CHANGE" });
    expect(s5.conversations).toEqual([]);
    expect(s5.activeChatTarget).toBe(null);
    expect(s5.activeConversationId).toBe(null);
    expect(s5.messages).toEqual([]);
  });
});
```

- [ ] **Step 3: 确认失败**

```bash
pnpm test src/lib/store/session/reducer.test.ts
```

Expected：`Cannot find module './reducer'`.

- [ ] **Step 4: 实现 reducer**

Create `src/lib/store/session/reducer.ts`:

```ts
import type { SessionState, SessionAction } from "./types";

export const initialSessionState: SessionState = {
  conversations: [],
  messages: [],
  activeChatTarget: null,
  activeConversationId: null,
  nativeSessionsLoading: false,
  nativeSessionsError: null,
};

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "SET_CONVERSATIONS":
      return { ...state, conversations: action.conversations };
    case "ADD_CONVERSATION":
      return {
        ...state,
        conversations: [action.conversation, ...state.conversations],
      };
    case "UPDATE_CONVERSATION":
      return {
        ...state,
        conversations: state.conversations.map(c =>
          c.id === action.id ? { ...c, ...action.updates } : c,
        ),
      };
    case "DELETE_CONVERSATION": {
      const conversations = state.conversations.filter(c => c.id !== action.id);
      if (state.activeConversationId === action.id) {
        return {
          ...state,
          conversations,
          activeConversationId: null,
          messages: [],
        };
      }
      return { ...state, conversations };
    }
    case "SET_ACTIVE_CONVERSATION":
      return { ...state, activeConversationId: action.id };
    case "SET_MESSAGES":
      return { ...state, messages: action.messages };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    case "SET_CHAT_TARGET":
      return { ...state, activeChatTarget: action.target };
    case "SET_NATIVE_SESSIONS_LOADING":
      return { ...state, nativeSessionsLoading: action.loading };
    case "SET_NATIVE_SESSIONS_ERROR":
      return { ...state, nativeSessionsError: action.error };
    case "RESET_SESSION_ON_COMPANY_CHANGE":
      return {
        ...state,
        conversations: [],
        messages: [],
        activeChatTarget: null,
        activeConversationId: null,
      };
    default:
      return state;
  }
}
```

- [ ] **Step 5: 确认测试通过**

```bash
pnpm test src/lib/store/session/reducer.test.ts
```

Expected：9 个测试全 PASS。

- [ ] **Step 6: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/store/session/
git commit -m "feat(store): add session slice reducer with tests"
```

---

## Task 5: chat slice reducer + StreamingState 迁移

**目的：** chat slice 含 `streamingStates / lastCascadeStatus`。同时把 `StreamingState` 形状从老 store 的匿名结构迁入 `chat/types.ts` 成为命名类型（spec §8）。

**Files:**
- Create: `src/lib/store/chat/types.ts`
- Create: `src/lib/store/chat/reducer.ts`
- Create: `src/lib/store/chat/reducer.test.ts`

- [ ] **Step 1: 定义类型**

Create `src/lib/store/chat/types.ts`:

```ts
import type {
  ChatTargetType,
  StreamingPhase,
  ToolCallContent,
} from "@/types";

export interface StreamingState {
  isStreaming: boolean;
  content: string;
  toolCalls: ToolCallContent[];
  runId: string | null;
  targetType: ChatTargetType;
  targetId: string;
  conversationId: string;
  sessionKey: string;
  phase: StreamingPhase;
}

export interface CascadeStatus {
  conversationId: string;
  reason: "max_hops" | "loop" | "abort";
  hop: number;
}

export interface ChatSliceState {
  streamingStates: Record<string, StreamingState>;
  lastCascadeStatus: CascadeStatus | null;
}

export type ChatAction =
  | {
      type: "SET_STREAMING";
      agentId: string;
      targetType: ChatTargetType;
      targetId: string;
      conversationId?: string;
      sessionKey: string;
      isStreaming: boolean;
    }
  | {
      type: "SET_STREAMING_CONTENT";
      agentId: string;
      content: string;
      runId: string | null;
      phase?: StreamingPhase;
      toolCalls?: ToolCallContent[];
    }
  | { type: "CLEAR_STREAMING"; agentId: string }
  | { type: "SET_CASCADE_STATUS"; status: CascadeStatus }
  | { type: "CLEAR_CASCADE_STATUS"; conversationId: string };
```

> 命名为 `ChatSliceState` 而不是 `ChatState`，避免与 SSE 事件类型 `ChatEventState`（Task 1 已重命名）以及切片外部可能的 `ChatState` 字面值混淆；同时 slice 之间命名更统一（`GatewayState` / `AgentState` / `SessionState` / `ChatSliceState`）。

- [ ] **Step 2: 写失败测试**

Create `src/lib/store/chat/reducer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { chatReducer, initialChatState } from "./reducer";

describe("chatReducer", () => {
  it("initialChatState is empty", () => {
    expect(initialChatState).toEqual({
      streamingStates: {},
      lastCascadeStatus: null,
    });
  });

  it("SET_STREAMING isStreaming=true creates a fresh entry with 'connecting' phase", () => {
    const s = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1",
      targetType: "agent",
      targetId: "a1",
      conversationId: "c1",
      sessionKey: "k1",
      isStreaming: true,
    });
    expect(s.streamingStates["a1"]).toEqual({
      isStreaming: true,
      content: "",
      toolCalls: [],
      runId: null,
      targetType: "agent",
      targetId: "a1",
      conversationId: "c1",
      sessionKey: "k1",
      phase: "connecting",
    });
  });

  it("SET_STREAMING isStreaming=false removes the entry", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      sessionKey: "", isStreaming: false,
    });
    expect(s2.streamingStates["a1"]).toBeUndefined();
  });

  it("SET_STREAMING_CONTENT is a no-op if the agent has no active streaming entry", () => {
    const s = chatReducer(initialChatState, {
      type: "SET_STREAMING_CONTENT",
      agentId: "ghost", content: "abc", runId: "r1",
    });
    expect(s.streamingStates["ghost"]).toBeUndefined();
  });

  it("SET_STREAMING_CONTENT updates content/runId; derives phase 'responding' when content present", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "hello", runId: "r1",
    });
    expect(s2.streamingStates["a1"].content).toBe("hello");
    expect(s2.streamingStates["a1"].runId).toBe("r1");
    expect(s2.streamingStates["a1"].phase).toBe("responding");
  });

  it("SET_STREAMING_CONTENT derives phase 'thinking' when content empty and no explicit phase", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "", runId: null,
    });
    expect(s2.streamingStates["a1"].phase).toBe("thinking");
  });

  it("SET_STREAMING_CONTENT with explicit phase overrides derived", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "anything", runId: null, phase: "tool-calling",
    });
    expect(s2.streamingStates["a1"].phase).toBe("tool-calling");
  });

  it("SET_STREAMING_CONTENT preserves existing toolCalls when action.toolCalls is undefined", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "x", runId: "r1",
      toolCalls: [{ id: "tc1", type: "tool_call", name: "t", arguments: "{}", status: "calling" }],
    });
    const s3 = chatReducer(s2, {
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "y", runId: "r1",
    });
    expect(s3.streamingStates["a1"].toolCalls).toHaveLength(1);
  });

  it("CLEAR_STREAMING removes the agent entry", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_STREAMING",
      agentId: "a1", targetType: "agent", targetId: "a1",
      conversationId: "c1", sessionKey: "k1", isStreaming: true,
    });
    const s2 = chatReducer(s1, { type: "CLEAR_STREAMING", agentId: "a1" });
    expect(s2.streamingStates).toEqual({});
  });

  it("SET_CASCADE_STATUS stores status", () => {
    const s = chatReducer(initialChatState, {
      type: "SET_CASCADE_STATUS",
      status: { conversationId: "c1", reason: "max_hops", hop: 8 },
    });
    expect(s.lastCascadeStatus).toEqual({ conversationId: "c1", reason: "max_hops", hop: 8 });
  });

  it("CLEAR_CASCADE_STATUS clears only if conversationId matches", () => {
    const s1 = chatReducer(initialChatState, {
      type: "SET_CASCADE_STATUS",
      status: { conversationId: "c1", reason: "abort", hop: 2 },
    });
    const s2 = chatReducer(s1, { type: "CLEAR_CASCADE_STATUS", conversationId: "other" });
    expect(s2.lastCascadeStatus?.conversationId).toBe("c1");
    const s3 = chatReducer(s1, { type: "CLEAR_CASCADE_STATUS", conversationId: "c1" });
    expect(s3.lastCascadeStatus).toBe(null);
  });
});
```

- [ ] **Step 3: 确认失败**

```bash
pnpm test src/lib/store/chat/reducer.test.ts
```

Expected：`Cannot find module './reducer'`.

- [ ] **Step 4: 实现 reducer**

Create `src/lib/store/chat/reducer.ts`:

```ts
import type { StreamingPhase } from "@/types";
import type { ChatSliceState, ChatAction } from "./types";

export const initialChatState: ChatSliceState = {
  streamingStates: {},
  lastCascadeStatus: null,
};

export function chatReducer(
  state: ChatSliceState,
  action: ChatAction,
): ChatSliceState {
  switch (action.type) {
    case "SET_STREAMING": {
      if (action.isStreaming) {
        return {
          ...state,
          streamingStates: {
            ...state.streamingStates,
            [action.agentId]: {
              isStreaming: true,
              content: "",
              toolCalls: [],
              runId: null,
              targetType: action.targetType,
              targetId: action.targetId,
              conversationId: action.conversationId ?? "",
              sessionKey: action.sessionKey,
              phase: "connecting" as StreamingPhase,
            },
          },
        };
      }
      return {
        ...state,
        streamingStates: Object.fromEntries(
          Object.entries(state.streamingStates).filter(
            ([k]) => k !== action.agentId,
          ),
        ),
      };
    }
    case "SET_STREAMING_CONTENT": {
      const existing = state.streamingStates[action.agentId];
      if (!existing) return state;
      const phase =
        action.phase ??
        ((action.content ? "responding" : "thinking") as StreamingPhase);
      return {
        ...state,
        streamingStates: {
          ...state.streamingStates,
          [action.agentId]: {
            ...existing,
            content: action.content,
            runId: action.runId,
            phase,
            toolCalls: action.toolCalls ?? existing.toolCalls,
          },
        },
      };
    }
    case "CLEAR_STREAMING":
      return {
        ...state,
        streamingStates: Object.fromEntries(
          Object.entries(state.streamingStates).filter(
            ([k]) => k !== action.agentId,
          ),
        ),
      };
    case "SET_CASCADE_STATUS":
      return { ...state, lastCascadeStatus: action.status };
    case "CLEAR_CASCADE_STATUS":
      if (state.lastCascadeStatus?.conversationId === action.conversationId) {
        return { ...state, lastCascadeStatus: null };
      }
      return state;
    default:
      return state;
  }
}
```

- [ ] **Step 5: 确认测试通过**

```bash
pnpm test src/lib/store/chat/reducer.test.ts
```

Expected：11 个测试全 PASS。

- [ ] **Step 6: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/store/chat/
git commit -m "feat(store): add chat slice reducer + StreamingState with tests"
```

---

## Task 6: 4 个 slice Provider + 切片内简单 action creator

**目的：** 每个 slice 暴露 `useXxxStore()` hook，返回 `{ state, dispatch, getState, 切片内 action creators }`。**铁律（spec §5.3）**：slice Provider 内的 `useEffect` 只订阅自己切片的 state，严禁订阅任何其他切片。

按切片分 4 步，每步独立提交？不——保持单 commit（spec §10.1 commit 6 对应整个 Provider 层），但实现顺序仍 gateway → agent → session → chat。

**Files:**
- Create: `src/lib/store/gateway/store.tsx`
- Create: `src/lib/store/agent/store.tsx`
- Create: `src/lib/store/session/store.tsx`
- Create: `src/lib/store/chat/store.tsx`

- [ ] **Step 1: Gateway Provider**

Create `src/lib/store/gateway/store.tsx`:

```tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { v4 as uuidv4 } from "uuid";
import type { Company, ChatEventPayload, ConnectionStatus } from "@/types";
import {
  createCompany as dbCreateCompany,
  updateCompany as dbUpdateCompany,
} from "@/lib/db";
import { RuntimeClient } from "@/lib/runtime";
import { gatewayReducer, initialGatewayState } from "./reducer";
import type { GatewayState, GatewayAction } from "./types";

export type GatewayChatEventHandler = (payload: ChatEventPayload) => void;

export interface GatewayStoreValue {
  state: GatewayState;
  dispatch: React.Dispatch<GatewayAction>;
  getState: () => GatewayState;
  clientRef: React.MutableRefObject<RuntimeClient | null>;
  registerChatEventHandler: (fn: GatewayChatEventHandler | null) => void;
  connect: () => void;
  disconnect: () => void;
  createCompany: (
    name: string,
    gatewayUrl: string,
    gatewayToken: string,
    description?: string,
  ) => Promise<Company>;
  updateCompany: (id: string, updates: Partial<Company>) => Promise<void>;
  restartGateway: () => Promise<void>;
}

const GatewayContext = createContext<GatewayStoreValue | null>(null);

export function GatewayProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(gatewayReducer, initialGatewayState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clientRef = useRef<RuntimeClient | null>(null);
  const chatEventHandlerRef = useRef<GatewayChatEventHandler | null>(null);

  const getState = useCallback(() => stateRef.current, []);
  const registerChatEventHandler = useCallback(
    (fn: GatewayChatEventHandler | null) => {
      chatEventHandlerRef.current = fn;
    },
    [],
  );

  const connect = useCallback(() => {
    const current = stateRef.current;
    const company = current.companies.find(c => c.id === current.activeCompanyId);
    if (!company?.gatewayUrl || !company?.gatewayToken) return;

    if (clientRef.current) {
      clientRef.current.destroy();
    }

    const client = new RuntimeClient();
    clientRef.current = client;

    const runtimeConfig = {
      type: company.runtimeType || ("openclaw" as const),
      baseUrl: company.gatewayUrl
        .replace(/^ws:\/\//, "http://")
        .replace(/^wss:\/\//, "https://"),
      apiKey: company.gatewayToken,
      model: company.model,
      headers: company.customHeaders ? JSON.parse(company.customHeaders) : undefined,
    };

    client.configure(runtimeConfig, {
      onConnectionStatus: (status: ConnectionStatus) => {
        dispatch({ type: "SET_CONNECTION_STATUS", status });
      },
      onChatEvent: (payload: ChatEventPayload) => {
        chatEventHandlerRef.current?.(payload);
      },
      onError: () => {},
    });

    client.connect();
  }, []);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.destroy();
      clientRef.current = null;
    }
    dispatch({ type: "SET_CONNECTION_STATUS", status: "disconnected" });
  }, []);

  const createCompany = useCallback(
    async (name: string, gatewayUrl: string, gatewayToken: string, description?: string) => {
      const now = Date.now();
      const company: Company = {
        id: uuidv4(),
        name,
        description,
        runtimeType: "openclaw",
        gatewayUrl,
        gatewayToken,
        createdAt: now,
        updatedAt: now,
      };
      await dbCreateCompany(company);
      dispatch({ type: "ADD_COMPANY", company });
      return company;
    },
    [],
  );

  const updateCompany = useCallback(
    async (id: string, updates: Partial<Company>) => {
      await dbUpdateCompany(id, updates);
      dispatch({ type: "UPDATE_COMPANY", id, updates });

      const current = stateRef.current;
      const needsReconnect =
        (updates.gatewayUrl ||
          updates.gatewayToken ||
          updates.runtimeType ||
          updates.model ||
          updates.customHeaders) &&
        current.activeCompanyId === id;
      if (needsReconnect) {
        setTimeout(() => connect(), 100);
      }
    },
    [connect],
  );

  const restartGateway = useCallback(async () => {
    try {
      await fetch("/api/gateway/restart", { method: "POST" });
      disconnect();
      setTimeout(() => connect(), 2000);
    } catch {
      // Failed to restart
    }
  }, [connect, disconnect]);

  // Self-auto-connect: subscribe ONLY to gateway's own state (spec §5.3 铁律)
  useEffect(() => {
    if (!state.initialized) return;
    const company = state.companies.find(c => c.id === state.activeCompanyId);
    if (company?.gatewayUrl && company?.gatewayToken) {
      connect();
    }
  }, [state.initialized, state.activeCompanyId, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.destroy();
        clientRef.current = null;
      }
    };
  }, []);

  const value = useMemo<GatewayStoreValue>(
    () => ({
      state,
      dispatch,
      getState,
      clientRef,
      registerChatEventHandler,
      connect,
      disconnect,
      createCompany,
      updateCompany,
      restartGateway,
    }),
    [state, getState, registerChatEventHandler, connect, disconnect, createCompany, updateCompany, restartGateway],
  );

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function useGatewayStore(): GatewayStoreValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error("useGatewayStore must be used within GatewayProvider");
  return ctx;
}
```

- [ ] **Step 2: Agent Provider**

Create `src/lib/store/agent/store.tsx`:

```tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { Agent, AgentTeam } from "@/types";
import {
  updateAgent as dbUpdateAgent,
  createTeam as dbCreateTeam,
  updateTeam as dbUpdateTeam,
} from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { agentReducer, initialAgentState } from "./reducer";
import type { AgentState, AgentAction } from "./types";

export interface AgentStoreValue {
  state: AgentState;
  dispatch: React.Dispatch<AgentAction>;
  getState: () => AgentState;
  updateAgent: (id: string, updates: Partial<Agent>) => Promise<void>;
  createTeam: (opts: {
    companyId: string;
    name: string;
    description?: string;
    agentIds: string[];
    tlAgentId?: string;
  }) => Promise<AgentTeam>;
  updateTeam: (id: string, updates: Partial<AgentTeam>) => Promise<void>;
}

const AgentContext = createContext<AgentStoreValue | null>(null);

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(agentReducer, initialAgentState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);

  const updateAgent = useCallback(async (id: string, updates: Partial<Agent>) => {
    await dbUpdateAgent(id, updates);
    dispatch({ type: "UPDATE_AGENT", id, updates });
  }, []);

  const createTeam = useCallback(
    async (opts: {
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
    },
    [],
  );

  const updateTeam = useCallback(async (id: string, updates: Partial<AgentTeam>) => {
    await dbUpdateTeam(id, updates);
    dispatch({ type: "UPDATE_TEAM", id, updates });
  }, []);

  const value = useMemo<AgentStoreValue>(
    () => ({ state, dispatch, getState, updateAgent, createTeam, updateTeam }),
    [state, getState, updateAgent, createTeam, updateTeam],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgentStore(): AgentStoreValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgentStore must be used within AgentProvider");
  return ctx;
}
```

- [ ] **Step 3: Session Provider**

Create `src/lib/store/session/store.tsx`:

```tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { v4 as uuidv4 } from "uuid";
import type { ChatTargetType, Conversation } from "@/types";
import {
  createConversation as dbCreateConversation,
  updateConversation as dbUpdateConversation,
} from "@/lib/db";
import { dmSessionKey } from "@/lib/store/session-keys";
import { sessionReducer, initialSessionState } from "./reducer";
import type { SessionState, SessionAction } from "./types";

export interface SessionStoreValue {
  state: SessionState;
  dispatch: React.Dispatch<SessionAction>;
  getState: () => SessionState;
  createConversation: (
    targetType: ChatTargetType,
    targetId: string,
    activeCompanyId: string | null,
  ) => Promise<string>;
  renameConversation: (id: string, title: string) => Promise<void>;
}

const SessionContext = createContext<SessionStoreValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);

  const createConversation = useCallback(
    async (
      targetType: ChatTargetType,
      targetId: string,
      activeCompanyId: string | null,
    ): Promise<string> => {
      const now = Date.now();

      if (targetType === "agent") {
        const sessionKey = dmSessionKey(targetId, uuidv4());
        const conv: Conversation = {
          id: sessionKey,
          targetType,
          targetId,
          companyId: activeCompanyId ?? "",
          title: "New Session",
          createdAt: now,
          updatedAt: now,
          source: "native-session",
          sessionKey,
        };
        dispatch({ type: "ADD_CONVERSATION", conversation: conv });
        dispatch({ type: "SET_ACTIVE_CONVERSATION", id: conv.id });
        dispatch({ type: "SET_MESSAGES", messages: [] });
        return conv.id;
      }

      const conv: Conversation = {
        id: uuidv4(),
        targetType,
        targetId,
        companyId: activeCompanyId ?? "",
        title: "New Chat",
        createdAt: now,
        updatedAt: now,
      };
      await dbCreateConversation(conv);
      dispatch({ type: "ADD_CONVERSATION", conversation: conv });
      dispatch({ type: "SET_ACTIVE_CONVERSATION", id: conv.id });
      dispatch({ type: "SET_MESSAGES", messages: [] });
      return conv.id;
    },
    [],
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    const conversation = stateRef.current.conversations.find(c => c.id === id);
    if (conversation?.source === "native-session") {
      dispatch({ type: "UPDATE_CONVERSATION", id, updates: { title } });
      return;
    }
    await dbUpdateConversation(id, { title });
    dispatch({ type: "UPDATE_CONVERSATION", id, updates: { title } });
  }, []);

  const value = useMemo<SessionStoreValue>(
    () => ({ state, dispatch, getState, createConversation, renameConversation }),
    [state, getState, createConversation, renameConversation],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionStore(): SessionStoreValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionStore must be used within SessionProvider");
  return ctx;
}
```

- [ ] **Step 4: Chat Provider**

Create `src/lib/store/chat/store.tsx`:

```tsx
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { chatReducer, initialChatState } from "./reducer";
import type { ChatSliceState, ChatAction } from "./types";

export interface ChatStoreValue {
  state: ChatSliceState;
  dispatch: React.Dispatch<ChatAction>;
  getState: () => ChatSliceState;
  pendingStreamResolvers: React.MutableRefObject<Map<string, () => void>>;
  teamAbortedRef: React.MutableRefObject<Map<string, boolean>>;
}

const ChatContext = createContext<ChatStoreValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);

  const pendingStreamResolvers = useRef<Map<string, () => void>>(new Map());
  const teamAbortedRef = useRef<Map<string, boolean>>(new Map());

  const value = useMemo<ChatStoreValue>(
    () => ({ state, dispatch, getState, pendingStreamResolvers, teamAbortedRef }),
    [state, getState],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatStore(): ChatStoreValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatStore must be used within ChatProvider");
  return ctx;
}
```

- [ ] **Step 5: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected：全部通过。Provider 未被任何组件使用，build 仍基于 store-legacy，所以老系统不受影响。

- [ ] **Step 6: Commit**

```bash
git add src/lib/store/gateway/store.tsx src/lib/store/agent/store.tsx src/lib/store/session/store.tsx src/lib/store/chat/store.tsx
git commit -m "feat(store): add 4 slice Providers with per-slice CRUD actions"
```

---

## Task 7: bootstrap + agent-sync coordinator

**目的：** 抽出两个最独立的跨切 coordinator，作为 coordinator 模式的首批落地样本。

**Files:**
- Create: `src/lib/store/coordinators/agent-sync.ts`
- Create: `src/lib/store/coordinators/agent-sync.test.ts`
- Create: `src/lib/store/coordinators/bootstrap.ts`
- Create: `src/lib/store/coordinators/bootstrap.test.ts`

- [ ] **Step 1: 先写 agent-sync 失败测试**

Create `src/lib/store/coordinators/agent-sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, Company } from "@/types";
import type { AgentAction } from "@/lib/store/agent/types";
import type { GatewayState } from "@/lib/store/gateway/types";
import type { AgentState } from "@/lib/store/agent/types";
import { syncAgents } from "./agent-sync";

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "c1",
    name: "co",
    runtimeType: "openclaw",
    gatewayUrl: "http://gw",
    gatewayToken: "tk",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id, companyId: "c1", name: `ag-${id}`,
    description: "", specialty: "general", createdAt: 0,
    ...overrides,
  };
}

function mockEnv(opts: {
  gateway: Partial<GatewayState>;
  agent: Partial<AgentState>;
  fetchResponse: unknown;
  fetchOk?: boolean;
}) {
  const gatewayState: GatewayState = {
    companies: [], activeCompanyId: null, connectionStatus: "disconnected", initialized: true,
    ...opts.gateway,
  };
  const agentState: AgentState = {
    agents: [], teams: [], agentIdentities: {},
    ...opts.agent,
  };
  const dispatchAgent = vi.fn<(a: AgentAction) => void>();
  const dbUpdateAgent = vi.fn(async () => {});
  const dbCreateAgent = vi.fn(async () => {});
  const fetchFn = vi.fn(async () => ({
    ok: opts.fetchOk ?? true,
    json: async () => opts.fetchResponse,
  })) as unknown as typeof fetch;
  return {
    getGatewayState: () => gatewayState,
    getAgentState: () => agentState,
    dispatchAgent,
    dbUpdateAgent,
    dbCreateAgent,
    fetchFn,
  };
}

describe("syncAgents coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-op when no active company", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: null },
      agent: {},
      fetchResponse: { agents: [] },
    });
    await syncAgents(env);
    expect(env.fetchFn).not.toHaveBeenCalled();
    expect(env.dispatchAgent).not.toHaveBeenCalled();
  });

  it("no-op when company is not openclaw", async () => {
    const env = mockEnv({
      gateway: {
        companies: [company({ runtimeType: "custom" })],
        activeCompanyId: "c1",
      },
      agent: {},
      fetchResponse: { agents: [] },
    });
    await syncAgents(env);
    expect(env.fetchFn).not.toHaveBeenCalled();
  });

  it("creates new agents not present locally", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [] },
      fetchResponse: { agents: [{ id: "a1", name: "New", avatar: "a.png" }] },
    });
    await syncAgents(env);
    expect(env.dbCreateAgent).toHaveBeenCalledOnce();
    expect(env.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_AGENT",
        agent: expect.objectContaining({ id: "a1", name: "New" }),
      }),
    );
  });

  it("updates existing agent name when NOT customName", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [agent("a1", { name: "Old", customName: false })] },
      fetchResponse: { agents: [{ id: "a1", name: "New" }] },
    });
    await syncAgents(env);
    expect(env.dispatchAgent).toHaveBeenCalledWith({
      type: "UPDATE_AGENT",
      id: "a1",
      updates: { name: "New" },
    });
  });

  it("does NOT update name when customName=true (user rename protection)", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [agent("a1", { name: "MyCustom", customName: true })] },
      fetchResponse: { agents: [{ id: "a1", name: "New" }] },
    });
    await syncAgents(env);
    const nameUpdate = env.dispatchAgent.mock.calls.find(
      c => c[0].type === "UPDATE_AGENT" && "name" in (c[0] as { updates?: { name?: string } }).updates!,
    );
    expect(nameUpdate).toBeUndefined();
  });

  it("still updates avatar even when customName=true", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: { agents: [agent("a1", { name: "MyCustom", customName: true, avatar: "old.png" })] },
      fetchResponse: { agents: [{ id: "a1", name: "ignored", avatar: "new.png" }] },
    });
    await syncAgents(env);
    expect(env.dispatchAgent).toHaveBeenCalledWith({
      type: "UPDATE_AGENT",
      id: "a1",
      updates: { avatar: "new.png" },
    });
  });

  it("swallows fetch failure silently (matches legacy behavior)", async () => {
    const env = mockEnv({
      gateway: { companies: [company()], activeCompanyId: "c1" },
      agent: {},
      fetchResponse: null,
      fetchOk: false,
    });
    // simulate network error
    env.fetchFn = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    await expect(syncAgents(env)).resolves.toBeUndefined();
    expect(env.dispatchAgent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 确认 agent-sync 测试失败**

```bash
pnpm test src/lib/store/coordinators/agent-sync.test.ts
```

Expected：`Cannot find module './agent-sync'`.

- [ ] **Step 3: 实现 agent-sync coordinator**

Create `src/lib/store/coordinators/agent-sync.ts`:

```ts
import type { Agent, AgentSpecialty } from "@/types";
import type { GatewayState } from "@/lib/store/gateway/types";
import type { AgentState, AgentAction } from "@/lib/store/agent/types";

export interface SyncAgentsOpts {
  getGatewayState: () => GatewayState;
  getAgentState: () => AgentState;
  dispatchAgent: (action: AgentAction) => void;
  dbUpdateAgent: (id: string, updates: Partial<Agent>) => Promise<unknown>;
  dbCreateAgent: (agent: Agent) => Promise<unknown>;
  fetchFn?: typeof fetch;
}

interface GatewayAgentPayload {
  id: string;
  name?: string;
  avatar?: string;
}

export async function syncAgents(opts: SyncAgentsOpts): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  const gateway = opts.getGatewayState();
  const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);
  if (!company?.gatewayUrl || !company?.gatewayToken) return;
  if (company.runtimeType !== "openclaw") return;

  try {
    const res = await fetchFn("/api/agents/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gatewayUrl: company.gatewayUrl,
        gatewayToken: company.gatewayToken,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { agents?: GatewayAgentPayload[] };
    if (!data.agents) return;

    const agentState = opts.getAgentState();
    const existingAgents = agentState.agents.filter(a => a.companyId === company.id);
    const existingMap = new Map(existingAgents.map(a => [a.id, a]));

    for (const agentData of data.agents) {
      const existing = existingMap.get(agentData.id);
      if (existing) {
        const updates: Partial<Agent> = {};
        if (!existing.customName && agentData.name && agentData.name !== existing.name) {
          updates.name = agentData.name;
        }
        if (agentData.avatar !== undefined && agentData.avatar !== existing.avatar) {
          updates.avatar = agentData.avatar;
        }
        if (Object.keys(updates).length > 0) {
          await opts.dbUpdateAgent(existing.id, updates);
          opts.dispatchAgent({ type: "UPDATE_AGENT", id: existing.id, updates });
        }
      } else {
        const agent: Agent = {
          id: agentData.id,
          companyId: company.id,
          name: agentData.name ?? agentData.id,
          avatar: agentData.avatar,
          description: agentData.name ? `OpenClaw agent: ${agentData.name}` : "",
          specialty: "general" as AgentSpecialty,
          createdAt: Date.now(),
        };
        try {
          await opts.dbCreateAgent(agent);
          opts.dispatchAgent({ type: "ADD_AGENT", agent });
        } catch {
          // Agent may already exist in another company — skip silently (matches legacy)
        }
      }
    }
  } catch {
    // Sync failed silently (matches legacy)
  }
}
```

- [ ] **Step 4: 确认 agent-sync 测试通过**

```bash
pnpm test src/lib/store/coordinators/agent-sync.test.ts
```

Expected：7 个测试全 PASS。

- [ ] **Step 5: 先写 bootstrap 失败测试**

Create `src/lib/store/coordinators/bootstrap.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, Company, AgentTeam } from "@/types";
import type { GatewayAction } from "@/lib/store/gateway/types";
import type { AgentAction } from "@/lib/store/agent/types";
import { initializeApp } from "./bootstrap";

function makeDeps(overrides: {
  existingCompanies?: Company[];
  existingAgents?: Agent[];
  existingTeams?: AgentTeam[];
  bootstrapResponse?: unknown;
  agentsSyncResponse?: unknown;
} = {}) {
  const dispatchGateway = vi.fn<(a: GatewayAction) => void>();
  const dispatchAgent = vi.fn<(a: AgentAction) => void>();

  const getAllCompanies = vi.fn(async () => overrides.existingCompanies ?? []);
  const getAgentsByCompany = vi.fn(async () => overrides.existingAgents ?? []);
  const getTeamsByCompany = vi.fn(async () => overrides.existingTeams ?? []);
  const dbCreateCompany = vi.fn(async () => {});
  const dbCreateAgent = vi.fn(async () => {});
  const dbUpdateAgent = vi.fn(async () => {});

  const fetchFn = vi.fn(async (url: string) => {
    if (url.endsWith("/api/bootstrap")) {
      return {
        ok: true,
        json: async () => overrides.bootstrapResponse ?? { found: false },
      };
    }
    if (url.endsWith("/api/agents/sync")) {
      return {
        ok: true,
        json: async () => overrides.agentsSyncResponse ?? { agents: [] },
      };
    }
    return { ok: false, json: async () => ({}) };
  }) as unknown as typeof fetch;

  return {
    dispatchGateway, dispatchAgent,
    getAllCompanies, getAgentsByCompany, getTeamsByCompany,
    dbCreateCompany, dbCreateAgent, dbUpdateAgent,
    fetchFn,
  };
}

describe("initializeApp coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no existing companies + bootstrap miss → only SET_INITIALIZED", async () => {
    const deps = makeDeps({ bootstrapResponse: { found: false } });
    await initializeApp(deps);
    expect(deps.dispatchGateway).toHaveBeenCalledWith({ type: "SET_INITIALIZED" });
    expect(deps.dispatchGateway).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_COMPANY" }),
    );
  });

  it("no existing companies + bootstrap hit creates company + agents", async () => {
    const deps = makeDeps({
      bootstrapResponse: {
        found: true,
        gateway: { url: "http://gw", token: "tk" },
        agents: [{ id: "a1", name: "A1" }],
      },
      agentsSyncResponse: { agents: [{ id: "a1", name: "A1" }] },
    });
    await initializeApp(deps);
    expect(deps.dispatchGateway).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_COMPANY" }),
    );
    expect(deps.dispatchGateway).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_ACTIVE_COMPANY" }),
    );
    expect(deps.dbCreateAgent).toHaveBeenCalled();
    expect(deps.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_AGENT" }),
    );
    expect(deps.dispatchGateway).toHaveBeenLastCalledWith({ type: "SET_INITIALIZED" });
  });

  it("existing companies → loads first + activates + fetches agents/teams", async () => {
    const co: Company = {
      id: "c1", name: "Existing", runtimeType: "openclaw",
      gatewayUrl: "http://gw", gatewayToken: "tk",
      createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      existingCompanies: [co],
      existingAgents: [{
        id: "a1", companyId: "c1", name: "X",
        description: "", specialty: "general", createdAt: 0,
      }],
      existingTeams: [{
        id: "t1", companyId: "c1", name: "Team", agentIds: ["a1"], createdAt: 0,
      }],
    });
    await initializeApp(deps);
    expect(deps.dispatchGateway).toHaveBeenCalledWith({
      type: "SET_COMPANIES", companies: [co],
    });
    expect(deps.dispatchGateway).toHaveBeenCalledWith({
      type: "SET_ACTIVE_COMPANY", id: "c1",
    });
    expect(deps.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_AGENTS" }),
    );
    expect(deps.dispatchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_TEAMS" }),
    );
    expect(deps.dispatchGateway).toHaveBeenLastCalledWith({ type: "SET_INITIALIZED" });
  });

  it("swallows bootstrap fetch failure silently", async () => {
    const deps = makeDeps();
    deps.fetchFn = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    await expect(initializeApp(deps)).resolves.toBeUndefined();
    expect(deps.dispatchGateway).toHaveBeenCalledWith({ type: "SET_INITIALIZED" });
  });
});
```

- [ ] **Step 6: 确认 bootstrap 测试失败**

```bash
pnpm test src/lib/store/coordinators/bootstrap.test.ts
```

Expected：`Cannot find module './bootstrap'`.

- [ ] **Step 7: 实现 bootstrap coordinator**

Create `src/lib/store/coordinators/bootstrap.ts`:

```ts
import { v4 as uuidv4 } from "uuid";
import type {
  Agent, AgentSpecialty, AgentTeam, Company,
} from "@/types";
import type { GatewayAction } from "@/lib/store/gateway/types";
import type { AgentAction } from "@/lib/store/agent/types";

export interface InitializeAppOpts {
  dispatchGateway: (a: GatewayAction) => void;
  dispatchAgent: (a: AgentAction) => void;

  getAllCompanies: () => Promise<Company[]>;
  getAgentsByCompany: (companyId: string) => Promise<Agent[]>;
  getTeamsByCompany: (companyId: string) => Promise<AgentTeam[]>;

  dbCreateCompany: (c: Company) => Promise<unknown>;
  dbCreateAgent: (a: Agent) => Promise<unknown>;
  dbUpdateAgent: (id: string, updates: Partial<Agent>) => Promise<unknown>;

  fetchFn?: typeof fetch;
}

interface BootstrapPayload {
  found: boolean;
  gateway?: { url: string; token: string };
  agents?: { id: string; name: string; avatar?: string }[];
}

interface SyncPayload {
  agents?: { id: string; name?: string; avatar?: string }[];
}

export async function initializeApp(opts: InitializeAppOpts): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;

  try {
    const companies = await opts.getAllCompanies();

    if (companies.length === 0) {
      await bootstrapFromGateway(opts, fetchFn);
    } else {
      await loadExistingCompany(opts, companies);
    }
  } finally {
    opts.dispatchGateway({ type: "SET_INITIALIZED" });
  }
}

async function bootstrapFromGateway(
  opts: InitializeAppOpts,
  fetchFn: typeof fetch,
): Promise<void> {
  try {
    const res = await fetchFn("/api/bootstrap");
    const data = (await res.json()) as BootstrapPayload;
    if (!data.found || !data.gateway) return;

    const companyId = uuidv4();
    const company: Company = {
      id: companyId,
      name: "OpenClaw",
      description: "Auto-configured from OpenClaw Gateway",
      runtimeType: "openclaw",
      gatewayUrl: data.gateway.url,
      gatewayToken: data.gateway.token,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await opts.dbCreateCompany(company);
    opts.dispatchGateway({ type: "ADD_COMPANY", company });
    opts.dispatchGateway({ type: "SET_ACTIVE_COMPANY", id: companyId });

    let agentsToCreate = data.agents ?? [];
    try {
      const syncRes = await fetchFn("/api/agents/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gatewayUrl: data.gateway.url,
          gatewayToken: data.gateway.token,
        }),
      });
      const syncData = (await syncRes.json()) as SyncPayload;
      if (syncData.agents?.length) {
        agentsToCreate = syncData.agents.map(a => ({
          id: a.id, name: a.name ?? a.id, avatar: a.avatar,
        }));
      }
    } catch {
      // Fallback to config file agents
    }

    for (const agentConfig of agentsToCreate) {
      const agent: Agent = {
        id: agentConfig.id,
        companyId,
        name: agentConfig.name,
        avatar: agentConfig.avatar,
        description: `OpenClaw agent: ${agentConfig.name}`,
        specialty: "general" as AgentSpecialty,
        createdAt: Date.now(),
      };
      await opts.dbCreateAgent(agent);
      opts.dispatchAgent({ type: "ADD_AGENT", agent });
    }
  } catch {
    // Bootstrap failed silently; user can configure manually
  }
}

async function loadExistingCompany(
  opts: InitializeAppOpts,
  companies: Company[],
): Promise<void> {
  opts.dispatchGateway({ type: "SET_COMPANIES", companies });
  const firstId = companies[0].id;
  opts.dispatchGateway({ type: "SET_ACTIVE_COMPANY", id: firstId });

  const [agents, teams] = await Promise.all([
    opts.getAgentsByCompany(firstId),
    opts.getTeamsByCompany(firstId),
  ]);
  opts.dispatchAgent({ type: "SET_AGENTS", agents });
  opts.dispatchAgent({ type: "SET_TEAMS", teams });

  // Background agent sync (ignored on failure)
  const company = companies[0];
  if (
    company?.runtimeType === "openclaw" &&
    company?.gatewayUrl &&
    company?.gatewayToken
  ) {
    const fetchFn = opts.fetchFn ?? fetch;
    fetchFn("/api/agents/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gatewayUrl: company.gatewayUrl,
        gatewayToken: company.gatewayToken,
      }),
    })
      .then(r => r.json())
      .then(async (data: SyncPayload) => {
        if (!data.agents?.length) return;
        const existingMap = new Map(agents.map(a => [a.id, a]));
        for (const agentData of data.agents) {
          const existing = existingMap.get(agentData.id);
          if (existing) {
            const updates: Partial<Agent> = {};
            if (!existing.customName && agentData.name && agentData.name !== existing.name) {
              updates.name = agentData.name;
            }
            if (agentData.avatar !== undefined && agentData.avatar !== existing.avatar) {
              updates.avatar = agentData.avatar;
            }
            if (Object.keys(updates).length > 0) {
              await opts.dbUpdateAgent(existing.id, updates);
              opts.dispatchAgent({ type: "UPDATE_AGENT", id: existing.id, updates });
            }
          } else {
            const agent: Agent = {
              id: agentData.id,
              companyId: firstId,
              name: agentData.name ?? agentData.id,
              avatar: agentData.avatar,
              description: "",
              specialty: "general" as AgentSpecialty,
              createdAt: Date.now(),
            };
            try {
              await opts.dbCreateAgent(agent);
              opts.dispatchAgent({ type: "ADD_AGENT", agent });
            } catch { /* skip duplicate */ }
          }
        }
      })
      .catch(() => { /* sync failed silently */ });
  }
}
```

- [ ] **Step 8: 确认 bootstrap 测试通过**

```bash
pnpm test src/lib/store/coordinators/bootstrap.test.ts
```

Expected：4 个测试全 PASS。

- [ ] **Step 9: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 10: Commit**

```bash
git add src/lib/store/coordinators/bootstrap.ts src/lib/store/coordinators/bootstrap.test.ts src/lib/store/coordinators/agent-sync.ts src/lib/store/coordinators/agent-sync.test.ts
git commit -m "feat(store/coordinators): add bootstrap + agent-sync with tests"
```

---

## Task 8: company-cascade + native-sessions coordinator

**目的：** company 切换/删除的跨切级联；native-session 列表拉取 + 选中/删除。

**Files:**
- Create: `src/lib/store/coordinators/company-cascade.ts`
- Create: `src/lib/store/coordinators/company-cascade.test.ts`
- Create: `src/lib/store/coordinators/native-sessions.ts`
- Create: `src/lib/store/coordinators/native-sessions.test.ts`

- [ ] **Step 1: 写 company-cascade 失败测试**

Create `src/lib/store/coordinators/company-cascade.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Agent, AgentTeam, Company } from "@/types";
import { selectCompany, deleteCompany } from "./company-cascade";

function company(id: string, overrides: Partial<Company> = {}): Company {
  return {
    id, name: `co-${id}`, runtimeType: "openclaw",
    gatewayUrl: "http://gw", gatewayToken: "tk",
    createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

function makeDeps(activeId: string | null = null, cos: Company[] = []) {
  return {
    getGatewayState: () => ({
      companies: cos,
      activeCompanyId: activeId,
      connectionStatus: "connected" as const,
      initialized: true,
    }),
    dispatchGateway: vi.fn(),
    dispatchAgent: vi.fn(),
    dispatchSession: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    dbDeleteCompany: vi.fn(async () => {}),
    getAgentsByCompany: vi.fn(async (_id: string): Promise<Agent[]> => []),
    getTeamsByCompany: vi.fn(async (_id: string): Promise<AgentTeam[]> => []),
    syncAgents: vi.fn(async () => {}),
  };
}

describe("selectCompany coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disconnects, sets active, resets session, loads agents/teams, schedules connect + syncAgents", async () => {
    const co = company("c1");
    const deps = makeDeps("c0", [co]);
    deps.getAgentsByCompany = vi.fn(async () => [
      { id: "a1", companyId: "c1", name: "X", description: "", specialty: "general", createdAt: 0 } as Agent,
    ]);
    deps.getTeamsByCompany = vi.fn(async () => [
      { id: "t1", companyId: "c1", name: "T", agentIds: ["a1"], createdAt: 0 } as AgentTeam,
    ]);

    await selectCompany("c1", deps);

    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(deps.dispatchGateway).toHaveBeenCalledWith({ type: "SET_ACTIVE_COMPANY", id: "c1" });
    expect(deps.dispatchSession).toHaveBeenCalledWith({ type: "RESET_SESSION_ON_COMPANY_CHANGE" });
    expect(deps.dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({ type: "SET_AGENTS" }));
    expect(deps.dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({ type: "SET_TEAMS" }));
    expect(deps.syncAgents).toHaveBeenCalled();
  });
});

describe("deleteCompany coordinator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disconnects only when deleting the active company", async () => {
    const deps = makeDeps("c1", [company("c1")]);
    await deleteCompany("c1", deps);
    expect(deps.disconnect).toHaveBeenCalledOnce();
    expect(deps.dbDeleteCompany).toHaveBeenCalledWith("c1");
    expect(deps.dispatchGateway).toHaveBeenCalledWith({ type: "REMOVE_COMPANY", id: "c1" });
    expect(deps.dispatchAgent).toHaveBeenCalledWith({
      type: "CLEAR_AGENTS_FOR_COMPANY",
      companyId: "c1",
    });
  });

  it("does NOT disconnect when deleting a non-active company", async () => {
    const deps = makeDeps("c1", [company("c1"), company("c2")]);
    await deleteCompany("c2", deps);
    expect(deps.disconnect).not.toHaveBeenCalled();
    expect(deps.dispatchAgent).toHaveBeenCalledWith({
      type: "CLEAR_AGENTS_FOR_COMPANY",
      companyId: "c2",
    });
  });

  it("resets session when deleting active company", async () => {
    const deps = makeDeps("c1", [company("c1")]);
    await deleteCompany("c1", deps);
    expect(deps.dispatchSession).toHaveBeenCalledWith({ type: "RESET_SESSION_ON_COMPANY_CHANGE" });
  });
});
```

- [ ] **Step 2: 确认失败**

```bash
pnpm test src/lib/store/coordinators/company-cascade.test.ts
```

Expected：`Cannot find module './company-cascade'`.

- [ ] **Step 3: 实现 company-cascade**

Create `src/lib/store/coordinators/company-cascade.ts`:

```ts
import type { Agent, AgentTeam } from "@/types";
import type { GatewayState, GatewayAction } from "@/lib/store/gateway/types";
import type { AgentAction } from "@/lib/store/agent/types";
import type { SessionAction } from "@/lib/store/session/types";

export interface CompanyCascadeDeps {
  getGatewayState: () => GatewayState;
  dispatchGateway: (a: GatewayAction) => void;
  dispatchAgent: (a: AgentAction) => void;
  dispatchSession: (a: SessionAction) => void;
  disconnect: () => void;
  connect: () => void;
  dbDeleteCompany: (id: string) => Promise<unknown>;
  getAgentsByCompany: (id: string) => Promise<Agent[]>;
  getTeamsByCompany: (id: string) => Promise<AgentTeam[]>;
  syncAgents: () => Promise<void>;
}

export async function selectCompany(
  id: string,
  deps: CompanyCascadeDeps,
): Promise<void> {
  deps.disconnect();
  deps.dispatchGateway({ type: "SET_ACTIVE_COMPANY", id });
  deps.dispatchSession({ type: "RESET_SESSION_ON_COMPANY_CHANGE" });

  const [agents, teams] = await Promise.all([
    deps.getAgentsByCompany(id),
    deps.getTeamsByCompany(id),
  ]);
  deps.dispatchAgent({ type: "SET_AGENTS", agents });
  deps.dispatchAgent({ type: "SET_TEAMS", teams });

  // Gateway auto-connect effect (§5.3 铁律) will pick up the new activeCompanyId.
  // Explicit sync for agents.
  await deps.syncAgents();
}

export async function deleteCompany(
  id: string,
  deps: CompanyCascadeDeps,
): Promise<void> {
  const current = deps.getGatewayState();
  const wasActive = current.activeCompanyId === id;

  if (wasActive) {
    deps.disconnect();
  }

  await deps.dbDeleteCompany(id);
  deps.dispatchGateway({ type: "REMOVE_COMPANY", id });
  deps.dispatchAgent({ type: "CLEAR_AGENTS_FOR_COMPANY", companyId: id });

  if (wasActive) {
    deps.dispatchSession({ type: "RESET_SESSION_ON_COMPANY_CHANGE" });
  }
}
```

- [ ] **Step 4: 确认 company-cascade 通过**

```bash
pnpm test src/lib/store/coordinators/company-cascade.test.ts
```

Expected：4 个测试全 PASS。

- [ ] **Step 5: 写 native-sessions 失败测试**

Create `src/lib/store/coordinators/native-sessions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Company, Conversation } from "@/types";
import {
  fetchNativeAgentSessions,
  selectChatTarget,
  selectConversation,
  deleteConversation,
} from "./native-sessions";

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "c1", name: "co", runtimeType: "openclaw",
    gatewayUrl: "http://gw", gatewayToken: "tk",
    createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

describe("fetchNativeAgentSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears conversations when no gateway credentials", async () => {
    const dispatchSession = vi.fn();
    await fetchNativeAgentSessions("a1", {
      getGatewayState: () => ({
        companies: [company({ gatewayUrl: "", gatewayToken: "" })],
        activeCompanyId: "c1",
        connectionStatus: "disconnected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: vi.fn(),
      parseSessions: vi.fn(() => []),
      parseMessages: vi.fn(() => []),
    });
    expect(dispatchSession).toHaveBeenCalledWith({ type: "SET_CONVERSATIONS", conversations: [] });
    expect(dispatchSession).toHaveBeenCalledWith({ type: "SET_ACTIVE_CONVERSATION", id: null });
    expect(dispatchSession).toHaveBeenCalledWith({ type: "SET_MESSAGES", messages: [] });
  });

  it("listOnly mode preserves active conversation + messages", async () => {
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async () => ({ ok: true, payload: {} }));
    await fetchNativeAgentSessions("a1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: rpc,
      parseSessions: () => [
        {
          id: "s1", targetType: "agent", targetId: "a1", companyId: "c1",
          title: "S", createdAt: 0, updatedAt: 0, source: "native-session",
        } as Conversation,
      ],
      parseMessages: () => [],
    }, "s1", { listOnly: true });
    expect(dispatchSession).toHaveBeenCalledWith({
      type: "SET_CONVERSATIONS",
      conversations: expect.any(Array),
    });
    expect(dispatchSession).toHaveBeenCalledWith({
      type: "SET_ACTIVE_CONVERSATION",
      id: "s1",
    });
    // listOnly must NOT clear messages
    const clearedMessages = dispatchSession.mock.calls.some(
      c => c[0].type === "SET_MESSAGES" && (c[0] as { messages: unknown[] }).messages.length === 0,
    );
    expect(clearedMessages).toBe(false);
  });

  it("full fetch: picks preferred session when present, then loads history", async () => {
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async (_url: string, _tk: string, method: string) => {
      if (method === "sessions.list") return { ok: true, payload: {} };
      if (method === "chat.history") return { ok: true, payload: {} };
      return { ok: false };
    });
    const parseMessages = vi.fn(() => []);
    await fetchNativeAgentSessions("a1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: rpc,
      parseSessions: () => [
        { id: "s1" } as Conversation,
        { id: "s2" } as Conversation,
      ],
      parseMessages,
    }, "s2");
    expect(dispatchSession).toHaveBeenCalledWith({ type: "SET_ACTIVE_CONVERSATION", id: "s2" });
    expect(parseMessages).toHaveBeenCalled();
  });
});

describe("selectChatTarget", () => {
  beforeEach(() => vi.clearAllMocks());

  it("agent + openclaw: delegates to fetchNativeAgentSessions path via rpc", async () => {
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async () => ({ ok: true, payload: {} }));
    await selectChatTarget({ type: "agent", id: "a1" }, {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: rpc,
      parseSessions: () => [],
      parseMessages: () => [],
      getConversationsByTarget: vi.fn(),
      getMessagesByConversation: vi.fn(),
    });
    expect(dispatchSession).toHaveBeenCalledWith({
      type: "SET_CHAT_TARGET",
      target: { type: "agent", id: "a1" },
    });
    expect(rpc).toHaveBeenCalledWith(
      "http://gw", "tk", "sessions.list", expect.anything(),
    );
  });

  it("team: loads conversations from local DB", async () => {
    const dispatchSession = vi.fn();
    const getConversationsByTarget = vi.fn(async () => [
      { id: "x" } as Conversation,
    ]);
    const getMessagesByConversation = vi.fn(async () => []);
    await selectChatTarget({ type: "team", id: "t1" }, {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      dispatchSession,
      gatewayRpc: vi.fn(),
      parseSessions: () => [],
      parseMessages: () => [],
      getConversationsByTarget,
      getMessagesByConversation,
    });
    expect(getConversationsByTarget).toHaveBeenCalledWith("team", "t1", "c1");
    expect(dispatchSession).toHaveBeenCalledWith({
      type: "SET_ACTIVE_CONVERSATION",
      id: "x",
    });
  });
});

describe("selectConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("native-session: calls chat.history via rpc", async () => {
    const conversation = {
      id: "s1", source: "native-session", sessionKey: "agent:a1:x:s1",
    } as Conversation;
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async () => ({ ok: true, payload: {} }));
    await selectConversation("s1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      getConversations: () => [conversation],
      getActiveChatTarget: () => ({ type: "agent", id: "a1" }),
      dispatchSession,
      gatewayRpc: rpc,
      parseMessages: () => [],
      getMessagesByConversation: vi.fn(),
    });
    expect(rpc).toHaveBeenCalledWith(
      "http://gw", "tk", "chat.history", { sessionKey: "agent:a1:x:s1" },
    );
  });

  it("local conversation: reads from DB", async () => {
    const conversation = { id: "local-1", source: undefined } as Conversation;
    const dispatchSession = vi.fn();
    const getMessagesByConversation = vi.fn(async () => []);
    await selectConversation("local-1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      getConversations: () => [conversation],
      getActiveChatTarget: () => ({ type: "team", id: "t1" }),
      dispatchSession,
      gatewayRpc: vi.fn(),
      parseMessages: () => [],
      getMessagesByConversation,
    });
    expect(getMessagesByConversation).toHaveBeenCalledWith("local-1");
  });
});

describe("deleteConversation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("native-session: calls sessions.delete via rpc, then dispatches DELETE_CONVERSATION", async () => {
    const dispatchSession = vi.fn();
    const rpc = vi.fn(async () => ({ ok: true, payload: {} }));
    await deleteConversation("s1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      getConversations: () => [{
        id: "s1", source: "native-session", sessionKey: "agent:a1:x:s1",
      } as Conversation],
      dispatchSession,
      gatewayRpc: rpc,
      dbDeleteConversation: vi.fn(),
    });
    expect(rpc).toHaveBeenCalledWith(
      "http://gw", "tk", "sessions.delete", {
        key: "agent:a1:x:s1",
        deleteTranscript: true,
        emitLifecycleHooks: false,
      },
    );
    expect(dispatchSession).toHaveBeenCalledWith({ type: "DELETE_CONVERSATION", id: "s1" });
  });

  it("local conversation: calls dbDeleteConversation", async () => {
    const dispatchSession = vi.fn();
    const db = vi.fn(async () => {});
    await deleteConversation("local-1", {
      getGatewayState: () => ({
        companies: [company()], activeCompanyId: "c1",
        connectionStatus: "connected", initialized: true,
      }),
      getConversations: () => [{ id: "local-1" } as Conversation],
      dispatchSession,
      gatewayRpc: vi.fn(),
      dbDeleteConversation: db,
    });
    expect(db).toHaveBeenCalledWith("local-1");
    expect(dispatchSession).toHaveBeenCalledWith({ type: "DELETE_CONVERSATION", id: "local-1" });
  });
});
```

- [ ] **Step 6: 确认失败**

```bash
pnpm test src/lib/store/coordinators/native-sessions.test.ts
```

Expected：`Cannot find module './native-sessions'`.

- [ ] **Step 7: 实现 native-sessions**

Create `src/lib/store/coordinators/native-sessions.ts`:

```ts
import type { ChatTarget, Conversation, Message } from "@/types";
import type { GatewayState } from "@/lib/store/gateway/types";
import type { SessionAction } from "@/lib/store/session/types";

export type GatewayRpcFn = (
  url: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<{ ok: boolean; payload?: unknown; error?: { message?: string } }>;

export type ParseSessionsFn = (
  payload: unknown,
  agentId: string,
  companyId: string,
) => Conversation[];

export type ParseMessagesFn = (
  payload: unknown,
  agentId: string,
  conversationId: string,
) => Message[];

export interface FetchNativeSessionsDeps {
  getGatewayState: () => GatewayState;
  dispatchSession: (a: SessionAction) => void;
  gatewayRpc: GatewayRpcFn;
  parseSessions: ParseSessionsFn;
  parseMessages: ParseMessagesFn;
}

export async function fetchNativeAgentSessions(
  agentId: string,
  deps: FetchNativeSessionsDeps,
  preferredSessionKey?: string,
  opts?: { listOnly?: boolean },
): Promise<void> {
  const gateway = deps.getGatewayState();
  const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);

  if (!company?.gatewayUrl || !company?.gatewayToken) {
    deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: [] });
    if (!opts?.listOnly) {
      deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: null });
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
    }
    return;
  }

  if (!opts?.listOnly) {
    deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_LOADING", loading: true });
  }
  deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_ERROR", error: null });

  try {
    const result = await deps.gatewayRpc(
      company.gatewayUrl, company.gatewayToken, "sessions.list", { agentId },
    );

    if (!result.ok) {
      deps.dispatchSession({
        type: "SET_NATIVE_SESSIONS_ERROR",
        error: result.error?.message ?? "Failed to load sessions",
      });
      deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: [] });
      if (!opts?.listOnly) {
        deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: null });
        deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
      }
      return;
    }

    const sessions = deps.parseSessions(
      result.payload, agentId, gateway.activeCompanyId ?? "",
    );
    deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: sessions });

    if (opts?.listOnly) {
      if (preferredSessionKey) {
        deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: preferredSessionKey });
      }
      return;
    }

    const nextSessionId =
      preferredSessionKey && sessions.some(s => s.id === preferredSessionKey)
        ? preferredSessionKey
        : sessions[0]?.id ?? null;

    deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: nextSessionId });

    if (!nextSessionId) {
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
      return;
    }

    const history = await deps.gatewayRpc(
      company.gatewayUrl, company.gatewayToken, "chat.history",
      { sessionKey: nextSessionId },
    );
    deps.dispatchSession({
      type: "SET_MESSAGES",
      messages: deps.parseMessages(
        history.ok ? history.payload : undefined,
        agentId,
        nextSessionId,
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load sessions";
    deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_ERROR", error: message });
    if (!opts?.listOnly) {
      deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: [] });
      deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: null });
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
    }
  } finally {
    if (!opts?.listOnly) {
      deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_LOADING", loading: false });
    }
  }
}

export interface SelectChatTargetDeps extends FetchNativeSessionsDeps {
  getConversationsByTarget: (
    targetType: "agent" | "team",
    targetId: string,
    companyId?: string,
  ) => Promise<Conversation[]>;
  getMessagesByConversation: (id: string) => Promise<Message[]>;
}

export async function selectChatTarget(
  target: ChatTarget,
  deps: SelectChatTargetDeps,
): Promise<void> {
  deps.dispatchSession({ type: "SET_CHAT_TARGET", target });

  const gateway = deps.getGatewayState();
  const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);

  if (target.type === "agent" && company?.runtimeType === "openclaw") {
    await fetchNativeAgentSessions(target.id, deps);
    return;
  }

  const convs = await deps.getConversationsByTarget(
    target.type, target.id, gateway.activeCompanyId ?? undefined,
  );
  deps.dispatchSession({ type: "SET_CONVERSATIONS", conversations: convs });

  if (convs.length > 0) {
    const latest = convs[0];
    deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: latest.id });
    const msgs = await deps.getMessagesByConversation(latest.id);
    deps.dispatchSession({ type: "SET_MESSAGES", messages: msgs });
  } else {
    deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id: null });
    deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
  }
}

export interface SelectConversationDeps {
  getGatewayState: () => GatewayState;
  getConversations: () => Conversation[];
  getActiveChatTarget: () => ChatTarget | null;
  dispatchSession: (a: SessionAction) => void;
  gatewayRpc: GatewayRpcFn;
  parseMessages: ParseMessagesFn;
  getMessagesByConversation: (id: string) => Promise<Message[]>;
}

export async function selectConversation(
  id: string,
  deps: SelectConversationDeps,
): Promise<void> {
  const target = deps.getActiveChatTarget();
  const conversation = deps.getConversations().find(c => c.id === id);

  deps.dispatchSession({ type: "SET_ACTIVE_CONVERSATION", id });

  if (target?.type === "agent" && conversation?.source === "native-session") {
    const gateway = deps.getGatewayState();
    const company = gateway.companies.find(c => c.id === gateway.activeCompanyId);
    if (!company?.gatewayUrl || !company?.gatewayToken) {
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
      return;
    }

    deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_LOADING", loading: true });
    deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_ERROR", error: null });

    try {
      const history = await deps.gatewayRpc(
        company.gatewayUrl, company.gatewayToken, "chat.history",
        { sessionKey: conversation.sessionKey ?? conversation.id },
      );

      if (!history.ok) {
        deps.dispatchSession({
          type: "SET_NATIVE_SESSIONS_ERROR",
          error: history.error?.message ?? "Failed to load messages",
        });
        deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
        return;
      }

      deps.dispatchSession({
        type: "SET_MESSAGES",
        messages: deps.parseMessages(history.payload, target.id, conversation.id),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load messages";
      deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_ERROR", error: message });
      deps.dispatchSession({ type: "SET_MESSAGES", messages: [] });
    } finally {
      deps.dispatchSession({ type: "SET_NATIVE_SESSIONS_LOADING", loading: false });
    }
    return;
  }

  const msgs = await deps.getMessagesByConversation(id);
  deps.dispatchSession({ type: "SET_MESSAGES", messages: msgs });
}

export interface DeleteConversationDeps {
  getGatewayState: () => GatewayState;
  getConversations: () => Conversation[];
  dispatchSession: (a: SessionAction) => void;
  gatewayRpc: GatewayRpcFn;
  dbDeleteConversation: (id: string) => Promise<unknown>;
}

export async function deleteConversation(
  id: string,
  deps: DeleteConversationDeps,
): Promise<void> {
  const conversation = deps.getConversations().find(c => c.id === id);
  if (conversation?.source === "native-session") {
    const gateway = deps.getGatewayState();
    const company = gateway.companies[0];
    if (company?.gatewayUrl && company?.gatewayToken) {
      const sessionKey = conversation.sessionKey ?? conversation.id;
      const result = await deps.gatewayRpc(
        company.gatewayUrl, company.gatewayToken, "sessions.delete",
        { key: sessionKey, deleteTranscript: true, emitLifecycleHooks: false },
      );
      if (!result.ok) {
        deps.dispatchSession({
          type: "SET_NATIVE_SESSIONS_ERROR",
          error: result.error?.message ?? "Failed to delete session",
        });
        return;
      }
    }
    deps.dispatchSession({ type: "DELETE_CONVERSATION", id });
    return;
  }
  await deps.dbDeleteConversation(id);
  deps.dispatchSession({ type: "DELETE_CONVERSATION", id });
}
```

- [ ] **Step 8: 确认 native-sessions 通过**

```bash
pnpm test src/lib/store/coordinators/native-sessions.test.ts
```

Expected：全部测试 PASS。

- [ ] **Step 9: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

- [ ] **Step 10: Commit**

```bash
git add src/lib/store/coordinators/company-cascade.ts src/lib/store/coordinators/company-cascade.test.ts src/lib/store/coordinators/native-sessions.ts src/lib/store/coordinators/native-sessions.test.ts
git commit -m "feat(store/coordinators): add company-cascade + native-sessions with tests"
```

---

## Task 9: gateway-events + send-message coordinator

**目的：** 两个最复杂、风险最高的 coordinator。`gateway-events.ts` 封装 `onChatEvent` 的 5 个 state 分支 × 2 种持久化路径；`send-message.ts` 封装 sendMessage / abortStreaming。

**Files:**
- Create: `src/lib/store/coordinators/gateway-events.ts`
- Create: `src/lib/store/coordinators/gateway-events.test.ts`
- Create: `src/lib/store/coordinators/send-message.ts`
- Create: `src/lib/store/coordinators/send-message.test.ts`

- [ ] **Step 1: 写 gateway-events 失败测试（重点覆盖 5 state × 2 persist = 10 分支）**

Create `src/lib/store/coordinators/gateway-events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatEventPayload, Conversation, Message } from "@/types";
import type { StreamingState } from "@/lib/store/chat/types";
import { handleGatewayChatEvent } from "./gateway-events";

function streaming(overrides: Partial<StreamingState> = {}): StreamingState {
  return {
    isStreaming: true,
    content: "",
    toolCalls: [],
    runId: null,
    targetType: "agent",
    targetId: "a1",
    conversationId: "conv-1",
    sessionKey: "agent:a1:graupelclaw:conv-1",
    phase: "connecting",
    ...overrides,
  };
}

function payload(
  state: ChatEventPayload["state"],
  overrides: Partial<ChatEventPayload> = {},
): ChatEventPayload {
  return {
    runId: "r1",
    sessionKey: "agent:a1:graupelclaw:conv-1",
    state,
    message: { role: "assistant", content: [], timestamp: 100 },
    ...overrides,
  };
}

function makeDeps(opts: {
  streamingStates?: Record<string, StreamingState>;
  conversations?: Conversation[];
  activeConversationId?: string | null;
} = {}) {
  return {
    getChatState: () => ({
      streamingStates: opts.streamingStates ?? {},
      lastCascadeStatus: null,
    }),
    getSessionState: () => ({
      conversations: opts.conversations ?? [],
      messages: [],
      activeChatTarget: null,
      activeConversationId: opts.activeConversationId ?? null,
      nativeSessionsLoading: false,
      nativeSessionsError: null,
    }),
    dispatchChat: vi.fn(),
    dispatchSession: vi.fn(),
    dbAddMessage: vi.fn(async () => {}),
    pendingResolvers: new Map<string, () => void>(),
    idFactory: () => "new-msg-id",
  };
}

describe("handleGatewayChatEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delta: dispatches SET_STREAMING_CONTENT only", () => {
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
    });
    const p = payload("delta", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        timestamp: 100,
      },
    });
    handleGatewayChatEvent(p, deps);
    expect(deps.dispatchChat).toHaveBeenCalledWith({
      type: "SET_STREAMING_CONTENT",
      agentId: "a1",
      content: "hi",
      runId: "r1",
      phase: undefined,
      toolCalls: undefined,
    });
  });

  it("message_done [local persist]: adds message + dbAddMessage + resets content", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: undefined,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming({ content: "partial" }) },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    const p = payload("message_done", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "done text" }],
        timestamp: 200,
      },
    });
    handleGatewayChatEvent(p, deps);
    expect(deps.dispatchSession).toHaveBeenCalledWith({
      type: "ADD_MESSAGE",
      message: expect.objectContaining({
        role: "assistant", agentId: "a1", content: "done text",
      }),
    });
    expect(deps.dbAddMessage).toHaveBeenCalled();
    expect(deps.dispatchChat).toHaveBeenCalledWith({
      type: "SET_STREAMING_CONTENT",
      agentId: "a1", content: "", runId: null,
    });
  });

  it("message_done [native-session persist]: adds message but does NOT call dbAddMessage", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: "native-session",
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    const p = payload("message_done", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "x" }],
        timestamp: 1,
      },
    });
    handleGatewayChatEvent(p, deps);
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
    expect(deps.dispatchSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_MESSAGE" }),
    );
  });

  it("message_done: does NOT dispatch ADD_MESSAGE when user viewing a different conversation", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "other-conv",
    });
    const p = payload("message_done", {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "bg" }],
        timestamp: 1,
      },
    });
    handleGatewayChatEvent(p, deps);
    const addCalls = deps.dispatchSession.mock.calls.filter(
      c => c[0].type === "ADD_MESSAGE",
    );
    expect(addCalls).toHaveLength(0);
    // dbAddMessage still called for local conversation
    expect(deps.dbAddMessage).toHaveBeenCalled();
  });

  it("final: clears streaming + resolves pending resolver", () => {
    const resolver = vi.fn();
    const pending = new Map([["a1", resolver]]);
    const deps = { ...makeDeps({ streamingStates: { a1: streaming() } }), pendingResolvers: pending };
    handleGatewayChatEvent(payload("final"), deps);
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: false, agentId: "a1" }),
    );
    expect(resolver).toHaveBeenCalled();
    expect(pending.has("a1")).toBe(false);
  });

  it("error [local]: adds error message via dbAddMessage + dispatches ADD_MESSAGE + clears streaming", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    const p = payload("error", { error: "boom" });
    handleGatewayChatEvent(p, deps);
    // wait for the async dbAddMessage chain before asserting
    await Promise.resolve(); await Promise.resolve();
    expect(deps.dbAddMessage).toHaveBeenCalled();
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: false }),
    );
  });

  it("error [native-session]: does NOT call dbAddMessage but still dispatches + clears streaming", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: "native-session",
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming() },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    handleGatewayChatEvent(payload("error", { error: "boom" }), deps);
    await Promise.resolve(); await Promise.resolve();
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
  });

  it("aborted [local]: persists partial content if any + clears streaming", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming({ content: "partial answer" }) },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    handleGatewayChatEvent(payload("aborted"), deps);
    await Promise.resolve(); await Promise.resolve();
    expect(deps.dbAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "partial answer" }),
    );
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: false }),
    );
  });

  it("aborted [native-session]: no dbAddMessage, dispatches ADD_MESSAGE when viewing", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: "native-session",
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming({ content: "partial" }) },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    handleGatewayChatEvent(payload("aborted"), deps);
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
    expect(deps.dispatchSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_MESSAGE" }),
    );
  });

  it("aborted with empty content: no message persisted, still clears streaming", () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0,
    };
    const deps = makeDeps({
      streamingStates: { a1: streaming({ content: "" }) },
      conversations: [conv],
      activeConversationId: "conv-1",
    });
    handleGatewayChatEvent(payload("aborted"), deps);
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: false }),
    );
  });

  it("ignores events whose sessionKey does not resolve to an agentId", () => {
    const deps = makeDeps();
    handleGatewayChatEvent(
      payload("delta", { sessionKey: "not-a-session" }),
      deps,
    );
    expect(deps.dispatchChat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 确认失败**

```bash
pnpm test src/lib/store/coordinators/gateway-events.test.ts
```

Expected：`Cannot find module './gateway-events'`.

- [ ] **Step 3: 实现 gateway-events**

Create `src/lib/store/coordinators/gateway-events.ts`:

```ts
import type { ChatEventPayload, Conversation, Message } from "@/types";
import type { ChatSliceState, ChatAction } from "@/lib/store/chat/types";
import type { SessionState, SessionAction } from "@/lib/store/session/types";

export interface GatewayEventsDeps {
  getChatState: () => ChatSliceState;
  getSessionState: () => SessionState;
  dispatchChat: (a: ChatAction) => void;
  dispatchSession: (a: SessionAction) => void;
  dbAddMessage: (m: Message) => Promise<unknown>;
  pendingResolvers: Map<string, () => void>;
  idFactory: () => string;
}

function resolveAgentFromSession(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match ? match[1] : null;
}

export function handleGatewayChatEvent(
  payload: ChatEventPayload,
  deps: GatewayEventsDeps,
): void {
  const agentId = resolveAgentFromSession(payload.sessionKey);
  if (!agentId) return;

  const chat = deps.getChatState();
  const streaming = chat.streamingStates[agentId];
  const session = deps.getSessionState();
  const streamingConversation = streaming
    ? session.conversations.find(c => c.id === streaming.conversationId)
    : undefined;
  const shouldPersistLocal = streamingConversation?.source !== "native-session";

  const firstContent = payload.message?.content?.[0];
  const text = firstContent && firstContent.type === "text" ? firstContent.text : "";

  switch (payload.state) {
    case "delta": {
      deps.dispatchChat({
        type: "SET_STREAMING_CONTENT",
        agentId,
        content: text,
        runId: payload.runId,
        phase: payload.phase,
        toolCalls: payload.toolCalls,
      });
      return;
    }

    case "message_done": {
      const doneText = text || streaming?.content || "";
      if (
        (doneText || (payload.toolCalls && payload.toolCalls.length > 0)) &&
        streaming
      ) {
        const msg: Message = {
          id: deps.idFactory(),
          conversationId: streaming.conversationId,
          targetType: streaming.targetType,
          targetId: streaming.targetId,
          role: "assistant",
          agentId,
          content: doneText,
          toolCalls: payload.toolCalls?.length ? payload.toolCalls : undefined,
          createdAt: payload.message?.timestamp ?? Date.now(),
        };
        if (session.activeConversationId === streaming.conversationId) {
          deps.dispatchSession({ type: "ADD_MESSAGE", message: msg });
        }
        if (shouldPersistLocal) {
          deps.dbAddMessage(msg);
        }
      }
      deps.dispatchChat({
        type: "SET_STREAMING_CONTENT",
        agentId,
        content: "",
        runId: null,
      });
      return;
    }

    case "final": {
      deps.dispatchChat({
        type: "SET_STREAMING",
        agentId,
        targetType: streaming?.targetType ?? "agent",
        targetId: streaming?.targetId ?? "",
        sessionKey: "",
        isStreaming: false,
      });
      const resolver = deps.pendingResolvers.get(agentId);
      if (resolver) {
        deps.pendingResolvers.delete(agentId);
        resolver();
      }
      return;
    }

    case "error": {
      const errText = payload.error || text || "An error occurred";
      if (streaming) {
        const msg: Message = {
          id: deps.idFactory(),
          conversationId: streaming.conversationId,
          targetType: streaming.targetType,
          targetId: streaming.targetId,
          role: "assistant",
          agentId,
          content: `Error: ${errText}`,
          createdAt: Date.now(),
        };
        applyErrorOrAbortMessage(msg, streaming.conversationId, shouldPersistLocal, deps);
      }
      deps.dispatchChat({
        type: "SET_STREAMING",
        agentId,
        targetType: streaming?.targetType ?? "agent",
        targetId: streaming?.targetId ?? "",
        sessionKey: "",
        isStreaming: false,
      });
      const resolver = deps.pendingResolvers.get(agentId);
      if (resolver) {
        deps.pendingResolvers.delete(agentId);
        resolver();
      }
      return;
    }

    case "aborted": {
      const abortedText = streaming?.content;
      if (abortedText && streaming) {
        const msg: Message = {
          id: deps.idFactory(),
          conversationId: streaming.conversationId,
          targetType: streaming.targetType,
          targetId: streaming.targetId,
          role: "assistant",
          agentId,
          content: abortedText,
          createdAt: Date.now(),
        };
        applyErrorOrAbortMessage(msg, streaming.conversationId, shouldPersistLocal, deps);
      }
      deps.dispatchChat({
        type: "SET_STREAMING",
        agentId,
        targetType: streaming?.targetType ?? "agent",
        targetId: streaming?.targetId ?? "",
        sessionKey: "",
        isStreaming: false,
      });
      const resolver = deps.pendingResolvers.get(agentId);
      if (resolver) {
        deps.pendingResolvers.delete(agentId);
        resolver();
      }
      return;
    }
  }
}

function applyErrorOrAbortMessage(
  msg: Message,
  conversationId: string,
  shouldPersistLocal: boolean,
  deps: GatewayEventsDeps,
): void {
  if (shouldPersistLocal) {
    deps.dbAddMessage(msg).then(() => {
      const s = deps.getSessionState();
      if (s.activeConversationId === conversationId) {
        deps.dispatchSession({ type: "ADD_MESSAGE", message: msg });
      }
    });
  } else {
    const s = deps.getSessionState();
    if (s.activeConversationId === conversationId) {
      deps.dispatchSession({ type: "ADD_MESSAGE", message: msg });
    }
  }
}
```

- [ ] **Step 4: 确认 gateway-events 测试通过**

```bash
pnpm test src/lib/store/coordinators/gateway-events.test.ts
```

Expected：11 个测试全 PASS。

- [ ] **Step 5: 写 send-message 失败测试**

Create `src/lib/store/coordinators/send-message.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Agent, AgentTeam, ChatTarget, Company, Conversation, Message,
} from "@/types";
import type { StreamingState } from "@/lib/store/chat/types";
import { sendMessage, abortStreaming } from "./send-message";

function agent(id: string): Agent {
  return {
    id, companyId: "c1", name: `ag-${id}`,
    description: "", specialty: "general", createdAt: 0,
  };
}
function team(id: string, agentIds: string[], tlAgentId?: string): AgentTeam {
  return { id, companyId: "c1", name: `team-${id}`, agentIds, tlAgentId, createdAt: 0 };
}
function company(): Company {
  return {
    id: "c1", name: "co", runtimeType: "openclaw",
    gatewayUrl: "http://gw", gatewayToken: "tk",
    createdAt: 0, updatedAt: 0,
  };
}

function makeDeps(opts: {
  target: ChatTarget | null;
  activeConversationId?: string | null;
  conversations?: Conversation[];
  messages?: Message[];
  teams?: AgentTeam[];
  agents?: Agent[];
  streamingStates?: Record<string, StreamingState>;
  isConnected?: boolean;
}) {
  return {
    getGatewayState: () => ({
      companies: [company()], activeCompanyId: "c1",
      connectionStatus: "connected" as const, initialized: true,
    }),
    getAgentState: () => ({
      agents: opts.agents ?? [], teams: opts.teams ?? [], agentIdentities: {},
    }),
    getSessionState: () => ({
      conversations: opts.conversations ?? [],
      messages: opts.messages ?? [],
      activeChatTarget: opts.target,
      activeConversationId: opts.activeConversationId ?? null,
      nativeSessionsLoading: false, nativeSessionsError: null,
    }),
    getChatState: () => ({
      streamingStates: opts.streamingStates ?? {},
      lastCascadeStatus: null,
    }),
    dispatchSession: vi.fn(),
    dispatchChat: vi.fn(),
    clientRef: {
      current: {
        isConnected: () => opts.isConnected ?? true,
        sendMessage: vi.fn(async () => {}),
        abortChat: vi.fn(async () => {}),
      },
    } as unknown as React.MutableRefObject<{
      isConnected: () => boolean;
      sendMessage: (k: string, t: string, u: undefined, a?: unknown) => Promise<void>;
      abortChat: (k: string) => Promise<void>;
    } | null>,
    pendingResolvers: new Map<string, () => void>(),
    teamAbortedRef: { current: new Map<string, boolean>() },
    dbAddMessage: vi.fn(async () => {}),
    dbUpdateConversation: vi.fn(async () => {}),
    createConversation: vi.fn(async () => "fresh-conv-id"),
    fetchNativeAgentSessions: vi.fn(async () => {}),
    dispatchTeamMessage: vi.fn(async () => {}),
    idFactory: () => "new-id",
  };
}

describe("sendMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-ops when no active chat target", async () => {
    const deps = makeDeps({ target: null });
    await sendMessage("hi", undefined, deps);
    expect(deps.dispatchSession).not.toHaveBeenCalled();
  });

  it("no-ops when gateway not connected", async () => {
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      isConnected: false,
    });
    await sendMessage("hi", undefined, deps);
    expect(deps.dispatchSession).not.toHaveBeenCalled();
  });

  it("agent: creates conversation when none active, adds user msg, starts streaming", async () => {
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      activeConversationId: null,
      agents: [agent("a1")],
    });
    await sendMessage("hello", undefined, deps);
    expect(deps.createConversation).toHaveBeenCalled();
    expect(deps.dispatchSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ADD_MESSAGE" }),
    );
    expect(deps.dispatchChat).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SET_STREAMING", isStreaming: true }),
    );
  });

  it("agent: updates conversation title on first message (local path)", async () => {
    const conv: Conversation = {
      id: "conv-1", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "New Chat", createdAt: 0, updatedAt: 0, source: undefined,
    };
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      activeConversationId: "conv-1",
      conversations: [conv],
      messages: [],
      agents: [agent("a1")],
    });
    await sendMessage("My first question", undefined, deps);
    expect(deps.dbUpdateConversation).toHaveBeenCalledWith("conv-1", { title: "My first question" });
    expect(deps.dispatchSession).toHaveBeenCalledWith({
      type: "UPDATE_CONVERSATION",
      id: "conv-1",
      updates: { title: "My first question" },
    });
  });

  it("agent [native-session]: updates title in state only, NOT via dbUpdateConversation", async () => {
    const conv: Conversation = {
      id: "agent:a1:graupelclaw:x", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "New Session", createdAt: 0, updatedAt: 0, source: "native-session",
      sessionKey: "agent:a1:graupelclaw:x",
    };
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      activeConversationId: conv.id,
      conversations: [conv],
      messages: [],
      agents: [agent("a1")],
    });
    await sendMessage("Hi", undefined, deps);
    expect(deps.dbUpdateConversation).not.toHaveBeenCalled();
    expect(deps.dispatchSession).toHaveBeenCalledWith({
      type: "UPDATE_CONVERSATION",
      id: conv.id,
      updates: { title: "Hi" },
    });
  });

  it("agent [native-session]: does NOT call dbAddMessage for user message", async () => {
    const conv: Conversation = {
      id: "agent:a1:graupelclaw:x", targetType: "agent", targetId: "a1", companyId: "c1",
      title: "t", createdAt: 0, updatedAt: 0, source: "native-session",
      sessionKey: "agent:a1:graupelclaw:x",
    };
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      activeConversationId: conv.id,
      conversations: [conv],
      agents: [agent("a1")],
    });
    await sendMessage("Hi", undefined, deps);
    expect(deps.dbAddMessage).not.toHaveBeenCalled();
  });

  it("team: dispatches team message via team dispatcher + clears cascade status", async () => {
    const t = team("t1", ["a1", "a2"], "a1");
    const deps = makeDeps({
      target: { type: "team", id: "t1" },
      activeConversationId: "conv-1",
      conversations: [{
        id: "conv-1", targetType: "team", targetId: "t1", companyId: "c1",
        title: "t", createdAt: 0, updatedAt: 0,
      }],
      messages: [],
      agents: [agent("a1"), agent("a2")],
      teams: [t],
    });
    await sendMessage("Work on X", undefined, deps);
    expect(deps.dispatchChat).toHaveBeenCalledWith({
      type: "CLEAR_CASCADE_STATUS", conversationId: "conv-1",
    });
    expect(deps.dispatchTeamMessage).toHaveBeenCalled();
  });

  it("team: noops when team not found", async () => {
    const deps = makeDeps({
      target: { type: "team", id: "missing" },
      activeConversationId: "conv-1",
      conversations: [{
        id: "conv-1", targetType: "team", targetId: "missing", companyId: "c1",
        title: "t", createdAt: 0, updatedAt: 0,
      }],
      teams: [],
    });
    await sendMessage("hi", undefined, deps);
    expect(deps.dispatchTeamMessage).not.toHaveBeenCalled();
  });
});

describe("abortStreaming", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-op when no streaming exists for agentId", async () => {
    const deps = makeDeps({ target: null, streamingStates: {} });
    await abortStreaming("ghost", deps);
    expect(deps.dispatchChat).not.toHaveBeenCalled();
  });

  it("flips teamAbortedRef when streaming target is team", async () => {
    const st: StreamingState = {
      isStreaming: true, content: "", toolCalls: [], runId: null,
      targetType: "team", targetId: "t1", conversationId: "conv-1",
      sessionKey: "agent:a1:graupelclaw:team:t1:conv-1", phase: "responding",
    };
    const deps = makeDeps({
      target: { type: "team", id: "t1" },
      streamingStates: { a1: st },
    });
    await abortStreaming("a1", deps);
    expect(deps.teamAbortedRef.current.get("conv-1")).toBe(true);
  });

  it("calls client.abortChat, clears streaming, drains pending resolver", async () => {
    const st: StreamingState = {
      isStreaming: true, content: "", toolCalls: [], runId: null,
      targetType: "agent", targetId: "a1", conversationId: "conv-1",
      sessionKey: "agent:a1:graupelclaw:conv-1", phase: "responding",
    };
    const deps = makeDeps({
      target: { type: "agent", id: "a1" },
      streamingStates: { a1: st },
    });
    const resolver = vi.fn();
    deps.pendingResolvers.set("a1", resolver);
    await abortStreaming("a1", deps);
    expect(deps.clientRef.current?.abortChat).toHaveBeenCalledWith(st.sessionKey);
    expect(deps.dispatchChat).toHaveBeenCalledWith({ type: "CLEAR_STREAMING", agentId: "a1" });
    expect(resolver).toHaveBeenCalled();
    expect(deps.pendingResolvers.has("a1")).toBe(false);
  });
});
```

- [ ] **Step 6: 确认失败**

```bash
pnpm test src/lib/store/coordinators/send-message.test.ts
```

Expected：`Cannot find module './send-message'`.

- [ ] **Step 7: 实现 send-message**

Create `src/lib/store/coordinators/send-message.ts`:

```ts
import type React from "react";
import type {
  ChatTarget, Message, MessageAttachment, Conversation,
} from "@/types";
import type { RuntimeClient } from "@/lib/runtime";
import type { GatewayState } from "@/lib/store/gateway/types";
import type { AgentState } from "@/lib/store/agent/types";
import type { SessionState, SessionAction } from "@/lib/store/session/types";
import type { ChatSliceState, ChatAction } from "@/lib/store/chat/types";
import type { DispatchOpts } from "@/lib/team/types";
import { dmSessionKey, teamSessionKey } from "@/lib/store/session-keys";

type MinimalClient = Pick<RuntimeClient, "isConnected" | "sendMessage" | "abortChat">;

export interface SendMessageDeps {
  getGatewayState: () => GatewayState;
  getAgentState: () => AgentState;
  getSessionState: () => SessionState;
  getChatState: () => ChatSliceState;
  dispatchSession: (a: SessionAction) => void;
  dispatchChat: (a: ChatAction) => void;
  clientRef: React.MutableRefObject<MinimalClient | null>;
  pendingResolvers: Map<string, () => void>;
  teamAbortedRef: React.MutableRefObject<Map<string, boolean>>;
  dbAddMessage: (m: Message) => Promise<unknown>;
  dbUpdateConversation: (id: string, updates: Partial<Conversation>) => Promise<unknown>;
  createConversation: (
    targetType: "agent" | "team",
    targetId: string,
    activeCompanyId: string | null,
  ) => Promise<string>;
  fetchNativeAgentSessions: (
    agentId: string,
    preferredSessionKey?: string,
    opts?: { listOnly?: boolean },
  ) => Promise<void>;
  dispatchTeamMessage: (opts: DispatchOpts) => Promise<void>;
  idFactory: () => string;
}

const STREAM_TIMEOUT = 5 * 60 * 1000;

export async function sendMessage(
  content: string,
  attachments: MessageAttachment[] | undefined,
  deps: SendMessageDeps,
): Promise<void> {
  const session = deps.getSessionState();
  const target = session.activeChatTarget;
  if (!target) return;

  const client = deps.clientRef.current;
  if (!client || !client.isConnected()) return;

  const gateway = deps.getGatewayState();

  let conversationId = session.activeConversationId;
  let activeConversation = conversationId
    ? session.conversations.find(c => c.id === conversationId)
    : undefined;
  if (!conversationId) {
    conversationId = await deps.createConversation(
      target.type, target.id, gateway.activeCompanyId,
    );
    activeConversation = deps
      .getSessionState()
      .conversations.find(c => c.id === conversationId);
  }

  if (session.messages.length === 0) {
    const title = content.slice(0, 50);
    if (activeConversation?.source === "native-session") {
      deps.dispatchSession({
        type: "UPDATE_CONVERSATION",
        id: conversationId,
        updates: { title },
      });
    } else {
      await deps.dbUpdateConversation(conversationId, { title });
      deps.dispatchSession({
        type: "UPDATE_CONVERSATION",
        id: conversationId,
        updates: { title },
      });
    }
  }

  const userMsg: Message = {
    id: deps.idFactory(),
    conversationId,
    targetType: target.type,
    targetId: target.id,
    role: "user",
    content,
    attachments: attachments?.length ? attachments : undefined,
    createdAt: Date.now(),
  };
  if (activeConversation?.source !== "native-session") {
    await deps.dbAddMessage(userMsg);
  }
  deps.dispatchSession({ type: "ADD_MESSAGE", message: userMsg });

  if (target.type === "agent") {
    await sendToAgent(target, conversationId, content, attachments, activeConversation, client, deps);
    return;
  }
  await sendToTeam(target, conversationId, content, attachments, userMsg.id, deps, client);
}

async function sendToAgent(
  target: ChatTarget,
  conversationId: string,
  content: string,
  attachments: MessageAttachment[] | undefined,
  activeConversation: Conversation | undefined,
  client: MinimalClient,
  deps: SendMessageDeps,
): Promise<void> {
  const sessionKey =
    activeConversation?.sessionKey ?? dmSessionKey(target.id, conversationId);
  deps.dispatchChat({
    type: "SET_STREAMING",
    agentId: target.id,
    targetType: "agent",
    targetId: target.id,
    conversationId,
    sessionKey,
    isStreaming: true,
  });
  try {
    await client.sendMessage(sessionKey, content, undefined, attachments);
    await deps.fetchNativeAgentSessions(target.id, sessionKey, { listOnly: true });
  } catch {
    deps.dispatchChat({
      type: "SET_STREAMING",
      agentId: target.id,
      targetType: "agent",
      targetId: target.id,
      sessionKey,
      isStreaming: false,
    });
  }
}

async function sendToTeam(
  target: ChatTarget,
  conversationId: string,
  content: string,
  attachments: MessageAttachment[] | undefined,
  userMsgId: string,
  deps: SendMessageDeps,
  client: MinimalClient,
): Promise<void> {
  const agentState = deps.getAgentState();
  const team = agentState.teams.find(t => t.id === target.id);
  if (!team) return;

  deps.teamAbortedRef.current.set(conversationId, false);
  deps.dispatchChat({ type: "CLEAR_CASCADE_STATUS", conversationId });

  const sendToAgentFn = async (
    agentId: string,
    sessionKey: string,
    text: string,
    atts?: MessageAttachment[],
  ): Promise<{ fromAgentId: string; content: string } | null> => {
    deps.dispatchChat({
      type: "SET_STREAMING",
      agentId,
      targetType: "team",
      targetId: target.id,
      conversationId,
      sessionKey,
      isStreaming: true,
    });
    const streamDone = Promise.race([
      new Promise<void>(resolve => {
        deps.pendingResolvers.set(agentId, resolve);
      }),
      new Promise<void>(resolve =>
        setTimeout(() => {
          deps.pendingResolvers.delete(agentId);
          resolve();
        }, STREAM_TIMEOUT),
      ),
    ]);
    const sinceTs = Date.now();
    try {
      await client.sendMessage(sessionKey, text, undefined, atts);
      await streamDone;
    } catch {
      deps.dispatchChat({
        type: "SET_STREAMING",
        agentId,
        targetType: "team",
        targetId: target.id,
        sessionKey,
        isStreaming: false,
      });
      return null;
    }

    const latestSession = deps.getSessionState();
    const reply = [...latestSession.messages].reverse().find(
      m =>
        m.role === "assistant" &&
        m.agentId === agentId &&
        m.targetId === target.id &&
        m.conversationId === conversationId &&
        m.createdAt > sinceTs,
    );
    if (!reply) return null;
    return { fromAgentId: agentId, content: reply.content };
  };

  await deps.dispatchTeamMessage({
    team,
    conversationId,
    rootUserMessageId: userMsgId,
    userContent: content,
    attachments,
    getState: () => ({
      agents: agentState.agents,
      teams: agentState.teams,
      messages: deps.getSessionState().messages,
      agentIdentities: agentState.agentIdentities,
    }),
    sendToAgent: sendToAgentFn,
    isAborted: cid => deps.teamAbortedRef.current.get(cid) === true,
    onCascadeStopped: ({ reason, hop }) => {
      deps.dispatchChat({
        type: "SET_CASCADE_STATUS",
        status: { conversationId, reason, hop },
      });
    },
    buildSessionKey: teamSessionKey,
    maxHops: 8,
  });
  deps.teamAbortedRef.current.delete(conversationId);
}

export async function abortStreaming(
  agentId: string,
  deps: SendMessageDeps,
): Promise<void> {
  const chat = deps.getChatState();
  const streaming = chat.streamingStates[agentId];
  if (!streaming) return;

  if (streaming.targetType === "team" && streaming.conversationId) {
    deps.teamAbortedRef.current.set(streaming.conversationId, true);
  }

  const client = deps.clientRef.current;
  if (client) {
    try {
      await client.abortChat(streaming.sessionKey);
    } catch {
      // Abort failed; clean up state manually
    }
    deps.dispatchChat({ type: "CLEAR_STREAMING", agentId });
    const resolver = deps.pendingResolvers.get(agentId);
    if (resolver) {
      deps.pendingResolvers.delete(agentId);
      resolver();
    }
  }
}
```

> 注：`dispatchTeamMessage` 的 `getState` 此处收窄为 `{ agents, teams, messages, agentIdentities }` —— 但 `team/types.ts` 当前声明的是 `() => AppState`。这在 Task 10 会被正式修改；Task 9 的测试期间，coordinator 先按窄签名实现即可，Task 10 修 `team/types.ts`，让两端一致。

- [ ] **Step 8: 确认 send-message 测试通过**

```bash
pnpm test src/lib/store/coordinators/send-message.test.ts
```

Expected：所有测试 PASS（注意：此时 team/types.ts 的 AppState 签名仍在，TypeScript 可能警告 — 如果测试用 vitest 的宽松类型模式通过即可；若构建报错，推迟到 Task 10 再清理此 coordinator 的最终类型）。

如果 TS 构建报错，把 `send-message.ts` 中 `getState` 的返回改为 `as unknown as AppState` 作为临时桥，并在注释里标注 `// TODO: Task 10 narrow team DispatchOpts.getState`。

- [ ] **Step 9: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected：全绿。如果 build 因 AppState 窄化不一致而失败，先加临时桥（见上一步），构建通过后提交。

- [ ] **Step 10: Commit**

```bash
git add src/lib/store/coordinators/gateway-events.ts src/lib/store/coordinators/gateway-events.test.ts src/lib/store/coordinators/send-message.ts src/lib/store/coordinators/send-message.test.ts
git commit -m "feat(store/coordinators): add gateway-events + send-message with tests"
```

---

## Task 10: ActionsProvider + StoreProvider 装配 + team/types.ts 收窄

**目的：** 把 4 个 slice Provider + coordinators 组装成对外 API：`<StoreProvider>` 嵌套四层 slice Provider + 一层 `<ActionsProvider>`，后者通过 `useActions()` 暴露所有跨切动作。同时把 `team/types.ts` 的 `DispatchOpts.getState` 从 `() => AppState` 窄化为 `() => TeamDispatchState`（只含 `agents / teams / messages / agentIdentities`），解除对 `AppState` 的依赖。

**Files:**
- Modify: `src/lib/team/types.ts` (narrow DispatchOpts.getState)
- Create: `src/lib/store/actions-provider.tsx`
- Create: `src/lib/store/index.tsx`

- [ ] **Step 1: 窄化 team/types.ts**

Edit `src/lib/team/types.ts`:

```ts
import type { Agent, AgentTeam, AgentIdentity, Message, MessageAttachment } from "@/types";

export interface Mention {
  name: string;
  agentId: string;
}

export interface RosterEntry {
  agentId: string;
  name: string;
  description?: string;
  role: "TL" | "Member";
}

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

export interface TeamDispatchState {
  agents: Agent[];
  teams: AgentTeam[];
  messages: Message[];
  agentIdentities: Record<string, AgentIdentity>;
}

export interface DispatchOpts {
  team: AgentTeam;
  conversationId: string;
  rootUserMessageId: string;
  userContent: string;
  attachments?: MessageAttachment[];
  maxHops?: number;
  getState: () => TeamDispatchState;
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

- [ ] **Step 2: 验证 team 模块仍然通过测试**

```bash
pnpm test src/lib/team/
```

Expected：所有 dispatcher 测试仍 PASS（mock state 已经是窄化的形状，所以无变化）。如果失败，说明某个 team 内部文件直接消费了 `AppState` 的其他字段，需要调整。

- [ ] **Step 3: 实现 ActionsProvider**

Create `src/lib/store/actions-provider.tsx`:

```tsx
"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import type {
  Agent, AgentSpecialty, ChatTarget, MessageAttachment,
} from "@/types";
import {
  createCompany as dbCreateCompany,
  deleteCompany as dbDeleteCompany,
  createAgent as dbCreateAgent,
  updateAgent as dbUpdateAgent,
  deleteAgent as dbDeleteAgent,
  deleteTeam as dbDeleteTeam,
  getAgentsByCompany,
  getTeamsByCompany,
  getConversationsByTarget,
  getMessagesByConversation,
  getAllCompanies,
  addMessage as dbAddMessage,
  updateConversation as dbUpdateConversation,
  deleteConversation as dbDeleteConversation,
} from "@/lib/db";
import {
  parseNativeSessionConversations,
  parseNativeSessionMessages,
} from "@/lib/openclaw-sessions";
import { gatewayRpc } from "@/lib/runtime";
import { dispatchTeamMessage } from "@/lib/team";
import { v4 as uuidv4 } from "uuid";

import { useGatewayStore } from "./gateway/store";
import { useAgentStore } from "./agent/store";
import { useSessionStore } from "./session/store";
import { useChatStore } from "./chat/store";

import { initializeApp } from "./coordinators/bootstrap";
import { syncAgents } from "./coordinators/agent-sync";
import { selectCompany, deleteCompany } from "./coordinators/company-cascade";
import {
  fetchNativeAgentSessions,
  selectChatTarget,
  selectConversation,
  deleteConversation,
} from "./coordinators/native-sessions";
import { handleGatewayChatEvent } from "./coordinators/gateway-events";
import { sendMessage, abortStreaming } from "./coordinators/send-message";

export interface StoreActions {
  selectCompany: (id: string) => Promise<void>;
  deleteCompany: (id: string) => Promise<void>;

  createAgent: (opts: {
    companyId: string;
    name: string;
    description: string;
    specialty: AgentSpecialty;
  }) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;
  syncAgents: () => Promise<void>;

  selectChatTarget: (target: ChatTarget) => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  sendMessage: (content: string, attachments?: MessageAttachment[]) => Promise<void>;
  abortStreaming: (agentId: string) => Promise<void>;
}

const ActionsContext = createContext<StoreActions | null>(null);

export function ActionsProvider({ children }: { children: React.ReactNode }) {
  const gateway = useGatewayStore();
  const agent = useAgentStore();
  const session = useSessionStore();
  const chat = useChatStore();

  // Wire chat event handler into gateway runtime — unique cross-slice subscription
  // that must live here (§5.3).
  useEffect(() => {
    gateway.registerChatEventHandler(payload => {
      handleGatewayChatEvent(payload, {
        getChatState: chat.getState,
        getSessionState: session.getState,
        dispatchChat: chat.dispatch,
        dispatchSession: session.dispatch,
        dbAddMessage,
        pendingResolvers: chat.pendingStreamResolvers.current,
        idFactory: () => uuidv4(),
      });
    });
    return () => gateway.registerChatEventHandler(null);
  }, [gateway, chat, session]);

  // Bootstrap once on mount
  useEffect(() => {
    void initializeApp({
      dispatchGateway: gateway.dispatch,
      dispatchAgent: agent.dispatch,
      getAllCompanies,
      getAgentsByCompany,
      getTeamsByCompany,
      dbCreateCompany,
      dbCreateAgent,
      dbUpdateAgent,
    });
    // Intentionally empty deps: run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncAgentsAction = useCallback(async () => {
    await syncAgents({
      getGatewayState: gateway.getState,
      getAgentState: agent.getState,
      dispatchAgent: agent.dispatch,
      dbUpdateAgent,
      dbCreateAgent,
    });
  }, [gateway, agent]);

  const selectCompanyAction = useCallback(async (id: string) => {
    await selectCompany(id, {
      getGatewayState: gateway.getState,
      dispatchGateway: gateway.dispatch,
      dispatchAgent: agent.dispatch,
      dispatchSession: session.dispatch,
      disconnect: gateway.disconnect,
      connect: gateway.connect,
      dbDeleteCompany,
      getAgentsByCompany,
      getTeamsByCompany,
      syncAgents: syncAgentsAction,
    });
  }, [gateway, agent, session, syncAgentsAction]);

  const deleteCompanyAction = useCallback(async (id: string) => {
    await deleteCompany(id, {
      getGatewayState: gateway.getState,
      dispatchGateway: gateway.dispatch,
      dispatchAgent: agent.dispatch,
      dispatchSession: session.dispatch,
      disconnect: gateway.disconnect,
      connect: gateway.connect,
      dbDeleteCompany,
      getAgentsByCompany,
      getTeamsByCompany,
      syncAgents: syncAgentsAction,
    });
  }, [gateway, agent, session, syncAgentsAction]);

  const createAgentAction = useCallback(
    async (opts: {
      companyId: string;
      name: string;
      description: string;
      specialty: AgentSpecialty;
    }) => {
      const newAgent: Agent = {
        id: uuidv4(),
        companyId: opts.companyId,
        name: opts.name,
        description: opts.description,
        specialty: opts.specialty,
        createdAt: Date.now(),
      };
      const gw = gateway.getState();
      const company = gw.companies.find(c => c.id === opts.companyId);
      if (company?.gatewayUrl && company?.gatewayToken) {
        const res = await fetch("/api/agents/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: newAgent.id,
            name: newAgent.name,
            description: newAgent.description,
            specialty: newAgent.specialty,
            gatewayUrl: company.gatewayUrl,
            gatewayToken: company.gatewayToken,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            data.error ?? `Failed to create agent on gateway (${res.status})`,
          );
        }
      }
      await dbCreateAgent(newAgent);
      agent.dispatch({ type: "ADD_AGENT", agent: newAgent });
      return newAgent;
    },
    [gateway, agent],
  );

  const deleteAgentAction = useCallback(async (id: string) => {
    const ag = agent.getState().agents.find(a => a.id === id);
    const company = ag
      ? gateway.getState().companies.find(c => c.id === ag.companyId)
      : undefined;

    await dbDeleteAgent(id);
    agent.dispatch({ type: "REMOVE_AGENT", id });

    try {
      await fetch("/api/agents/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: id,
          gatewayUrl: company?.gatewayUrl,
          gatewayToken: company?.gatewayToken,
        }),
      });
    } catch {
      // Gateway update failed silently (matches legacy)
    }

    const sess = session.getState();
    if (sess.activeChatTarget?.type === "agent" && sess.activeChatTarget.id === id) {
      session.dispatch({ type: "SET_CHAT_TARGET", target: null });
      session.dispatch({ type: "SET_MESSAGES", messages: [] });
    }
  }, [gateway, agent, session]);

  const deleteTeamAction = useCallback(async (id: string) => {
    await dbDeleteTeam(id);
    agent.dispatch({ type: "REMOVE_TEAM", id });
    const sess = session.getState();
    if (sess.activeChatTarget?.type === "team" && sess.activeChatTarget.id === id) {
      session.dispatch({ type: "SET_CHAT_TARGET", target: null });
      session.dispatch({ type: "SET_MESSAGES", messages: [] });
    }
  }, [agent, session]);

  const selectChatTargetAction = useCallback(async (target: ChatTarget) => {
    await selectChatTarget(target, {
      getGatewayState: gateway.getState,
      dispatchSession: session.dispatch,
      gatewayRpc,
      parseSessions: parseNativeSessionConversations,
      parseMessages: parseNativeSessionMessages,
      getConversationsByTarget,
      getMessagesByConversation,
    });
  }, [gateway, session]);

  const selectConversationAction = useCallback(async (id: string) => {
    await selectConversation(id, {
      getGatewayState: gateway.getState,
      getConversations: () => session.getState().conversations,
      getActiveChatTarget: () => session.getState().activeChatTarget,
      dispatchSession: session.dispatch,
      gatewayRpc,
      parseMessages: parseNativeSessionMessages,
      getMessagesByConversation,
    });
  }, [gateway, session]);

  const deleteConversationAction = useCallback(async (id: string) => {
    await deleteConversation(id, {
      getGatewayState: gateway.getState,
      getConversations: () => session.getState().conversations,
      dispatchSession: session.dispatch,
      gatewayRpc,
      dbDeleteConversation,
    });
  }, [gateway, session]);

  const fetchNative = useCallback(
    async (
      agentId: string,
      preferredSessionKey?: string,
      opts?: { listOnly?: boolean },
    ) => {
      await fetchNativeAgentSessions(agentId, {
        getGatewayState: gateway.getState,
        dispatchSession: session.dispatch,
        gatewayRpc,
        parseSessions: parseNativeSessionConversations,
        parseMessages: parseNativeSessionMessages,
      }, preferredSessionKey, opts);
    },
    [gateway, session],
  );

  const sendMessageAction = useCallback(
    async (content: string, attachments?: MessageAttachment[]) => {
      await sendMessage(content, attachments, {
        getGatewayState: gateway.getState,
        getAgentState: agent.getState,
        getSessionState: session.getState,
        getChatState: chat.getState,
        dispatchSession: session.dispatch,
        dispatchChat: chat.dispatch,
        clientRef: gateway.clientRef,
        pendingResolvers: chat.pendingStreamResolvers.current,
        teamAbortedRef: chat.teamAbortedRef,
        dbAddMessage,
        dbUpdateConversation,
        createConversation: session.createConversation,
        fetchNativeAgentSessions: fetchNative,
        dispatchTeamMessage,
        idFactory: () => uuidv4(),
      });
    },
    [gateway, agent, session, chat, fetchNative],
  );

  const abortStreamingAction = useCallback(async (agentId: string) => {
    await abortStreaming(agentId, {
      getGatewayState: gateway.getState,
      getAgentState: agent.getState,
      getSessionState: session.getState,
      getChatState: chat.getState,
      dispatchSession: session.dispatch,
      dispatchChat: chat.dispatch,
      clientRef: gateway.clientRef,
      pendingResolvers: chat.pendingStreamResolvers.current,
      teamAbortedRef: chat.teamAbortedRef,
      dbAddMessage,
      dbUpdateConversation,
      createConversation: session.createConversation,
      fetchNativeAgentSessions: fetchNative,
      dispatchTeamMessage,
      idFactory: () => uuidv4(),
    });
  }, [gateway, agent, session, chat, fetchNative]);

  const actions = useMemo<StoreActions>(
    () => ({
      selectCompany: selectCompanyAction,
      deleteCompany: deleteCompanyAction,
      createAgent: createAgentAction,
      deleteAgent: deleteAgentAction,
      deleteTeam: deleteTeamAction,
      syncAgents: syncAgentsAction,
      selectChatTarget: selectChatTargetAction,
      selectConversation: selectConversationAction,
      deleteConversation: deleteConversationAction,
      sendMessage: sendMessageAction,
      abortStreaming: abortStreamingAction,
    }),
    [
      selectCompanyAction,
      deleteCompanyAction,
      createAgentAction,
      deleteAgentAction,
      deleteTeamAction,
      syncAgentsAction,
      selectChatTargetAction,
      selectConversationAction,
      deleteConversationAction,
      sendMessageAction,
      abortStreamingAction,
    ],
  );

  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}

export function useActions(): StoreActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useActions must be used within ActionsProvider");
  return ctx;
}
```

- [ ] **Step 4: 实现 StoreProvider（组合所有 Provider）**

Create `src/lib/store/index.tsx`:

```tsx
"use client";

import React from "react";
import { GatewayProvider } from "./gateway/store";
import { AgentProvider } from "./agent/store";
import { SessionProvider } from "./session/store";
import { ChatProvider } from "./chat/store";
import { ActionsProvider } from "./actions-provider";

export { useGatewayStore } from "./gateway/store";
export { useAgentStore } from "./agent/store";
export { useSessionStore } from "./session/store";
export { useChatStore } from "./chat/store";
export { useActions } from "./actions-provider";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return (
    <GatewayProvider>
      <AgentProvider>
        <SessionProvider>
          <ChatProvider>
            <ActionsProvider>{children}</ActionsProvider>
          </ChatProvider>
        </SessionProvider>
      </AgentProvider>
    </GatewayProvider>
  );
}
```

- [ ] **Step 5: 跑验证三件套**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected：全绿。如果 send-message coordinator 在 Task 9 用了 `as unknown as AppState` 临时桥，此处清理掉改回窄化签名并重测。

- [ ] **Step 6: Commit**

```bash
git add src/lib/team/types.ts src/lib/store/index.tsx src/lib/store/actions-provider.tsx
git commit -m "feat(store): add StoreProvider + ActionsProvider; narrow team/types AppState dependency"
```

---

## Task 11: 迁移 9 个消费者 + page.tsx 到新 API

**目的：** 一次性把所有 `const { state, actions } = useStore()` 调用改为 per-slice hooks + `useActions()`。这是整个重构的唯一切换闸门。

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/chat-area.tsx`
- Modify: `src/components/conversation-panel.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/dialogs/create-company-dialog.tsx`
- Modify: `src/components/dialogs/create-agent-dialog.tsx`
- Modify: `src/components/dialogs/create-team-dialog.tsx`
- Modify: `src/components/dialogs/agent-settings-dialog.tsx`
- Modify: `src/components/dialogs/team-settings-dialog.tsx`
- Modify: `src/components/dialogs/gateway-settings-dialog.tsx`

**字段/动作迁移映射表：**

| 旧 `state.X` | 新来源 |
|---|---|
| `state.companies`, `state.activeCompanyId`, `state.connectionStatus`, `state.initialized` | `useGatewayStore().state` |
| `state.agents`, `state.teams`, `state.agentIdentities` | `useAgentStore().state` |
| `state.conversations`, `state.messages`, `state.activeChatTarget`, `state.activeConversationId`, `state.nativeSessionsLoading`, `state.nativeSessionsError` | `useSessionStore().state` |
| `state.streamingStates`, `state.lastCascadeStatus` | `useChatStore().state` |

| 旧 `actions.X` | 新来源 |
|---|---|
| `createCompany`, `updateCompany`, `restartGateway` | `useGatewayStore()` |
| `updateAgent`, `createTeam`, `updateTeam` | `useAgentStore()` |
| `createConversation`, `renameConversation` | `useSessionStore()` |
| `selectCompany`, `deleteCompany`, `createAgent`, `deleteAgent`, `deleteTeam`, `syncAgents`, `selectChatTarget`, `selectConversation`, `deleteConversation`, `sendMessage`, `abortStreaming` | `useActions()` |
| `connectGateway`, `disconnectGateway` | 不再暴露 — gateway slice 内部 useEffect 自动处理；如有消费者调用，通过 `useGatewayStore().connect/disconnect` 访问 |

- [ ] **Step 1: 更新 page.tsx 导入**

Edit `src/app/page.tsx` 第 3 行：

```tsx
// Before
import { StoreProvider } from "@/lib/store-legacy";

// After
import { StoreProvider } from "@/lib/store";
```

- [ ] **Step 2: 迁移 chat-area.tsx**

`src/components/chat-area.tsx` 第 22 / 173 行替换为：

```tsx
// Before
import { useStore } from "@/lib/store-legacy";
// ...
const { state, actions } = useStore();

// After
import {
  useGatewayStore,
  useAgentStore,
  useSessionStore,
  useChatStore,
  useActions,
} from "@/lib/store";
// ...
const gateway = useGatewayStore();
const { state: agentState } = useAgentStore();
const { state: sessionState } = useSessionStore();
const { state: chatState } = useChatStore();
const actions = useActions();
```

然后对文件内的 `state.X` 和 `actions.X` 按映射表替换。**具体需要替换的名称**取决于该组件消费了哪些字段/action，用这两条命令核对：

```bash
grep -n "state\." src/components/chat-area.tsx
grep -n "actions\." src/components/chat-area.tsx
```

对每条结果按映射表改写。

- [ ] **Step 3: 迁移 conversation-panel.tsx**

同 Step 2 模式。首先把 import 改为 `@/lib/store` 并列出 hooks；然后按映射表改字段。

```bash
grep -n "state\.\|actions\." src/components/conversation-panel.tsx
```

- [ ] **Step 4: 迁移 app-sidebar.tsx**

```bash
grep -n "state\.\|actions\." src/components/app-sidebar.tsx
```

- [ ] **Step 5: 迁移 dialogs/create-company-dialog.tsx**

- [ ] **Step 6: 迁移 dialogs/create-agent-dialog.tsx**

- [ ] **Step 7: 迁移 dialogs/create-team-dialog.tsx**

- [ ] **Step 8: 迁移 dialogs/agent-settings-dialog.tsx**

- [ ] **Step 9: 迁移 dialogs/team-settings-dialog.tsx**

- [ ] **Step 10: 迁移 dialogs/gateway-settings-dialog.tsx**

（以上 Step 5-10 每步都：`grep -n "state\.\|actions\." <file>`，按映射表改；如文件调用了 `actions.connectGateway/disconnectGateway`，改为从 `useGatewayStore()` 解构 `connect` / `disconnect`。）

- [ ] **Step 11: 确认无旧 useStore 残留**

```bash
grep -rn "from \"@/lib/store-legacy\"" src/ && echo "STILL HAS LEGACY" || echo "OK: all migrated"
grep -rn "useStore()" src/ && echo "LEGACY API STILL CALLED" || echo "OK"
```

Expected：两行都输出 `OK`。

- [ ] **Step 12: 跑 build + lint + test（TypeScript strict 是质量闸门）**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected：全部通过。TypeScript 会在任何漏改的字段/action 上报错 — 按报错逐一修。

- [ ] **Step 13: 手工 QA（spec §12 checklist）**

启动 dev server：

```bash
pnpm dev
```

按 [docs/superpowers/specs/2026-04-24-store-domain-split-design.md](../specs/2026-04-24-store-domain-split-design.md#12-qa-checklist-大纲) 中 §12 的 10 条验收项逐一手动验证。任何一项不通过，不得进入 Task 12。

- [ ] **Step 14: Commit**

```bash
git add src/app/page.tsx src/components/
git commit -m "refactor(consumers): migrate 9 consumers + page.tsx to per-slice hooks + useActions"
```

---

## Task 12: 删除 store-legacy.tsx 和 AppState 类型

**目的：** 所有消费者都迁移完成后，删除老代码，彻底解除对 `AppState` 的依赖。

**Files:**
- Delete: `src/lib/store-legacy.tsx`
- Modify: `src/types/index.ts` (remove `AppState` export)

- [ ] **Step 1: 最后一次确认无引用**

```bash
grep -rn "store-legacy\|AppState" src/ --include="*.ts" --include="*.tsx" | grep -v "test\\."
```

Expected：无输出（或仅 test 内残留的旧 import）。对每条结果调整：
- `store-legacy` 引用 → 改为 `@/lib/store`
- `AppState` 类型引用 → 通常是 `import type { AppState }` 在某处；用具体的 slice state type 替换，或删除该 import 如果未实际使用

- [ ] **Step 2: 删除 store-legacy**

```bash
rm src/lib/store-legacy.tsx
```

- [ ] **Step 3: 从 types/index.ts 删除 AppState**

Edit `src/types/index.ts` — 删除 `AppState` 接口定义（第 147-192 行左右）。

最终该文件的 `// ── Store Types ──` 这节直接删除；保留共享领域类型（Company / Agent / Message 等）。

- [ ] **Step 4: 跑 build + lint + test**

```bash
pnpm lint && pnpm test && pnpm build
```

Expected：全部通过。TypeScript 会把任何残留的 `AppState` 引用 / `store-legacy` 路径报出来 — 修掉，再跑。

- [ ] **Step 5: 再做一次回归 QA（spec §12 的缩减版）**

```bash
pnpm dev
```

重新验证 spec §12 checklist 中第 1、4、6、8、9 项（初始化 / Agent 改名 / DM 流式 / 流式生命周期 / 团队派发）。这 5 项覆盖了删除 legacy 最容易引入的回归。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(store): delete store-legacy.tsx and remove AppState type"
```

---

## Task 13: 固化文档到 project-journal + CLAUDE.md

**目的：** 把本次拆分的结果记录到项目知识库，使下次 AI 或新成员读到的文档反映新架构。

**Files:**
- Modify: `.project-journal/patterns.md`
- Modify: `.project-journal/decisions.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 patterns.md —— 替换旧的"全局状态集中在 store.tsx"条目**

Edit `.project-journal/patterns.md`:

把现有 `## 全局状态集中在 store.tsx` 条目整体替换为：

```markdown
## 状态按领域切分为 slice + 跨切 coordinator

**When**: 添加任何新功能、修改业务逻辑、添加新的 UI 状态
**How**:
1. 判断字段归属：gateway (companies / connection) / agent (agents, teams) / session (conversations, messages, activeChatTarget) / chat (streamingStates, cascade)
2. 若为 slice 内部 CRUD（只动自己切片的 state + 自己关心的 db）：
   - 在 `src/lib/store/{slice}/types.ts` 增补 action 类型
   - 在 `reducer.ts` 加 case + 写单元测试
   - 在 `store.tsx` 的 Provider value 中暴露 action creator
3. 若为跨切动作：在 `src/lib/store/coordinators/` 新建 pure function，显式接收 `getXState / dispatchX / refs`，配单元测试；在 `actions-provider.tsx` 中用 `useCallback` 绑定并加入 `useActions()`
4. 消费者：`useGatewayStore()` / `useAgentStore()` / `useSessionStore()` / `useChatStore()` 拿 state + 切片 CRUD；`useActions()` 拿跨切动作
5. **铁律**：slice Provider 内 useEffect 只订阅自己切片的 state，绝不跨切订阅；跨切反应放 `<ActionsProvider>` 的 useEffect
**Why not the obvious alternative**: 单一 useStore() facade 使 streaming delta 触发全量 re-render；切片 Provider 跨切订阅会产生隐式反应链难追踪
**Detected from**: <Task 13 commit sha>
```

- [ ] **Step 2: 在 decisions.md 追加落地记录**

Edit `.project-journal/decisions.md` — 在文件末尾追加：

```markdown
---

## [2026-04-24] store 按领域拆分落地

**Context**: 2026-04-24 决定把 store.tsx 拆为 gateway / agent / session / chat 四 slice + coordinators，本次 PR 完成落地。
**Decision**: 14 commit 单 PR 完成：reducer 先于 Provider、Provider 先于 coordinator、消费者迁移独立一个 commit、legacy 删除独立一个 commit。测试硬门槛 + spec §12 手工 QA 通过后 merge。
**Rejected**: 分多 PR 滚动迁移（双轨期过长易落债务）；保留 `useStore()` facade（re-render 隔离收益归零）。
**Affects**: src/lib/store/ 新目录 + src/lib/team/types.ts 的 DispatchOpts.getState 窄化；9 个消费者 API 切换；types/index.ts 删除 AppState。
**Detected from**: <Task 13 commit sha>
```

- [ ] **Step 3: 更新 CLAUDE.md 的架构决策章节**

Edit `CLAUDE.md` — 把 `## 关键架构决策` 里首行替换为：

```markdown
- `store.tsx` 已按领域拆分为 `store/gateway` / `store/agent` / `store/session` / `store/chat` 四个 slice + `store/coordinators/`。**切片 Provider 内 useEffect 只订阅自己切片**；跨切反应放 `<ActionsProvider>` 的 useEffect
- 消费者按需用 `useGatewayStore/useAgentStore/useSessionStore/useChatStore` + `useActions()`，不要再从旧的 `useStore()` 引入
```

- [ ] **Step 4: 跑一次 lint + test（文档变更但仍跑以确认不误伤）**

```bash
pnpm lint && pnpm test
```

Expected：全绿。

- [ ] **Step 5: Commit**

```bash
git add .project-journal/ CLAUDE.md
git commit -m "docs(journal+claude): record store domain-split landing; update patterns + decisions"
```

- [ ] **Step 6: 确认 commit 序列完整且可追溯**

```bash
git log --oneline <task0-start-sha>..HEAD
```

Expected：14 行，commit 标题分别对应 Task 0-13 的 commit message。

---

## 最终交付验证

- [ ] **`pnpm lint && pnpm test && pnpm build` 三件套在 HEAD 通过**
- [ ] **spec §12 QA checklist 10 项手动全绿**
- [ ] **commit 序列 14 个（每个独立可构建）**
- [ ] **`grep -rn "AppState" src/ --include="*.ts" --include="*.tsx"` 无命中**
- [ ] **`grep -rn "store-legacy" src/ --include="*.ts" --include="*.tsx"` 无命中**
- [ ] **新增测试数量 ≥ 60（`find src/lib/store -name "*.test.ts" | xargs grep -c "^  it(" | awk -F: '{sum+=$2} END {print sum}'` 输出 ≥ 60）**

