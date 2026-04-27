# P5 — 决策日志（最小版）

> 由 2026-04-26 的双 agent brainstorm 综合而成。
> 评审者的 "最简替代" 方案（第 7 点）大量采纳。

## 目标

把团队的关键决策持久化到一个 markdown 文件中，让 team agent 跨会话也能看到。
解决 "决策缺位" 的痛点 —— 但不要过度工程化。

## 评审驱动的简化（最大的一刀）

**❌ 砍掉 CLI 集成、结构化 TS 接口、正则解析器、lockfile、HTML 注释中嵌 ID**。

**采纳**最小流程：
1. 在 assistant 消息上加 "Mark as decision" UI 按钮 → POST 给 API → API 用
   `fs.appendFile` 写入 `{workspaceRoot}/.team/decisions.md`（小写入在 POSIX
   下原子，无锁）。
2. （不加 CLI 命令 —— agent 已经有 `write_file`，想自己写时直接 append 即可。）
3. prompt-assembler 读取该文件**末尾 N 字节**（或末尾 N 个 markdown section）
   作为原始文本注入。
4. 聊天页头部的决策 popover 同样按原始文本读这个文件，然后用 markdown 渲染
   （不抽正则 —— 直接渲染）。

这一刀砍掉提案者约 70% 的设计，但用户价值仍然达到。

## 设计决策

### D1. 存储格式（markdown，新决策置顶）

`{workspaceRoot}/.team/decisions.md`：
```markdown
# Team Decisions

---

## [2026-04-26] Pick direction A: long-term memory product

**Decided by**: Slico (TL)
**Context**: User asked us to pick between three product directions.
**Rationale**: 9.2K star validation, our team is primary user, MVP ships in 2 weeks.
**Rejected**: direction B (too research-heavy), direction C (cost optimization, deferred).
**Affects**: All team members. Eva to start PRD; Tian on tech research.

---

## [earlier decision...]
```

- `# Team Decisions` 标题 + 一条 `---` 分隔线，仅在文件为空时**首次** append 写入。
- 每条记录 = `## [date] title` 标题 + 正文。新条目插在 `---` 分隔线之后
  （不是 append 到文件末尾 —— 用户要的是新决策置顶）。
- **不用** HTML 注释做 ID（用 `(date, title)` 这一对可见文本作身份对 prompt
  注入和 UI 展示已足够）。
- 文件大小上限 1MB；超过则创建时返回 `413` + 明确错误。实际团队几乎不会触达。

### D2. API 路由

```
POST   /api/teams/{teamId}/decisions
   body: { title, decidedBy, context?, rationale, rejected?, affects? }
   action: format markdown section, prepend after header divider, write file
   returns: 200 { ok: true }
   422 if no workspaceRoot configured
   413 if file > 1MB

GET    /api/teams/{teamId}/decisions
   returns: { content: string, sectionCount: number }
   action: read file as raw text; count `## [` occurrences for sectionCount
   404 → return { content: "", sectionCount: 0 } (lazy-create on first POST)
```

v1 不提供 PATCH/DELETE（评审者说："用户想改可以直接编辑文件"）。改错别字直接
打开文件编辑即可。

### D3. 原子写（不引 lockfile）

写头部分隔线时用 `fs.appendFile`（仅一次）。新增条目时：读全文 → 在分隔线
之后插入新 section → 写到 tmp → rename。沿用 P3 任务的原子 rename 模式。
**不引** `proper-lockfile` 依赖。

并发写发生概率极低（决策与决策之间间隔以秒到分钟计）。极少数竞态时取最后写入；
即便丢了一条，用户也能从聊天历史中恢复。我们用这点风险换简化。

### D4. "Mark as decision" 交互

- 触发：在 team chat 中 hover `role: "assistant"` 消息 → action bar 出现
  `Bookmark` 图标按钮 "Mark as decision"。
- 点击 → 弹窗，字段：
  - **Title**（必填，无预填，placeholder "Summarize the decision"）。
  - **Context**（可选，预填 "From {agentName} in {teamName} team chat"）。
  - **Rationale**（必填，预填消息正文前 200 字符，提示可编辑）。
  - **Rejected**（可选）。
  - **Affects**（可选）。
  - **Decided by**（只读，agent 名）。
- 提交 → POST → toast → 弹窗关闭。

移动端 / 触屏：action bar 平时隐藏，触摸场景下常驻显示（沿用 chat-area 既有
模式）。

### D5. 聊天页头部的决策 popover

- 在 `<Clock>` 旁新增 `<Scale>` 图标按钮。仅当 `target.type === "team"` 时显示。
- 点击 → shadcn `Popover`，`align="end"`，`max-h-[60vh] overflow-auto w-96`。
- 内容：用现有 `MarkdownRenderer` 渲染 GET 响应的 `content`。顶部加 "Add manual
  decision" 链接，点击复用 D4 的弹窗（无预填）。
- 空态："No decisions logged yet."

### D6. Prompt 注入

在 `prompt-assembler.ts` 的 `buildTeamContext` 中，紧接 `## Active tasks`（P3）
之后 —— 也就是 `## @mention protocol` **之前**（评审者第 12 点：决策是 agent
在决定要不要派发前应已知的上下文）：

```
## Recent decisions
{first ~600 chars of decisions.md, starting with the most recent ## section}

If a question touches a topic already decided above, honor the decision unless
the user explicitly asks to revisit it.
```

- 按**字节**截断而非按 section 数 —— 实现简单。上限 600 字符；如发生截断，
  追加 `\n\n*(...older decisions in {workspaceRoot}/.team/decisions.md)*`。
- 文件不存在或为空：整段省略。
- **不**解析为 TS 接口 —— 直接注入字节。

仅在 `dispatchTeamMessage` 一次 cascade **开头**取一次（评审者第 1 点 ——
避免每跳读盘）。

### D7. agent 自写路径
agent 已有 `write_file`，想自主登记决策（比如 TL 自行决定时）就直接 append
`{workspaceRoot}/.team/decisions.md`。格式：照写 `## [date] title\n\n**Field**:
value`。无需新工具、无需 API 一跳。它从 prompt 注入的近期样例中习得格式
（in-context learning —— 模仿看到的样式）。

如果以后想强制格式更严，可以在 team-coordination skill 中加一段 "decisions"
说明（v1 不做）。

### D8. schema 与存储路径
- **不在** `AgentTeam` 上加新字段 —— workspace 路径已有。
- **不开新 chatStore slice** —— popover 内容打开时再拉，不缓存（决策读频率低）。

### D9. 测试
- API POST：正确 append、向已有文件 prepend、缺失时懒创建、>1MB 时拒绝、
  workspaceRoot 未配置时返回 422。
- API GET：返回完整内容 + section 计数；缺失时（等价 404）返回空内容。
- prompt-assembler：有内容时注入 `recent_decisions`；为空时省略。
- 弹窗：表单校验、预填行为、提交流程。
- Popover：markdown 渲染、空态、"Add manual" 打开弹窗。

### D10. v1 不在范围内
- 编辑 / 删除决策（请直接打开文件编辑）
- 决策搜索 / 过滤
- 跨 team 决策
- 决策标签或分类
- 决策修订历史
- CLI 集成（agent 走 `write_file` 即可）
- 基于 lockfile 的并发写保护

## 文件清单

```
src/app/api/teams/[teamId]/decisions/route.ts      // GET + POST
src/app/api/teams/[teamId]/decisions/__tests__/

src/components/team/decisions-popover.tsx           // header popover
src/components/team/mark-decision-dialog.tsx        // modal triggered from message hover

src/components/chat-area.tsx                        // header trigger button + hover button on assistant messages
src/lib/team/prompt-assembler.ts                    // <recent_decisions> injection
src/lib/team/dispatcher.ts                          // fetch decisions ONCE in dispatchTeamMessage; pass to prompt
```

测试文件：
```
src/app/api/teams/[teamId]/decisions/__tests__/route.test.ts
src/components/team/__tests__/decisions-popover.test.tsx
src/components/team/__tests__/mark-decision-dialog.test.tsx
src/lib/team/prompt-assembler.test.ts                 // + recent_decisions cases
```

## 测试场景

1. workspace 未设置时 POST → 422。
2. workspace 为空文件时 POST → 创建文件，写入头部 + 第一条 section。
3. 文件已有历史决策时 POST → 新 section 插在分隔线之后、旧记录之前。
4. 文件 > 1MB 时 POST → 413。
5. 文件不存在时 GET → 空内容 + 计数 0。
6. 文件存在时 GET → 全文返回。
7. prompt-assembler：空内容 → 区块省略；200 字符内容 → 完整注入；5000 字符
   内容 → 截断到 600 + "older in" 尾注。
8. 弹窗校验必填字段（title、rationale）。
9. Popover 正确渲染 markdown；"Add manual" 打开弹窗。
10. 并发 POST 模拟（最后写入胜出，不损坏文件）。

## 实施顺序

1. [ ] API 路由 + 测试（仅 `fs.appendFile` + 读取 + 截断）
2. [ ] prompt-assembler `<recent_decisions>` 区块 + 测试
3. [ ] dispatcher：cascade 开始时读一次决策；传给 assembleAgentPrompt
4. [ ] mark-decision-dialog 组件
5. [ ] assistant 消息上的 hover 按钮 → 打开弹窗
6. [ ] decisions-popover 组件 + chat-area 触发按钮
7. [ ] 手工冒烟：UI 登记一条决策 → 验证文件 → 下一轮 agent 在 prompt 中看到 →
   agent 通过 `write_file` 再写一条 → 文件格式仍然保持。
