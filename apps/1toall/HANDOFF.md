# 1toAll 维护交接（Hunter × 47）

## 地址

- 源码：<https://github.com/11Agents/1toall>
- 生产工作台：<https://1toall.11agents.ai>
- 11agents 入口：Flatkey 项目 → Agent Floor → `内容分发 Agent (1toAll)`

## 产品边界

1toAll 是 11agents 的内容运营工作台。每个 11agents 项目都可以启用同一个
Agent 模板，但打开的是独立工作区：

```text
https://1toall.11agents.ai/?workspace=<project-slug>
```

当前 Hunter 与 47 共同维护的大模型、Token、AI Native 组织和未来 Flatkey
定位内容，放在 `flatkey` 工作区。Flatkey 的种子数据包含 1 个品牌、9 个运营
玩法和 34 个内容风格；其他项目第一次打开时为空白，不会读到 Flatkey 数据。

## 本地运行

要求 Node.js 18 或更高版本：

```bash
npm ci
npm test
FLATKEY_API_KEY="..." npm start
```

默认地址为 `http://localhost:4178`。本地未设置 `ONE_TO_ALL_AUTH_USER` 和
`ONE_TO_ALL_AUTH_PASSWORD` 时不启用登录；生产环境必须设置这两个变量。

## 日常发布

47 后续只需要提交并 push 本仓库 `main`：

```bash
git pull --rebase origin main
npm test
git push origin main
```

`11Agents/11agents-ai` 的自托管 `Sync 1toAll` 工作流每 15 分钟比较本仓库
`main` SHA 和生产 `/api/health` 返回的 release SHA；检测到新版本后，将完整
commit SHA 交给 `Deploy 1toAll` 工作流。生产工作流负责：

1. 再次测试候选版本并运行 smoke；
2. 上传不可变 release 到 11agents 的 GCP 服务器；
3. 用 pm2 在端口 `4178` 启动该 release；
4. 更新 nginx 并执行内网、公网健康检查；
5. 保留 `shared/` 下的运营数据和生成物。

不要直接修改服务器 release 目录；修复应回到 GitHub，通过上述链路发布。
如需立即发布，可在 `11Agents/11agents-ai` Actions 中手动运行
`Sync 1toAll`，无需等待下一次定时检查。

## 数据与工作区

- 代码内可复现基线：`data/seed/`
- 生产可变数据：服务器 `1toall/shared/data/workspaces/<slug>/`
- 生成物：服务器 `1toall/shared/output/`
- 素材与媒体：服务器 `1toall/shared/assets/`、`1toall/shared/media/`
- 工作区解析与防路径穿越：`lib/workspace-context.js`
- JSON 存储的工作区路由：`lib/store.js`

请求可以用查询参数 `?workspace=<slug>` 或请求头
`X-1toall-workspace: <slug>` 指定工作区；浏览器会保存
`one_to_all_workspace` Cookie。

## 凭证与权限

- 正常使用复用 11agents 登录态。Agent Floor 链接同时携带 `workspace` 与
  `tenant_id`，1toAll 会向 11agents 验证用户对该项目的访问权限；不要绕过
  这层校验或把 session token 写进日志。
- 生产登录、SSH、Flatkey API key 和仓库 token 全部保存在 GitHub Actions
  secrets 或服务器权限受控的环境文件中，不在代码仓库。
- Hunter 本机的生产登录密码存放在 macOS Keychain：service
  `1TOALL_PROD_PASSWORD`、account `hunter`。
- 47 需要由 `11Agents` GitHub 组织管理员添加到 `11Agents/1toall`，并获得
  push 权限；不需要分享部署服务器 SSH key。
- 社媒 OAuth/token 继续使用受控 secret 存储，禁止写入 JSON、代码或提交历史。

## 交接验收

每次发布至少确认：

```bash
npm test
curl -fsS https://1toall.11agents.ai/api/health
```

公网验收还应覆盖：

1. 已登录 11agents 后，从 Agent Floor 打开 1toAll 不出现第二次登录；
2. 未登录访问 `/` 会被拦截，且应急 `/login` 仍可用；
3. 访问 `/?workspace=flatkey&tenant_id=<tenant uuid>`，能看到 Flatkey 基线数据；
4. 访问另一个 workspace 时没有 Flatkey 品牌数据；
5. 11agents Flatkey Agent Floor 的卡片链接包含 workspace 与 tenant scope；
6. 浏览器无阻断级 console error、失败资源或死按钮。

## 当前后续产品工作

1. 灵感雷达已接入：Podcast / YouTube / X → 去重 → Taste 打分 → 素材卡 → 一键创作；
2. X 当前复用 builders feed；下一步可增加 Nitter 健康池与用户自选账号；
3. 内容发布结果通过 11agents MCP 回流业务目标与 Agent 大盘；
4. 各社媒账号 OAuth、审批与审计链路；
5. JSON 存储增长后迁移到数据库，同时保留 workspace 级隔离。
