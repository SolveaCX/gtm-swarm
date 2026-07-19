# 新闻看板项目 — 代码包

> 线上地址：http://news.skill101.cn ｜ 打包日期：2026-07-19

每天自动搜全网新闻 → 分 8 个栏目 → 加密生成一个日历看板网页 → 传到阿里云 OSS。全程无人值守，早晚各跑一班。

---

## 一、这堆文件都是干嘛的（人话版）

**搜新闻的大脑（1 个，最核心）**

| 文件 | 作用 |
|---|---|
| `code/flatkey-agent.py` | **搜索引擎本体**。7 个栏目全靠它去全网搜新闻。用 DuckDuckGo 打底 + Google News RSS 兜底，两个都免费、不烧额度、永不断供（之前"没内容"就是因为旧的 Firecrawl 欠费停了，已换掉）。带退避+熔断+防死链。 |

**7 个栏目各自的启动脚本**（都调用上面那个大脑）

| 脚本 | 栏目 | 每天几点跑 |
|---|---|---|
| `code/daily-news-radar.sh` | 🌍 全球新闻 + 🎯 选题推荐 | 10:00 |
| `code/daily-ai-blog.sh` | 📝 AI 博客 | 10:05 |
| `code/daily-ai-briefing.sh` | 🌅 AI 早报 | 10:10 |
| `code/daily-ai-podcast.sh` | 🎧 AI 播客 | 10:12 |
| `code/daily-ai-quicknews.sh` | ⚡ AI 快讯 | 10:15 |
| `code/daily-ai-deepread.sh` | 📖 AI 精读（宁缺毋滥，找不到够格深度长文就空着） | 10:20 |
| `code/daily-shulex-customers.sh` | 🏢 跨境大卖（扫已成交客户近况） | 11:25 + 22:25 |

**把内容拼成网页 + 加密 + 上传（2 个）**

| 文件 | 作用 |
|---|---|
| `code/build-dashboard.py` | **主构建器**。把 7 个栏目的当天内容拼成日历看板 HTML，AES 加密后传到 OSS `skill101-news` 桶。 |
| `code/dash_crypto.py` | 加密小工具（被上面那个调用）。看板内容是加密存的，打开网页要密码。 |

**辅助**

| 文件 | 作用 |
|---|---|
| `code/dashboard-refresh.sh` | 每小时巡检：库里有新文件就自动重建看板 + 重传。 |
| `code/render-news-page.py` | 选题雷达单页渲染（news-radar 调用）。 |
| `code/_loop-common.sh` | 所有脚本共用的公共函数（取 token、写日志、发通知）。 |
| `code/flatkey-news.py` | ⚠️ **旧版本，已弃用**，没人调用了。留着仅供参考，可删。 |

**定时配置**

`launchd/*.plist` — 8 个 macOS 定时任务配置。装法见下。

---

## 二、跑起来需要啥（依赖）

- **Python 3.14**（`/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`），装 `cryptography`、`beautifulsoup4`、`lxml`、`requests`
- **ossutil**（`~/bin/ossutil`）— 阿里云 OSS 上传命令行工具
- **两个密钥（不在这个包里，见下方安全说明）**：
  - flatkey API key → 存在 macOS Keychain，service 名 `FLATKEY_API_KEY`
  - Claude oat token → Keychain `anthropic-oat-token`（headless 跑 Claude 用）
  - 看板解密密码 → `~/.477-automation/.dash-pass`

---

## 三、怎么装定时任务

```bash
# 1. 代码放回原位
cp code/* ~/.477-automation/

# 2. 定时配置装上
cp launchd/*.plist ~/Library/LaunchAgents/
for p in ~/Library/LaunchAgents/com.477.loop-ai-*.plist \
         ~/Library/LaunchAgents/com.477.loop-news-radar.plist \
         ~/Library/LaunchAgents/com.477.loop-shulex-customers.plist \
         ~/Library/LaunchAgents/com.477.dashboard-refresh.plist; do
  launchctl load "$p"
done
```

手动跑单个栏目测试：`bash ~/.477-automation/daily-ai-blog.sh`

---

## 四、⚠️ 安全说明（重要）

**这个包里没有任何密钥、密码、token** —— 故意排除的，防止泄露：

- ❌ `.dash-pass`（看板解密密码）**没打包**。真文件在 `~/.477-automation/.dash-pass`。
- ❌ flatkey / Claude 的 API key **没打包**。代码运行时从 macOS Keychain 现取。
- ✅ 已扫过全部代码：**无硬编码密钥**，全是 `security find-generic-password` 这种从 Keychain 取的安全写法。

要换机器跑：先在新机 Keychain 灌 `FLATKEY_API_KEY` 和 `anthropic-oat-token`，再放 `.dash-pass`。

---

## 五、数据/产物在哪（不在这个包）

- 每天生成的 md 日报 → ob 库 `01_Projects/AI自媒体/选题雷达/`
- 加密后的网页 → ob 库 `.../选题雷达/site/`（8MB，是产物不是代码，没打包）
- 线上 → 阿里云 OSS `skill101-news` 桶 → http://news.skill101.cn
- 运行日志 → `~/Library/Logs/daily-ai-*/`
