// 灵感雷达：Podcast + YouTube + X + 官方/个人博客 + 科技媒体 → 去重 → Taste 打分 → 可创作素材卡。
// 只读取标题/简介做首轮评分；用户采用后才由创作链路读取完整素材，控制成本。
// 卡片契约：title + summary(内容) + author + authorBio(一句话介绍) + publishedAt(ISO)
//          + score + reason/dimensions(打分依据，UI 悬停展示) + angle(建议切口) + signals(关键词)
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { chat } from './flatkey.js';
import { extractJson } from './generate.js';
import { DATA_DIR, NEWS_MODEL } from '../config.js';
import { currentWorkspace } from './workspace-context.js';

// 源注册表：[名称, 地址, 作者, 作者一句话介绍]。作者介绍手写在这（确定、零成本、不编造）。
const PODCASTS = [
  ['The AI Daily Brief', 'https://anchor.fm/s/f7cac464/podcast/rss', 'Nathaniel Whittemore', 'AI 日报播客主理人，日更追踪 AI 商业动向'],
  ['Latent Space', 'https://api.substack.com/feed/podcast/1084089.rss', 'swyx & Alessio', 'AI 工程师社区 Latent Space 主理人，「AI Engineer」概念提出者'],
  ['No Priors', 'https://feeds.megaphone.fm/nopriors', 'Sarah Guo & Elad Gil', '顶级风投＋连续创业者，对谈一线 AI 创始人'],
  ["Lenny's Podcast", 'https://api.substack.com/feed/podcast/10845.rss', 'Lenny Rachitsky', '前 Airbnb 增长负责人，全球最大产品/增长 newsletter 主理人'],
  ['The Cognitive Revolution', 'https://feeds.megaphone.fm/RINTP3108857801', 'Nathan Labenz', 'Waymark 创始人，深访 AI 变革一线玩家'],
  ['Lightcone / YC', 'https://anchor.fm/s/f58d3330/podcast/rss', 'YC 合伙人团', 'Y Combinator 合伙人闲谈，硅谷早期创业风向标'],
  ['Dwarkesh Podcast', 'https://api.substack.com/feed/podcast/69345.rss', 'Dwarkesh Patel', '硬核长访谈播客，Karpathy/Sutskever 级嘉宾常客'],
  ['How I AI', 'https://anchor.fm/s/1035b1568/podcast/rss', 'Claire Vo', '每期一个真实的人实操展示自己怎么用 AI 干活'],
  ['Training Data', 'https://feeds.megaphone.fm/trainingdata', 'Sequoia 合伙人', '红杉资本访一线 AI 创始人，公司怎么建的案例密度最高'],
  ['BG2', 'https://anchor.fm/s/f06c2370/podcast/rss', 'Bill Gurley & Brad Gerstner', '两位顶级投资人双周宏观对谈，资本视角看 AI'],
  ['All-In', 'https://rss.libsyn.com/shows/254861/destinations/1928300.xml', 'Chamath/Jason/Sacks/Friedberg', '硅谷四大佬周谈，话题度最高的观点源'],
  ['20VC', 'https://rss.libsyn.com/shows/61840/destinations/240976.xml', 'Harry Stebbings', '日更创投访谈，AI 创始人密集'],
];

const YOUTUBE = [
  ['Y Combinator', 'UCxIJaCMEptJjxmmQgGFsnCg', 'Y Combinator', '全球最强创业加速器官方频道'],
  ['a16z', 'UCQ1VQj-37kl2yS_VUhfQHsw', 'a16z', '硅谷顶级风投 Andreessen Horowitz 官方频道'],
  ['OpenAI', 'UCXZCJLdBC09xxGZ6gcdrc6A', 'OpenAI 官方', 'GPT/Codex/Sora 发布会与 Demo 第一现场'],
  ['Anthropic', 'UCrDwWp7EBBv4NwvScIpBDOA', 'Anthropic 官方', 'Claude 生态官方频道'],
  ['AI Explained', 'UCNJ1Ymd5yFuUPtn21xtRbbw', 'Philip（AI Explained）', '全网最克制的模型深度解读，反炒作'],
  ['Fireship', 'UCsBjURrPoezykLs9EqgamOA', 'Jeff Delaney', '开发者热点风向标，「什么火了」最快信号'],
  ['Lex Fridman', 'UCSHZKyawb77ixDdsGog4iWA', 'Lex Fridman', '大佬长访谈（Karpathy/Altman 级），一期拆多条选题'],
];

// 官方与个人博客（type=blog）
const BLOGS = [
  ['OpenAI News', 'https://openai.com/news/rss.xml', 'OpenAI 官方', '新模型/新产品第一手官方发布'],
  ['Hugging Face Blog', 'https://huggingface.co/blog/feed.xml', 'HF 团队与社区', '开源 AI 大本营的技术与生态博客'],
  ['Google DeepMind', 'https://deepmind.google/blog/rss.xml', 'DeepMind 团队', 'Google 顶级 AI 实验室官方博客'],
  ['Simon Willison', 'https://simonwillison.net/atom/everything/', 'Simon Willison', 'Django 联合创造者，AI 工具实测最勤快的独立开发者'],
  ['Google AI Blog', 'https://blog.google/technology/ai/rss/', 'Google 官方', 'Gemini 与 Google AI 产品线官方发布'],
];

// 科技媒体/社区（type=media）
const MEDIA = [
  ['Hacker News · AI', 'https://hnrss.org/newest?q=AI+OR+LLM+OR+agent&points=100', 'HN 社区', '黑客社区 100 分以上高热 AI 帖'],
  ['TechCrunch AI', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'TechCrunch 编辑部', '硅谷科技媒体 AI 频道，融资与产品动向'],
  ['The Verge AI', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'The Verge 编辑部', '主流科技媒体 AI 版块，产品视角'],
];

const X_FEED = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const FRESH_WINDOW_DAYS = 14;   // 采集窗口：超过 14 天的素材直接不进池（新闻会过期）
const PER_SOURCE = 5;
const SCORE_CAP = 120;          // 单轮送评上限（控 token）
const SCORE_CHUNK = 40;         // 分块送评：一锅太大输出会截断 → 整批解析失败全体降级

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

// 各种 RSS 日期（RFC822/ISO）→ ISO；解析失败给空串（UI 显示为「时间未知」）
function toIso(raw) {
  const d = new Date(String(raw || '').trim());
  return isNaN(d) ? '' : d.toISOString();
}

function isFresh(iso) {
  if (!iso) return true; // 没日期的不粗暴丢弃，交给打分与 UI 标注
  return Date.now() - new Date(iso).getTime() <= FRESH_WINDOW_DAYS * 86400000;
}

function parseFeed(xml, source, sourceName, author, authorBio) {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  return blocks.slice(0, PER_SOURCE * 2).map((b) => ({
    source, sourceName, author, authorBio,
    title: tag(b, 'title'),
    summary: tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'),
    url: atomLink(b),
    publishedAt: toIso(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated')),
  })).filter((x) => x.title && x.url && isFresh(x.publishedAt)).slice(0, PER_SOURCE);
}

async function collectRss() {
  const sources = [
    ...PODCASTS.map(([name, url, author, bio]) => ({ type: 'podcast', name, url, author, bio })),
    ...YOUTUBE.map(([name, id, author, bio]) => ({ type: 'youtube', name, url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, author, bio })),
    ...BLOGS.map(([name, url, author, bio]) => ({ type: 'blog', name, url, author, bio })),
    ...MEDIA.map(([name, url, author, bio]) => ({ type: 'media', name, url, author, bio })),
  ];
  const settled = await Promise.allSettled(sources.map(async (s) => parseFeed(await curl(s.url), s.type, s.name, s.author, s.bio)));
  return settled.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
}

async function collectX() {
  try {
    const data = JSON.parse(await curl(X_FEED, 30));
    return (data.x || []).flatMap((builder) => (builder.tweets || []).slice(0, 3).map((t) => ({
      source: 'x', sourceName: `@${builder.handle}`,
      author: builder.name || `@${builder.handle}`,
      authorBio: String(builder.bio || '').slice(0, 120),
      title: decode(t.text).slice(0, 220),
      summary: decode(t.text),
      url: t.url,
      publishedAt: toIso(t.createdAt || data.generatedAt || ''),
      engagement: Number(t.likes || 0) + Number(t.retweets || 0) * 2,
    }))).filter((x) => isFresh(x.publishedAt));
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
  // 新的优先送评：同分辨率下先保新素材
  const candidates = [...items].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)).slice(0, SCORE_CAP);
  const compact = candidates.map((x, i) => ({ i, source: x.source, author: x.author, title: x.title, summary: x.summary.slice(0, 260), publishedAt: (x.publishedAt || '').slice(0, 10), engagement: x.engagement || 0 }));
  const system = `你是 Hunter 的内容总编。只根据标题和简介做 Taste 初筛，不补充事实。高分信号：AI-native 组织、一人公司、Agent 作为劳动力或分发渠道、技能/结果责任、GTM 工程化、反炒作的真实 build 与决策。低分信号：纯跑分、泛新闻汇总、标题党、纯学术、重复话题、过时旧闻。`;
  const userFor = (chunk) => `为每条素材打 0-100 分。总分由 relevance(35)、novelty(25)、evidence(20)、story(20) 相加。zhSummary 用中文一两句讲清这条素材「谁+说了/做了什么+为什么值得看」（当卡片标题用，别翻译腔）。reason 必须写成可解释的打分依据（两句：第一句为什么值得/不值得写，第二句点名最强或最弱的维度及原因）。严格输出 JSON：{"cards":[{"i":0,"score":80,"relevance":30,"novelty":20,"evidence":15,"story":15,"zhSummary":"…","reason":"…","angle":"Hunter 应该从什么反常识角度写","signals":["AI-native组织"]}]}。素材：${JSON.stringify(chunk)}`;
  // 分块并行送评：i 用全局下标，块内解析失败只影响该块（降级规则分），不拖全体
  const chunks = [];
  for (let at = 0; at < compact.length; at += SCORE_CHUNK) chunks.push(compact.slice(at, at + SCORE_CHUNK));
  const mapped = new Map();
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const parsed = extractJson(await chat({ model: NEWS_MODEL, system, user: userFor(chunk), maxTokens: 8000 }));
      for (const x of parsed.cards || []) mapped.set(Number(x.i), x);
    } catch { /* 该块降级到规则分，采集仍可用 */ }
  }));
  return candidates.map((item, i) => {
    const s = mapped.get(i) || {};
    const scoreValue = Math.max(0, Math.min(100, Number(s.score) || fallbackScore(item)));
    return { id: `idea_${Buffer.from(item.url).toString('base64url').slice(0, 18)}`, ...item, score: scoreValue,
      dimensions: { relevance: Number(s.relevance) || null, novelty: Number(s.novelty) || null, evidence: Number(s.evidence) || null, story: Number(s.story) || null },
      zhSummary: String(s.zhSummary || '').trim(),
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
      const count = (t) => cards.filter((c) => c.source === t).length;
      const payload = { builtAt: new Date().toISOString(), cards, stats: {
        total: cards.length, podcast: count('podcast'), youtube: count('youtube'), x: count('x'),
        blog: count('blog'), media: count('media'),
        must: cards.filter((c) => c.tier === 'must').length, strong: cards.filter((c) => c.tier === 'strong').length,
      } };
      writeCache(payload); return payload;
    } finally { building = null; }
  })();
  return building;
}
