# GraupelClaw — Project Instructions

## 技术栈

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui
- 存储：Dexie/IndexedDB（默认）或 Drizzle/SQLite
- 通信：HTTP/SSE（聊天流）+ WebSocket RPC（网关管理）

## 关键架构决策

- `store.tsx` 已按领域拆分为 `store/gateway` / `store/agent` / `store/session` / `store/chat` 四个 slice + `store/coordinators/`。**切片 Provider 内 useEffect 只订阅自己切片**；跨切反应放 `<ActionsProvider>` 的 useEffect
- 消费者按需用 `useGatewayStore/useAgentStore/useSessionStore/useChatStore` + `useActions()`，不要再从旧的 `useStore()` 引入
- 客户端不直连网关 WebSocket，所有通信经过 Next.js API route 代理
- `source: "native-session"` 区分本地对话和网关原生 Session，决定是否本地持久化
- `customName: true` 保护用户手动重命名的 Agent 不被网关同步覆盖
- `gateway-rpc.ts` 已废弃，新代码使用 `runtime/index.ts` 的 `gatewayRpc`

## Project Journal

项目使用 `.project-journal/` 记录架构决策、踩坑经验和项目模式。

- 进入不熟悉的子系统或做跨模块改动前，先读 journal
- 发现非显而易见的根因或做出架构选择后，及时录入
- 不记录常规重构、从代码本身就能推断的信息

## 开发命令

```bash
pnpm install    # 安装依赖
pnpm dev        # 启动开发服务器
pnpm build      # 生产构建
pnpm lint       # ESLint 检查
```
