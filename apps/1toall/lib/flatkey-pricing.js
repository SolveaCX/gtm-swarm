// flatkey 实价：直接问 flatkey 后台（/api/pricing，带自己的 key），不再抄官网页。
// 为什么：官网页只公示 6 个模型，且和后台扣费价有出入（gpt-5.5 页面 $3.33 vs 后台 $3.00）——
// 后台的 ratio 才是扣费引擎真用的数。477 2026-07-21 拍板以后台为准。
//
// new-api 计价规则：
//   input  $/M = model_ratio × 2 × 组折扣
//   output $/M = input × completion_ratio
//   cache  $/M = input × cache_ratio
// 组折扣按「该模型可用组里最便宜的一档」取（key 是 auto 分组，网关会挑能用的便宜组）；
// 具体用了哪个组每次请求可能不同，这里取最优是下限口径，账本注明。
import { getApiKey } from './flatkey.js';

const PRICING_URL = 'https://router.flatkey.ai/api/pricing';
const REFRESH_MS = 6 * 3600e3; // 6 小时刷一次，价目不常动

let cache = { at: 0, byModel: new Map(), version: null };
let inflight = null;

async function fetchTable() {
  const res = await fetch(PRICING_URL, {
    headers: getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`flatkey pricing HTTP ${res.status}`);
  const data = await res.json();
  const groupRatio = data.group_ratio || {};
  const byModel = new Map();
  for (const m of data.data || []) {
    if (m.quota_type !== 0) continue; // 按次计价的（quota_type=1）不参与 token 折算
    const ratios = (m.enable_groups || []).map((g) => groupRatio[g]).filter((x) => Number.isFinite(x));
    const best = ratios.length ? Math.min(...ratios) : 1;
    const inUsd = Number(m.model_ratio || 0) * 2 * best;
    if (!inUsd) continue;
    byModel.set(String(m.model_name).toLowerCase(), {
      usdInPerM: inUsd,
      usdOutPerM: inUsd * Number(m.completion_ratio || 1),
      usdCacheReadPerM: m.cache_ratio != null ? inUsd * Number(m.cache_ratio) : null,
      group: best,
    });
  }
  cache = { at: Date.now(), byModel, version: data.pricing_version || null };
  return cache;
}

/** 后台价查询（同步）：命中返回 {usdInPerM,usdOutPerM,usdCacheReadPerM}，没同步到或没这个模型返回 null。 */
export function flatkeyPriceFor(modelId) {
  maybeRefresh();
  if (!cache.byModel.size) return null;
  const id = String(modelId || '').toLowerCase();
  if (cache.byModel.has(id)) return cache.byModel.get(id);
  // 子串匹配兜底（fk-cc 这类路由别名解析后的名字带日期后缀等）
  let best = null;
  for (const [name, p] of cache.byModel) {
    if (id.includes(name) && (!best || name.length > best[0].length)) best = [name, p];
  }
  return best ? best[1] : null;
}

export function flatkeyPricingState() {
  return { syncedAt: cache.at ? new Date(cache.at).toISOString() : null, models: cache.byModel.size, version: cache.version };
}

function maybeRefresh() {
  if (Date.now() - cache.at < REFRESH_MS || inflight) return;
  inflight = fetchTable()
    .catch((e) => { console.log('[flatkey-pricing] 同步失败（用上次的缓存）:', e.message); })
    .finally(() => { inflight = null; });
}

// 起服务就先拉一次，别等第一笔账
maybeRefresh();
