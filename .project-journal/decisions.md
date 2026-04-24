# Decision Log

Architectural and design decisions with context and rejected alternatives.
Append new entries at the bottom.

---

## [2026-04-23] 客户端不直连网关 WebSocket，所有通信经 Next.js API route 代理

**Context**: RuntimeClient 需要与 OpenClaw 网关通信。网关 WebSocket 认证需要 token 和 challenge-response 握手，不适合暴露给浏览器。
**Decision**: 客户端通过 HTTP POST 到 /api/chat（SSE 代理）和 /api/gateway/rpc（WS RPC 代理）与网关交互。gateway-ws.ts 仅在 Node.js 服务端运行。RuntimeClient.connect() 只翻转布尔值，不建立实际长连接。
**Rejected**: Not recorded
**Affects**: Not recorded
**Detected from**: c01018bcf790ac4ad5a4bded69b09a1a1ff7d200

---

## [2026-04-23] native-session 与 local 对话的分离策略

**Context**: OpenClaw 网关有自己的 Session 系统，GraupelClaw 也有本地对话。需要统一展示但分开持久化。
**Decision**: 通过 Conversation.source='native-session' 区分。native-session 对话不写本地 DB（消息归网关所有），conversation.id 直接用 sessionKey（格式 agent:{agentId}:{namespace}:{uuid}）。本地对话 id 是普通 UUID。Drizzle schema 缺少 source/sessionKey 列，所以 drizzle 模式下原生 Session 不持久化，刷新后重新从网关拉取。
**Rejected**: Not recorded
**Affects**: Not recorded
**Detected from**: c01018bcf790ac4ad5a4bded69b09a1a1ff7d200

---

## [2026-04-23] customName 标记保护用户手动重命名的 Agent

**Context**: Agent 名称从网关 agent.identity.get 同步，但用户可能在 UI 手动改名。每次 init 和 company switch 都触发同步，会覆盖手动改名。
**Decision**: Agent 类型新增 customName?: boolean。用户在 agent-settings-dialog 手动改名时设为 true。同步逻辑中检查 !existing.customName 才更新 name。该字段不在 Drizzle schema 中（IndexedDB 无 schema 约束可用，drizzle 模式下会丢失）。
**Rejected**: Not recorded
**Affects**: Not recorded
**Detected from**: c01018bcf790ac4ad5a4bded69b09a1a1ff7d200

---

## [2026-04-24] store.tsx 按领域拆分为多个 store slice

**Context**: store.tsx 已膨胀到 1436 行，集中了 agent/session/chat/gateway 等多个领域的状态与副作用，成为上帝对象；任何改动都要在整份文件里绕，组件订阅粒度过粗易触发无关 re-render。team/ 子目录已证明按领域切分 + 独立单元测试在本项目可行。
**Decision**: 按领域拆为 agentStore / sessionStore / chatStore / gatewayStore 四个 slice，各自独立 reducer + actions + selectors，通过 composition 在顶层组合。保留现有 useReducer 模式，不引入新状态库。组件仅订阅所需 slice。
**Rejected**: 维持现状（持续膨胀，新功能继续往单文件堆）；仅抽出同步保护逻辑（治标不治本，god object 仍在）；迁移到 Zustand/Redux（引入新依赖与心智负担，收益不抵成本）。
**Affects**: src/lib/store.tsx 及所有 useStore 调用方；patterns.md 中旧的「全局状态集中在 store.tsx」条目将被新 pattern 取代（待第一个 slice 落地后再记录 pattern）。
**Detected from**: 5e806a976fbc1f7bf03396fb8aeb86767c3dab9f
