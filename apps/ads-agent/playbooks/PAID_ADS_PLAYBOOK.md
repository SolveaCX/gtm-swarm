---
name: ads-playbook
description: 付费广告投放 playbook(Google Ads 为主)。凡是新建/审计/优化任何产品的广告 campaign(flatkey、VOC AI、nuvelle 等),先读本 playbook 再动手。核心:只有利润是真的;先焊漏斗再放大。
---

# Ads Playbook

方法论来源:Jono Catliff($18万广告费→$73万营收,YouTube 8VyHKDSyCCo)经 Agent101 拆解 + 本组自身教训(flatkey 282注册→0充值;VOC AI 投放纪律)。
适用:所有产品的付费投放。执行任何广告任务前先过一遍对应章节的 checklist。

## 0. 总纲(两条铁律)

1. **只有利润是真的。** CTR、CVR、展示量、优化评分全是 proxy。唯一的问题:是否盈利到足以持续投放并放大。不盈利,其余全是自我安慰。
2. **广告只是冰山一角。** 钱在广告之后的四件事里赚到或亏掉:落地页、响应速度、跟进、数据对账。把预算压在"买更多线索"之前,先把已买到的线索榨干(flatkey 教训:282 注册 0 充值,问题从来不在流量)。

## 1. 账户卫生 checklist(每个新 campaign 上线前必查)

- [ ] 地域设置改 **presence only**(默认 "presence or interest" 会烧给搜过目标市场的无关国家用户),并逐个排除其他国家
- [ ] **关闭 auto-apply recommendations**;优化评分和 Google 客代电话一律无视——他们的奖金和你花多少挂钩,不和你赚多少挂钩
- [ ] 账户级 shared negative list 挂上(free download / crack / tutorial / course / jobs / salary + 产品特有负词),每周搜索词报告清洗一次
- [ ] 新 campaign 一律初始 Paused,核对后手动开
- [ ] 同账户多产品(如 <ADS_LOGIN> CID 下 flatkey + VOC)用命名前缀隔离,预算互不挤占,确认账户余额

## 2. 转化分层(最重要的一章)

拿"真钱事件"训练广告平台,不拿注册:

| 层 | 事件 | 用途 |
|---|---|---|
| P0 | 注册 / sign_up | 只观察,不作为优化目标 |
| P1 | 激活(首报告 / 首个成功 API 请求 / 绑卡) | 次转化,回传 |
| P2 | **付费(首充 / 订阅)** | 主转化,唯一给优化权重的事件 |

- 注册表单埋 **GCLID + UTM 隐藏字段**存库;付费发生时回传离线转化。攒够 50-100 个付费客户再切主转化优化——让 Google 学"付钱的人长什么样",不是"会填表的人长什么样"。
- **没有转化追踪之前绝不开 tCPA**;前两周 Maximize Clicks 拿基线。
- 加码门槛(以 flatkey/VOC 为例):CPA 达标 **且** 注册→付费 ≥3% 才加预算;不达标封顶,把钱挪去 affiliate / 存量激活 / 漏斗修复。

## 3. 结构:单意图广告组 + 五环 echo

- **一个产品线一条 campaign,一个意图一个 ad group**(SKAG 现代版),组内 3 条 RSA split test,赢家长期跑。
- **五环 echo**:用户搜的词 → 广告标题 → 落地页大标题 → 邮件 → onboarding,五环重复同一意图措辞。任何一环对不上,信任就漏一点。
- **每意图 × 每市场一版落地页**,用 Codex 批量生成(意图 × 语言 ≈ 几十页 = 一个下午)。这个战术一直正确,过去只是贵到没人做;现在没有借口。
  - 例:flatkey → /openrouter-alternative、/Codex-api、/llm-gateway × 5 市场语言
  - 例:VOC → /helium10-alternative(已有)、/review-analysis、/api-mcp
- 全流量落首页 = 把钱往窗外扔。

## 4. 漏斗下半场(零广告费的杠杆,优先级高于投放调优)

- **60 秒法则**:线索响应快 4× 收入。SaaS/dev 版 = **注册到第一次成功使用的时间**:完成页直接给预填 key 的可复制命令 / 一键出首份报告;触发即时邮件,不是 drip 第一天。承诺要写明白("75 秒后就打给你"的等价物)。
- **证言杠杆**:真实视频/用量数字证言可把 CPL 砍 85%($200→$30);创始人出镜 +33% 线索。LP 必须有:真实数字 + 客户原话 + 创始人 demo。
- **跟进纪律**:愿意为一条线索花 $50,就愿意跟进它 7 次;否则那 $50 等于冲进下水道。
- **评价新鲜度**(评价类平台 G2/Trustpilot/LSA):最近 30 天的新评价 > 五年前的存量。反馈门控:满意的引去公开评价,不满意的路由进内部渠道先解决——不删差评,在差评公开前把人接住。

## 5. 数据对账(每周)

- 广告花费 × 注册 × 付费,按 GCLID/UTM join,输出 **每关键词/每市场/每时段的付费 ROI 看板**。按钱排序,不按 CTR 排序。
- 每周一:搜索词报告清洗扩负词 + 核对官网 offer 时效(offer 下线当日改文案)。

## 6. 文案纪律

- 每个数字锚定到可引用的公开来源页,不同页面口径不混用(VOC 例:首页 100K+ 与旧页 400K+ 不混)。
- 禁承诺结果(guaranteed sales/ranking);用 surfaces / identifies / analyzes。
- 各品牌禁词表遵守(VOC:不说 chatbot;通用:revolutionary / game-changing / unlock)。
- RSA 规格:headline ≤30 字符 × 10-15 条,description ≤90 字符 × 4 条,Final URL 带完整 UTM。

## 7. 复利规则

每跑通一个流程,当天固化:可复用物料存 repo(campaigns/keywords/ads CSV 模板),新踩的坑写回本 playbook。护城河不是"会投广告",是这份被固化下来、只属于我们的 SOP。

## 现役战场(2026-07)

- **flatkey**:CID <GOOGLE_ADS_CID>,5 市场 $41/天;P0 = presence-only 检查 + auto-apply 关闭 + 转化改充值;详见 `apps/ads-agent/products/flatkey/PLAYBOOK.md`
- **VOC AI Agent**:同 CID VOC- 前缀,4 campaigns $105/天(07-13 上线);物料 `apps/ads-agent/products/voc-ai/`;$10M 模型中广告天花板 $2-3M ARR,第一杠杆是存量激活
