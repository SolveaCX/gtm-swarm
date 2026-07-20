// 全站统一价格表：按「实际解析模型 id」子串匹配计价。
// ⚠️ 这些是上游公开 API 参考价（USD），flatkey 实扣以其控制台为准（通常更低）——
// UI 必须标注「API 等价估算，非实扣」。477 可在设置页逐项改，改动存 wsSettings.pricing 覆盖默认。
import { wsSettings } from './store.js';

// type:'token' → usdInPerM/usdOutPerM（每百万 token）；'image' → usdPerImage（每张）；'char' → usdPerMChars（每百万字符）
export const DEFAULT_PRICES = [
  { match: 'gpt-5.5', type: 'token', usdInPerM: 1.25, usdOutPerM: 10, note: 'OpenAI 参考价' },
  { match: 'gpt-5.4-mini', type: 'token', usdInPerM: 0.15, usdOutPerM: 0.6, note: 'OpenAI 参考价' },
  { match: 'gpt-5.4', type: 'token', usdInPerM: 1.1, usdOutPerM: 8, note: 'OpenAI 参考价' },
  { match: 'glm-5.2', type: 'token', usdInPerM: 0.6, usdOutPerM: 2.2, note: 'z.ai 参考价' },
  { match: 'glm-5.1', type: 'token', usdInPerM: 0.55, usdOutPerM: 2.0, note: 'z.ai 参考价' },
  { match: 'glm-5', type: 'token', usdInPerM: 0.6, usdOutPerM: 2.2, note: 'z.ai 参考价' },
  { match: 'claude-opus', type: 'token', usdInPerM: 15, usdOutPerM: 75, note: 'Anthropic 参考价（fk-cc 实际解析为 glm 时按 glm 计）' },
  { match: 'claude-sonnet', type: 'token', usdInPerM: 3, usdOutPerM: 15, note: 'Anthropic 参考价' },
  { match: 'claude-haiku', type: 'token', usdInPerM: 0.8, usdOutPerM: 4, note: 'Anthropic 参考价' },
  { match: 'kimi', type: 'token', usdInPerM: 0.6, usdOutPerM: 2.5, note: 'Moonshot 参考价' },
  { match: 'gpt-image-2', type: 'image', usdPerImage: 0.05, note: 'OpenAI 参考价（按张，中档尺寸）' },
  { match: 'nano-banana', type: 'image', usdPerImage: 0.035, note: 'Google 参考价（按张）' },
  { match: 'eleven', type: 'char', usdPerMChars: 150, note: 'ElevenLabs 参考价（按字符）' },
];

export const USD_CNY = 7.1;

function effectivePrices() {
  const overrides = (wsSettings.get() || {}).pricing || [];
  if (!Array.isArray(overrides) || !overrides.length) return DEFAULT_PRICES;
  // 覆盖规则：同 match 的以设置页为准，其余用默认
  const map = new Map(DEFAULT_PRICES.map((p) => [p.match, p]));
  for (const o of overrides) if (o && o.match) map.set(o.match, { ...map.get(o.match), ...o });
  return [...map.values()];
}

// 子串匹配（最长命中优先）——fk-cc 等路由别名要按「实际解析模型」传进来
export function priceFor(modelId) {
  const id = String(modelId || '').toLowerCase();
  let best = null;
  for (const p of effectivePrices()) {
    if (id.includes(p.match.toLowerCase()) && (!best || p.match.length > best.match.length)) best = p;
  }
  return best;
}

// usage: {inputTokens, outputTokens} | {images} | {chars} → CNY（找不到价回 null，绝不瞎猜）
export function costCny(modelId, usage = {}) {
  const p = priceFor(modelId);
  if (!p) return null;
  let usd = null;
  if (p.type === 'token') {
    const it = Number(usage.inputTokens || 0);
    const ot = Number(usage.outputTokens || 0);
    if (!it && !ot) return null;
    usd = (it / 1e6) * (p.usdInPerM || 0) + (ot / 1e6) * (p.usdOutPerM || 0);
  } else if (p.type === 'image') {
    const n = Number(usage.images || 0);
    if (!n) return null;
    usd = n * (p.usdPerImage || 0);
  } else if (p.type === 'char') {
    const c = Number(usage.chars || 0);
    if (!c) return null;
    usd = (c / 1e6) * (p.usdPerMChars || 0);
  }
  return usd == null ? null : Math.round(usd * USD_CNY * 10000) / 10000;
}

export function pricingTable() {
  return effectivePrices();
}
