# VOC AI Agent 广告落地包 (2026-07-12)

主推 **Ask the Agent**(voc.ai 主线定位 "The e-commerce data layer for AI Agents")。
方案全文:`plan-2026-07-12.html`(浏览器打开)。

## 落地物料

- `google-ads-editor/campaigns.csv` — 4 个 Search campaigns($105/天推荐档,初始 Paused)
  - VOC-Agent-Conquest-US($40)竞品截流:helium10/junglescout alternative + review 工具词
  - VOC-Agent-Category-US($40)品类高意图:voc analysis / competitor analysis / ai for sellers
  - VOC-API-MCP-Dev-US($20)开发者:reviews api / ecommerce mcp server
  - VOC-Brand-Defense($5)品牌防守
- `google-ads-editor/keywords.csv` — 35 个 Phrase 关键词
- `google-ads-editor/ads-rsa.csv` — 9 组 RSA(headlines ≤30 字符、descriptions ≤90 字符已校验;Final URL 带 UTM)
- `google-ads-editor/negative-keywords.csv` — 首批负词

## D1(07-13)四件事

1. Google Ads 转化追踪:sign_up 事件 + GA4 绑定(今晚实测 11agents tenant GA4 未绑定)
2. Google Ads Editor 导入上述 CSV,核对后 Paused→Enabled
3. 实测 Try the Agent 注册全流程 + /pricing 口径
4. 投放账号:shulextech@gmail.com CID 275-229-9046(与 flatkey 共账号,预算隔离)

## 文案纪律

- 只用官网首页当前数字:2B+ reviews / 500M+ products / 100K+ sellers / Since 2020
- 禁词:chatbot、revolutionary、unlock;不承诺 sales/ranking 结果
- Offer("limited-time free"、2,000 credits)每周一核对官网,下线当日改文案

数据源:Solvea 云端知识库(app.11agents.ai,rev.412,2026-06-04 官网爬取)+ 2026-07-12 官网实时核对。
