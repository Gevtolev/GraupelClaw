# GraupelClaw

GraupelClaw 是一个面向个人的 OpenClaw 操作台，提供 Agent 聊天、网关管理和原生 Session 浏览功能。

基于 ChatClaw 代码库发展而来，已重塑为独立项目，专注于个人 OpenClaw 工作流。

## 功能

- **Agent 聊天** — 通过 OpenClaw 网关与 Agent 实时对话，支持 SSE 流式输出和工具调用展示
- **原生 Session 管理** — 浏览、切换、删除 OpenClaw 网关上的原生 Session，查看完整对话历史
- **Agent Identity 解析** — 自动从网关获取 Agent 的名称、头像、Emoji（支持 IDENTITY.md）
- **网关配置** — 管理多个 OpenClaw 网关连接，自动检测本地 `~/.openclaw/openclaw.json`
- **Workspace 文件编辑** — 在线编辑 Agent 的 workspace 文件

## 技术栈

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui
- 存储：Dexie/IndexedDB（浏览器端）或 Drizzle/SQLite（服务端）
- 通信：HTTP/SSE（聊天流）+ WebSocket RPC（网关管理）

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

如果本地有 OpenClaw 网关运行，GraupelClaw 会自动从 `~/.openclaw/openclaw.json` 检测并连接。

## 配置

复制 [`.env.example`](./.env.example) 到 `.env` 并根据需要调整：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_BACKEND` | 存储后端：`indexeddb`（浏览器）或 `drizzle`（SQLite） | `indexeddb` |
| `PRIVATE_OPENCLAW_CONSOLE_DATA_DIR` | SQLite 数据目录（drizzle 模式） | `./data` |
| `AUTH_ENABLED` | 是否启用登录认证 | `false` |
| `MULTI_COMPANY` | 是否支持多网关配置 | `true` |

## 项目结构

- `src/lib/store.tsx` — 全局状态管理（React Context + useReducer）
- `src/lib/runtime/` — OpenClaw 网关通信客户端
- `src/lib/gateway-ws.ts` — WebSocket RPC 连接
- `src/lib/openclaw-sessions.ts` — 原生 Session 解析
- `src/lib/project-brand.ts` — 品牌和命名配置
- `src/components/chat-area.tsx` — 聊天主界面
- `src/components/conversation-panel.tsx` — Session/对话列表面板

## License

[MIT](./LICENSE)
