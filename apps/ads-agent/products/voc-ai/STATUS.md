# VOC AI Agent 广告 — 项目状态(source of truth)

> memory 目录多机同步屡次冲掉项目记忆,完整状态以本文件为准。每次会话结束前更新。
> 最后更新:2026-07-19

## 一句话现状
试投 LIVE 第 5 天($50/天,US,51 词),累计 $178/42 点击/CTR 达标;**转化链路三断点已查明并出工单(P0)**,修好前"0 注册"不可信;泄漏负词已止血。

## 账户
- CID 275-229-9046(MCC 7153662160,shulextech;与 flatkey 共账户,adtiger 代理户)
- 凭证：通过 `GOOGLE_ADS_ENV` 指向 Git 外的 secret 文件；google-ads lib 31.1.0(API v24,直连,FieldMask 用 protobuf_helpers)
- Campaigns:Conquest $15 / Category $10 / Dev $20(07-16 起主推 MCP+Amazon data)/ Brand $5;全 Maximize Clicks + CPC 上限(Dev $6 其余 $5/$2)

## 大事记
- 07-12 方案 + 物料(plan-2026-07-12.html,$10M 反推:存量激活第一杠杆,广告天花板 $2-3M)
- 07-14 试投上线(create_voc_campaigns.py 在 laptop 跑,voc_testlaunch.py 本机)
- 07-16 重点切 MCP+Amazon data(focus_mcp_data.py);CEO SEO 文档 Bucket1 痛点词上线(add_bucket1_pain.py);dashboard ⑤⑥板块上线
- 07-19 全链路体检:搜索词泄漏 ~60%(reviewmeta/magento/中文/free)→ 已加 18 负词;**三断点工单**(ticket-conversion-tracking-fix.md,云 KB rev.493):①GTM-MD42STD 无 AW 转化标签 ②voc.ai→app.voc.ai 跨域丢 gclid ③Get Agent 指登录墙深链、/signup 404

## Dashboard 管道
- cron `7 9,21 * * *` → push_daily_stats.py:按前缀分桶(VOC-/flatkey-/其余=solvea)推三项目的 dataset `ads`+`ads_keywords`+每日进度快照
- MCP 工具 `ads_daily_snapshot_push`(我加的,commit 9817e32)+ ⑤⑥表格(7d103c8),都已在生产
- token：通过 `ADS_PROJECT_TOKENS_FILE` 指向 Git 外的项目 token 文件
- ⚠️ flatkey 快照与 laptop 旧管线后写覆盖;⚠️ 平台 push main=生产部署需用户逐次批准

## 关键数据点(07-19 知)
- 最强词:amazon review analyzer(CTR ~6%)、analyze amazon reviews(7.3%);amazon data 已出量;competitor review analysis 73曝光0点击待处理
- 账户转化动作:7527391177 signup_success(GA 导入,非主要,VOC ALL_conv=0,属性待查)
- 加码门槛:CPA<$25 且注册→付费≥3%;转化≥30 才切 tCPA

## 待办
1. 【P0·产品侧】三断点工单落地(已发用户转发)
2. D7 复盘(07-20/21):CTR/CPC 对基准,处理 competitor review analysis
3. 确认 7527391177 的 GA 属性;修完跨域后设主要转化
4. 内容侧(SEO 文档):review-analysis 集群 / 对比页+G2 / MCP 教程(github.com/mguozhen/voc-amazon-reviews 做唯一答案)
5. Meta 账号充值搭建(方案 D2 项,一直未动)
