// 全站统一价格表：按「实际解析模型 id」子串匹配计价。
// ⚠️ 这些是上游公开 API 参考价（USD），flatkey 实扣以其控制台为准（通常更低）——
// UI 必须标注「API 等价估算，非实扣」。477 可在设置页逐项改，改动存 wsSettings.pricing 覆盖默认。
import { wsSettings } from './store.js';
import { flatkeyPriceFor } from './flatkey-pricing.js';

// type:'token' → usdInPerM/usdOutPerM（每百万 token）+ usdCacheReadPerM/usdCacheWritePerM（命中/写入缓存）。
// fkFactor = flatkey 实价 ÷ 官方价（flatkey.ai/models 2026-07-21 公示，只标了的模型才有；
// 官网公示的是输入价，输出/缓存按同折扣系数推）。没公示的模型不猜——flatkey 价按官方算，省 0。'image' → usdPerImage（每张）；'char' → usdPerMChars（每百万字符）
// 全部照厂商官方价目页填（2026-07-21 核对，来源见每行 note）。子串匹配、最长命中优先，
// 所以 gpt-5.6-sol 要排在 gpt-5.6 前面这类顺序问题由 priceFor 的「最长优先」兜住，不靠数组顺序。
export const DEFAULT_PRICES = [
  // OpenAI — developers.openai.com/api/docs/pricing
  { match: 'gpt-5.6-sol', type: 'token', usdInPerM: 5, usdOutPerM: 30, usdCacheReadPerM: 0.5, usdCacheWritePerM: 5, fkFactor: 0.666, note: 'OpenAI 官方价' },
  { match: 'gpt-5.6-terra', type: 'token', usdInPerM: 2.5, usdOutPerM: 15, usdCacheReadPerM: 0.25, usdCacheWritePerM: 2.5, note: 'OpenAI 官方价' },
  { match: 'gpt-5.6-luna', type: 'token', usdInPerM: 1, usdOutPerM: 6, usdCacheReadPerM: 0.1, usdCacheWritePerM: 1, note: 'OpenAI 官方价' },
  { match: 'gpt-5.5-pro', type: 'token', usdInPerM: 30, usdOutPerM: 180, usdCacheReadPerM: 3, usdCacheWritePerM: 30, note: 'OpenAI 官方价' },
  { match: 'gpt-5.5', type: 'token', usdInPerM: 5, usdOutPerM: 30, usdCacheReadPerM: 0.5, usdCacheWritePerM: 5, fkFactor: 0.666, note: 'OpenAI 官方价' },
  { match: 'gpt-5.4-pro', type: 'token', usdInPerM: 30, usdOutPerM: 180, usdCacheReadPerM: 3, usdCacheWritePerM: 30, note: 'OpenAI 官方价' },
  { match: 'gpt-5.4-mini', type: 'token', usdInPerM: 0.75, usdOutPerM: 4.5, usdCacheReadPerM: 0.075, usdCacheWritePerM: 0.75, fkFactor: 0.667, note: 'OpenAI 官方价' },
  { match: 'gpt-5.4-nano', type: 'token', usdInPerM: 0.2, usdOutPerM: 1.25, usdCacheReadPerM: 0.02, usdCacheWritePerM: 0.2, note: 'OpenAI 官方价' },
  { match: 'gpt-5.4', type: 'token', usdInPerM: 2.5, usdOutPerM: 15, usdCacheReadPerM: 0.25, usdCacheWritePerM: 2.5, fkFactor: 0.668, note: 'OpenAI 官方价' },
  // z.ai（GLM）— docs.z.ai/guides/overview/pricing
  { match: 'glm-5.2', type: 'token', usdInPerM: 1.4, usdOutPerM: 4.4, usdCacheReadPerM: 0.26, usdCacheWritePerM: 1.4, fkFactor: 0.4, note: 'z.ai 官方价' },
  { match: 'glm-5.1', type: 'token', usdInPerM: 1.4, usdOutPerM: 4.4, usdCacheReadPerM: 0.26, usdCacheWritePerM: 1.4, note: 'z.ai 官方价' },
  { match: 'glm-5', type: 'token', usdInPerM: 1, usdOutPerM: 3.2, usdCacheReadPerM: 0.2, usdCacheWritePerM: 1, note: 'z.ai 官方价' },
  { match: 'glm-4.7', type: 'token', usdInPerM: 0.6, usdOutPerM: 2.2, usdCacheReadPerM: 0.11, usdCacheWritePerM: 0.6, note: 'z.ai 官方价' },
  // Anthropic — platform.claude.com/docs/en/docs/about-claude/pricing
  { match: 'claude-fable', type: 'token', usdInPerM: 10, usdOutPerM: 50, usdCacheReadPerM: 1, usdCacheWritePerM: 12.5, note: 'Anthropic 官方价' },
  { match: 'claude-opus-4-8', type: 'token', usdInPerM: 5, usdOutPerM: 25, usdCacheReadPerM: 0.5, usdCacheWritePerM: 6.25, fkFactor: 0.666, note: 'Anthropic 官方价（fk-cc 实际解析为 glm 时按 glm 计）' },
  { match: 'claude-opus-4-7', type: 'token', usdInPerM: 5, usdOutPerM: 25, usdCacheReadPerM: 0.5, usdCacheWritePerM: 6.25, note: 'Anthropic 官方价' },
  { match: 'claude-opus', type: 'token', usdInPerM: 5, usdOutPerM: 25, usdCacheReadPerM: 0.5, usdCacheWritePerM: 6.25, note: 'Anthropic 官方价（4.5–4.8 同价；4.1 及更早为 15/75）' },
  { match: 'claude-sonnet-5', type: 'token', usdInPerM: 2, usdOutPerM: 10, usdCacheReadPerM: 0.2, usdCacheWritePerM: 2.5, note: 'Anthropic 官方价（introductory，2026-08-31 后转 3/15）' },
  { match: 'claude-sonnet', type: 'token', usdInPerM: 3, usdOutPerM: 15, usdCacheReadPerM: 0.3, usdCacheWritePerM: 3.75, note: 'Anthropic 官方价' },
  { match: 'claude-haiku', type: 'token', usdInPerM: 1, usdOutPerM: 5, usdCacheReadPerM: 0.1, usdCacheWritePerM: 1.25, note: 'Anthropic 官方价（Haiku 4.5）' },
  // Moonshot / Kimi — platform.kimi.ai/docs/pricing/chat-k3
  { match: 'kimi-k3', type: 'token', usdInPerM: 3, usdOutPerM: 15, usdCacheReadPerM: 0.3, usdCacheWritePerM: 3, note: 'Moonshot 官方价（cache miss；命中缓存 $0.3）' },
  { match: 'kimi', type: 'token', usdInPerM: 3, usdOutPerM: 15, usdCacheReadPerM: 0.3, usdCacheWritePerM: 3, note: 'Moonshot 官方价' },
  // 出图 — 按张记，取官方「每张」口径或按中档尺寸的 token 成本折算
  { match: 'gpt-image-2', type: 'image', usdPerImage: 0.048, note: 'OpenAI 官方价折算（输出 $30/M image token，中档约 1600 token/张）' },
  { match: 'nano-banana-pro', type: 'image', usdPerImage: 0.134, note: 'Google 官方价（Gemini 3 Pro Image，1K/2K 每张）' },
  { match: 'nano-banana', type: 'image', usdPerImage: 0.039, note: 'Google 官方价（Gemini 2.5 Flash Image，每张）' },
  // 配音 — elevenlabs.io/pricing/api
  { match: 'eleven_multilingual', type: 'char', usdPerMChars: 100, note: 'ElevenLabs 官方价（Multilingual v2/v3，$0.1/千字符）' },
  { match: 'eleven_flash', type: 'char', usdPerMChars: 50, note: 'ElevenLabs 官方价（Flash/Turbo，$0.05/千字符）' },
  { match: 'eleven', type: 'char', usdPerMChars: 100, note: 'ElevenLabs 官方价（默认按 Multilingual 计）' },
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

// usage: {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens} | {images} | {chars}
// → CNY（找不到价回 null，绝不瞎猜）。缓存命中比普通输入便宜一大截，有就按缓存价算。
export function costCny(modelId, usage = {}) {
  const p = priceFor(modelId);
  if (!p) return null;
  let usd = null;
  if (p.type === 'token') {
    const it = Number(usage.inputTokens || 0);
    const ot = Number(usage.outputTokens || 0);
    const cr = Number(usage.cacheReadInputTokens || 0);
    const cw = Number(usage.cacheCreationInputTokens || 0);
    if (!it && !ot && !cr && !cw) return null;
    usd = (it / 1e6) * (p.usdInPerM || 0)
      + (ot / 1e6) * (p.usdOutPerM || 0)
      + (cr / 1e6) * (p.usdCacheReadPerM ?? p.usdInPerM ?? 0)
      + (cw / 1e6) * (p.usdCacheWritePerM ?? p.usdInPerM ?? 0);
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

// 双轨：同一份用量按官方价和 flatkey 实价各算一遍。
// flatkey 价的取数顺序：① 后台 /api/pricing 实价（含分组折扣，6 小时同步一次）
// ② 后台没同步到 → 官网公示的 fkFactor ③ 都没有 → 两边同价（省 0），绝不虚报优惠。
export function costCnyDual(modelId, usage = {}) {
  const official = costCny(modelId, usage);
  if (official == null) return { official: null, flatkey: null, saved: null };
  const p = priceFor(modelId);
  let flatkey = official;
  const fk = p?.type === 'token' ? flatkeyPriceFor(modelId) : null;
  if (fk) {
    const it = Number(usage.inputTokens || 0);
    const ot = Number(usage.outputTokens || 0);
    const cr = Number(usage.cacheReadInputTokens || 0);
    const cw = Number(usage.cacheCreationInputTokens || 0);
    const usd = (it / 1e6) * fk.usdInPerM
      + (ot / 1e6) * fk.usdOutPerM
      + (cr / 1e6) * (fk.usdCacheReadPerM ?? fk.usdInPerM)
      + (cw / 1e6) * fk.usdInPerM; // 后台没单列缓存写入价，按 input 计
    flatkey = Math.round(usd * USD_CNY * 10000) / 10000;
  } else if (p?.fkFactor) {
    flatkey = Math.round(official * p.fkFactor * 10000) / 10000;
  }
  // 网关不可能倒贴：后台价偶尔配得比官方还高（或官方价表滞后），优惠只报正数
  const saved = Math.max(0, Math.round((official - flatkey) * 10000) / 10000);
  return { official, flatkey: Math.min(flatkey, official), saved };
}
