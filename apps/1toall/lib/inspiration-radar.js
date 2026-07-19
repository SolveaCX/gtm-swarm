// 灵感雷达：Podcast + YouTube + X → 去重 → Taste 打分 → 可创作素材卡。
// 只读取标题/简介做首轮评分；用户采用后才由创作链路读取完整素材，控制成本。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { chat } from './flatkey.js';
import { extractJson } from './generate.js';
import { DATA_DIR, NEWS_MODEL } from '../config.js';
import { currentWorkspace } from './workspace-context.js';

const PODCASTS = [
  ['The AI Daily Brief', 'https://anchor.fm/s/f7cac464/podcast/rss'],
  ['Latent Space', 'https://api.substack.com/feed/podcast/1084089.rss'],
  ['No Priors', 'https://feeds.megaphone.fm/nopriors'],
  ["Lenny's Podcast", 'https://api.substack.com/feed/podcast/10845.rss'],
  ['The Cognitive Revolution', 'https://feeds.megaphone.fm/RINTP3108857801'],
  ['Lightcone / YC', 'https://anchor.fm/s/f58d3330/podcast/rss'],
];

const YOUTUBE = [
  ['Y Combinator', 'UCxIJaCMEptJjxmmQgGFsnCg'],
  ['a16z', 'UCQ1VQj-37kl2yS_VUhfQHsw'],
];

const X_FEED = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
const CACHE_TTL = 6 * 60 * 60 * 1000;

function cachePath() {
  return path.join(DATA_DIR, 'workspaces', currentWorkspace(), 'inspiration-cache.json');
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(cachePath(), 'utf8')); } catch { return null; }
}

function writeCache(data) {
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  fs.writeFileSync(cachePath(), JSON.stringify(data, null, 2));
}

function curl(url, timeout = 20) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-fsSL', '--max-time', String(timeout), url], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) reject(err); else resolve(out);
    });
  });
}

function decode(s = '') {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return decode(m?.[1] || '');
}

function atomLink(block) {
  const m = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return decode(m?.[1] || tag(block, 'link'));
}

function parseFeed(xml, source, sourceName) {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return blocks.slice(0, 5).map((b) => ({
    source, sourceName,
    title: tag(b, 'title'),
    summary: tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'),
    url: atomLink(b),
    publishedAt: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated'),
  })).filter((x) => x.title && x.url);
}

async function collectRss() {
  const sources = [
    ...PODCASTS.map(([name, url]) => ({ type: 'podcast', name, url })),
    ...YOUTUBE.map(([name, id]) => ({ type: 'youtube', name, url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}` })),
  ];
  const settled = await Promise.allSettled(sources.map(async (s) => parseFeed(await curl(s.url), s.type, s.name)));
  return settled.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
}

async function collectX() {
  try {
    const data = JSON.parse(await curl(X_FEED, 30));
    return (data.x || []).flatMap((builder) => (builder.tweets || []).slice(0, 3).map((t) => ({
      source: 'x', sourceName: `@${builder.handle}`, title: decode(t.text).slice(0, 220),
      summary: `${builder.name || ''} · ${builder.bio || ''}`.slice(0, 300), url: t.url,
      publishedAt: t.createdAt || data.generatedAt || '', engagement: Number(t.likes || 0) + Number(t.retweets || 0) * 2,
    })));
  } catch { return []; }
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.url || item.title).toLowerCase().replace(/[?#].*$/, '').replace(/\W/g, '').slice(0, 180);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function fallbackScore(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const strong = ['agent', 'ai-native', 'one person', 'organization', 'distribution', 'coding', 'workflow', 'gtm', 'model'];
  const weak = ['benchmark', 'roundup', 'rumor'];
  return Math.max(20, Math.min(92, 48 + strong.filter((x) => text.includes(x)).length * 8 - weak.filter((x) => text.includes(x)).length * 5));
}

async function score(items) {
  const candidates = items.slice(0, 70);
  const compact = candidates.map((x, i) => ({ i, source: x.source, title: x.title, summary: x.summary.slice(0, 260), engagement: x.engagement || 0 }));
  const system = `你是 Hunter 的内容总编。只根据标题和简介做 Taste 初筛，不补充事实。高分信号：AI-native 组织、一人公司、Agent 作为劳动力或分发渠道、技能/结果责任、GTM 工程化、反炒作的真实 build 与决策。低分信号：纯跑分、泛新闻汇总、标题党、纯学术、重复话题。`;
  const user = `为每条素材打 0-100 分，并给出可解释的创作切口。总分由 relevance(35)、novelty(25)、evidence(20)、story(20) 相加。严格输出 JSON：{"cards":[{"i":0,"score":80,"relevance":30,"novelty":20,"evidence":15,"story":15,"reason":"为什么值得","angle":"Hunter 应该从什么反常识角度写","signals":["AI-native组织"]}]}。素材：${JSON.stringify(compact)}`;
  let mapped = new Map();
  try {
    const parsed = extractJson(await chat({ model: NEWS_MODEL, system, user, maxTokens: 7000 }));
    mapped = new Map((parsed.cards || []).map((x) => [Number(x.i), x]));
  } catch { /* 降级到规则分，采集仍可用 */ }
  return candidates.map((item, i) => {
    const s = mapped.get(i) || {};
    const scoreValue = Math.max(0, Math.min(100, Number(s.score) || fallbackScore(item)));
    return { id: `idea_${Buffer.from(item.url).toString('base64url').slice(0, 18)}`, ...item, score: scoreValue,
      dimensions: { relevance: Number(s.relevance) || null, novelty: Number(s.novelty) || null, evidence: Number(s.evidence) || null, story: Number(s.story) || null },
      reason: String(s.reason || '符合当前 AI 与 Agent 内容方向'), angle: String(s.angle || '从真实使用与组织变化切入'), signals: Array.isArray(s.signals) ? s.signals.slice(0, 4) : [],
      tier: scoreValue >= 85 ? 'must' : scoreValue >= 70 ? 'strong' : scoreValue >= 50 ? 'watch' : 'skip' };
  }).sort((a, b) => b.score - a.score);
}

export function getInspirationCached() { return readCache(); }

let building = null;
export async function getInspiration({ refresh = false } = {}) {
  const cached = readCache();
  if (!refresh && cached && Date.now() - new Date(cached.builtAt).getTime() < CACHE_TTL) return cached;
  if (building) return building;
  building = (async () => {
    try {
      const [rss, x] = await Promise.all([collectRss(), collectX()]);
      const cards = await score(dedupe([...rss, ...x]));
      const payload = { builtAt: new Date().toISOString(), cards, stats: {
        total: cards.length, podcast: cards.filter((x) => x.source === 'podcast').length,
        youtube: cards.filter((x) => x.source === 'youtube').length, x: cards.filter((x) => x.source === 'x').length,
        must: cards.filter((x) => x.tier === 'must').length, strong: cards.filter((x) => x.tier === 'strong').length,
      } };
      writeCache(payload); return payload;
    } finally { building = null; }
  })();
  return building;
}
