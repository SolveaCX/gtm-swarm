// 自有 X 账号库 + 采集器：不再受制于 follow-builders 上游账号池。
// 账号池存 workspace（xPool 集合，首次用默认池播种，可经 /api/xpool 增删）；
// 采集走 nitter 系公开镜像的 RSS（无 key、服务器可直连），过滤回复/转推，
// 链接改写回 x.com канonical——与 follow-builders 来源天然按 URL 去重。
import { execFile } from 'node:child_process';
import { xPool } from './store.js';

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
];

// 公开镜像池（按序回退；只放实测通过的）
const MIRRORS = ['https://nitter.net'];
const PER_HANDLE = 3;
const CONCURRENCY = 4;

export function ensureXPool() {
  const cur = xPool.all();
  if (cur.length) return cur;
  for (const [handle, name, bio, group] of DEFAULT_X_POOL) xPool.create({ handle, name, bio, group });
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
