# 1toall — 内容分发 Agent

> 一份内容 → 多平台。11agents 的社媒运营工作台（Hunter × 47，2026-07-18 定调）。

## 定位（方案 A · 独立挂靠）
- 独立服务独立部署，11agents 平台侧只挂入口链接；数据按需经 MCP 回流 dashboard
- 种子用户：Hunter + 47；第一批任务：LinkedIn 公司号矩阵统一运营

## 生产部署
- 目标机器：与 `app.11agents.ai` 同一台 GCP VM（nginx + pm2）
- 域名：`https://1toall.11agents.ai`；应用端口 `4178`；pm2 进程名 `1toall`
- **日常发布：直接 push 本仓 `main`。** `11Agents/11agents-ai` 的自托管
  `Sync 1toAll` 工作流每 15 分钟对比本仓 `main` SHA 与生产健康接口里的
  release SHA；发现新版本后自动调用正式部署工作流。这样不依赖 GitHub
  托管 runner 的账单状态。正式部署会完成测试、release 部署、nginx reload、
  健康检查和公网 smoke。
- 生产可变数据不在 release 中：位于服务器 `1toall/shared/`，新 release
  通过 `ONE_TO_ALL_*_DIR` 读取；部署不会覆盖品牌、日历、任务或生成物。
- 工作区数据位于 `shared/data/workspaces/<slug>/`。入口链接通过
  `?workspace=<11agents project slug>` 选择命名空间；当前 Hunter × 47 的
  基线数据只初始化到 `flatkey`，其他项目首次打开为空白实例。
- 手工回滚/重跑：在 `11Agents/11agents-ai` Actions 中运行
  **Deploy 1toAll**，输入本仓完整 commit SHA（留空表示 `main`）。

## 登录与密钥
- 公网工作台优先复用 `.11agents.ai` 域的 `elevenagents_session`：1toAll
  服务端向 11agents 校验会话以及当前 workspace/tenant 权限，浏览器不会
  再出现第二次登录。校验结果只短暂缓存，不保存原始 session token。
- 原有应用内登录只作为 11agents 登录或校验服务故障时的应急入口；用户名/
  密码是 11agents 仓库的 Actions secrets，Hunter 的本机密码另存 macOS
  Keychain service `1TOALL_PROD_PASSWORD`，不进 URL、不进 git。
- 可通过受保护的 `GET /api/auth/status` 验收当前认证来源；正常入口应返回
  `source: "elevenagents"`，且接口不会返回任何 session token。
- `FLATKEY_API_KEY` 只由生产 workflow 写入服务器 chmod 600 的 env 文件。

## 安全红线（重要）
- **社媒 token（LinkedIn 等）绝不明文进代码/库**：本地用 `.env`（已 gitignore）；上线后用服务器上的 env 文件（chmod 600）或接平台的加密配置（INTEGRATION_SECRETS_KEY 体系，找 Hunter/Claude 对接）
- token 传递不要走聊天明文，放服务器指定路径

## 与 11agents 的对接点（按需，不强制）
- 发布结果回流：MCP `https://app.11agents.ai/mcp`（参考 voc-ads/push_daily_stats.py 的 dataset push 模式，token 在 ~/.11agents/credentials 约定）
- 未来可选：Taste 打分接平台 Action Required 审批流；灵感源（news.skill101.cn / X 采集）落平台雷达

## 已知产品缺口（来自 07-18 对话）
1. Taste 打分 + 素材卡评分（现为 通过/pass）
2. X 深度文采集（List+API / Nitter 桥 / 浏览器抓）
3. 与 11agents 的深度结合（当前方案=独立挂靠，深融合另议）
