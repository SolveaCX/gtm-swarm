// 发布前曝光预测：账号基础(0-40) + 内容力(0-40) + 账号势能(0-20)，纯公式可解释可调。
// 账号侧数据来自 acctStats（粉丝/近30天）与 pool 已发布条目的真实播放；内容侧三特征由质检同一次 LLM 顺带产出。
import { acctStats, pool } from './store.js';

// 冷启动先验：账号完全无数据时按平台常量估基线播放（可按实际观察调）
const COLD_BASELINE = { 抖音: 500, 小红书: 200, 视频号: 300, tiktok: 400, youtube: 150, b站: 300, 公众号: 100, x: 100, default: 200 };

const norm = (p) => String(p || '').toLowerCase().replace(/bilibili|哔哩哔哩/, 'b站').replace(/tiktok|tk/, 'tiktok');

// 找账号：先 acctStats（名称+平台弱匹配 brandName），再 pool 已发布条目中位播放
function accountBaseline(brandName, platform) {
  const plat = norm(platform);
  const stat = acctStats.all().find((r) => norm(r.platform) === plat) || null;
  const published = pool.all().filter((e) => norm(e.platform) === plat && e.status === 'published' && e.stats?.views != null);
  const views = published.map((e) => Number(e.stats.views)).sort((a, b) => a - b);
  const median = views.length ? views[Math.floor(views.length / 2)] : null;
  return { stat, medianViews: median, publishedCount: views.length };
}

// features: {hook:0-10, heat:0-10, fit:0-10}（质检 LLM 产出）
export function predictExposure({ brandName, platform, features = {} }) {
  const { stat, medianViews, publishedCount } = accountBaseline(brandName, platform);
  const hook = Math.max(0, Math.min(10, Number(features.hook) || 0));
  const heat = Math.max(0, Math.min(10, Number(features.heat) || 0));
  const fit = Math.max(0, Math.min(10, Number(features.fit) || 0));

  let base; let confidence; let baseViews;
  if (medianViews != null && publishedCount >= 5) {
    baseViews = medianViews; confidence = 'high';
  } else if (medianViews != null || stat) {
    baseViews = medianViews ?? (stat?.views30 && stat?.posts30 ? Math.max(50, stat.views30 / Math.max(1, stat.posts30)) : COLD_BASELINE[norm(platform)] || COLD_BASELINE.default);
    confidence = 'mid';
  } else {
    baseViews = COLD_BASELINE[norm(platform)] || COLD_BASELINE.default;
    confidence = 'low';
  }
  base = Math.min(40, Math.max(0, (Math.log10(baseViews + 1) / 5) * 40)); // log10(1e5)=5 → 满分

  // 冷启动时内容力权重放大（内容是唯一可控变量）
  const contentMax = confidence === 'low' ? 55 : 40;
  const content = Math.min(contentMax, (hook * 2 + heat + fit) * (contentMax / 40));

  let momentum = 0;
  if (stat) {
    const netRate = stat.fans ? Math.max(0, Number(stat.net30 || 0)) / Math.max(1, Number(stat.fans)) : 0;
    momentum += Math.min(8, netRate * 400);
    momentum += Math.min(6, Number(stat.posts30 || 0) / 5);
    if (stat.lastPost) {
      const days = (Date.now() - new Date(stat.lastPost).getTime()) / 86400000;
      momentum += Math.max(0, 6 - Math.min(6, days / 3)); // 越近越满
    }
  }
  momentum = Math.min(20, momentum);

  const score = Math.round(Math.min(100, base + content + momentum));
  const spread = Math.max(0.4, 2.5 - (hook + heat + fit) / 30 * 2); // 内容越强区间越窄且上探
  const lo = Math.round(baseViews * 0.5);
  const hi = Math.round(baseViews * (1 + (hook + heat + fit) / 30 * 1.5 + 0.5));
  return {
    score, confidence,
    range: [lo, hi],
    factors: { account: Math.round(base), content: Math.round(content), momentum: Math.round(momentum) },
    features: { hook, heat, fit },
    baseViews: Math.round(baseViews),
    weakest: base <= content && base <= momentum ? 'account' : content <= momentum ? 'content' : 'momentum',
  };
}
