# gtm-swarm

## Repository Source of Truth

- 11agents 主项目的组织归属是 `SolveaCX`，本仓库地址是
  `https://github.com/SolveaCX/gtm-swarm`。
- 1toAll 内容运营 Agent 的唯一真源在 `apps/1toall/`。不要再向
  `11Agents/1toall` 提交功能；该仓只作为迁移前历史来源。
- 1toAll 生产发布由 `11Agents/11agents-ai` 中的 `Sync 1toAll` 和
  `Deploy 1toAll` 工作流控制，但候选代码必须从本仓 `apps/1toall/` 读取。
- 修改 1toAll 时，在 `apps/1toall/` 运行 `npm test`。不要把运行数据、
  Flatkey API key、社媒 token 或 11agents session 写入 git。
- 多产品付费投放 Agent 的 Git 真源在 `apps/ads-agent/`。共享 Google Ads
  执行器和数据管道放在 `runtime/`，产品物料放在 `products/<product>/`。
  `projects/flatkey/agents/08-ads/` 仅是历史兼容入口，不再承载新的共享能力。
- 修改 Ads Agent 时运行 `python3 -m unittest discover apps/ads-agent/tests`
  和 `python3 -m py_compile`。不得提交 Google OAuth、developer token、平台
  密码、项目 bearer token、日志或本机 daemon 状态；默认保持 `ARMED=0`
  与 `ALLOW_ENABLE=0`。

## Database Configuration

Two separate databases. Never mix them up.

### GTM Database (`GTM_DATABASE`)
- The app's own PostgreSQL database
- Used by `server/db.js` (`hasDB()` checks `GTM_DATABASE`)
- Used by `server/store.js` (workspaces, agents, content items, etc.)
- Used by `server/bootstrap.js` for migrations

### Multica Database (`MULTICA_DATABASE_URL`)
- External Multica project management database
- Used **only** by `server/multica-db.js` (`hasMultica()` checks `MULTICA_DATABASE_URL`)
- Contains workspaces, agents, issues from Multica's schema
- **Each GTM project must be explicitly bound to one Multica workspace** via `multica_workspace_slug` column on the GTM `workspaces` table
- Never hardcode a Multica workspace slug — always look it up from `ws.multica_workspace_slug`
- If a GTM project has no binding (`multica_workspace_slug IS NULL`), APIs return 400; the UI shows a blocking bind modal

### Multica Workspace Binding
- Stored in GTM DB: `workspaces.multica_workspace_slug TEXT`
- **One-time, immutable**: set via `PATCH /api/workspaces/[slug]` with `{ multica_workspace_slug }` only once; subsequent attempts return 409
- Available Multica workspaces listed via `GET /api/multica/workspaces`
- Dashboard detects unbound projects and shows `<BindWorkspaceModal>` before any other UI

### Priority in API routes
Agents data comes **exclusively from Multica**. No GTM DB fallback for agents — if `MULTICA_DATABASE_URL` is not set, return 503.

## Key Conventions

- `/api/projects` — lists workspaces from DB only, no filesystem fallback
- `/api/agents` — **multica only**, no GTM DB fallback; looks up `ws.multica_workspace_slug` from GTM DB; returns 503 if multica not configured, 400 if project unbound
- `/api/workspaces/[slug]` — agents fetched from the project's bound Multica workspace only
- `/api/content` — **multica only** when `MULTICA_DATABASE_URL` is set; reads Issues from bound Multica workspace; no GTM DB content_items, no filesystem fallback
- `/api/ledger` — requires `?project=` param; looks up bound Multica workspace
- `/api/review-multica` — requires `project` in request body to look up bound Multica workspace

## 核心原则：永远不走文件系统路径

**所有状态用数据库维护，不用文件系统。**

- 不读写 `projects/*/agents/*/content-bank/` 目录
- 不用文件系统 symlink、review queue 文件、metrics.json 等
- 不调用任何依赖本地文件路径的 runner/script 逻辑
- API 路由里如果有 `hasMultica()` 判断，Multica 分支必须走完整的 DB 路径后 return，绝不 fall through 到文件系统分支

## Agent Config — Multica is Source of Truth

**Never create or rely on local `agent.yaml` files.** Agent configuration (name, platform, reviewer, builder, goal, status) lives exclusively in the Multica database.

- Do NOT add `agent.yaml` to any `projects/*/agents/*/` directory
- Do NOT read `agent.yaml` in any code path when Multica is configured (`hasMultica()`)
- Do NOT create engine symlinks or local filesystem stubs to work around missing agent config
- When `hasMultica()` is true, all agent metadata must be fetched from Multica and passed directly to runner/LLM logic
- **All content lists (Ideas / Drafts / Review / Bank / Published) read exclusively from Multica Issues** — never from GTM DB `content_items` or filesystem; GTM DB is not used for content reads

## Idea → GTM 落地流程

```
[用户] 在 Ideas Tab 填写 topic / angle / hook
  ↓ POST /api/create-idea
[Multica] 创建 issue（status=backlog），number 自动递增

[用户] 点击 Promote
  ↓ POST /api/promote-idea { project, idea_id }
[系统]
  1. 从 Multica 读取该 idea（title + description 里的 angle/hook）
  2. 从 Multica 读取 workspace 下所有 agents
  3. 为每个 agent 创建一条子 issue（parentId = idea_id），内容：
       - title: [channel] <topic>
       - description: topic + angle + hook + "your channel, your call"
       - status: backlog，assignee = 该 agent
  4. 将原 idea issue 状态改为 in_progress
  → 返回 { agents_notified: [{agent, channel, issue_id}] }

[各 Agent] 收到各自的子 issue，自行拆解执行
  ↓ agent 完成内容生成后
[GTM DB] 写入 content_items（state=draft）
  ↓ Reviewer 审核
[GTM DB] 更新 state: draft → bank → published
```

**关键约束：**
- `promote-idea` 不调 LLM，不生成内容，只做任务分发
- 每个 agent 的子 issue 是独立的执行单元，agent 自己决定怎么拆解
- 子 issue 通过 `parentId` 挂在原 idea 下，保持追溯链路
