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
import { collectOwnX, authorityOf, AUTHORITY_TIERS } from './x-pool.js';
import { brands, styles, adopted, feeds } from './store.js';
import { HUNTER_HOOK_RECIPE } from './hunter-style.js';

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
const FRESH_WINDOW_DAYS = 7;    // 采集窗口：只收 7 天内素材（UI 最宽档就是「本周」，更旧的没意义）
const PER_SOURCE = 5;
const SCORE_CAP = 120;          // 单轮送评上限（控 token）
const SCORE_CHUNK = 20;         // 分块送评：一锅太大输出会截断 → 整批解析失败全体降级（加了 hook 后输出更长，块调小）

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

// 非 X 源的权威分级：官方博客/官方频道 = 官方；创始人级主理人 = 创始人；媒体社区最低
const OFFICIAL_SOURCE = /官方|OpenAI|Anthropic|DeepMind|Google/i;
const FOUNDER_SOURCE = /Y Combinator|a16z|Sequoia|红杉|Sarah Guo|Elad Gil|Bill Gurley|Brad Gerstner|Harry Stebbings|Chamath|Garry|Claire Vo|Dan Shipper|Amjad/i;
function feedAuthority(type, sourceName, author) {
  if (type === 'media') return 'media';
  const s = `${sourceName} ${author || ''}`;
  if (OFFICIAL_SOURCE.test(s)) return 'official';
  if (FOUNDER_SOURCE.test(s)) return 'founder';
  return 'builder';
}

function parseFeed(xml, source, sourceName, author, authorBio) {
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  const authority = feedAuthority(source, sourceName, author);
  return blocks.slice(0, PER_SOURCE * 2).map((b) => ({
    source, sourceName, author, authorBio, authority,
    title: tag(b, 'title'),
    summary: tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'),
    url: atomLink(b),
    publishedAt: toIso(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated')),
  })).filter((x) => x.title && x.url && isFresh(x.publishedAt)).slice(0, PER_SOURCE);
}

// 出厂内置的源，摊平成统一结构。477 在网页上加/改/停用的存进 feeds 集合，
// 同名（同 url）的以他的为准——内置只是起点，不是锁死的。
function builtinFeeds() {
  return [
    ...PODCASTS.map(([name, url, author, bio]) => ({ type: 'podcast', name, url, author, bio })),
    ...YOUTUBE.map(([name, id, author, bio]) => ({ type: 'youtube', name, url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, author, bio, channelId: id })),
    ...BLOGS.map(([name, url, author, bio]) => ({ type: 'blog', name, url, author, bio })),
    ...MEDIA.map(([name, url, author, bio]) => ({ type: 'media', name, url, author, bio })),
  ].map((f) => ({ ...f, id: `builtin:${f.url}`, builtin: true, enabled: true }));
}

/** 加源之前先拉一次：拉不通就别让它进列表，免得每轮采集都白跑一遍还没人知道 */
export async function feedProbe(url) {
  let xml = '';
  try { xml = await curl(url, 15); }
  catch (e) { return { ok: false, why: String(e.message).includes('timed out') ? '连接超时' : '拉不到（地址错了或需要登录）' }; }
  const items = parseFeed(xml, 'blog', 'probe', '', '');
  if (!items.length) {
    const looksFeed = /<rss|<feed|<channel/i.test(xml);
    return { ok: false, why: looksFeed ? '是订阅源但解析不出条目' : '这不像 RSS/Atom 订阅源（拿到的是网页？）' };
  }
  return { ok: true, sample: items[0].title.slice(0, 80), count: items.length };
}

/** 当前生效的源清单：内置 + 自定义，自定义同 url 覆盖内置，停用的排除在采集之外 */
export function listFeeds({ includeDisabled = true } = {}) {
  const custom = feeds.all();
  const byUrl = new Map(builtinFeeds().map((f) => [f.url, f]));
  for (const c of custom) {
    // 自定义条目可以覆盖内置（比如改个名字/作者介绍/停用），也可以是全新的源
    byUrl.set(c.url, { ...(byUrl.get(c.url) || {}), ...c, builtin: !!byUrl.get(c.url)?.builtin, enabled: c.enabled !== false });
  }
  const all = [...byUrl.values()];
  return includeDisabled ? all : all.filter((f) => f.enabled !== false);
}

async function collectRss() {
  const sources = listFeeds({ includeDisabled: false })
    .filter((f) => ['podcast', 'youtube', 'blog', 'media'].includes(f.type));
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
      authority: authorityOf({ handle: builder.handle, bio: builder.bio }),
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

// ── 采纳记录：哪条素材真被写成了内容 ──
// 477 的要求：被收录过的要记下来，同一批关键人和相似内容下次稍微加一点点权重。
// 「一点点」是认真的：这是偏好信号不是权威背书，加太多会让雷达只会推熟面孔。
const ADOPT_AUTHOR_BONUS = 2;   // 这个人的东西被写过 → 每次 +2
const ADOPT_AUTHOR_CAP = 4;     // 最多 +4，别让老熟人永远霸榜
const ADOPT_TOPIC_BONUS = 2;    // 标题和写过的选题明显重合 → +2
const ADOPT_MAX = 5;            // 两项合计封顶

const normUrl = (u) => String(u || '').toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
const authorKey = (v) => String(v || '').trim().toLowerCase().replace(/^@/, '');
// 中文没空格，按 2-gram 取词；英文按单词。停用词丢掉，免得「the/AI」把什么都判成相关
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'ai', '的', '了', '是', '在', '和', '我们', '一个']);
function topicTokens(text) {
  const t = String(text || '').toLowerCase();
  const en = (t.match(/[a-z][a-z0-9.+-]{2,}/g) || []).filter((w) => !STOP.has(w));
  const zh = [];
  const cn = t.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i + 2 <= cn.length; i++) { const g = cn.slice(i, i + 2); if (!STOP.has(g)) zh.push(g); }
  return new Set([...en, ...zh]);
}

/** 记一笔：这条灵感被写成内容了 */
export function recordAdoption({ url, title, author, sourceName, source, workId, platformIds = [] } = {}) {
  if (!url && !title) return null;
  const key = normUrl(url) || String(title).slice(0, 120);
  const already = adopted.all().find((a) => a.key === key);
  if (already) {
    return adopted.update(already.id, { count: (already.count || 1) + 1, lastAt: new Date().toISOString() });
  }
  return adopted.create({
    key, url: url || '', title: String(title || '').slice(0, 200),
    author: author || '', authorKey: authorKey(author || sourceName),
    sourceName: sourceName || '', source: source || '',
    workId: workId || null, platformIds, count: 1, lastAt: new Date().toISOString(),
  });
}

/** 采纳过的历史 → 一个「给这条素材加几分」的函数。导出供自检，业务只在 score() 里用。 */
export function adoptionScorer() {
  const rows = adopted.all();
  if (!rows.length) return () => ({ bonus: 0, used: false, why: '' });
  const usedUrls = new Set(rows.map((r) => r.key));
  const byAuthor = new Map();
  for (const r of rows) {
    if (!r.authorKey) continue;
    byAuthor.set(r.authorKey, (byAuthor.get(r.authorKey) || 0) + (r.count || 1));
  }
  const topicSets = rows.map((r) => topicTokens(r.title));
  return (item) => {
    const key = normUrl(item.url) || String(item.title).slice(0, 120);
    if (usedUrls.has(key)) return { bonus: 0, used: true, why: '这条已经写过了' };
    const why = [];
    let bonus = 0;
    const ak = authorKey(item.author || item.sourceName);
    const times = byAuthor.get(ak) || 0;
    if (times) {
      const b = Math.min(ADOPT_AUTHOR_CAP, ADOPT_AUTHOR_BONUS * times);
      bonus += b;
      why.push(`这个人的内容写过 ${times} 次 +${b}`);
    }
    const mine = topicTokens(item.title);
    if (mine.size >= 3) {
      const hit = topicSets.some((set) => {
        let n = 0;
        for (const t of mine) if (set.has(t)) { n++; if (n >= 3) return true; }
        return false;
      });
      if (hit) { bonus += ADOPT_TOPIC_BONUS; why.push(`选题跟写过的重合 +${ADOPT_TOPIC_BONUS}`); }
    }
    return { bonus: Math.min(ADOPT_MAX, bonus), used: false, why: why.join('；') };
  };
}

function fallbackScore(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const strong = ['agent', 'ai-native', 'one person', 'organization', 'distribution', 'coding', 'workflow', 'gtm', 'model'];
  const weak = ['benchmark', 'roundup', 'rumor'];
  return Math.max(20, Math.min(92, 48 + strong.filter((x) => text.includes(x)).length * 8 - weak.filter((x) => text.includes(x)).length * 5));
}

// 账号风格速写：品牌定位 + 写作风格喂给评分 prompt，让「建议切口/钩子」贴着自家账号给
function accountStyleBrief() {
  try {
    const bs = brands.all().slice(0, 4)
      .map((b) => `${b.name}（${[b.tagline || b.positioning, b.persona, b.voice || b.writingStyle].filter(Boolean).join('；').slice(0, 120)}）`)
      .filter((s) => !s.includes('（）'));
    const ws = styles.all().filter((s) => (s.kind || 'writing') === 'writing').slice(0, 4)
      .map((s) => `《${s.name}》${String(s.tone || '').slice(0, 60)}`);
    const parts = [];
    if (bs.length) parts.push(`我们的账号：${bs.join('；')}`);
    if (ws.length) parts.push(`常用写作风格：${ws.join('；')}`);
    return parts.join('\n');
  } catch { return ''; }
}

async function score(items) {
  // 新的优先送评：同分辨率下先保新素材
  const candidates = [...items].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)).slice(0, SCORE_CAP);
  const compact = candidates.map((x, i) => ({
    i, source: x.source, author: x.author, title: x.title, summary: x.summary.slice(0, 260),
    publishedAt: (x.publishedAt || '').slice(0, 10), engagement: x.engagement || 0,
    信源等级: AUTHORITY_TIERS[x.authority || 'builder']?.label || 'AI builder',
  }));
  const brief = accountStyleBrief();
  const system = `你是 Hunter 的内容总编。只根据标题和简介做 Taste 初筛，不补充事实。高分信号：AI-native 组织、一人公司、Agent 作为劳动力或分发渠道、技能/结果责任、GTM 工程化、反炒作的真实 build 与决策。低分信号：纯跑分、泛新闻汇总、标题党、纯学术、重复话题、过时旧闻。
信源权威度按「信源等级」字段判断，直接影响 evidence 维度：官方（模型厂商/平台一手发布）与创始人/高管（CEO、创始人、投资人，讲的是自己公司的真实决策与数据）最可信，evidence 给足；一线负责人次之；**AI builder（独立开发者/实践者/教学者）只是观察和个人经验，不是权威结论，evidence 要压着给**；媒体/社区是二手转述，最低。同样一个观点，创始人说和 builder 说，分数不该一样。${brief ? `\n${brief}\n给切口和钩子时必须站在上面账号的定位与风格上——写清这个账号该用什么姿势接这条素材，不要泛泛的媒体建议。` : ''}`;
  const userFor = (chunk) => `为每条素材打 0-100 分。总分由 relevance(35)、novelty(25)、evidence(20)、story(20) 相加。zhSummary 用中文一两句讲清这条素材「谁+说了/做了什么+为什么值得看」（当卡片标题用，别翻译腔）。reason 必须写成可解释的打分依据（两句：第一句为什么值得/不值得写，第二句点名最强或最弱的维度及原因）。angle 站在我们账号的风格与人设上给切口。hook 仅当 score≥60 时给：写一段可直接当公众号首段的钩子（60-120 字连贯一段话，具体、抓人、不标题党），低分素材 hook 给空字符串。${HUNTER_HOOK_RECIPE}严格输出 JSON：{"cards":[{"i":0,"score":80,"relevance":30,"novelty":20,"evidence":15,"story":15,"zhSummary":"…","reason":"…","angle":"站在账号风格上的切口","hook":"公众号首段钩子或空串","signals":["AI-native组织"]}]}。素材：${JSON.stringify(chunk)}`;
  // 分块并行送评：i 用全局下标，块内解析失败只影响该块（降级规则分），不拖全体
  const chunks = [];
  for (let at = 0; at < compact.length; at += SCORE_CHUNK) chunks.push(compact.slice(at, at + SCORE_CHUNK));
  const mapped = new Map();
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const parsed = extractJson(await chat({ model: NEWS_MODEL, system, user: userFor(chunk), maxTokens: 9000, purpose: 'radar-score' }));
      for (const x of parsed.cards || []) mapped.set(Number(x.i), x);
    } catch { /* 该块降级到规则分，采集仍可用 */ }
  }));
  const adoptBonusOf = adoptionScorer();
  return candidates.map((item, i) => {
    const s = mapped.get(i) || {};
    // 权威度确定性加权：不全靠模型自觉，官方/创始人提分、builder/媒体降分
    const tier = AUTHORITY_TIERS[item.authority || 'builder'] || AUTHORITY_TIERS.builder;
    const raw = Number(s.score) || fallbackScore(item);
    // 采纳history：写过的人和相近选题加一点点；已经写过的这条本身直接标出来，别重复推
    const adopt = adoptBonusOf(item);
    const scoreValue = Math.max(0, Math.min(100, Math.round(raw + tier.bonus + adopt.bonus)));
    return { id: `idea_${Buffer.from(item.url).toString('base64url').slice(0, 18)}`, ...item, score: scoreValue,
      adoptedBefore: adopt.used, adoptBonus: adopt.bonus, adoptWhy: adopt.why,
      // authorityKey 给前端上色用：官方/创始人一眼认得出，builder/媒体收敛
      authorityKey: item.authority || 'builder', authorityLabel: tier.label, authorityBonus: tier.bonus, rawScore: Math.round(raw),
      dimensions: { relevance: Number(s.relevance) || null, novelty: Number(s.novelty) || null, evidence: Number(s.evidence) || null, story: Number(s.story) || null },
      zhSummary: String(s.zhSummary || '').trim(),
      hook: String(s.hook || '').trim(),
      reason: String(s.reason || '符合当前 AI 与 Agent 内容方向'), angle: String(s.angle || '从真实使用与组织变化切入'), signals: Array.isArray(s.signals) ? s.signals.slice(0, 4) : [],
      tier: scoreValue >= 85 ? 'must' : scoreValue >= 70 ? 'strong' : scoreValue >= 50 ? 'watch' : 'skip' };
  }).sort((a, b) => b.score - a.score);
}

// ── 搜索：在已采集的素材池里按关键词找 ──
// 只搜池子：瞬时、零成本。想覆盖新领域就去信息源管理里加源，下一轮采集就有了——
// 那条路有作者、权威度、打分，比临时联网抓一把来路不明的结果靠谱得多。
function matchScore(item, terms) {
  const hay = `${item.title} ${item.summary} ${item.author} ${item.sourceName}`.toLowerCase();
  let hit = 0;
  for (const t of terms) if (hay.includes(t)) hit++;
  return hit / terms.length;
}

/**
 * 关键词搜素材。返回的卡片跟雷达卡片同一个契约，可以直接拿去创作。
 */
export async function searchInspiration({ query, limit = 12 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { error: '搜什么？给个关键词' };
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const cached = readCache();
  const pool = withAdoption(cached?.cards || []).map((c) => ({ ...c, _m: matchScore(c, terms) }))
    .filter((c) => c._m > 0)
    .sort((a, b) => (b._m - a._m) || (b.score - a.score))
    .slice(0, limit)
    .map(({ _m, ...c }) => c);
  return {
    query: q, from: 'pool', builtAt: cached?.builtAt || null, hits: pool.length, cards: pool,
    note: pool.length ? '' : '已采集的素材里没有命中的。想覆盖这个方向，去「📡 信息源」加一个源，下一轮采集就有了。',
  };
}

// 采纳标记按「现在」算，不用上次打分时的快照——刚记完一笔就该立刻看到「已写过」，
// 而不是等下一轮四小时后的重新评分。
// 读的时候用当前档位重算分数，别用采集那一刻冻住的数。
// 为什么：调了权威度档位（或采纳权重）之后，缓存里的老卡片分数不会自己更新——
// 477 会看到「改了没反应」，等下一轮采集才生效，还白烧一次打分的钱。
// 模型给的原始分 rawScore 已经存着了，重算只是加减法，零成本。
function withAdoption(cards = []) {
  const f = adoptionScorer();
  return cards.map((c) => {
    const a = f(c);
    const tier = AUTHORITY_TIERS[c.authorityKey || c.authority || 'builder'] || AUTHORITY_TIERS.builder;
    const raw = Number.isFinite(Number(c.rawScore)) ? Number(c.rawScore) : Number(c.score) || 0;
    const score = Math.max(0, Math.min(100, Math.round(raw + tier.bonus + a.bonus)));
    return {
      ...c, score,
      authorityLabel: tier.label, authorityBonus: tier.bonus,
      tier: score >= 85 ? 'must' : score >= 70 ? 'strong' : score >= 50 ? 'watch' : 'skip',
      adoptedBefore: a.used, adoptBonus: a.bonus, adoptWhy: a.why,
    };
  }).sort((x, y) => y.score - x.score);
}

export function getInspirationCached() {
  const d = readCache();
  return d ? { ...d, cards: withAdoption(d.cards) } : d;
}

let building = null;
export async function getInspiration({ refresh = false } = {}) {
  const cached = readCache();
  if (!refresh && cached && Date.now() - new Date(cached.builtAt).getTime() < CACHE_TTL) return { ...cached, cards: withAdoption(cached.cards) };
  if (building) return building;
  building = (async () => {
    try {
      // 自有 X 库在前、follow-builders 在后：同一条推文按 URL 去重时保留信息更全的自有条目
      const [rss, own, x] = await Promise.all([collectRss(), collectOwnX().catch(() => []), collectX()]);
      const cards = await score(dedupe([...rss, ...own.filter((i) => isFresh(i.publishedAt)), ...x]));
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
