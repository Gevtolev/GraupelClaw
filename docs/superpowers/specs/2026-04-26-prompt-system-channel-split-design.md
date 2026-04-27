# 提示词拆分到 system 通道（accio 对齐 · §1）

> 本 spec 由 2026-04-26 brainstorm 产出。系列三件事之一，独立实现。
> 关键决策内联，不做的范围列在末尾。

## 目标

让团队 dispatch 过程中**稳定**的 team 上下文通过 OpenClaw 的 `extraSystemPrompt`
通道下发（不写入 `messages.jsonl`），**动态**的内容仍走 user message。

预期效果：

- 每个 hop 的 user message 体积下降到约原来的 1/4（~2k 字符 → ~0.5k 字符）。
- chat history 不再被静态团队规则反复污染——重读 jsonl 时一眼能看出真正发生了什么。
- 与 accio session 文件结构对齐（参见 `docs/.accio/accounts/.../sessions/*.messages.jsonl`，
  其中 user message 只含 `<group_activity>` + trailer）。

## 背景

### OpenClaw 对 system role 的处理（已验证）

入口：[openai-http-DzUCvleu.js:213-244](file:///data/lidongyu/.npm-global/lib/node_modules/openclaw/dist/openai-http-DzUCvleu.js#L213-L244)
的 `buildAgentPrompt`。

- 任意条数的 `role: "system"` 或 `role: "developer"` 消息 → 文本拼接（`\n\n` 连接）→
  作为 `extraSystemPrompt` 字段下传。
- 这些消息**不会进入 conversation history**，不会出现在 messages.jsonl。
- `extraSystemPrompt` 流到 [prepare.runtime-uR-bHnQr.js:680](file:///data/lidongyu/.npm-global/lib/node_modules/openclaw/dist/prepare.runtime-uR-bHnQr.js#L680)
  的 `buildSystemPrompt({ ..., extraSystemPrompt, ... })`——**追加（不替换）**到
  `agent-core/*.md` 拼出来的静态 system prompt 末尾。

### 缓存哈希行为

[prepare.runtime-uR-bHnQr.js:543](file:///data/lidongyu/.npm-global/lib/node_modules/openclaw/dist/prepare.runtime-uR-bHnQr.js#L543)
通过 `extraSystemPromptHash` 决定 CLI session 复用：

- system 内容**两次调用之间稳定** → hash 命中 → CLI session 复用（无冷启动）。
- system 内容**变化** → 新 hash → CLI session 重建（一次性冷启动 1–2s）。

→ 设计核心：**只把 turn 内不变的内容放 system**，把每轮都变的留在 user。

## 通道划分

| 块 | 通道 | 频率 |
|---|---|---|
| `# You are the TL/Member of "X"` 角色块 | system | 团队配置变才动 |
| Team roster（含 trigger 语法） | system | 成员增减才动 |
| Workspace 路径块（`team.workspaceRoot` 存在时） | system | 团队配置变才动 |
| `<recent_decisions>` | system | 用户手动 mark decision 才动（低频） |
| `## @mention protocol` | system | 静态 |
| `## sessions_spawn vs @mention` | system | 静态 |
| `## Identity protection` | system | 静态 |
| 4 段协议 XML（delivering_results / proactiveness / task_management / circuit_breaker） | system | 静态 |
| `<active_tasks>` | user | 每次 dispatch 变 |
| `<group_activity>` | user | 每轮变 |
| 用户原文 | user | 每轮变 |
| `You (X) were @mentioned...` trailer | user | 每 hop 变 |

**`<recent_decisions>` 选 system 的理由**：与 accio 的 `groupSystemPrompt` 行为对齐
（accio 在 [get-reply-DIRI0vf6.js:2110](file:///data/lidongyu/.npm-global/lib/node_modules/openclaw/dist/get-reply-DIRI0vf6.js#L2110)
的 `extraSystemPromptStaticParts` 里包含 `groupSystemPrompt`）。decisions 是团队共识、
属于 agent 身份层面的背景知识，进 system 更贴合语义。代价是 mark decision 时会
触发一次 CLI session 重建——人为手动操作，频率低，可接受。

**trailer 选 user 的理由**：trailer 是本轮性质的提醒（这条消息你被 @ 了），
不是稳定上下文。accio 的 jsonl 也是把它放在 user message 末尾。

## 改动定位

### 1. `src/lib/team/prompt-assembler.ts`（核心）

**接口变化**：

```ts
// 旧
export function assembleAgentPrompt(opts: AssembleOpts): string

// 新
export interface AssembledPrompt {
  systemPrompt: string;   // 稳定块拼接，可能极简但通常非空
  userPrompt: string;     // 动态块拼接，可能为空字符串（heartbeat 等无内容场景）
}
export function assembleAgentPrompt(opts: AssembleOpts): AssembledPrompt
```

**内部拆分**：

```ts
function assembleAgentPrompt(opts) {
  return {
    systemPrompt: buildSystemPrompt(opts),
    userPrompt: buildUserPrompt(opts),
  };
}

function buildSystemPrompt(opts): string {
  // 现有 buildTeamContext 完整内容（含 roster / workspace / decisions /
  // @mention 协议 / sessions_spawn / identity protection）
  // + 现有 buildGlobalProtocols 完整内容
  return [teamContext, globalProtocols].filter(Boolean).join("\n\n");
}

function buildUserPrompt(opts): string {
  // 动态块 + 用户原文 + trailer
  const trailer = opts.isDirectMention
    ? ""
    : `\n\nYou (${opts.self.name}) were mentioned in the group conversation. Please respond to the discussion.`;
  const tail = (opts.userText + trailer).trim();
  return [opts.activeTasks ?? "", opts.groupActivity ?? "", tail].filter(Boolean).join("\n\n");
}
```

`buildTeamContext` / `buildGlobalProtocols` / `formatDecisionsBlock` 这三个内部
helper **保持不变**——只是 `assembleAgentPrompt` 不再把它们 join 到一起，而是
分别归入 system 和 user。

### 2. `src/lib/runtime/index.ts`

`sendMessage` 增加可选 `systemPrompt`：

```ts
async sendMessage(
  sessionKey: string,
  message: string,
  agentId?: string,
  attachments?: MessageAttachment[],
  systemPrompt?: string,   // 新增
): Promise<void>
```

构造请求 body 时若有 system 且非空白：

```ts
const messagesArr: Array<{ role: string; content: string | Array<unknown> }> = [];
if (systemPrompt && systemPrompt.trim()) {
  messagesArr.push({ role: "system", content: systemPrompt });
}
messagesArr.push({ role: "user", content: messageContent });

await fetch("/api/chat", {
  method: "POST",
  headers,
  body: JSON.stringify({ model, messages: messagesArr, stream: true }),
  signal: abortController.signal,
});
```

`RuntimeProvider` 接口签名同步扩展。

### 3. `src/lib/team/dispatcher.ts`

[dispatcher.ts:267](src/lib/team/dispatcher.ts#L267) 处接收新返回值，分别透传：

```ts
const { systemPrompt, userPrompt } = assembleAgentPrompt({
  team, roster, self, groupActivity,
  userText: isUserHop ? opts.userContent : "",
  isDirectMention,
  activeTasks: activeTasksRendered,
  recentDecisions,
});

const sessionKey = opts.buildSessionKey(agentId, team.id, ctx.conversationId);
const attachments = isUserHop ? opts.attachments : undefined;

return opts.sendToAgent(agentId, sessionKey, userPrompt, attachments, systemPrompt);
```

`DispatchOpts.sendToAgent` 接口签名增加可选 `systemPrompt: string` 参数。

### 4. `src/app/api/chat/route.ts`

**不动**。req body 透传到 OpenClaw `/v1/chat/completions`。OpenClaw 自动识别
`role: "system"` 并归入 `extraSystemPrompt`。

### 5. 上层调用链

`useActions().sendMessage` / store coordinator 等上层调用是否暴露 systemPrompt？

→ **不暴露**。系统 prompt 只在 dispatcher 这一层生成（团队场景）。DM 场景
的 `RuntimeClient.sendMessage` 调用不传 systemPrompt，行为不变。

### 6. 测试

**`prompt-assembler.test.ts`**:

- 现有用例改为同时断言 `systemPrompt` 和 `userPrompt` 两个字段。
- 新增 case：team 1 个人 + 无 decisions → systemPrompt 仍含角色块 + 协议
  XML（最小 system 也至少 ~1k 字符）。
- 新增 case：`recent_decisions` 出现在 systemPrompt，**不**出现在 userPrompt。
- 新增 case：`<active_tasks>` / `<group_activity>` / 用户原文 / trailer 都
  出现在 userPrompt，**不**出现在 systemPrompt。
- 新增 case：被直接 @ 时 trailer 不追加；非直接 @ 时 trailer 出现在 userPrompt。

**`dispatcher.test.ts`**:

- `sendToAgent` mock 新增第 5 参数 systemPrompt 的捕获。
- 现有测试增补断言：systemPrompt 包含 roster；userPrompt 不含 roster。
- 新增 case：DM hop（team.id 为 undefined 路径）—— 实际不通过 dispatcher。
  不需要测试。

**手工验证（一次性）**:

1. `pnpm dev`，向一个含 ≥ 2 个 agent 的 team 发一条 `@SomeAgent 帮我...` 消息。
2. 观察 OpenClaw `~/.openclaw/accounts/<aid>/agents/<did>/sessions/<sk>.messages.jsonl`：
   - 新增的 user message 应当**不**含 `<team_context>` / `<delivering_results>`
     等静态块。
   - 应当**只**含 `<group_activity>`（如有）/ `<active_tasks>`（如有）/ 用户
     原文 + trailer。
3. 观察 OpenClaw 进程日志（`/tmp/openclaw/openclaw-YYYY-MM-DD.log`）：
   - 第 1 次调用应有 `cli session reset: ... reason=extraSystemPromptHash`
     （首次冷启动，预期）。
   - 第 2、3 次连续调用同一 agent 应**不再**出现 `extraSystemPromptHash` 重置
     （hash 命中复用）。
4. 让 TL agent 写一条 decision（mark decision），下一次 dispatch 时观察
   日志，应有一次 `extraSystemPromptHash` 重置（预期，对应 decisions 更新）。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 首次启用会触发每 agent × 每 team 一次 CLI session 重建 | 可接受。一次性冷启动，每 agent 1–2s。文档说明。 |
| 历史会话 jsonl 里仍存着旧格式的 user message（含静态团队块） | 不重写，accio 也不重写。新 hop 用新格式即可，混合存在不影响 LLM 调用。 |
| 团队成员增减导致 hash 变化 | 这是预期行为——agent 必须知道新 roster。 |
| OpenClaw `extraSystemPrompt` 接口未来变更 | 已在 OpenClaw 当前安装版本（`/data/lidongyu/.npm-global/lib/node_modules/openclaw`）的源码中验证。若 OpenClaw 后续重构需同步关注。 |
| `systemPrompt` 越界进入 jsonl | 不会——OpenClaw 在 [openai-http-DzUCvleu.js:223-225](file:///data/lidongyu/.npm-global/lib/node_modules/openclaw/dist/openai-http-DzUCvleu.js#L223-L225)
显式 `continue` 跳过 system role 进 conversation。 |
| 同一 agent 跨多 team 互相影响 | 当前 sessionKey 已经按 (agentId, teamId, conversationId) 区分（[dispatcher.ts:278](src/lib/team/dispatcher.ts#L278)），互不干扰。 |

## 不做的范围（明确）

- **不**为 DM（1:1）路径引入 systemPrompt 通道。DM 不走 prompt-assembler，行为不变。
- **不**在 `useActions` / store 层暴露 systemPrompt 参数。仅 dispatcher 内部使用。
- **不**重写历史 messages.jsonl。新旧格式共存，无功能影响。
- **不**做 `extraSystemPromptStatic` 优化（HTTP 路径目前不暴露这个字段，
  即使暴露收益也有限）。
- **不**改 `chat-area.tsx` / UI 渲染——本 spec 只动后端。
- **不**调整 `prompt-assembler.test.ts` 之外的测试夹具。
- **不**为指派 chips UI 或工作区文件侧栏做任何前置铺垫——它们是独立 spec。

## 完成定义

- [x] `assembleAgentPrompt` 返回 `{ systemPrompt, userPrompt }`，单元测试断言两路内容。（commit `e997fce`）
- [x] `RuntimeClient.sendMessage` 接受可选 `systemPrompt`，非空白时 prepend
      `role: "system"` 消息。（commit `3ef0d02`）
- [x] `dispatcher.ts` 把两段分别下发到 `sendToAgent`，新参数有测试覆盖。（commits `83a26ca` + `c40cc7f`）
- [x] 手工验证全部通过：本地 dev server + smoke-test-team（Slico/Tian）+
      OpenClaw session jsonl 实测，user message 体积从 4558 字符 → 228/252 字符
      （-95%），所有 12 项静态 team-context 块均不再出现，2 项动态块正常出现。
      Tian 回复 "我是 Tian, 专注于软件开发" 证明 system 通道把身份信息成功
      传到 agent；OpenClaw 第二轮自动用了 `Other team members said since
      your last response:` 增量格式说明 group_activity 流转正常。
- [x] `pnpm lint` 通过（修改文件 0 新增 lint 错误；预存的 `_runtimeType`
      警告来自 2026-04-10 初始 commit，与本变更无关）。
- [x] `pnpm build` 通过（Task 4 implementer 已确认 32 个静态页面全部生成）。
