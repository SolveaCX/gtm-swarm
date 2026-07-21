# 1toAll — 本地开发约定

## 🚨 本地调试：一套环境，不许另起

**永远用这一套，不要每次改代码就换端口、换数据目录。**

```bash
npm run dev        # → http://localhost:4178
```

- **端口固定 4178**（`config.js` 的默认值）。不要 `PORT=459xx` 随手挑一个。
- **数据目录固定 `data/`**（默认值，已 gitignore）。不要 `ONE_TO_ALL_DATA_DIR=/tmp/xxx` 另造一份。
  这份本地数据里已经有 20 条任务、3 个项目、28 个风格、7 个账号，足够试大部分场景。
- **`npm run dev` 带 `--watch`**：改完源码服务自己重启，浏览器刷新即可。**不用杀进程重开。**
- 用 Browser 预览时走 `preview_start {name: "1toall"}`（读 `.claude/launch.json`），已经在跑就复用，
  不会重复起。

**为什么定这条**：477 2026-07-21 明确要求——之前每改一处就 `PORT=45939 ONE_TO_ALL_DATA_DIR=/tmp/xxx node server.js`
起一个新服务、造一份新数据，端口从 45937 一路开到 45943，浏览器标签堆满，每次还要重新点过引导弹窗。
纯属自找麻烦，热重载本来就有。

### 要试特殊状态怎么办

比如「任务失败了该弹什么提醒」——**直接改 `data/workspaces/flatkey/` 下对应的 JSON**，
试完改回来。不要为了一个临时状态另开一整套环境。

改之前先备份那一个文件：

```bash
cp data/workspaces/flatkey/jobs.json /tmp/jobs.bak && \
  # ...改、试... && \
  mv /tmp/jobs.bak data/workspaces/flatkey/jobs.json
```

## 上线链路

merge 到 gtm-swarm main → `11Agents/11agents-ai` 的 **Sync 1toAll** →
**Deploy 1toAll**。用 `/api/health` 的 `release` 字段核对是不是自己那一版。

```bash
gh workflow run "Sync 1toAll" --repo 11Agents/11agents-ai
curl -s https://1toall.11agents.ai/api/health | python3 -c "import sys,json;print(json.load(sys.stdin)['release'])"
```

## 加平台能力必须同步加 CLI 工具

新增 API 端点或页面功能时，**同一个 PR 里**在 `lib/cli-mcp.js` 的 `registerPlatformTools()`
补上对应的 MCP 工具（依赖从 `server.js` 底部注入，避免 lib 反向 import server）。
否则接进来的 agent 只能回去点网页——没人记账、不可复现、出错查不到是谁干的。

规矩写在三处，改动能力时一并更新：MCP `initialize` 的 instructions、`SETUP_GUIDE`、网页版 CLI 说明书。
