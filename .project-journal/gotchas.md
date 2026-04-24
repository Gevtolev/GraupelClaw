# Gotchas

Non-obvious pitfalls that cause bugs, confusion, or wasted time.
Prefix [RESOLVED] for fixed but historically useful entries.

---

- **[网关 RPC: chat.history]**: 调用 chat.history 时传入 agentId 参数 -> 网关返回错误 'unexpected property agentId'。chat.history 只接受 { sessionKey }，不需要 agentId。 (detected: 2026-04-23)

---

- **[Agent Identity 解析]**: 仅依赖 agents.list 获取 Agent 名称 -> agents.list 只返回 config 级 identity，不包含 IDENTITY.md 内容。必须额外调用 agent.identity.get RPC 才能获取完整的 name/avatar/emoji。 (detected: 2026-04-23)

---

- **[gateway-ws.ts WebSocket 连接]**: 从服务端 Node.js 打开 WebSocket 到网关时不带 origin 头 -> 网关做 origin 检查，缺少 origin 头会被拒绝连接。需要手动设置 origin: wsUrl.replace('ws://', 'http://').replace('wss://', 'https://')。 (detected: 2026-04-23)

---

- **[runtime/index.ts 模型格式]**: 使用 openclaw:agentId 格式（冒号分隔） -> 网关要求 openclaw/{agentId}（斜杠分隔）。用冒号会导致模型识别失败。 (detected: 2026-04-23)

---

- **[RuntimeClient SSE 流]**: 网关在工具调用期间暂停 >3 秒 -> RuntimeClient 的 3 秒空闲超时机制会提前 commit 部分内容为一条完成消息，然后新内容作为新消息开始累积，导致一次回复拆成多条消息。 (detected: 2026-04-23)
