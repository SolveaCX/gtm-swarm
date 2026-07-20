# 1toAll 内容运营 Agent｜维护交接

最后更新：2026-07-19
产品 Owner：Hunter
业务与内容共建：Hunter × 47
代码维护：47（需具备 `SolveaCX/gtm-swarm` push 或 PR 权限）

## 1. 唯一真源与线上地址

- 唯一代码真源：<https://github.com/SolveaCX/gtm-swarm/tree/main/apps/1toall>
- 生产工作台：<https://1toall.11agents.ai>
- 11agents Flatkey 项目：<https://app.11agents.ai/tenant/9034be95-5adb-4a36-a969-95f693196fbb/dashboard/flatkey>
- 生产健康接口：<https://1toall.11agents.ai/api/health>
- 部署控制面：`11Agents/11agents-ai` 的 `Sync 1toAll` 与
  `Deploy 1toAll` GitHub Actions

`11Agents/1toall` 已归档，只保留迁移前历史。不要再向旧仓提交、开 PR 或从旧仓
部署。`SolveaCX/gtm-swarm` 是公开仓库，任何密钥、真实账号数据、未公开商业
资料和用户数据都不得进入提交历史。

## 2. 产品定位

1toAll 是 11agents 的内容运营 Agent 工作台：把一个选题或素材转成符合品牌、
账号与平台风格的多平台内容，再统一进入日历、任务、作品、账号和成本账本。

当前 Hunter × 47 共同维护的 Flatkey 自媒体项目重点覆盖：

- 大模型与模型能力；
- Token、推理成本与算力；
- AI Native 组织与 Agent 工作方式；
- Flatkey 未来的定位：`LLM + 算力`基础设施平台。

11agents 中每个项目都可以启用同一个“内容分发 Agent (1toAll)”模板，但应进入
自己的工作区，并连接该项目的官方 LinkedIn、小红书、X、公众号等社媒账号。

## 3. 当前已经可用的能力

- 工作台、灵感、创作、日历、任务、作品、账号、账本；
- 品牌与账号、34 个内容风格、9 个运营玩法；
- Podcast / YouTube / X 灵感采集、去重、Taste 打分与一键带入创作；
- Flatkey OpenAI-compatible 网关驱动的文字与图片生成；
- workspace 级 JSON 数据隔离和可持久化生成物；
- 11agents 共享登录、项目权限校验和 Agent Floor 深链接；
- GCP VM + pm2 + nginx 的不可变 release 自动部署。

Flatkey 当前基线包含 1 个品牌、9 个运营玩法和 34 个内容风格。其他 workspace
第一次打开时不应读取 Flatkey 的品牌数据。

## 4. 代码结构

```text
apps/1toall/
├── server.js                 # Express 入口、认证中间件和 API
├── public/                   # 零构建前端
├── lib/
│   ├── elevenagents-sso.js   # 共享会话校验与短时缓存
│   ├── workspace-context.js  # workspace / tenant 参数解析
│   ├── store.js              # workspace 级 JSON 存储
│   ├── inspiration-radar.js  # 灵感采集、去重和 Taste 打分
│   ├── generate.js           # 内容与图片生成
│   ├── dispatch.js           # 重任务派发
│   └── content-ledger.js     # 内容与成本账本
├── data/seed/                # 可复现的初始品牌、玩法和风格
├── assets/                   # 可提交的静态资产
├── news-board/               # 新闻看板子模块说明与资源
├── tests/                    # Node test + smoke
├── DEPLOY.md                 # 部署实现细节
└── HANDOFF.md                # 本文档
```

1toAll 有自己的 `package.json` 和 `package-lock.json`。开发 1toAll 时应在
`apps/1toall/` 内执行 npm 命令，不要误用 monorepo 根目录的 Next.js 依赖。

## 5. 本地启动

要求 Node.js 18 或更高版本：

```bash
git clone https://github.com/SolveaCX/gtm-swarm.git
cd gtm-swarm/apps/1toall
npm ci
npm test

# 需要真实调用模型时再配置；不要写进仓库
export FLATKEY_API_KEY="..."
npm start
```

默认地址：<http://localhost:4178>。

本地未设置 `ONE_TO_ALL_AUTH_USER` 和 `ONE_TO_ALL_AUTH_PASSWORD` 时，应急登录
关闭，方便开发。不要把生产 Cookie 或 11agents session 复制到本地文件。

## 6. 推荐开发与提交流程

从 monorepo 根目录开始：

```bash
git fetch origin
git rebase origin/main
git switch -c feat/1toall-<short-name>

cd apps/1toall
npm ci
npm test
# 开发并本地验收

cd ../..
git add apps/1toall
git commit -m "feat(1toall): <summary>"
git push -u origin feat/1toall-<short-name>
```

通过 PR 合并到 `SolveaCX/gtm-swarm/main`。提交前至少运行：

```bash
cd apps/1toall
npm test
node --check server.js
```

禁止直接在生产服务器的 release 目录修代码。线上问题也必须回到 GitHub 修复，
经过测试和部署工作流发布。

## 7. 多租户与 11agents 共享登录

标准入口必须同时携带项目 slug 和 tenant UUID：

```text
https://1toall.11agents.ai/?workspace=<project-slug>&tenant_id=<tenant-uuid>
```

Flatkey 的正式入口为：

```text
https://1toall.11agents.ai/?workspace=flatkey&tenant_id=9034be95-5adb-4a36-a969-95f693196fbb
```

认证链路：

1. 用户先登录 `app.11agents.ai`；
2. 11agents 将 HttpOnly `elevenagents_session` 签发到 `.11agents.ai`；
3. 1toAll 服务端收到共享 Cookie 后，请求
   `https://app.11agents.ai/api/auth/sso`；
4. 11agents 同时验证 session、workspace、tenant 和项目成员权限；
5. 校验成功后直接进入工作台，不再出现第二次登录。

正向校验只缓存约 30 秒，缓存键是 session token 的哈希，不保存明文 token。
原用户名/密码登录仅作为故障时的 break-glass 入口。认证优先级必须保持为：

```text
11agents SSO → 应急 Cookie → Basic Auth → 拒绝访问
```

受保护接口 `GET /api/auth/status` 可用于确认当前认证来源。正常入口应返回
`source: "elevenagents"`，接口不得返回 session token。

### 当前多租户限制

项目访问权限已经按 `tenant_id + workspace` 校验，但运行数据目录目前主要按
`workspace slug` 分区。如果不同 tenant 创建同名 workspace，理论上存在存储
命名冲突。正式向外部多租户开放前，应把持久化 key 升级为
`<tenant_id>/<workspace>`，并提供旧 Flatkey 数据迁移脚本。此项按 P0 处理。

## 7.5 CLI 产能机接入（Claude Code / Codex）

设置页「CLI 产能机接入」可为任何一台电脑铸造接入令牌（`otk_<workspace>_…`，服务端只存
sha256 哈希，明文只显示一次，可随时吊销）。绑定命令（弹窗内一键复制）：

```bash
claude mcp add --transport http 1toall https://1toall.11agents.ai/api/cli/mcp \
  --header "Authorization: Bearer <token>"
codex mcp add 1toall -- npx -y mcp-remote https://1toall.11agents.ai/api/cli/mcp \
  --header "Authorization: Bearer <token>"
```

端点 `POST /api/cli/mcp`（MCP Streamable HTTP，JSON-RPC 2.0）挂在会话认证之前、以
Bearer 令牌自证并绑定 workspace。工具集：`one_to_all_status` / `get_brand_brain`（品牌
大脑三件）/ `list_video_channels` / `get_video_task_brief`（渠道指令+品牌大脑拼成完整任
务书）/ `get_setup_guide`（产能机环境自检：ffmpeg/python/faster-whisper/字体/flatkey
key/skill 包）/ `submit_work_note`（交付回报，写进品牌空间「交付记录」）。

定位：视频产线跑在绑定机本机（谁绑 CLI 谁就是产能机），系统发任务书、收成片。

**任务队列（v2）**：服务器上没有 claude CLI（`hasLocalClaude()`，可用
`ONE_TO_ALL_REMOTE_ONLY=1` 强制），工作台派发的重型任务停在 `queued`，由产能机经
`list_open_tasks → claim_task`（拿到与本地 spawn 一字不差的任务书，含品牌知识/声线/
连续性指令）→ 本机生产 → `upload_begin/upload_part/upload_commit`（base64 分片
≤1MB/片、sha256 校验、直落任务 outDir）→ `complete_task`（服务器按本地同规则
harvest 产物、进作品库）。干不了 `release_task` 放回，确认失败 `fail_task`。
工作台生产中卡片会显示「产能机「xxx」生产中」。

**模型全家桶**：设置页从 flatkey `/v1/models` 拉全目录（10 分钟缓存，
`GET /api/models/catalog`），四个用途可分别选模型（文字/选题/出图提示词设计/视频
产能机模型），存 workspace 级 `settings.json`（`/api/settings/models`），保存即全系
统生效——generate 的文字/选题/图片设计与 dispatch 的 `claude --model` 都读它，远程
认领的任务书也带 `suggestedModel`。出图本体固定 gpt-image-2（换=改代码）；配音引擎
按渠道各自配置，切 ElevenLabs 属一次性移植（等中文样音拍板）。

## 8. 数据与持久化

代码仓只保存可复现种子，不保存生产运营状态：

- 种子数据：`apps/1toall/data/seed/`；
- 生产 workspace 数据：服务器 `1toall/shared/data/workspaces/<slug>/`；
- 生成物：服务器 `1toall/shared/output/`；
- 静态资产：服务器 `1toall/shared/assets/`；
- 上传媒体：服务器 `1toall/shared/media/`。

部署使用不可变 release，并把上述 `shared/` 目录挂到新版本，所以正常发布不会
覆盖品牌、日历、任务、作品和媒体。不要把服务器 `shared/` 数据复制回 git。

## 9. 密钥与权限边界

生产所需密钥由 `11Agents/11agents-ai` 的 GitHub Actions secrets 或服务器
权限受控的 `.env.production` 提供：

- `ONE_TO_ALL_REPO_TOKEN`；
- `ONE_TO_ALL_FLATKEY_API_KEY`；
- `ONE_TO_ALL_AUTH_USER` / `ONE_TO_ALL_AUTH_PASSWORD`；
- `SERVER_HOST` / `SERVER_USER` / `SSH_PRIVATE_KEY` / `PROJECT_DIR`。

运行时还可能使用 `ELEVENLABS_API_KEY`、钉钉配置和社媒 OAuth。约束如下：

- 不在代码、Issue、PR、聊天截图和日志中粘贴任何 token；
- 不把 `.env`、Cookie、OAuth refresh token 或私钥提交到公开仓库；
- 47 日常开发不需要生产服务器 SSH key；
- 社媒账号授权必须进入加密 secret 存储，并保留审批与审计；
- `elevenagents_session` 只能用于服务端校验，不得写日志或下发给前端脚本。

## 10. 自动部署与回滚

发布链路跨两个仓库：

```text
SolveaCX/gtm-swarm/main
  └─ apps/1toall 有新 commit
       ↓（每 15 分钟或手动）
11Agents/11agents-ai · Sync 1toAll
       ↓ 传递最后一次影响 apps/1toall 的完整 commit SHA
11Agents/11agents-ai · Deploy 1toAll
       ↓ 测试 → smoke → 打包 → 上传 → pm2/nginx → 公网验收
https://1toall.11agents.ai
```

`Sync 1toAll` 只查询最后一次影响 `apps/1toall/` 的 commit，因此 monorepo 其他
目录的普通提交不会重复部署 1toAll。

需要立即发布时，在 `11Agents/11agents-ai` Actions 手动运行 `Sync 1toAll`。
部署成功后，`/api/health` 的 `release` 必须等于被部署的 monorepo 完整 SHA。

回滚时，在 `Deploy 1toAll` 中输入一个确认包含 `apps/1toall/` 的历史完整 SHA。
工作流会重新测试该版本并切换不可变 release；`shared/` 数据不会随代码回滚。

## 11. 发布验收清单

### 自动检查

```bash
cd apps/1toall
npm test
node --check server.js
curl -fsS https://1toall.11agents.ai/api/health
```

健康接口至少应满足：

- `ok: true`；
- `service: "1toall"`；
- `release` 是 40 位 monorepo commit SHA；
- `keyOk: true`。

### 浏览器检查

1. 已登录 11agents 后，从 Flatkey Agent Floor 打开 1toAll；
2. URL 同时包含正确的 `workspace` 和 `tenant_id`；
3. 不出现 1toAll 二次登录页；
4. 页面显示“flatkey 已就绪”；
5. Flatkey 基线数据可见；
6. 换到其他 workspace 时不读取 Flatkey 品牌数据；
7. 未登录 HTML 请求被重定向，未登录 API 返回 401；
8. 浏览器 Console 无阻断级 error/warn，无失败资源和死按钮。

## 12. 故障排查顺序

### 页面提示需要重新登录

1. 确认用户已登录 `app.11agents.ai`；
2. 确认入口同时带 `workspace` 与 `tenant_id`；
3. 检查 `/api/auth/status` 的 `source`；
4. 检查 11agents `/api/auth/sso` 是否为 401、403 或 5xx；
5. 不要通过关闭 SSO 或移除项目权限校验来“修复”。

### 页面一直“连接中”或数据为空

1. 查看浏览器 Console 和 `/api/bootstrap` 状态；
2. 确认 workspace Cookie 与 URL 一致；
3. 检查生产 `shared/data/workspaces/<slug>/` 是否存在且权限正确；
4. 检查 `/api/health` 的 release 是否为预期 SHA；
5. 不要用重新复制种子覆盖生产数据。

### push 后没有部署

1. 确认提交确实修改了 `apps/1toall/`；
2. 查看 `Sync 1toAll` 是否识别到新的 path commit；
3. 手动运行一次 `Sync 1toAll`；
4. 查看后续 `Deploy 1toAll` 的测试、SSH 和公网 smoke 步骤；
5. 不要手工覆盖服务器 current symlink。

## 13. 下一阶段优先级

### P0

1. 将持久化命名空间升级为 `tenant_id/workspace`，解决同名 workspace 冲突；
2. 完成 LinkedIn、小红书、X、公众号等官方账号的加密 OAuth 配置；
3. 给所有真实发布动作增加“Agent 提案 → 人审核 → 执行 → 结果回报”审计链路。

### P1

1. 将发布量、互动、线索和内容成本回流 11agents 的业务目标与 Agent 大盘；
2. 完善各平台真实发布 connector、失败重试和幂等；
3. JSON 状态迁移到数据库，同时保留 tenant/workspace 隔离与导出能力；
4. 增加每日内容简报、机会点和 Action Required 队列。

### P2

1. 扩展 X/Nitter/创作者账号池和来源健康监控；
2. 建立内容表现反馈到 Taste、选题和风格策略的闭环；
3. 增加 Web 与移动端的自动巡检和视觉缺陷测试。

## 14. 交接完成标准

47 能独立完成以下动作即视为交接完成：

1. 从 `SolveaCX/gtm-swarm` 创建分支并修改 `apps/1toall/`；
2. 本地运行测试和工作台；
3. 提交 PR 并合并到 `main`；
4. 观察 `Sync 1toAll` 与 `Deploy 1toAll` 成功；
5. 通过 `/api/health` 核对 release；
6. 从 11agents Flatkey Agent Floor 免登录进入工作台并完成浏览器验收；
7. 在不接触生产 SSH 与明文密钥的情况下定位常见问题。
