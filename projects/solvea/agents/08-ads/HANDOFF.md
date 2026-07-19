# Solvea Ads Agent — 维护交接

> 更新日期：2026-07-19
>
> 当前状态：能力包已准备；Campaign 未上线，尚无广告花费证据。

## 代码地址

- GitHub 仓库：<https://github.com/SolveaCX/gtm-swarm>
- Solvea Ads Agent 模块：<https://github.com/SolveaCX/gtm-swarm/tree/feat/solvea-ads-agent/projects/solvea/agents/08-ads>
- 本文档：<https://github.com/SolveaCX/gtm-swarm/blob/feat/solvea-ads-agent/projects/solvea/agents/08-ads/HANDOFF.md>

合并后把链接中的 `feat/solvea-ads-agent` 替换为 `main`。不要再把 `11Agents/11agents-ai/platform/docs/ops/solvea-app-paid-growth` 当作维护真源；它是早期平台集成副本。

## 生产身份

| 项目 | 值 |
| --- | --- |
| Tenant ID | `9034be95-5adb-4a36-a969-95f693196fbb` |
| Workspace ID | `42db36b2-f517-41c4-81fe-05a9fd3cd003` |
| Project slug | `solvea` |
| Paid Ads Agent ID | `56471a25-d3df-4570-bd36-518580860096` |
| Runtime profile | `paid-ads-runtime` |
| Skill | `solvea-app-paid-growth` |
| Ads card key | `solvea-app-paid-growth-capability` |
| Ads card ID | `16` |

- Production Agent: <https://app.11agents.ai/tenant/9034be95-5adb-4a36-a969-95f693196fbb/dashboard/solvea/agents/56471a25-d3df-4570-bd36-518580860096>
- Ads dashboard: <https://app.11agents.ai/tenant/9034be95-5adb-4a36-a969-95f693196fbb/dashboard/solvea/ads>

## 真源边界

1. `SolveaCX/gtm-swarm` 是技能、关键词、文案、归因规格和变更历史的 Git 维护源。
2. Multica/11Agents 数据库是 Agent 身份、任务、runtime、connector 和运行状态的生产真源。
3. 不要创建或依赖 `agent.yaml`，不要把数据库状态或密钥写进仓库。
4. GitHub 合并不会自动更新生产 Agent；合并后必须通过认证工作流同步技能和附件，并核对文件名与哈希。

## 目录

```text
projects/solvea/agents/08-ads/
├── README.md
├── HANDOFF.md
├── SKILL.md
└── wave1/
    ├── apple-search-ads-keywords.csv
    ├── google-search-rsa.csv
    ├── measurement-spec.csv
    ├── meta-creative-manifest.csv
    └── negative-keywords.txt
```

## 北极星与预算

- 目标：USD 10,000,000 已验证收入，不以点击、安装或注册代替收入。
- 首发：Apple Search Ads，美国、英文、iOS 17+。
- 日预算硬上限：USD 150。
- 首轮窗口：7 天；总硬上限 USD 1,050。
- 缺少新的书面审批时，不得扩预算、延长窗口或跨渠道挪用预算。

| Campaign | 日预算上限 |
| --- | ---: |
| Business Phone | $55 |
| AI Receptionist | $55 |
| Work Number | $30 |
| Brand Defense | $10 |

## 上线门槛

必须依次完成：

1. #154 连接 Apple Search Ads 与可用 runtime。
2. #155 真机验证 `install → business_number_created → ai_answering_enabled → first_ai_answered_call → subscription_started/credits_purchased`。
3. #156 以 `PAUSED` 状态导入 ASA Wave 1 并回写平台 ID。
4. #157 完成预算、归因、政策、App Store 和真机漏斗 QA，获得人工启用审批。

没有平台 ID、启用状态及 delivery/spend 证据，不得称为 `LIVE` 或“投放成功”。

## 停投规则

- 单关键词 20 taps、0 installs：暂停。
- 单关键词 5 installs、0 `business_number_created`：暂停并检查广告承诺与 onboarding。
- 下游归因损坏或无法信任：暂停受影响 Campaign。
- 接近日预算或总预算硬上限：超限前停止或封顶。
- 错误国家、语言、落地页、App Store 链接或政策风险：立即暂停。

## 每日核算

至少记录 spend、impressions、taps/clicks、CTR、CPT/CPC、installs、CPI、激活事件、付费用户、订阅收入、Credits 收入、退款、已实现收入、CAC、ROAS 和回本周期。平台花费必须与产品收入按 channel/campaign 对账。

允许的状态术语：`NOT CONNECTED`、`READY TO IMPORT`、`IMPORTED / PAUSED`、`QA PASSED / PAUSED`、`LIVE`、`PAUSED BY RULE`。

## 待负责人补充

- Business Owner：待填写
- Paid Media Owner：待填写
- iOS/Attribution Owner：待填写
- Reviewer/预算审批人：待填写
- Apple Ads Organization：只在安全配置中维护
- 目标 CAC、毛利率、退款率、留存/流失假设：待财务和增长负责人确认

