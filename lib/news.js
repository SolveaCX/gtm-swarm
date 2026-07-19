// 新闻板块：拉 ai-builders-digest 中央 feed（免 key）→ flatkey 加工成 快讯/关键词/产品雷达 → 按天缓存
// feed 上游：github.com/zarazhangrui/follow-builders，每天更新一次（北京时间约 15:30-16:10）
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { chat } from './flatkey.js';
import { extractJson } from './generate.js';
import { DATA_DIR, NEWS_MODEL } from '../config.js';

const REPO = 'zarazhangrui/follow-builders';
const RAW = (f) => `https://raw.githubusercontent.com/${REPO}/main/${f}`;
// GFW 兜底镜像（jsDelivr 有分钟级缓存延迟，可接受）
const MIRROR = (url) =>
  url.replace(`https://raw.githubusercontent.com/${REPO}/main/`, `https://cdn.jsdelivr.net/gh/${REPO}@main/`);
// ⚠️ raw.githubusercontent 在本机被 GFW 墙，node fetch 又不走系统代理 → 之前新闻卡死在旧缓存。
//    改用 curl 子进程：先走代理（翻墙拉主源），失败再直连（无墙环境/云端），双保险。
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:1082';

const CACHE_DIR = path.join(DATA_DIR, 'news-cache');

// curl 拉 JSON（useProxy=true 走代理，false 直连 --noproxy）
function curlJSON(url, timeoutMs, useProxy) {
  return new Promise((resolve, reject) => {
    const args = ['-sSL', '--max-time', String(Math.ceil(timeoutMs / 1000))];
    if (useProxy && PROXY) args.push('-x', PROXY); else args.push('--noproxy', '*');
    args.push(url);
    execFile('curl', args, { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs + 5000 }, (err, stdout) => {
      if (err) return reject(err);
      if (!stdout || !stdout.trim()) return reject(new Error(`空响应 ${url}`));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`JSON 解析失败 ${url}: ${e.message}`)); }
    });
  });
}
// 单个 URL：代理优先（翻墙），再直连兜底
async function fetchJSON(url, timeoutMs) {
  try { if (PROXY) return await curlJSON(url, timeoutMs, true); } catch { /* 代理失败→直连 */ }
  return curlJSON(url, timeoutMs, false);
}
async function fetchWithMirror(url, timeoutMs) {
  try {
    return await fetchJSON(url, timeoutMs);
  } catch {
    return fetchJSON(MIRROR(url), timeoutMs);
  }
}

// 先拉最轻的 feed-x（~30KB）拿 generatedAt 判断日期，命中缓存就不用碰几 MB 的播客 feed
async function fetchXFeed() {
  return fetchWithMirror(RAW('feed-x.json'), 30000);
}
async function fetchRestFeeds() {
  const settled = await Promise.allSettled([
    fetchWithMirror(RAW('feed-podcasts.json'), 120000),
    fetchWithMirror(RAW('feed-blogs.json'), 30000),
  ]);
  const [pod, blog] = settled.map((s) => (s.status === 'fulfilled' ? s.value : null));
  return {
    // 上游键名有过变体，防御性兜底
    podcasts: pod?.podcasts || pod?.episodes || [],
    blogs: blog?.blogs || blog?.posts || [],
    podcastsMissing: !pod,
  };
}

// ---------- 缓存（按 feed 日期一天一文件）----------
function cachePath(date) {
  return path.join(CACHE_DIR, `${date}.json`);
}
function readCache(date) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(date), 'utf8'));
  } catch {
    return null;
  }
}
function writeCache(date, payload) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(date), JSON.stringify(payload, null, 2));
}
function latestCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, files[files.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

// ---------- 把原始素材拼成给 LLM 的材料（控制长度）----------
function buildMaterial(x, podcasts, blogs) {
  const parts = [];
  parts.push('=== X / 推特（AI builders 最近 24h 原创推文）===');
  (x || []).forEach((b) => {
    (b.tweets || []).forEach((t) => {
      parts.push(
        `@${b.handle}（${b.name}｜bio: ${String(b.bio || '').slice(0, 100)}）：${String(t.text || '').slice(0, 600)}\n  互动：❤${t.likes} 🔁${t.retweets} 💬${t.replies}｜链接：${t.url}`
      );
    });
  });
  (podcasts || []).forEach((p) => {
    parts.push(`\n=== 播客：${p.name} · ${p.title}（链接：${p.url}）===`);
    parts.push(String(p.transcript || '').slice(0, 14000));
  });
  (blogs || []).forEach((bl) => {
    parts.push(`\n=== 博客：${bl.name} · ${bl.title}（链接：${bl.url}）===`);
    parts.push(String(bl.content || '').slice(0, 7000));
  });
  return parts.join('\n');
}

// ---------- LLM 加工：快讯 20 条 + 今日关键词 + 新产品雷达 ----------
async function buildDigest({ x, podcasts, blogs }) {
  const system = `你是一位 AI 行业新闻编辑，从给定素材中提取当日情报。铁律：
- 只用素材里明确出现的内容，绝不编造、不预测、不外推。
- 每条快讯必须带素材里给出的来源链接；没有链接的事实不收录。
- 纯事实表述，禁「震撼」「革命性」等修饰词。
- 头衔只从 bio 推断，不猜。`;
  const user = `从下面的素材提取三块内容，严格只输出 JSON（不要 markdown 代码块）：

1. flashes：AI 快讯，最多 20 条最具新闻价值的原子事实。每条一句话中文（≤35字）。排序优先级：新产品/功能发布 > 研究突破 > 融资/商业动态 > 公司战略/人事 > 独特观点。同一来源最多 3 条；不足 20 条就如实少给，不凑数。
2. keywords：今日关键词 5-8 个，按重要性降序。必须具体（产品名/公司名/概念名，禁「AI」「大模型」这类泛词），why 用 ≤20 字回答「为什么今天这个词重要」。
3. products：素材中明确宣布的 AI 新产品/重大更新。rating 只能来自素材中实际出现的用户反应，没有就写「评分待收集」；tryUrl 只能用素材里出现的 URL，没有就留空串。没有新产品就给空数组。

{"flashes":[{"text":"","url":""}],"keywords":[{"word":"","why":""}],"products":[{"name":"","by":"","rating":"","review":"","tryUrl":"","sourceUrl":""}]}

【素材】
${buildMaterial(x, podcasts, blogs)}`;

  const raw = await chat({ model: NEWS_MODEL, system, user, maxTokens: 4000 });
  const data = extractJson(raw);
  return {
    flashes: (data.flashes || [])
      .filter((f) => f && f.text && f.url)
      .slice(0, 20)
      .map((f) => ({ text: String(f.text).trim(), url: String(f.url).trim() })),
    keywords: (data.keywords || [])
      .filter((k) => k && k.word)
      .slice(0, 8)
      .map((k) => ({ word: String(k.word).trim(), why: String(k.why || '').trim() })),
    products: (data.products || [])
      .filter((p) => p && p.name)
      .map((p) => ({
        name: String(p.name).trim(),
        by: String(p.by || '').trim(),
        rating: String(p.rating || '评分待收集').trim(),
        review: String(p.review || '').trim(),
        tryUrl: String(p.tryUrl || '').trim(),
        sourceUrl: String(p.sourceUrl || '').trim(),
      })),
  };
}

// 只读缓存，绝不触发拉取/蒸馏——工作台首屏用（要快）
export function getNewsCached() {
  return latestCache();
}

// 并发请求共享同一次构建，避免重复烧 LLM
let building = null;

// 主入口：GET /api/news 用。refresh=true 强制重新加工今天这份
export async function getNews({ refresh = false } = {}) {
  // 便宜检查：feed 一天只更新一次，先用轻量 feed-x 确定这份 feed 是哪天的
  let xFeed;
  try {
    xFeed = await fetchXFeed();
  } catch (e) {
    const stale = latestCache();
    if (stale) return { ...stale, stale: true };
    throw new Error(`新闻源不可达（GitHub raw + jsDelivr 镜像都失败）：${e.message}`);
  }
  const feedDate = String(xFeed.generatedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!refresh) {
    const cached = readCache(feedDate);
    if (cached) return cached;
  }
  if (building) return building;
  building = (async () => {
    try {
      const rest = await fetchRestFeeds();
      const x = xFeed.x || [];
      const digest = await buildDigest({ x, podcasts: rest.podcasts, blogs: rest.blogs });
      const payload = {
        date: feedDate,
        generatedAt: xFeed.generatedAt,
        ...digest,
        stats: {
          xBuilders: x.length,
          totalTweets: x.reduce((s, b) => s + (b.tweets?.length || 0), 0),
          podcastEpisodes: rest.podcasts.length,
          blogPosts: rest.blogs.length,
        },
        podcastsMissing: rest.podcastsMissing,
        builtAt: new Date().toISOString(),
      };
      writeCache(feedDate, payload);
      return payload;
    } finally {
      building = null;
    }
  })();
  return building;
}
