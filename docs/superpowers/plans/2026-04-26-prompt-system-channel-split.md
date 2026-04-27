# 提示词拆 system 通道 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 team dispatch 的提示词拆成 system + user 两路下发，让 OpenClaw 通过 `extraSystemPrompt` 通道接收稳定的团队上下文（不写入 messages.jsonl），动态内容仍走 user message。

**Architecture:** `assembleAgentPrompt` 返回 `{systemPrompt, userPrompt}` 双字段；`dispatcher` 把两段分别透传；`RuntimeClient.sendMessage` 接受可选 systemPrompt，非空白时 prepend `role: "system"` 到 OpenAI-compatible messages 数组。`/api/chat` 透传 body，OpenClaw 自带的 OpenAI HTTP 适配器把 system role 抽出作为 `extraSystemPrompt`。

**Tech Stack:** TypeScript (Next.js 16 App Router) · vitest · OpenClaw `/v1/chat/completions` (本地 npm 全局安装版本：`/data/lidongyu/.npm-global/lib/node_modules/openclaw`)

**Spec:** [docs/superpowers/specs/2026-04-26-prompt-system-channel-split-design.md](../specs/2026-04-26-prompt-system-channel-split-design.md)

---

## File Map

| 文件 | 改动类型 | 责任 |
|---|---|---|
| `src/lib/team/prompt-assembler.ts` | 修改 | `assembleAgentPrompt` 返回值改为 `{systemPrompt, userPrompt}` |
| `src/lib/team/prompt-assembler.test.ts` | 修改 | 现有断言迁移到新字段；新增覆盖 system/user 内容归属的用例 |
| `src/lib/team/types.ts` | 修改 | `DispatchOpts.sendToAgent` 增加可选第 5 参 `systemPrompt?: string` |
| `src/lib/team/dispatcher.ts` | 修改 | 解构 assembler 返回值，分别透传到 `sendToAgent` |
| `src/lib/team/dispatcher.test.ts` | 修改 | mock `sendToAgent` 捕获第 5 参；新增断言 systemPrompt 含 roster、userPrompt 不含 |
| `src/lib/runtime/types.ts` | 修改 | `RuntimeProvider.sendMessage` 第 5 参 `systemPrompt?: string` |
| `src/lib/runtime/index.ts` | 修改 | `RuntimeClient.sendMessage` 同步签名；非空白时 prepend system 消息 |
| `src/lib/store/coordinators/send-message.ts` | 修改 | `sendToAgentFn` 增加 5 参并透传给 `client.sendMessage` |
| `src/lib/store/coordinators/send-message.test.ts` | 修改 | 放宽 `clientRef.current.sendMessage` 的类型，让新签名不破坏旧 mock |

DM 路径（`send-message.ts:137`）调用 `client.sendMessage` 时**不传** systemPrompt，行为不变。

---

## Task 1: prompt-assembler 拆双字段（保持调用链字面兼容）

**目标**：让 `assembleAgentPrompt` 返回 `{systemPrompt, userPrompt}`；dispatcher 临时把两段 `\n\n` 拼回单一字符串送给 `sendToAgent`，外部行为零变化。这一 commit 后所有测试仍绿。

**Files:**
- Modify: `src/lib/team/prompt-assembler.ts`
- Modify: `src/lib/team/prompt-assembler.test.ts`
- Modify: `src/lib/team/dispatcher.ts:267-281`

### Step 1.1 — Write the failing tests for the new shape

替换 [src/lib/team/prompt-assembler.test.ts](../../../src/lib/team/prompt-assembler.test.ts) 全文为下列内容（保留原导入与 fixture，断言对象升级到双字段，并加 4 个归属类用例）：

- [ ] **Step 1.1**

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

describe("assembleAgentPrompt — system channel (stable team context)", () => {
  it("injects TL role header into systemPrompt when self.role is TL", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi team", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain(`You are the TL (Team Leader) of "dev"`);
    expect(out.userPrompt).not.toContain(`You are the TL`);
  });

  it("injects Member role header into systemPrompt when self.role is Member", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain(`You are a Member of "dev"`);
  });

  it("marks self in the roster with ← You inside systemPrompt", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain("**Bob**");
    expect(out.systemPrompt).toContain("← You");
  });

  it("includes trigger syntax for every roster member in systemPrompt", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain("`@[Alice](a1)`");
    expect(out.systemPrompt).toContain("`@[Bob](a2)`");
    expect(out.userPrompt).not.toContain("`@[Alice](a1)`");
  });

  it("includes the four global protocol XML blocks in systemPrompt only", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    for (const tag of [
      "<delivering_results>",
      "<proactiveness>",
      "<task_management>",
      "<circuit_breaker>",
    ]) {
      expect(out.systemPrompt).toContain(tag);
      expect(out.userPrompt).not.toContain(tag);
    }
  });

  it("includes Identity protection guidance in systemPrompt", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).toContain("Identity protection");
  });

  it("omits the recent_decisions block when not provided", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
    });
    expect(out.systemPrompt).not.toContain("<recent_decisions>");
    expect(out.systemPrompt).not.toContain("Recent team decisions");
    expect(out.userPrompt).not.toContain("<recent_decisions>");
  });

  it("omits the recent_decisions block when value is empty/whitespace", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
      recentDecisions: "   \n  ",
    });
    expect(out.systemPrompt).not.toContain("<recent_decisions>");
  });

  it("injects raw decisions content into systemPrompt verbatim when under cap", () => {
    const decisions = `# Team Decisions\n\n---\n\n## [2026-04-26] Use SSE\n\n**Decided by**: Alice\n**Rationale**: lower latency\n\n---\n`;
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
      recentDecisions: decisions,
    });
    expect(out.systemPrompt).toContain("<recent_decisions>");
    expect(out.systemPrompt).toContain("[2026-04-26] Use SSE");
    expect(out.systemPrompt).toContain("**Decided by**: Alice");
    expect(out.systemPrompt).toContain("Do not relitigate these");
    expect(out.systemPrompt).not.toContain("(log truncated");
    expect(out.userPrompt).not.toContain("<recent_decisions>");
  });

  it("truncates the decisions block when it exceeds the size cap", () => {
    const long =
      `# Team Decisions\n\n---\n\n` +
      Array.from({ length: 30 }, (_, i) =>
        `## [2026-04-${String(i + 1).padStart(2, "0")}] Decision ${i}\n\n**Decided by**: Alice\n**Rationale**: lorem ipsum dolor sit amet consectetur adipiscing elit ${i}\n\n---\n`
      ).join("\n");
    expect(long.length).toBeGreaterThan(600);
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "hi", isDirectMention: false,
      recentDecisions: long,
    });
    expect(out.systemPrompt).toContain("<recent_decisions>");
    expect(out.systemPrompt).toContain("(log truncated");
    const start = out.systemPrompt.indexOf("<recent_decisions>");
    const end = out.systemPrompt.indexOf("</recent_decisions>");
    expect(end - start).toBeLessThan(900);
  });
});

describe("assembleAgentPrompt — user channel (per-turn dynamic)", () => {
  it("includes the group_activity block in userPrompt when provided", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: "<group_activity>\nsome activity\n</group_activity>",
      userText: "", isDirectMention: false,
    });
    expect(out.userPrompt).toContain("<group_activity>\nsome activity\n</group_activity>");
    expect(out.systemPrompt).not.toContain("<group_activity>");
  });

  it("omits the group_activity block when null", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "hello", isDirectMention: false,
    });
    expect(out.userPrompt).not.toContain("<group_activity>");
  });

  it("includes the active_tasks block in userPrompt when provided", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "", isDirectMention: false,
      activeTasks: "<active_tasks>\n- T1 in_progress\n</active_tasks>",
    });
    expect(out.userPrompt).toContain("<active_tasks>");
    expect(out.systemPrompt).not.toContain("<active_tasks>");
  });

  it("appends 'You were mentioned' trailer in userPrompt when isDirectMention is false", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "", isDirectMention: false,
    });
    expect(out.userPrompt).toContain("You (Bob) were mentioned in the group conversation");
    expect(out.systemPrompt).not.toContain("were mentioned in the group conversation");
  });

  it("does NOT append the trailer when isDirectMention is true", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a2", name: "Bob", role: "Member" },
      groupActivity: null, userText: "@[Bob](a2) do X", isDirectMention: true,
    });
    expect(out.userPrompt).not.toContain("were mentioned in the group conversation");
    expect(out.userPrompt).toContain("@[Bob](a2) do X");
  });

  it("returns systemPrompt as a non-empty string even with minimal inputs", () => {
    const out = assembleAgentPrompt({
      team, roster,
      self: { agentId: "a1", name: "Alice", role: "TL" },
      groupActivity: null, userText: "", isDirectMention: true,
    });
    expect(out.systemPrompt.length).toBeGreaterThan(0);
    expect(out.systemPrompt).toContain("dev");
  });
});
```

### Step 1.2 — Run tests, expect failure

- [ ] **Step 1.2**

```bash
pnpm vitest run src/lib/team/prompt-assembler.test.ts
```

Expected: FAIL — every assertion on `out.systemPrompt` / `out.userPrompt` errors with "Cannot read properties of undefined" or similar (because the function still returns a string).

### Step 1.3 — Refactor assembler to return `{systemPrompt, userPrompt}`

替换 [src/lib/team/prompt-assembler.ts:25-41](../../../src/lib/team/prompt-assembler.ts#L25-L41) 的 `assembleAgentPrompt` 与紧随其后的 helper 调用。新结构：

- [ ] **Step 1.3**

```ts
export interface AssembledPrompt {
  /** Stable team-level context: role header, roster, workspace path,
   * recent decisions, @mention protocol, sessions_spawn guidance, identity
   * protection, and the four behavioral protocol XML blocks.
   * Sent via OpenClaw's `extraSystemPrompt` channel — does not enter chat history. */
  systemPrompt: string;
  /** Per-turn dynamic content: active_tasks, group_activity, user text,
   * "you were mentioned" trailer. Sent as a normal user message. */
  userPrompt: string;
}

export function assembleAgentPrompt(opts: AssembleOpts): AssembledPrompt {
  const teamContext = buildTeamContext(
    opts.team,
    opts.roster,
    opts.self,
    opts.recentDecisions,
  );
  const protocols = buildGlobalProtocols();
  const systemPrompt = [teamContext, protocols].filter(Boolean).join("\n\n");

  const trailer = opts.isDirectMention
    ? ""
    : `\n\nYou (${opts.self.name}) were mentioned in the group conversation. Please respond to the discussion.`;
  const tail = (opts.userText + trailer).trim();
  const userPrompt = [opts.activeTasks ?? "", opts.groupActivity ?? "", tail]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, userPrompt };
}
```

注意：`buildTeamContext` / `buildGlobalProtocols` / `formatDecisionsBlock` 三个内部 helper **完全不动**。

### Step 1.4 — Run assembler tests, expect pass

- [ ] **Step 1.4**

```bash
pnpm vitest run src/lib/team/prompt-assembler.test.ts
```

Expected: PASS — all 16 tests green.

### Step 1.5 — Patch dispatcher call site so the rest of the world still compiles

找到 [src/lib/team/dispatcher.ts:267-281](../../../src/lib/team/dispatcher.ts#L267-L281)，整体替换为下面这块（**临时**把两段 `\n\n` 拼回，下个 task 才会走双通道）：

- [ ] **Step 1.5**

```ts
  const { systemPrompt, userPrompt } = assembleAgentPrompt({
    team,
    roster,
    self,
    groupActivity,
    userText: isUserHop ? opts.userContent : "",
    isDirectMention,
    activeTasks: activeTasksRendered,
    recentDecisions,
  });

  const sessionKey = opts.buildSessionKey(agentId, team.id, ctx.conversationId);
  const attachments = isUserHop ? opts.attachments : undefined;

  // TODO(task-2): pass systemPrompt and userPrompt as separate channels.
  const prompt = [systemPrompt, userPrompt].filter(Boolean).join("\n\n");
  return opts.sendToAgent(agentId, sessionKey, prompt, attachments);
```

### Step 1.6 — Run full test suite, expect pass (no behavior change yet)

- [ ] **Step 1.6**

```bash
pnpm vitest run src/lib/team/
```

Expected: PASS — `prompt-assembler.test.ts` 16 个，`dispatcher.test.ts` 既有用例全绿（行为字符串与之前一致）。

### Step 1.7 — Commit

- [ ] **Step 1.7**

```bash
git add src/lib/team/prompt-assembler.ts src/lib/team/prompt-assembler.test.ts src/lib/team/dispatcher.ts
git commit -m "refactor(team): split assembleAgentPrompt into systemPrompt + userPrompt

assembleAgentPrompt now returns { systemPrompt, userPrompt }. Dispatcher
temporarily concatenates them so the wire format is unchanged. Tests
verify which content goes to which channel. Subsequent commits will
plumb systemPrompt through to OpenClaw's extraSystemPrompt channel."
```

---

## Task 2: dispatcher emits systemPrompt as the 5th `sendToAgent` arg

**目标**：把 dispatcher 的 system 通道真正传到 `sendToAgent`。`DispatchOpts` 接口与 dispatcher 测试同步更新。

**Files:**
- Modify: `src/lib/team/types.ts:51-67`
- Modify: `src/lib/team/dispatcher.ts:267-282` (上一 task 已动过，再调一次)
- Modify: `src/lib/team/dispatcher.test.ts`

### Step 2.1 — Write a failing dispatcher-level test

往 [src/lib/team/dispatcher.test.ts](../../../src/lib/team/dispatcher.test.ts) **追加**一个 describe 块（保留全部既有测试）：

- [ ] **Step 2.1**

```ts
describe("dispatchTeamMessage — system/user prompt split", () => {
  it("passes systemPrompt as the 5th arg with stable team context, userPrompt without it", async () => {
    const t = team(["a1", "a2"], "a2");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(
      async (id: string) => ({ fromAgentId: id, content: "ok" }),
    );

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "ping", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    const call = sendToAgent.mock.calls[0];
    // signature: (agentId, sessionKey, userPrompt, attachments, systemPrompt)
    const userPrompt = call[2] as string;
    const systemPrompt = call[4] as string | undefined;

    expect(systemPrompt).toBeTypeOf("string");
    expect(systemPrompt).toContain(`You are the TL (Team Leader) of "dev"`);
    expect(systemPrompt).toContain("`@[A](a1)`");
    expect(systemPrompt).toContain("<task_management>");

    expect(userPrompt).not.toContain(`You are the TL`);
    expect(userPrompt).not.toContain("<task_management>");
    expect(userPrompt).toContain("ping");
  });
});
```

### Step 2.2 — Run dispatcher tests, expect failure

- [ ] **Step 2.2**

```bash
pnpm vitest run src/lib/team/dispatcher.test.ts
```

Expected: FAIL — `systemPrompt` is `undefined`（dispatcher 还没传第 5 参）。

### Step 2.3 — Extend `DispatchOpts.sendToAgent` signature

替换 [src/lib/team/types.ts:59-64](../../../src/lib/team/types.ts#L59-L64) 的 `sendToAgent` 字段：

- [ ] **Step 2.3**

```ts
  sendToAgent: (
    agentId: string,
    sessionKey: string,
    text: string,
    attachments?: MessageAttachment[],
    systemPrompt?: string,
  ) => Promise<DispatchReply | null>;
```

### Step 2.4 — Update dispatcher to pass systemPrompt as the 5th arg

替换 [src/lib/team/dispatcher.ts:280-281](../../../src/lib/team/dispatcher.ts#L280-L281) 的最后两行（在 task 1 修改基础上去掉 TODO 与拼接）：

- [ ] **Step 2.4**

```ts
  return opts.sendToAgent(agentId, sessionKey, userPrompt, attachments, systemPrompt);
```

`prompt` 中间变量删掉，`systemPrompt` / `userPrompt` 两个 `const` 保留即可。

### Step 2.5 — Run dispatcher tests, expect pass

- [ ] **Step 2.5**

```bash
pnpm vitest run src/lib/team/dispatcher.test.ts
```

Expected: PASS — 既有用例（不读第 5 参）+ 新加的 split 用例全部绿。

### Step 2.6 — Run team test suite for sanity

- [ ] **Step 2.6**

```bash
pnpm vitest run src/lib/team/
```

Expected: PASS。

### Step 2.7 — Commit

- [ ] **Step 2.7**

```bash
git add src/lib/team/types.ts src/lib/team/dispatcher.ts src/lib/team/dispatcher.test.ts
git commit -m "feat(team): dispatcher emits systemPrompt as 5th sendToAgent arg

DispatchOpts.sendToAgent now takes optional systemPrompt as the 5th arg
so the team context can be carried through a separate channel. Existing
callers ignoring the 5th arg keep working unchanged."
```

---

## Task 3: Runtime supports `role: \"system\"` prepend

**目标**：`RuntimeProvider.sendMessage` 接受可选 `systemPrompt`，`RuntimeClient` 实现非空白时 prepend 一条 `role: "system"` 到 OpenAI-compatible body 的 messages 数组。

**Files:**
- Modify: `src/lib/runtime/types.ts:26`
- Modify: `src/lib/runtime/index.ts:57, 105-110`

> 没有 runtime 单元测试（它走真实 fetch），保证类型签名 + 契约一致即可。后续 task 4 + 手工烟囱测会兜底覆盖。

### Step 3.1 — Update interface signature

替换 [src/lib/runtime/types.ts:26](../../../src/lib/runtime/types.ts#L26)：

- [ ] **Step 3.1**

```ts
  sendMessage(
    sessionKey: string,
    message: string,
    agentId?: string,
    attachments?: import("@/types").MessageAttachment[],
    systemPrompt?: string,
  ): Promise<void>;
```

### Step 3.2 — Update `RuntimeClient.sendMessage` signature and request body

替换 [src/lib/runtime/index.ts:57](../../../src/lib/runtime/index.ts#L57) 的方法签名：

- [ ] **Step 3.2 (a)**

```ts
  async sendMessage(
    sessionKey: string,
    message: string,
    agentId?: string,
    attachments?: MessageAttachment[],
    systemPrompt?: string,
  ): Promise<void> {
```

然后定位到 [src/lib/runtime/index.ts:103-112](../../../src/lib/runtime/index.ts#L103-L112) 构造 `fetch("/api/chat", ...)` 的位置，把当前 body 中那一行：

```ts
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: messageContent }],
          stream: true,
        }),
```

替换为：

- [ ] **Step 3.2 (b)**

```ts
        body: JSON.stringify({
          model,
          messages: buildMessagesArray(systemPrompt, messageContent),
          stream: true,
        }),
```

并在 [src/lib/runtime/index.ts](../../../src/lib/runtime/index.ts) 文件最底部（`export class` 之后、`export` 之前）追加 helper：

- [ ] **Step 3.2 (c)**

```ts
function buildMessagesArray(
  systemPrompt: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userContent: string | Array<any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Array<{ role: string; content: string | Array<any> }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Array<{ role: string; content: string | Array<any> }> = [];
  if (systemPrompt && systemPrompt.trim().length > 0) {
    out.push({ role: "system", content: systemPrompt });
  }
  out.push({ role: "user", content: userContent });
  return out;
}
```

### Step 3.3 — Type check

- [ ] **Step 3.3**

```bash
pnpm tsc --noEmit
```

Expected: PASS — no errors.（如果类型检查脚本不是 `tsc --noEmit`，改用项目现有的 `pnpm lint` 或 `pnpm build`。）

### Step 3.4 — Sanity: existing send-message tests still compile/pass

- [ ] **Step 3.4**

```bash
pnpm vitest run src/lib/store/coordinators/send-message.test.ts
```

Expected: PASS — coordinator 调用 `client.sendMessage` 时不传第 5 参，旧行为完全保留。

### Step 3.5 — Commit

- [ ] **Step 3.5**

```bash
git add src/lib/runtime/types.ts src/lib/runtime/index.ts
git commit -m "feat(runtime): RuntimeClient.sendMessage accepts optional systemPrompt

When provided and non-blank, the runtime prepends a { role: 'system' }
message to the OpenAI-compatible messages array. OpenClaw's HTTP
adapter (openai-http buildAgentPrompt) extracts these into
extraSystemPrompt and appends to the agent's static system prompt
without persisting them to messages.jsonl."
```

---

## Task 4: Coordinator threads systemPrompt end-to-end

**目标**：`send-message.ts` 的 `sendToAgentFn` 接受 dispatcher 传来的第 5 参 `systemPrompt`，并继续往下喂给 `client.sendMessage`。同时放宽 `send-message.test.ts` 里的 `clientRef.current.sendMessage` 类型，使新签名不破坏 mock。

**Files:**
- Modify: `src/lib/store/coordinators/send-message.ts:168-200`
- Modify: `src/lib/store/coordinators/send-message.test.ts:62-66`

### Step 4.1 — Extend `sendToAgentFn` lambda

替换 [src/lib/store/coordinators/send-message.ts:168-173](../../../src/lib/store/coordinators/send-message.ts#L168-L173)：

- [ ] **Step 4.1 (a)**

```ts
  const sendToAgentFn = async (
    agentId: string,
    sessionKey: string,
    text: string,
    atts?: MessageAttachment[],
    systemPrompt?: string,
  ): Promise<{ fromAgentId: string; content: string } | null> => {
```

然后定位到 [src/lib/store/coordinators/send-message.ts:200](../../../src/lib/store/coordinators/send-message.ts#L200)，把：

```ts
      await client.sendMessage(sessionKey, text, undefined, atts);
```

替换为：

- [ ] **Step 4.1 (b)**

```ts
      await client.sendMessage(sessionKey, text, undefined, atts, systemPrompt);
```

DM 路径 [src/lib/store/coordinators/send-message.ts:137](../../../src/lib/store/coordinators/send-message.ts#L137) 的 `client.sendMessage(sessionKey, content, undefined, attachments)` 调用**保持不变**——DM 不需要 systemPrompt。

### Step 4.2 — Loosen the test mock typing

替换 [src/lib/store/coordinators/send-message.test.ts:62-66](../../../src/lib/store/coordinators/send-message.test.ts#L62-L66) 的类型 cast 块：

- [ ] **Step 4.2**

```ts
    } as unknown as React.MutableRefObject<{
      isConnected: () => boolean;
      sendMessage: (
        k: string,
        t: string,
        u: undefined,
        a?: unknown,
        s?: string,
      ) => Promise<void>;
      abortChat: (k: string) => Promise<void>;
    } | null>,
```

`vi.fn(async () => {})` mock 本身不需要改——它会接受任意参数。

### Step 4.3 — Run coordinator tests

- [ ] **Step 4.3**

```bash
pnpm vitest run src/lib/store/coordinators/send-message.test.ts
```

Expected: PASS。

### Step 4.4 — Run full test suite

- [ ] **Step 4.4**

```bash
pnpm vitest run
```

Expected: PASS — all suites green.

### Step 4.5 — Lint + build

- [ ] **Step 4.5**

```bash
pnpm lint && pnpm build
```

Expected: PASS — no lint/type errors, build artefacts emit.

### Step 4.6 — Commit

- [ ] **Step 4.6**

```bash
git add src/lib/store/coordinators/send-message.ts src/lib/store/coordinators/send-message.test.ts
git commit -m "feat(team): coordinator threads systemPrompt to runtime

The sendToAgentFn lambda created in send-message.ts now accepts the 5th
arg from the dispatcher and forwards it to client.sendMessage. DM path
unchanged. With this commit, system content reaches OpenClaw's
extraSystemPrompt channel end-to-end."
```

---

## Task 5: 手工烟囱测试 + 文档收尾

**目标**：在真实 OpenClaw 环境下确认拆分生效；更新 spec 完成定义勾选；推送分支。

### Step 5.1 — Start dev server

- [ ] **Step 5.1**

```bash
pnpm dev
```

Expected: Next.js dev server 在 `http://localhost:3000` 启动；OpenClaw 网关已配置（gateway 地址 + token 在用户 settings 里）。

### Step 5.2 — Trigger a team dispatch

- [ ] **Step 5.2**

打开浏览器 → 选一个含 ≥ 2 个 agent 的 team → 发一条 `@SomeAgent 帮我写一段 hello 函数`。等 agent 流式回复完成。

记下被激活的 agent 的 DID（页面右上角 avatar 列表对照 agent 配置），命名为 `<DID>`，记下 conversation id（可在 URL 或 localStorage `lastChatTarget` 里看到）。

### Step 5.3 — Inspect the persisted user message in OpenClaw session jsonl

- [ ] **Step 5.3**

```bash
ACCID=$(ls ~/.openclaw/accounts | head -1)
ls -t ~/.openclaw/accounts/$ACCID/agents/<DID>/sessions/*.messages.jsonl | head -1
```

打开最新的 jsonl，看最后一条 `role:"user"` 的 content。**预期**：

- ✅ 含 `<group_activity>` / `<active_tasks>`（如果有任务）/ 用户原文 / `You (X) were mentioned` trailer
- ❌ **不**含 `# You are the TL` / `# You are a Member`
- ❌ **不**含 `## Team roster` / `` `@[…](…)` ``
- ❌ **不**含 `<delivering_results>` / `<proactiveness>` / `<task_management>` / `<circuit_breaker>`
- ❌ **不**含 `## @mention protocol` / `## sessions_spawn` / `## Identity protection`
- ❌ **不**含 `<recent_decisions>`

如果上面任何一项 ❌ 没满足，把样本 jsonl 内容粘出来，停步排查。

### Step 5.4 — Verify CLI session reuse on the second turn

- [ ] **Step 5.4**

在同一会话再发一条不同的消息（比如 `还是这个函数，加个 docstring`），确认 agent 正常回复。然后查看 OpenClaw 日志：

```bash
LOG=$(ls -t /tmp/openclaw/openclaw-*.log | head -1)
tail -200 "$LOG" | grep -E "cli session reset|extraSystemPromptHash"
```

**预期**：第一条消息可能有一行 `cli session reset: ... reason=extraSystemPromptHash`（首次冷启动），第二条消息**不应**再出现该 reset。如果第二条仍 reset，说明 systemPrompt 内容在两轮间发生了变化，需要回头排查 `prompt-assembler` 的稳定性（最常见嫌疑：roster 顺序或 decisions 文件被意外重写）。

### Step 5.5 — Update spec completion checklist

- [ ] **Step 5.5**

打开 [docs/superpowers/specs/2026-04-26-prompt-system-channel-split-design.md](../specs/2026-04-26-prompt-system-channel-split-design.md) 的 "完成定义" 段，把 6 个复选框全部勾上：

```md
- [x] `assembleAgentPrompt` 返回 `{ systemPrompt, userPrompt }`，单元测试断言两路内容。
- [x] `RuntimeClient.sendMessage` 接受可选 `systemPrompt`，非空白时 prepend
      `role: "system"` 消息。
- [x] `dispatcher.ts` 把两段分别下发到 `sendToAgent`，新参数有测试覆盖。
- [x] 手工验证 4 步全部通过。
- [x] `pnpm lint` 通过。
- [x] `pnpm build` 通过。
```

### Step 5.6 — Commit + push

- [ ] **Step 5.6**

```bash
git add docs/superpowers/specs/2026-04-26-prompt-system-channel-split-design.md
git commit -m "docs(specs): mark prompt-system-channel-split completion checklist done"
git push -u origin feat/agent-prompt-and-dispatch-ui
```

预期：分支推送成功。

---

## Self-Review

**Spec coverage（每条 spec 要求都有任务对应）**：

- "拆 system / user 双字段" → Task 1
- "RuntimeClient.sendMessage 接 systemPrompt 参数" → Task 3
- "Dispatcher 透传两段" → Task 2
- "/api/chat 不动" → 显式不在改动文件列表中 ✅
- "上层 useActions 不暴露" → coordinator `sendMessage`（外部 API）签名不变，仅内部 `sendToAgentFn` 加参数 → Task 4 ✅
- "测试：assembler / dispatcher 双断言" → Task 1 + Task 2
- 手工验证 4 步 → Task 5
- 风险表中"首次冷启动 1 次重建" / "decisions 改时再 bust 1 次" → Task 5.4 显式观察日志覆盖

**Placeholder scan**：搜 "TBD" / "TODO" / "implement later" / "fill in details" — 仅 Task 1 step 1.5 出现一行 `// TODO(task-2): ...` 注释，**这是临时占位且 Task 2 step 2.4 会显式删除**，符合 "完整代码 + 后续任务清除" 的模式，放行。

**Type consistency**：`assembleAgentPrompt` 返回 `AssembledPrompt = {systemPrompt, userPrompt}` 在 Task 1 定义并被 Task 2 使用名字一致；`sendToAgent` 第 5 参在 types.ts (Task 2) / dispatcher.ts (Task 2) / send-message.ts 的 lambda (Task 4) 三处签名一致都叫 `systemPrompt: string` (optional)；`RuntimeProvider.sendMessage` 第 5 参 (Task 3) 与 coordinator 调用 (Task 4) 也对齐。
