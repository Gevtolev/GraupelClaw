# Patterns

Project-specific conventions that deviate from language or framework defaults.
Only record patterns that are easier to forget than to rediscover.

---

## 全局状态集中在 store.tsx

**When**: 添加任何新功能、修改业务逻辑、添加新的 UI 状态
**How**: 在 store.tsx 中：1) 在 Action 联合类型中添加新 action type，2) 在 reducer 中添加 case，3) 创建 action 函数，4) 在 actions 对象中导出。所有副作用（API 调用、DB 操作）都在 action 函数中完成，不在组件中。
**Why not the obvious alternative**: Not recorded
**Detected from**: c01018bcf790ac4ad5a4bded69b09a1a1ff7d200

---

## 网关 RPC 调用路径

**When**: 需要调用网关管理方法（sessions.list, config.get 等）
**How**: 客户端代码：使用 runtime/index.ts 的 gatewayRpc()（POST 到 /api/gateway/rpc）。服务端 API route：使用 gateway-ws.ts 的 connectGatewayWs()（直接 WS 连接）或 gatewayRpcCall()（一次性 WS）。不要使用 gateway-rpc.ts 中的旧函数。
**Why not the obvious alternative**: Not recorded
**Detected from**: c01018bcf790ac4ad5a4bded69b09a1a1ff7d200

---

## Session Key 格式

**When**: 创建新对话或解析 session 事件
**How**: 单 agent: agent:{agentId}:{sessionNamespace}:{conversationId}。团队中的 agent: agent:{agentId}:{sessionNamespace}:team:{teamId}:{conversationId}。sessionNamespace 固定为 'graupelclaw'（来自 project-brand.ts）。
**Why not the obvious alternative**: Not recorded
**Detected from**: c01018bcf790ac4ad5a4bded69b09a1a1ff7d200
