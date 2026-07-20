# Agent101《$18万投出$73万》→ flatkey Ads 落地清单 (2026-07-12)

来源:公众号 Agent101,拆 Jono Catliff《Claude Code Local Google Ads: Automate Everything ($730K Earned)》(YouTube 8VyHKDSyCCo)。
flatkey 现状:CID <GOOGLE_ADS_CID>,5 市场 campaign $41/天;漏斗 282 注册→1 绑卡→0 充值(PR#192/#193/#184 在修)。

## 一、立刻检查(账户设置,30 分钟,零成本)

1. **地域设置查 "presence only"** — 文章最具体的坑:默认 "presence or interest" 会把预算烧给搜过目标市场的无关国家用户。flatkey 5 个市场 campaign 逐个查,全改 presence only + 排除其他国家。
2. **关掉 auto-apply recommendations,无视优化评分** — "优化评分 83.7%" 是给 Google 优化,不是给你。客代电话同理。检查 CID 是否开了自动应用建议。
3. **通用负词清单挂到账户级** — 文章打法:一份 shared negative list 全 campaign 复用(free/crack/tutorial/jobs/salary + LLM 场景的 "what is"、"course")。

## 二、本周改造(转化定义,这是 flatkey 最痛的一条)

4. **只有利润是真的:优化目标从注册改成钱** — 282 注册→0 充值 = 我们正在让 Google 学"什么样的人会注册但不付钱"。行动:
   - 转化事件分层:注册(观察)→ 绑卡(次转化)→ **首充(主转化,才给优化权重)**。
   - Dashboard(:8099)加一列:per-campaign / per-keyword 的**充值金额**,不看 CTR/CVR 排序,看钱排序。
5. **GCLID + UTM 隐藏字段闭环** — 注册表单埋 GCLID+UTM 存库;用户首充时回传 Google 离线转化。文章说攒够 50-100 个付费再喂给 Google 学——我们现在 0 充值,先把采集埋上,数据攒着。

## 三、两周内(相关性链条,Claude Code 的主场)

6. **意图 echo 五环:搜索词→广告→LP→邮件→onboarding 全部重复同一意图** — flatkey 现在大概率全流量落首页。按意图拆 LP,用 Claude Code 批量生成(文章原话:几个月的无聊活压成几小时):
   - `/openrouter-alternative`(竞品截流意图)
   - `/claude-api`、`/gpt-api`(模型直达意图)
   - `/llm-gateway`(品类意图)
   - × 5 市场语言版 = ~20 个页面,一个下午的事。
7. **单意图广告组(SKAG 现代版)** — 一意图一 ad group,组内 3 条 RSA split test,赢家长期跑。现有 campaign 若一组塞多意图词,拆。

## 四、漏斗下半场(文章的核心:钱在广告之后)

8. **"60 秒回拨" 的 dev 版 = 注册到第一个成功请求的时间** — 文章:60 秒内响应 = 4× 收入,零广告费。flatkey 版:注册完成页直接给预填 API key 的可复制 curl,10 秒跑通第一个请求;注册后触发即时邮件(不是 drip 第一天)。这比任何投放优化都值钱——我们的死点就在这段。
9. **证言杠杆** — 视频证言把 CPL $200→$30、创始人出镜 +33% 线索。flatkey 版:LP 放真实用量数字(tokens served)、开发者一句话证言、Hunter 出镜 60 秒 build-in-public demo。
10. **利润对账看板** — 线索 CSV × 成交 CSV 对上 = 哪个词真赚钱。flatkey 版:广告花费 × 注册 × 充值按 UTM/GCLID join,:8099 dashboard 加"每词/每市场充值 ROI"视图。文章原话:"用 AI 拿到专家级建议,几乎免费"。

## 五、复利层

11. **沉淀成 Skills** — /build-campaign、/generate-ads、/build-landing-page。流程跑通一次就固化成斜杠命令(我们本来就有 30 个 skills 的发布经验)。护城河 = 固化的 SOP,不是"会投广告"。

## 优先级(建议顺序)

P0(今天):#1 presence only、#2 auto-apply、#4 转化分层
P1(本周):#5 GCLID 埋点、#8 注册→首请求提速
P2(两周):#6 意图 LP 批量生成、#7 SKAG 重构、#10 ROI 看板
P3(跑通后):#11 Skills 固化

一句话总纲:**flatkey 的问题不是买量,是 282 个已买到的注册一个都没榨出钱——先把水面下的漏斗焊住,再谈放大。**

## 六、Flatkey Ads 直接执行版

### 1. 预算闸门

- 在“首充金额可按 GCLID/UTM 回传”与“注册后能在 60 秒内跑通首个 API 请求”完成前，不增加当前总预算。
- 修复期将当前预算下调 50%，避免继续购买无法归因、无法变现的注册。
- 剩余预算不再平均撒给 5 个市场：70% 给历史上 `绑卡率/首请求率` 最高的 2 个市场，20% 给第三名，10% 留作新词与新创意测试；其余市场暂停。
- 放量条件：连续 7 天至少 20 个首个成功请求、至少 5 个首充，并且能按 campaign/ad group/keyword 对账收入。未达到就继续修漏斗，不扩量。

### 2. Campaign / Ad Group 结构

每个市场复制同一套结构，但关键词、广告和落地页使用当地语言。不要把不同意图混在一个 ad group。

| Campaign | Ad group | 关键词意图 | 对应落地页 |
|---|---|---|---|
| FK-HighIntent-{Market} | openrouter-alternative | openrouter alternative / alternative to openrouter | `/openrouter-alternative` |
| FK-HighIntent-{Market} | llm-api-gateway | llm api gateway / ai api gateway | `/llm-gateway` |
| FK-Model-{Market} | claude-api | claude api / claude api access | `/claude-api` |
| FK-Model-{Market} | gpt-api | gpt api / openai api access | `/gpt-api` |
| FK-Category-{Market} | unified-llm-api | unified llm api / one api multiple llms | `/unified-llm-api` |
| FK-Brand-{Market} | flatkey | flatkey / flatkey api | 首页或专属 brand LP |

第一轮只用 exact + phrase。Broad match 等首充回传累计 50–100 个付费用户后再小预算测试。

### 3. 第一批 RSA 文案

#### OpenRouter Alternative

Headlines（每条不超过 30 字符）：

- OpenRouter Alternative
- One API for Every LLM
- Switch Models Without Rewrites
- A Simpler LLM API Gateway
- One Key. Multiple Models.
- Build Faster With Flatkey
- Unified Access to LLM APIs
- Keep Your Existing Workflow

Descriptions（每条不超过 90 字符）：

- Connect to multiple leading models through one API and keep your stack flexible.
- Stop rewriting integrations for every model. Build once and switch when you need.
- Start with Flatkey, run your first request, and manage model access in one place.
- Compare model workflows without rebuilding your application for each provider.

#### LLM API Gateway

Headlines：

- Unified LLM API Gateway
- One Endpoint. More Models.
- Simplify Your AI Stack
- Route LLM Requests Simply
- Flatkey for LLM APIs
- Build Once, Choose Any Model
- Faster Multi-Model Setup
- Manage LLM Access in One Place

Descriptions：

- Use one integration for multiple LLMs and keep model changes out of your app code.
- Give your team one place to access models, run requests, and manage usage.
- Move from signup to your first API request with a copy-ready quickstart.
- Keep your application flexible as model needs, providers, and workloads change.

#### Claude / GPT API 意图

Headlines：

- Connect to Claude via Flatkey
- Start Your Claude API Build
- Connect to GPT via Flatkey
- Start Your GPT API Build
- One API for Claude and GPT
- Add More Models Without Rework

Descriptions：

- Start with the model you need today and keep one path to add more models later.
- Use Flatkey's unified workflow to connect, test, and run your first request.
- Avoid rebuilding your integration when your application needs another model.
- Get from account creation to a working API request with a focused quickstart.

商标词只用于事实性兼容/访问描述；不要暗示 Flatkey 与 OpenAI、Anthropic 或 OpenRouter 存在官方隶属或背书。

### 4. 通用否定关键词初稿

`free`, `free trial`, `crack`, `破解版`, `download`, `apk`, `torrent`, `jobs`, `salary`, `career`, `course`, `tutorial`, `documentation pdf`, `what is`, `definition`, `research paper`, `stock`, `logo`, `customer service`, `phone number`

上线前必须逐市场审核。“tutorial”与“what is”只应用于高购买意图 campaign，内容获客 campaign 不应照搬。

### 5. 五环 Echo 模板

以 `openrouter alternative` 为例：

1. 搜索词：OpenRouter alternative。
2. 广告标题：OpenRouter Alternative / One API for Every LLM。
3. LP H1：A Flexible OpenRouter Alternative for Multi-Model Apps。
4. 注册完成页：Your OpenRouter alternative setup is ready；直接展示预填 API key 的首个请求。
5. 即时邮件：Run your first multi-model request；邮件深链回同一 quickstart，而不是发泛化欢迎邮件。

其他意图按同一规则替换。广告承诺、LP 首屏、onboarding 与邮件不得换词换主题。

### 6. 转化与收入回传规范

| Event | Google Ads 角色 | 参数 |
|---|---|---|
| `signup_complete` | Secondary / Observation | gclid, utm_*, market, keyword theme |
| `card_bound` | Secondary / Observation | user_id, gclid, timestamp |
| `first_api_success` | Activation；修复期诊断指标 | model, latency, time_from_signup |
| `first_topup` | Primary | value, currency, order_id, gclid |
| `topup_revenue` | Primary / value based | value, currency, order_id, gclid |

规则：注册不再作为最终成功；首充必须去重；充值收入按真实金额回传；GCLID 与 UTM 从首次访问保存到用户和订单。数据不足阶段先用 Maximize Clicks 或受控 CPC 收集高意图流量，不要让 0–5 个首充强行驱动自动出价。

### 7. 每日利润看板

最少显示：`Spend → Click → Signup → Card Bound → First API Success → First Top-up → Revenue`，并按 market、campaign、ad group、keyword、search term、device 拆分。

核心派生指标：

- 激活率 = first_api_success / signup
- 绑卡率 = card_bound / signup
- 首充率 = first_topup / signup
- CAC = spend / first_topup
- ROAS = attributed revenue / spend
- 回本周期 = CAC / 首月毛利

任何优化建议必须回答“它会改善哪一个利润指标”。CTR、优化评分和注册量只作为诊断指标，不作为放量依据。

### 8. 7 天测试节奏

- Day 1：presence only、国家排除、关闭 auto-apply、共享负词；注册降为 Secondary。
- Day 2：埋 GCLID/UTM；首充与充值收入事件进入 Ads，但先验证不参与错误出价。
- Day 3：发布 `/openrouter-alternative` 与 `/llm-gateway`，每页只保留一个主 CTA。
- Day 4：上线 2 个高意图 ad group，每组 2 个 RSA；旧泛词组降预算或暂停。
- Day 5：注册完成页加入预填 API key 的 copy-ready request，并发送即时激活邮件。
- Day 6：逐条审 Search Terms；新增负词；检查广告→LP→onboarding 的 message match。
- Day 7：按激活率、首充率、CAC 和收入复盘；只保留有下游行为的市场/词/广告。

### 9. 决策纪律

- `0 首充`：不放量，优先修产品激活和支付。
- 有首充但 CAC 高于可接受毛利：缩词、缩市场、提高 LP 与 onboarding 转化。
- 累计 50–100 个可归因付费用户：上传离线转化并开始测试 value-based bidding。
- ROAS 连续 14 天达到目标且退款/坏账正常：预算每 3 天最多增加 20%，避免学习期重置。
