# P2 — Team Workspace + 可视化文件夹选择器

> 由 2026-04-26 的双 agent brainstorm（提案者 + 评审者）综合而成。
> 关键决策附在条目内，连带说明取舍理由；最末列出明确不做的范围。

## 目标

每个 team 在用户本机上拥有一个**共享文件夹**，team 内所有 agent 共用。
agent 通过 OpenClaw 既有的 `read_file` / `write_file` 工具按绝对路径读写
其中的产物（调研、草稿、代码、文档等）。路径在 UI 中按 team 级一次设定，
后续注入到所有 team agent 的 prompt 中。

## 改动范围

| 模块 | 变更 |
|---|---|
| `AgentTeam` schema | 新增 `workspaceRoot?: string`（绝对路径，可选）|
| Dexie | 升级到 `db.version(3)`，显式 upgrade hook（将 `workspaceRoot` 置为 `undefined`）|
| Drizzle | `ALTER TABLE teams ADD COLUMN workspace_root TEXT NULL` |
| Next.js API | `GET /api/fs/home`、`GET /api/fs/list-dirs?path=`、`POST /api/fs/create-dir` |
| 新组件 | `folder-picker-dialog.tsx` |
| 弹窗 | `create-team-dialog.tsx` 与 `team-settings-dialog.tsx` 增加 Workspace 区块 |
| `prompt-assembler.ts` | 仅在已设置时把 workspace 路径注入 `<team_context>` |
| 标记文件 | 首次设置 workspace 时写入 `{workspaceRoot}/.graupelclaw-workspace.json` |

## 关键设计决策（评审轮过后）

### D1. **延迟创建**而非提前创建
- 评审者最有价值的反馈：建 team 时直接 `mkdir` 会让用户惊讶、在只读卷上失败，
  并把 slug 冲突问题复杂化。
- **决策**：默认情况下，建 team 时 workspace 留空。team 设置弹窗显示
  "尚未配置 workspace — 立即设置"。只有当用户在 picker 中显式选定（或接受默认建议）
  时才真正创建该文件夹。
- 顺带收益：彻底消除了 slug 冲突问题。

### D2. 路径校验：带尾分隔符的前缀检查 + home 路径段守卫
- 拒绝前缀攻击：使用 `resolved === home || resolved.startsWith(home + path.sep)`，
  而**不是**裸 `startsWith(home)`。独立的 `..` 拒绝逻辑已删除（在 `path.resolve()`
  归一化后冗余）。
- 当 `os.homedir()` 返回 `/` 或路径段少于 2 时，所有请求一律返回
  `500 — cannot determine safe home directory`。
- 拒绝任何位于 `~/.openclaw/workspace-` 之下的路径（遵循 CLAUDE.md 中
  OpenClaw 边界约束）。

### D3. 默认建议路径：`~/Documents/GraupelClaw/teams/{slug}-{shortId}/`
- Linux/macOS 用户：`~/Documents/...` 让用户的文件保持可见、符合习惯。
- Slug 规则：转小写 + `[^a-z0-9]+ -> -` + 去首尾连字符；通过
  `-{first8(uuid)}` 后缀保证唯一（即便首个 team 也带，保持统一）。
- 这只是 picker 中显示的**建议**，用户在点击 "Use" 之前可以修改。

### D4. `list-dirs` 加固
- 结果上限 200 条，达到上限时返回 `truncated: true`。
- 用 `AbortController` 设置 3s 超时——慢挂载场景下返回 `408`。
- 启用 `withFileTypes: true`；按字典序排序；除非 `?showHidden=true`，否则跳过
  `.dot` 目录。
- 跳过已知重型目录：`node_modules`、`.git`、`__pycache__`（可配置，安全默认）。

### D5. Picker UI：树形 + 面包屑（**不是**极简的文本框 + 自动补全）
- 评审者建议用文本框 + 自动补全更简单。综合判断：用户明确要求**可视化**
  picker，因此保留树形。但严控范围：面包屑 + 目录列表 + 行内新建文件夹 +
  取消/选用按钮。**不**做拖拽、不做预览、不做最近路径历史。
- 组件：`src/components/folder-picker-dialog.tsx`，Props：
  ```ts
  interface FolderPickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultPath?: string;          // if undefined, picker starts at $HOME
    onSelect: (path: string) => void;
  }
  ```

### D6. 标记文件 `.graupelclaw-workspace.json`
- 首次设置 workspace 时写入。内容：
  ```json
  {
    "teamId": "...", "teamName": "...",
    "createdAt": "2026-04-26T...",
    "schemaVersion": 1
  }
  ```
- 用途：
  1. 即便 prompt 注入的路径已经滑出注意力窗口，agent 也能 `ls` 后找到上下文。
  2. 用户手动打开文件夹时能理解其用途。
  3. 未来 GraupelClaw 启动时可识别 "这是我们创建的 workspace" vs 任意目录。

### D7. Prompt 注入（带保护）
在 `prompt-assembler.ts` 的 `buildTeamContext` 中，roster 之后追加：
```ts
const workspaceSection = team.workspaceRoot
  ? `\n\n## Team workspace
Shared folder: \`${team.workspaceRoot}\`
All team files (research, drafts, code, output) go here. Use absolute paths
when reading/writing. Do not write outside this folder unless the user explicitly
asks. The folder also contains \`.graupelclaw-workspace.json\` you can inspect
for team metadata.`
  : "";
```
**关键**：当 `workspaceRoot` 为 undefined（迁移前的老 team）时整段省略。

### D8. 设置 UI：Workspace 标签页
- 在 `team-settings-dialog.tsx` 增加导航项 "Workspace"，配 `FolderOpen` 图标。
- 内容：
  - 路径展示（只读 Input，显示路径或 "(未设置)"）。
  - "Browse..." 按钮 → 打开 FolderPickerDialog → 用户点 Use 后，调用
    `actions.updateTeam({ workspaceRoot: chosenPath })` 并通过新增的 server
    action 写入标记文件。
  - "重置为未设置" 按钮（仅当 `workspaceRoot` 已设置时显示）：将其改回
    undefined；不会删除文件夹内容。

### D9. 建 team 弹窗
- 在弹窗底部加一行可选的 Workspace。默认文案：
  "稍后在 Team Settings 中配置（当前推荐）"。
- 提供 "Set workspace" 链接，行内打开 FolderPickerDialog。用户若选定，
  随 team 一并保存；若跳过，则 team 创建后 workspace 留空。

### D10. 删除 team
- 删除时显示行内提示："`/path/...` 上的 workspace 曾被该 team 使用。"
  两个选项：**保留**（默认）| **移到回收站**。
- 移到回收站：通过 `trash` npm 包调用系统回收站（跨平台）。
- 这是打磨项；如果 `trash` 引入显著的依赖体积，可推迟到后续 PR。

## API 契约

### `GET /api/fs/home`
```
200: { home: string }
500: { error: "cannot determine safe home directory" }
```

### `GET /api/fs/list-dirs?path={absolute}&showHidden=true`
```
200: { path, dirs: { name: string; hasChildren: boolean }[]; truncated: boolean }
403: { error: "path outside user home" }
404: { error: "not found" }
408: { error: "timeout" }
```

### `POST /api/fs/create-dir`，body `{ path: string }`
```
200: { created: true, path: string }
403/404/500 with descriptive error.
```

三个接口都先调用 `validatePath(path)`；拒绝任何不在 `os.homedir()` 之下、
或位于 `~/.openclaw/workspace-` 之下的路径。

## 文件清单

```
src/types/index.ts                          // + workspaceRoot field
src/lib/db.ts                               // dexie v3 upgrade
src/lib/db-drizzle.ts                       // workspace_root column
src/app/api/fs/validate.ts                  // shared path validation
src/app/api/fs/home/route.ts                // new
src/app/api/fs/list-dirs/route.ts           // new
src/app/api/fs/create-dir/route.ts          // new
src/components/folder-picker-dialog.tsx     // new
src/components/dialogs/create-team-dialog.tsx   // + workspace section
src/components/dialogs/team-settings-dialog.tsx // + Workspace tab
src/lib/team/prompt-assembler.ts            // + workspace section in team_context
src/lib/store/agent/store.tsx               // updateTeam handles workspaceRoot
```

测试：
```
src/app/api/fs/__tests__/validate.test.ts
src/app/api/fs/__tests__/list-dirs.test.ts
src/app/api/fs/__tests__/create-dir.test.ts
src/components/__tests__/folder-picker-dialog.test.tsx
src/lib/team/prompt-assembler.test.ts       // + workspace block emit/omit cases
```

## 测试场景（必须覆盖）

1. `validatePath`：
   - `/home/user/foo`（在 home 下）→ 通过
   - `/home/userOTHER/x`（前缀攻击）→ 拒绝  ← **D2 修复需验证**
   - `/etc/passwd` → 拒绝
   - `~/.openclaw/workspace-abc` → 拒绝
   - `os.homedir() === "/"` → 全部拒绝
2. `list-dirs`：
   - 200 条以内 → 完整返回，按字典序
   - 5000 条 → 截断到 200 条，flag 置位
   - 挂载卡死 → 3s 后 408
   - 默认隐藏点目录；`?showHidden=true` 时显示
3. `create-dir`：
   - 新路径 → 创建成功
   - 已存在路径 → 幂等成功（不报错）
   - 父目录缺失 → 递归创建
   - 在 home 之外 → 403
4. `prompt-assembler`：
   - 有 workspaceRoot 的 team → 区块出现
   - 没有的 team（undefined）→ 区块整体省略（不能出现 `undefined` 字面量）
5. 文件夹选择器：
   - 默认路径打开
   - 面包屑各段可向上导航
   - "新建文件夹" 创建后自动选中
   - 键盘：Enter 进入目录、Backspace 上层、Escape 关闭、方向键导航

## 不在范围内

- 跨 team 共享 workspace
- 远程 workspace（SSH、S3）
- 云同步 / 备份
- 在 GraupelClaw UI 内浏览 workspace 内容
- 文件监听 / 实时预览
- 删除 team 时清空文件夹

## 已识别风险

1. **现有 team 没有 workspaceRoot** —— 通过 D7 的守卫 + D1 的延迟创建处理。
2. **用户编辑标记文件** —— agent 只读它；即便损坏也可恢复。
3. **NFS / 网络挂载下的路径校验** —— 沿用 `path.resolve()` 同一套规则；
   挂载在运行时挂掉时由 agent 自身的熔断器处理。
4. **Windows 路径分隔符** —— 当前不在范围内（GraupelClaw 面向 Linux/macOS）。
   全程使用 `path.sep`，未来支持 Windows 不会破坏既有逻辑。

## 实施清单（按顺序）

1. [ ] schema 增量（types + dexie + drizzle 迁移）
2. [ ] 路径校验工具 + 测试
3. [ ] 三个 fs API 路由 + 测试
4. [ ] FolderPickerDialog 组件 + 测试
5. [ ] 把 picker 接进建 team 弹窗
6. [ ] 把 picker 接进 team 设置弹窗
7. [ ] 设置 workspace 时写入标记文件
8. [ ] prompt-assembler 的 workspace 区块（带保护）+ 测试
9. [ ] 手工冒烟：建 team 时不设 workspace → prompt 不变 → 在设置中设置 →
   文件夹被创建 → prompt 中含路径 → agent 下一次回复应自然引用 / 使用该路径。
