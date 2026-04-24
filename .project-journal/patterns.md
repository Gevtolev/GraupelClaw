# Patterns

Project-specific conventions that deviate from language or framework defaults.
Only record patterns that are easier to forget than to rediscover.

---

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
**Detected from**: 7552c28

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
