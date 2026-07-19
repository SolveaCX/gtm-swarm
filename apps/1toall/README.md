# 1toAll

一个想法进入系统 → 品牌路由 → 生成多平台内容（文案/脚本/图片/视频方案），并统一回到任务、作品、账号、账本里管理。本机单用户工作台，零构建前端 + Express 后端 + 本地 JSON 存储，服务地址 `http://localhost:4178`（仅本机、无鉴权）。

「灵感」页每天从 Podcast、YouTube 和 X 收集候选素材，仅用标题与简介批量做 Taste 初筛，输出 0–100 分、评分理由和建议切口；采用后可一键带入创作。缓存按 workspace 隔离，默认 6 小时刷新。

## 快速开始

```bash
npm install
# 配置文字/图片模型的 key（flatkey，OpenAI 兼容网关；也可换成你自己的 OpenAI 兼容端点）
export FLATKEY_API_KEY="你的key"       # 或存进 macOS 钥匙串 service=FLATKEY_API_KEY
npm start                               # → http://localhost:4178
```

- Node.js `>=18`。
- 文字默认 `gpt-5.5`、图片 `gpt-image-2`（走 flatkey 网关 `https://router.flatkey.ai/v1`；`lib/flatkey.js` 里可改端点/模型）。
- macOS 用户可双击 `run-server.sh` 那类脚本；其余系统直接 `npm start`。

## 这个包里有什么

- **全部源码**：`server.js` + `lib/`（生成/路由/派单/账本/交付/平台规则等）+ `public/`（前端）。
- **风格库** `data/seed/styles.json`：34 个写作 + 视觉风格配方（含 `assets/styles/` 样图），首次启动复制到运行数据目录。
- **运营玩法库** `data/seed/plays.json`：9 个通用运营玩法。
- **一个示例品牌** `data/seed/brands.json`（`Demo 品牌`），方便直接看效果。

## 需要你自己补的（分享版已清空/占位）

- **模型 key**：`FLATKEY_API_KEY`（见上）。
- **你的品牌**：在「品牌 · 账号」页新建，替换示例品牌。
- **平台通用规则** `data/platform-rules.json` / `lib/platform-rules.js`：现在是通用占位，按你的账号/发布规则填。
- **发布/数据集成（可选）**：YouTube 发布、YouTube 数据抓取需要一套 YouTube OAuth 凭证放 `~/.secrets/publishing-platforms.env`；钉钉账号看板需要 `DINGTALK_MCP_URL`（钥匙串）+ `config.js` 里的 `DINGTALK_ACCOUNT_BASE/TABLE`。这些分享版都是占位，不接也能用核心的「生成 + 管理」。

## 目录

- `server.js` — Express API + 静态前端 + 各发布/数据入口
- `lib/generate.js` — 轻内容提示词、品牌知识注入、选题路由、两步图片（先提示词后渲染）
- `lib/dispatch.js` — 重视频队列（本地 Claude worker），产物落 `~/Movies/BrandHQ/`
- `lib/platform-rules.js` — 系统级平台通用规则（注入生成）
- `lib/delivery.js` — 交付包整理（人/账号/交付包/{视频,图片,文案}）
- `data/*.json` — 本地存储（无数据库）；`data/` 里没有的集合首次运行会自动建空文件

> 分享版：已移除原作者的真实账号数据、对话记录、发布凭证、机密平台规则、品牌资产与商业文档；代码可直接跑，数据请填你自己的。

## Production

- Workbench: `https://1toall.11agents.ai`
- 11agents entry: Flatkey workspace → Agent Floor → 内容分发 Agent (1toAll)
- Canonical source: `https://github.com/SolveaCX/gtm-swarm/tree/main/apps/1toall`
- Deploy: push `SolveaCX/gtm-swarm` 的 `main`; see `DEPLOY.md`
- Runtime data is persistent and is intentionally not committed. The tracked
  `data/seed/` directory is the reproducible Flatkey baseline from 47's share package.
