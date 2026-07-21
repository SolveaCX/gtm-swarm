// 自有 X 账号库 + 采集器：不再受制于 follow-builders 上游账号池。
// 账号池存 workspace（xPool 集合，首次用默认池播种，可经 /api/xpool 增删）；
// 采集走 nitter 系公开镜像的 RSS（无 key、服务器可直连），过滤回复/转推，
// 链接改写回 x.com канonical——与 follow-builders 来源天然按 URL 去重。
import { execFile } from 'node:child_process';
import { xPool } from './store.js';

// 信源权威分级（477 定）：官方/创始人说的话权重最高，普通 AI builder 只是观察者、没那么权威。
// tier 越高越权威，打分时按它加权，UI 上也标出来。
// 加权只用来调排序，不该把整池分数压塌——原来 official+8 / builder-3 的跨度太大，
// 独立开发者的干货被扣到 80 分线以下，看着像「今天没好素材」。477 2026-07-21 重新定档：
// 官方 +3 / 创始人 +2 / 一线负责人 +1 / 独立开发者 0（不扣）/ 媒体 -2（仍要交叉验证）
export const AUTHORITY_TIERS = {
  official: { rank: 4, label: '官方', bonus: 3, note: '模型厂商/平台官方发布，一手事实' },
  founder: { rank: 3, label: '创始人/高管', bonus: 2, note: 'CEO/创始人/投资人，决策与内部数据的一手视角' },
  insider: { rank: 2, label: '一线负责人', bonus: 1, note: '大厂产品/工程负责人，接近一手但视角局部' },
  builder: { rank: 1, label: 'AI builder', bonus: 0, note: '独立开发者/实践者，观察与经验为主，不加不扣' },
  media: { rank: 0, label: '媒体/社区', bonus: -2, note: '二手报道与社区讨论，需交叉验证' },
};
// handle → tier（小写匹配）。没列到的按 group 兜底：官方→official，其余→builder
export const AUTHORITY_BY_HANDLE = {
  // 创始人 / 高管 / 投资人：正在经营一家有规模的公司，或掌握组合投资面的一手数据
  amasad: 'founder',        // Replit CEO
  dharmesh: 'founder',      // HubSpot 联创
  rauchg: 'founder',        // Vercel CEO
  levie: 'founder',         // Box CEO
  garrytan: 'founder',      // YC 总裁
  danshipper: 'founder',    // Every CEO
  levelsio: 'founder',      // 一人公司标杆，长期公开真实营收
  mattturck: 'founder',     // FirstMark 投资人，看得到组合公司真实数据
  nikunj: 'founder',        // FPV 合伙人，同上
  // 注：以下曾被误归创始人档，实为个人 builder（477 2026-07-21 指出）——
  // 自称 Builder、做个人项目、没有在经营有规模的公司，观点属个人经验不是权威结论
  zarazhangrui: 'builder',  // follow-builders 项目作者
  steipete: 'builder',      // 已退出 PSPDFKit，现为 agent 重度玩家
  // 一线负责人（大厂内部但非决策层）
  alexalbert__: 'insider', officiallogank: 'insider', thsottiaux: 'insider',
  amandaaskell: 'insider', _catwu: 'insider', trq212: 'insider',
  // 独立实践者 / 教学者
  karpathy: 'builder', simonw: 'builder', swyx: 'builder', petergyang: 'builder',
};
// 没在名单里的账号按 bio 兜底判级：说自己是 CEO/创始人才算创始人档，
// 自称 Builder / indie hacker 的就是 builder（默认也是 builder，宁可低估不高估）
const BIO_FOUNDER = /\b(ceo|founder|co-?founder|cto|president|partner)\b|创始人|联创|合伙人|总裁/i;
const BIO_INSIDER = /\b(head of|lead|PM|product manager|developer relations|devrel)\b|负责人|@openai|@anthropic|@google/i;
export function authorityOf({ handle, group, bio } = {}) {
  const h = String(handle || '').toLowerCase();
  if (AUTHORITY_BY_HANDLE[h]) return AUTHORITY_BY_HANDLE[h];
  if (group === '官方') return 'official';
  const b = String(bio || '');
  if (/\bbuilder\b|indie hacker/i.test(b)) return 'builder'; // 自报 builder 优先，别被 bio 里的公司名带偏
  if (BIO_FOUNDER.test(b)) return 'founder';
  if (BIO_INSIDER.test(b)) return 'insider';
  return 'builder';
}

// 默认池：[handle, 显示名, 一句话介绍, 分组]
export const DEFAULT_X_POOL = [
  // 官方（477 点名：codex/gpt/openai/google/kimi/gemini/claude/anthropic/glm/openrouter）
  ['OpenAI', 'OpenAI', 'GPT/Sora 官方号', '官方'],
  ['OpenAIDevs', 'OpenAI Developers', 'OpenAI 开发者官方（Codex/API 动态）', '官方'],
  ['AnthropicAI', 'Anthropic', 'Claude 官方号', '官方'],
  ['claudeai', 'Claude', 'Claude 产品号', '官方'],
  ['GoogleDeepMind', 'Google DeepMind', 'Google 顶级 AI 实验室官方', '官方'],
  ['GeminiApp', 'Google Gemini', 'Gemini 产品官方号', '官方'],
  ['Kimi_Moonshot', 'Kimi (月之暗面)', 'Kimi/Moonshot 官方号', '官方'],
  ['Zai_org', 'Z.ai (智谱)', 'GLM 系列官方号', '官方'],
  ['OpenRouterAI', 'OpenRouter', '模型路由平台官方号', '官方'],
  // builder 推荐（一人公司 / agent 劳动力 / 技术判断力）
  ['levelsio', 'Pieter Levels', '一人公司标杆，公开收入做产品', 'builder'],
  ['amasad', 'Amjad Masad', 'Replit CEO，内部 agent 用得最狠的公司', 'builder'],
  ['dharmesh', 'Dharmesh Shah', 'HubSpot 联创，agent.ai 操盘者', 'builder'],
  ['karpathy', 'Andrej Karpathy', '前 Tesla/OpenAI，AI 教学与判断力天花板', 'builder'],
  ['simonw', 'Simon Willison', 'AI 工具实测之王，Django 联合创造者', 'builder'],
  ['swyx', 'swyx', 'Latent Space 主理人，AI Engineer 概念提出者', 'builder'],
  ['alexalbert__', 'Alex Albert', 'Anthropic Claude 关系负责人', 'builder'],
  ['OfficialLoganK', 'Logan Kilpatrick', 'Google AI Studio/Gemini API 负责人', 'builder'],
  // follow-builders 原班人马（与上面重叠的不重复列）
  ['thsottiaux', 'Thibault Sottiaux', 'OpenAI Codex/ChatGPT 工程负责人', 'builder'],
  ['petergyang', 'Peter Yang', 'AI 实操教程与访谈，Creator Economy 老兵', 'builder'],
  ['AmandaAskell', 'Amanda Askell', 'Anthropic 哲学家，Claude 人格设计者', 'builder'],
  ['_catwu', 'Cat Wu', 'Anthropic Claude Code/Cowork 产品', 'builder'],
  ['trq212', 'Thariq', 'Anthropic Claude Code 团队', 'builder'],
  ['rauchg', 'Guillermo Rauch', 'Vercel CEO，前端基础设施', 'builder'],
  ['levie', 'Aaron Levie', 'Box CEO，企业 AI 落地视角', 'builder'],
  ['garrytan', 'Garry Tan', 'YC 总裁，早期创业风向标', 'builder'],
  ['mattturck', 'Matt Turck', 'FirstMark 投资人，MAD Podcast 主理人', 'builder'],
  ['zarazhangrui', 'Zara Zhang', 'Builder，follow-builders 项目作者', 'builder'],
  ['nikunj', 'Nikunj Kothari', 'FPV Ventures 合伙人，产品出身投资人', 'builder'],
  ['steipete', 'Peter Steinberger', 'PSPDFKit 创始人，agent 重度玩家', 'builder'],
  ['danshipper', 'Dan Shipper', 'Every CEO，AI 与知识工作写作者', 'builder'],
];

// 公开镜像池（按序回退；只放实测通过的）
const MIRRORS = ['https://nitter.net'];
const PER_HANDLE = 3;
const CONCURRENCY = 4;

export function ensureXPool() {
  // 缺哪个默认账号补哪个（幂等）：默认池账号即使被删，下轮采集也会自动回来——原本的始终在。
  const have = new Set(xPool.all().map((x) => String(x.handle).toLowerCase()));
  for (const [handle, name, bio, group] of DEFAULT_X_POOL) {
    if (!have.has(handle.toLowerCase())) xPool.create({ handle, name, bio, group });
  }
  return xPool.all();
}

function curl(url, timeout = 20) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-fsSL', '--max-time', String(timeout), '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126', url], { maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
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

function parseNitterRss(xml, acct) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const out = [];
  for (const it of items) {
    const title = decode((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    if (!title || /^R to @/.test(title) || /^RT by /.test(title)) continue; // 过滤回复与转推
    const link = decode((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const pub = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const d = new Date(pub);
    out.push({
      source: 'x',
      sourceName: `@${acct.handle}`,
      author: acct.name || `@${acct.handle}`,
      authorBio: String(acct.bio || '').slice(0, 120),
      authority: authorityOf(acct), // 官方/创始人/一线负责人/builder：打分按它加权
      title: title.slice(0, 220),
      summary: title,
      url: link.replace(/https?:\/\/[^/]+\//, 'https://x.com/').replace(/#m$/, ''),
      publishedAt: isNaN(d) ? '' : d.toISOString(),
    });
    if (out.length >= PER_HANDLE) break;
  }
  return out;
}

async function fetchHandle(acct) {
  for (const base of MIRRORS) {
    try {
      const xml = await curl(`${base}/${encodeURIComponent(acct.handle)}/rss`);
      const items = parseNitterRss(xml, acct);
      if (items.length) return items;
    } catch { /* 换下一个镜像 */ }
  }
  return [];
}

// 采集整个账号池（有限并发，礼貌抓取；单账号失败静默跳过）
export async function collectOwnX() {
  const pool = ensureXPool();
  const results = [];
  for (let i = 0; i < pool.length; i += CONCURRENCY) {
    const batch = pool.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((acct) => fetchHandle(acct)));
    for (const r of settled) if (r.status === 'fulfilled') results.push(...r.value);
  }
  return results;
}
