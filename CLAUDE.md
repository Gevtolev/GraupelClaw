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

### OpenClaw 边界（只能追加，不能修改用户已有 agent）

用户的 OpenClaw 里可能已经有他自己配置的 agent。GraupelClaw 必须**只追加，不改用户原有数据**：

- ❌ 不修改 agent 的 `agent-core/` 任何文件（`IDENTITY.md` / `SOUL.md` / `MEMORY.md` / `USER.md` / `AGENTS.md` / `TOOLS.md` / `BOOTSTRAP.md` / `HEARTBEAT.md` / `SKILL.md`）
- ❌ 不修改 agent 的 OpenClaw `config.jsonc` 配置（`tools.profile` / `alsoAllow` / `denyList` / model 等）
- ❌ 不读写用户已有的 `~/.openclaw/workspace-{agentId}/` 内的文件（除非用户明确许可）
- ✅ Team-context 拼接到我们发给 agent 的 **user message** 里（`prompt-assembler.ts` 做的事）—— 这不是改 agent，是给它的输入
- ✅ 在 `~/.openclaw/workspace/skills/{我们的 skill 名}/` 下创建新 skill 目录（OpenClaw 自动发现，靠 frontmatter `description` 触发匹配，不需要 per-agent 配置）
- ✅ Team workspace = 用户新建/选择的目录，与 agent 私域 workspace 完全隔离

新功能设计前先问：这条改动会动到「用户原有 agent」的任何文件或配置吗？如果会，换实现方式。

### 多步设计任务必须走 superpowers

涉及多 PR / 跨模块的大改（例：多 agent 系统重设计、新协作原语、跨切重构），先用：
- `superpowers:brainstorming` —— 探查需求、边界、取舍
- `superpowers:writing-plans` —— 出可执行的 task 列表

不要直接进入 ad-hoc 设计。小修小补除外。

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
