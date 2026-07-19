// 移植自 11agents-rednote server.js（/Users/YOU/Downloads/APP/11ag/11agents-rednote/server.js）
// 四块核心逻辑：① XHS_RULES + enforceXhs 平台硬规则体检 ② 风格学习（多模态蒸馏 + 链接抓取 + 质量闸门）
// ③ 9 图批量生成（封面带大字 + 8 张内容图统一图风） ④ ffmpeg 竖版视频合成（Ken Burns + xfade 淡入）
// LLM/出图统一走 1toAll 现有 lib/flatkey.js 的 chat()/image()；仅 visionChat（多模态）因 flatkey.chat() 不支持
// image_url 内容块，自行直连 flatkey /chat/completions（key 同样从 Keychain 读，绝不落盘）。
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { chat, image as genImage } from './flatkey.js';
import { OUTPUT_DIR, DEFAULT_MODEL } from '../config.js';

const FLATKEY_BASE = 'https://router.flatkey.ai/v1';

// ---- key：仅 visionChat 直连 fetch 时需要（chat()/image() 已在 flatkey.js 内部处理）----
let _key = null;
function apiKey() {
  if (_key) return _key;
  if (process.env.FLATKEY_API_KEY) return (_key = process.env.FLATKEY_API_KEY.trim());
  _key = execSync('security find-generic-password -s FLATKEY_API_KEY -w', { encoding: 'utf8' }).trim();
  if (!_key) throw new Error('Keychain 里没找到 FLATKEY_API_KEY');
  return _key;
}

/* ==================== 模块 1：小红书平台硬规则 + 体检 ==================== */

// 小红书平台硬规则（所有风格通用，写进生成 prompt；内容保持源码原样英文，模型按此自我约束）
export const XHS_RULES = `
[RedNote platform rules — must follow]
1. Titles: each <=20 characters (RedNote hard cap; over-limit = rejected); punchy, hooky, 1-2 emoji ok
2. Tags: give exactly 10 in the tags array; mix 2-3 high-traffic + 3-4 precise niche + 2-3 long-tail scene/audience tags; words only, no # symbol
3. Body: short lines, blank line between blocks; emoji on key lines; end with an engagement prompt
[Anti-ban red lines — never touch]
- No absolutes: best / #1 / top / most / only / 100% / permanent / guaranteed / cures
- No medical-efficacy claims: treat / cure / heal / antibacterial-efficacy / replaces medication
- No false promises: guaranteed profit / pass rate / definitely works
- No off-platform lures: click link / add my WeChat / DM to buy / off-site trade or any variant
- No banned categories: reseller / counterfeit / replica / prescription
- Normal seeding only; do not name or bash specific competitor brands (write category-level cons)
- Hedge data ("around / in my experience"); never state unverified absolute figures`;

// 图片字段 schema：拼进生成 prompt，要求模型正好给 9 条画面提示
const IMG_SCHEMA = `,"coverText":"封面大字(≤12字)","imageHints":["封面画面描述","内容图1描述",...共9条]（正好9张：第1张封面主视觉带大字，后8张内容图各配合正文一个关键点/卖点；每条一句话画面，全部严格贴合上面的图风，9张视觉统一像同一组拍摄）`;

// 生成后本地二次校验：标题截≤20、标签补/截到10、扫违禁词
export const BANNED = ['最', '第一', '顶级', '绝对', '唯一', '国家级', '最佳', '100%', '永久', '根治', '治愈', '治疗', '药用', '杀菌', '抗菌', '稳赚', '包过', '一定有效', '点击链接', '加微信', '私信我买', '高仿', 'A货', '代购'];
// 标签数量不够 10 个时补位的兜底词——按内容语言（含中文字符 vs 纯英文）分两套，避免中文种草文混进纯英文 tag
const FALLBACK_TAGS_ZH = ['好物分享', '日常好物', '生活方式', '种草', '宝藏好物', '实用推荐', '居家好物', '沉浸式体验', '闺蜜安利', '值得入手'];
const FALLBACK_TAGS_EN = ['musthaves', 'dailyfinds', 'homefinds', 'goodstuff', 'livingalone', 'lifestyle', 'recommendations', 'reddotfinds', 'shareables', 'worthit'];

export function enforceXhs(d) {
  const warns = [];
  // 标题≤20
  d.titles = (d.titles || []).map((t) => {
    t = String(t).trim();
    if ([...t].length > 20) { warns.push('标题超20字已截：' + t); t = [...t].slice(0, 20).join(''); }
    return t;
  }).filter(Boolean);
  if (!d.titles.length) d.titles = ['分享一个最近很爱的好物'];
  // 标签正好10个
  let tags = [...new Set((d.tags || []).map((x) => String(x).replace(/^#+/, '').trim()).filter(Boolean))];
  const hasCjk = /[一-鿿]/.test(d.titles.join('') + ' ' + (d.body || ''));
  const FALLBACK_TAGS = hasCjk ? FALLBACK_TAGS_ZH : FALLBACK_TAGS_EN;
  for (const f of FALLBACK_TAGS) { if (tags.length >= 10) break; if (!tags.includes(f)) tags.push(f); }
  d.tags = tags.slice(0, 10);
  // 违禁词扫描（正文+标题）
  const hay = d.titles.join(' ') + ' ' + (d.body || '');
  const hits = BANNED.filter((w) => hay.includes(w));
  if (hits.length) warns.push('检测到疑似违禁词：' + hits.join('、') + '（建议改写后再发）');
  d.compliance = { ok: hits.length === 0, warns, banned: hits };
  return d;
}

/* ==================== 生成 prompt：genericStylePrompt 结构照搬，产品/人设/痛点 → idea+brandBlock ==================== */

// 没有指定学到的风格时的默认风格（避免 /api/rn/xhs 在没选风格时直接报错）
const DEFAULT_STYLE = {
  name: '自然种草',
  visual: '干净现代，暖调自然光，无夸张滤镜，封面大字醒目居中偏上',
  dna: [
    '标题公式：具体场景/数字+痛点+反差收益，避免夸张堆砌形容词',
    '开场用一个具体、有画面感的生活场景切入，不直接推销',
    '中段给到2-3个真实使用细节或痛点共鸣，落到情绪或体验感受，不空谈',
    '产品自然带入，讲清1-2个能被具体感知到的好处，不堆参数',
    '语言口语化、真诚，偶尔自嘲或吐槽增加真实感，emoji适度（≤3个）',
    '结尾给一个轻量互动引导（评论区聊聊/收藏备用），不写硬广告腔',
  ],
};

function buildXhsPrompt({ idea, brandBlock, style }) {
  const st = style && Array.isArray(style.dna) && style.dna.length ? style : DEFAULT_STYLE;
  return `OUTPUT LANGUAGE：跟随下面「创作想法」使用的语言写标题、正文、标签（想法是中文就出中文，想法是英文就出英文）。
你是小红书爆文写手，只写「${st.name}」风格。严格按风格 DNA 产出，返回 JSON：
{"titles":["标题1","标题2","标题3"],"body":"正文全文","tags":["标签1",...正好10个]${IMG_SCHEMA}}

图风（配图必须贴合）：${st.visual || '干净现代，封面大字醒目'}

文风 DNA（一条不合格就是废稿）：
${st.dna.map((d, i) => `${i + 1}. ${d}`).join('\n')}

${brandBlock ? `品牌资料：\n${brandBlock}\n\n` : ''}创作想法：
${idea}

正文 600-900 字。${XHS_RULES}
只返回 JSON，不要解释。`;
}

// 主入口：idea + 品牌资料文本 + 学到的风格 → 小红书成套内容
export async function generateXhs({ idea, brandBlock, style }) {
  if (!idea || !String(idea).trim()) throw new Error('先给一个创作想法');
  const prompt = buildXhsPrompt({ idea: String(idea).trim(), brandBlock, style });
  const raw = await chat({ model: DEFAULT_MODEL, user: prompt, maxTokens: 4000 });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('没生成出有效结果，请重试');
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { throw new Error('生成结果格式有误，请重试'); }
  parsed = enforceXhs(parsed);
  return { visual: (style && style.visual) || DEFAULT_STYLE.visual, ...parsed };
}

/* ==================== 模块 2：风格学习（多模态蒸馏 + 链接抓取 + 质量闸门） ==================== */

// visionChat：flatkey.js 的 chat() 只支持纯文字 messages，多模态（图文混排）自行直连
async function visionChat(content, { maxTokens = 3000, timeoutMs = 180000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FLATKEY_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({ model: DEFAULT_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content }] }),
      signal: ctrl.signal,
    });
    const d = await res.json();
    if (d.error) throw new Error(d.error.message || 'LLM 调用出错');
    return String(d.choices?.[0]?.message?.content || '');
  } finally { clearTimeout(t); }
}

// 小红书链接 → Jina Reader 抓正文（xhslink 短链/xiaohongshu 全链都行）
export function fetchXhsNote(url) {
  // 用 curl 抓（走系统代理；node 全局 fetch 直连 jina 会被 TLS 重置）
  if (!/^https?:\/\/(xhslink\.com|(www\.)?xiaohongshu\.com)\/[\w\-/?=&.%]+$/.test(url)) return '';
  try {
    const md = execFileSync('curl', ['-sL', '--max-time', '40', 'https://r.jina.ai/' + url], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const body = md.replace(/^Title:.*$/m, '').replace(/^URL Source:.*$/m, '').replace(/^Published Time:.*$/m, '').replace(/^Markdown Content:\s*/m, '').trim();
    return body.slice(0, 8000);
  } catch { return ''; }
}

// 质量闸门：蒸馏结果是不是有效风格（防"待补正文"这种空壳入库）
export function isValidStyle(st) {
  if (!st?.name || !Array.isArray(st.dna) || st.dna.length < 5) return false;
  const junk = /待提取|待判断|待补|需补|需要看|暂无|无法|请粘贴|请提供|见原文|未提供/;
  if (junk.test(st.name)) return false;
  const badDna = st.dna.filter((d) => junk.test(String(d))).length;
  if (badDna >= Math.ceil(st.dna.length / 2)) return false; // 半数以上是占位=没学到
  return true;
}

// 主入口：一段文字/爆文正文 + 最多5张参考图 → {name,desc,dna[],visual}
export async function learnStyle({ text = '', images = [] }) {
  const imgs = Array.isArray(images) ? images.slice(0, 5) : [];
  const txt = String(text || '');
  if (!imgs.length && txt.trim().length < 12) throw new Error('请附几张参考图，或写一句话描述这个风格');
  const content = [{
    type: 'text',
    text: `You are a RedNote (Xiaohongshu) style analyst. Distill a reusable style DNA from the reference material below. Return JSON only:
{"name":"style name (<=20 chars, English)","desc":"one-line trait (<=40 chars)","dna":["copy DNA rule",...7-9 items],"visual":"one line of Visual DNA: palette / mood / composition / typography / cover treatment"}

How to learn:
- The REFERENCE IMAGES are the primary source for Visual DNA — read their palette, lighting, composition, typography, cover text placement, mood/filter, any on-image labels or captions. Describe them precisely so an image model can reproduce the look.
- The ONE-LINE DESCRIPTION (if given) sets the copy direction, tone, and audience.
- If a full post is pasted, also extract copy DNA (title formula, opening, structure, product placement, voice, emoji, closing hook, compliance) from it.
- You can produce a complete style from images + a single sentence alone — do NOT ask for more; infer sensible copy DNA that matches the visual mood and the description.
Write DNA like an operator's manual for another creator. Return JSON only.
${txt ? `\nDescription / post text:\n${txt.slice(0, 8000)}` : ''}${imgs.length ? `\n(${imgs.length} reference image(s) attached — learn the visual style from them)` : ''}`,
  }];
  for (const u of imgs) content.push({ type: 'image_url', image_url: { url: u } });
  const raw = await visionChat(content, { maxTokens: 3000 });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('风格蒸馏失败，请重试');
  let st;
  try { st = JSON.parse(m[0]); } catch { throw new Error('风格蒸馏结果格式有误，请重试'); }
  if (!isValidStyle(st)) throw new Error('没能学出稳定的风格——换更清晰的参考图，或写更具体的一句话描述');
  return { name: st.name, desc: st.desc || '', dna: st.dna, visual: st.visual || '' };
}

/* ==================== 模块 3：9 图批量生成（第1张封面带大字，其余内容图统一图风） ==================== */

export async function generateImages({ imageHints, coverText, visual, fileBase }) {
  const hints = (Array.isArray(imageHints) && imageHints.length ? imageHints : ['温暖 lifestyle 场景']).slice(0, 9);
  const vis = visual || '干净现代，暖调';
  const base = fileBase || `rn${Date.now().toString(36)}`;
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = [];
  for (let i = 0; i < hints.length; i++) {
    const isCover = i === 0;
    const prompt = isCover
      ? `小红书封面图，竖版3:4。图风：${vis}。画面：${hints[i]}。图上排版醒目大字（中文，清晰无乱码，粗体，占画面上1/3）：「${coverText || ''}」`
      : `小红书内容配图，竖版3:4。图风：${vis}。画面：${hints[i]}。无文字或仅少量点缀文字，风格与封面统一`;
    try {
      const buffer = await genImage({ prompt, size: '1024x1536' });
      const name = `${base}-${String(i).padStart(2, '0')}.png`;
      writeFileSync(path.join(OUTPUT_DIR, name), buffer);
      out.push(`/output/${name}`);
    } catch (e) {
      console.error(`第${i + 1}张图生成失败：`, e.message);
    }
  }
  if (!out.length) throw new Error('图片生成失败，请重试');
  return out;
}

/* ==================== 模块 4：ffmpeg 竖版视频合成（Ken Burns 缓推 + xfade 交叉淡入） ==================== */

// 把 /output/xx.png 这种相对 url 解析回本地文件路径，顺手挡一下路径穿越
function resolveOutputPath(url) {
  const rel = String(url || '').replace(/^\/output\//, '');
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) throw new Error('非法的图片路径：' + url);
  return path.join(OUTPUT_DIR, rel);
}

export async function composeVideo({ imageUrls, fileBase }) {
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).slice(0, 9);
  if (urls.length < 2) throw new Error('至少需要2张图片才能合成视频');
  const files = urls.map(resolveOutputPath);
  const base = fileBase || `rnvideo${Date.now().toString(36)}`;
  const dir = path.join(OUTPUT_DIR, `.tmp-${base}`);
  mkdirSync(dir, { recursive: true });
  try {
    const per = 2.6, W = 1080, H = 1620; // 竖版 2:3
    // 每张图：缩放铺满+Ken Burns 缓推，各生成一段，再 xfade 串联
    const segs = files.map((f, i) => {
      const seg = path.join(dir, `seg${i}.mp4`);
      const frames = Math.round(per * 30);
      execSync(`ffmpeg -y -loop 1 -i "${f}" -vf "scale=${W * 1.15}:${H * 1.15}:force_original_aspect_ratio=increase,crop=${W}:${H},zoompan=z='min(zoom+0.0008,1.12)':d=${frames}:s=${W}x${H}:fps=30,format=yuv420p" -t ${per} -r 30 "${seg}"`, { stdio: 'pipe' });
      return seg;
    });
    // xfade 逐段淡入合成
    let cur = segs[0];
    for (let i = 1; i < segs.length; i++) {
      const merged = path.join(dir, `m${i}.mp4`);
      const off = per * i - 0.5 * i - 0.5;
      execSync(`ffmpeg -y -i "${cur}" -i "${segs[i]}" -filter_complex "xfade=transition=fade:duration=0.5:offset=${Math.max(0.1, off).toFixed(2)}" -r 30 "${merged}"`, { stdio: 'pipe' });
      cur = merged;
    }
    const outName = `${base}.mp4`;
    const outPath = path.join(OUTPUT_DIR, outName);
    execSync(`ffmpeg -y -i "${cur}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${outPath}"`, { stdio: 'pipe' });
    return `/output/${outName}`;
  } catch (e) {
    throw new Error('ffmpeg 合成失败：' + String(e.message).slice(0, 120));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
