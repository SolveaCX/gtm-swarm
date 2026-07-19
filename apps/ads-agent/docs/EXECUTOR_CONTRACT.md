# Keyword War Room — 本地执行器契约（sync + write-back）

云端只读 DB、只排队意图；Google Ads 凭证永远只在本地执行器（与 050 的 campaign 契约同一条管线）。

## 1. Sync（新增两个快照，与 ad_campaigns 同节奏）

### ad_keywords ← GAQL keyword_view（近 30 天）

```sql
SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
       ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
       ad_group_criterion.keyword.match_type, ad_group_criterion.status,
       metrics.cost_micros, metrics.clicks, metrics.impressions,
       metrics.conversions, metrics.conversions_value, metrics.average_cpc
FROM keyword_view
WHERE segments.date DURING LAST_30_DAYS
```

Upsert 键：`(workspace_id, channel, external_id)`，`external_id` = criterion_id。
换算：`cost = cost_micros / 1e6`；`roas = conv_value / cost`（cost>0）；`status` 映射为 `enabled|paused|removed`（小写）；写 `synced_at`。

### ad_search_terms ← GAQL search_term_view（近 30 天）

```sql
SELECT campaign.id, campaign.name, ad_group.id,
       search_term_view.search_term, search_term_view.status,
       segments.keyword.info.text, segments.keyword.info.match_type,
       metrics.cost_micros, metrics.clicks, metrics.impressions,
       metrics.conversions, metrics.conversions_value
FROM search_term_view
WHERE segments.date DURING LAST_30_DAYS
```

Upsert 键：`(workspace_id, channel, campaign_external_id, term)`。
`matched_keyword` = segments.keyword.info.text；`is_negative` = 该词已被否词排除（status=EXCLUDED）；`is_keyword` = status=ADDED。

## 2. Write-back（ad_actions 新 kind='keyword'，op 四种）

执行器按现有队列索引认领 `execution_status='queued'`，`params.entity='keyword'`：

| op | params | 平台动作 |
|---|---|---|
| `add_negative` | `text`, `campaign_external_id` | campaign 级否定关键词（EXACT） |
| `add_keyword` | `text`, `match_type:'EXACT'`, `ad_group_external_id` | ad group 加精确匹配关键词 |
| `pause_keyword` | `keyword_external_id`, `ad_group_external_id` | 暂停该 criterion |
| `bid_adjust` | `keyword_external_id`, `pct`（-25 / +20） | CPC 出价按百分比调整 |

结果写回 `execution_result {before, after, error, dry_run}` + `execution_status (executed|failed|dry_run)` + `executed_at`。默认 dry-run，armed 后才真改——与 campaign op 完全一致。

**执行器需遵守的护栏（server 已在入队时写入 params，执行器必须读取）：**
- `params.max_daily_budget`（campaign `budget_up` op）：日预算硬上限。执行器设置新预算时必须 `min(current × 1.3, max_daily_budget)` 封顶；该字段存在即为硬约束。未设 cap 时字段缺省。
- 入队侧已保证：同一 `(workspace, op, campaign/keyword external_id)` 同时最多一条 `queued/executing`（防相对调整复利叠加）；`external_id` 必属于该 workspace 的已同步实体；只有 `mode∈{approved,auto}` 才会 `queued`（`pending` 记为 `skipped`）。

## 3. 服务端阈值（server/ads-agent.js）

- 否词提案门槛：0 转化且花费 ≥ $10（`NEGATIVE_COST_FLOOR`）
- 关键词 pause 线：ROAS < 0.35；bid_down：< 目标 ROAS；bid_up：≥ 目标且有转化
- 全部确定性规则，无 LLM 调用；提案带 confidence（high/medium）供 UI 展示
