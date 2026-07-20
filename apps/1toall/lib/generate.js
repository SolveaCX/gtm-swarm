// 内容生成大脑：把「想法 + 品牌 + 平台规则」拼成提示词，调 flatkey 出内容。
import fs from 'node:fs';
import path from 'node:path';
import { chat, image, imageWithRef } from './flatkey.js';
import { getPlatform } from './platforms.js';
import { checkQuality } from './quality.js';
import { ROOT, OUTPUT_DIR, IMAGE_DESIGN_MODEL, DEFAULT_MODEL } from '../config.js';
import { modelPref } from './model-prefs.js';
import { contentRuleFor } from './platform-rules.js';

// 把品牌 IP 参考图（可能是 data url 或 /assets 路径）解析成 data url 喂给 Nano
function resolveRefDataUrl(v) {
  if (!v || typeof v !== 'string') return null;
  if (v.startsWith('data:')) return v;
  if (v.startsWith('/assets/') || v.startsWith('/output/')) {
    try {
      const abs = path.join(ROOT, v);
      const ext = (path.extname(abs).slice(1) || 'png').replace('jpg', 'jpeg');
      return `data:image/${ext};base64,${fs.readFileSync(abs).toString('base64')}`;
    } catch { return null; }
  }
  return null;
}

// 全局反 AI 腔约束，所有文字生成都注入
const HUMAN_VOICE = `
写作铁律（务必遵守）：
- 说人话。像一个真实、有观点的行家在写，不是 AI 在交差。
- 严禁 AI 套话：「在这个快节奏的时代」「赋能」「抓手」「闭环」「总而言之」「综上所述」「不仅……更……」这类空话一律不用。
- 不堆砌排比，不滥用破折号，不无脑加 emoji。
- 数字、比例、价格只能用「想法/素材」里明确给出的；素材没给就不要编造，也不要在不同平台给出互相矛盾的数字。
- 有具体细节、有态度、有信息增量。能短则短，不注水。`;

function brandBlock(brand) {
  if (!brand || brand.id === 'none') {
    return '【品牌】无特定品牌，按内容本身的最佳调性来写。';
  }
  const lines = [`【品牌身份】`, `- 品牌名：${brand.name}`];
  if (brand.tagline) lines.push(`- 一句话定位 / Slogan：${brand.tagline}`);
  if (brand.positioning) lines.push(`- 账号定位：${brand.positioning}`);
  if (brand.persona) lines.push(`- 人设：${brand.persona}`);
  if (brand.audience) lines.push(`- 目标受众：${brand.audience}`);
  if (brand.pillars) lines.push(`- 内容支柱：${brand.pillars}`);
  if (brand.goal) lines.push(`- 账号终极目的（内容要服务于此）：${brand.goal}`);
  if (brand.voice) lines.push(`- 语气调性：${brand.voice}`);
  if (brand.writingStyle) lines.push(`- 写作风格：${brand.writingStyle}`);
  if (brand.catchphrases) lines.push(`- 可自然带入的口头禅 / 高频词：${brand.catchphrases}`);
  if (brand.taboos) lines.push(`- 务必避免：${brand.taboos}`);
  if (brand.bannedWords) lines.push(`- 禁用词（绝对不能出现）：${brand.bannedWords}`);
  lines.push(`所有内容都要贴合以上品牌身份，但不要生硬喊口号；尤其不要把 Slogan 原句直接抄进正文当结尾金句，最多体现它的精神。`);
  return lines.join('\n');
}

// 解析品牌专属禁用词（、，,/ 空格 分隔）
function brandBanned(brand) {
  if (!brand || !brand.bannedWords) return [];
  return String(brand.bannedWords).split(/[、,，/\s]+/).map((s) => s.trim()).filter(Boolean);
}

function optionsBlock(options = {}) {
  const map = { 短: '简短精炼', 中: '中等篇幅', 长: '充分展开' };
  const parts = [];
  if (options.tone) parts.push(`整体语气偏「${options.tone}」`);
  if (options.length) parts.push(`篇幅${map[options.length] || options.length}`);
  return parts.length ? `【本次偏好】${parts.join('；')}。` : '';
}

// 套用「真·写作风格配方」
function styleBlock(style) {
  if (!style) return '';
  const lines = [`【写作风格配方：${style.name || '未命名'}】`];
  if (style.voice) lines.push(`- 语气 / 调性：${style.voice}`);
  if (style.sentence) lines.push(`- 句式 / 节奏：${style.sentence}`);
  if (style.devices) lines.push(`- 常用手法：${style.devices}`);
  if (style.banned) lines.push(`- 务必避开：${style.banned}`);
  if (style.example) lines.push(`- 参考范文片段（学风格，不抄内容）：\n${style.example}`);
  return lines.join('\n');
}

// ---------- 各平台文字规则 ----------
const TEXT_SPEC = {
  article: {
    role: '资深内容主笔',
    spec: `产出一篇结构完整的深度文章。要求：
- 开头用一个具体场景 / 反常识观点 / 真问题抓住人，别铺垫废话。
- 中间分 3-5 个有逻辑递进的小节，每节有小标题，论点配具体例子或数据。
- 结尾给一个让人记得住的收束（一个判断 / 一个行动）。
- Markdown 格式，标题用 ##。**总字数严格控制在 1200-1800 字，宁可精炼也不要注水，绝不超过 1800 字。**`,
  },
  gongzhonghao: {
    role: '头部公众号主编',
    spec: `产出一篇公众号推文。要求：
- 先给 3 个备选标题（编号列出），风格各异但都抓人，不做标题党。
- 正文开头制造共鸣或悬念；小标题分段；语言口语化、有节奏。
- 适当用短句和换行，方便手机阅读。
- 结尾自然引导互动（提问 / 在看 / 转发），别硬广。
- Markdown 格式，1000-1600 字。`,
  },
  xiaohongshu: {
    role: '小红书爆款博主',
    spec: `产出一篇小红书图文笔记。要求：
- 标题 20 字内，有钩子、真诚不浮夸，可带 1-2 个 emoji。
- 正文短句多换行，痛点共鸣 + 干货 / 体验，口语化、有「姐妹感」或行家感（看品牌受众）。
- emoji 适度点缀，别每句都加。
- 结尾给 4-6 个相关 #话题标签。
- 总字数控制在 400-700 字。`,
  },
  douyin: {
    role: '抖音爆款编导',
    spec: `产出一条抖音口播视频脚本。要求：
- 第一行写【黄金3秒开场】：一句能让人停下划走的钩子。
- 然后是口播逐字稿，口语化、节奏快、一句一个信息点。
- 关键处用 [停顿] [强调] 等标注帮助拍摄。
- 结尾一句引导（关注 / 评论 / 收藏）。
- 控制在 30-60 秒口播量（约 150-300 字）。`,
  },
  shipinhao: {
    role: '视频号运营',
    spec: `产出一条视频号文案。要求：
- 比抖音更稳重，适合熟人 / 朋友圈层传播。
- 简短有力、实用或有温度，开头一句立住。
- 结尾可引导转发或点赞。
- 200-400 字。`,
  },
  bilibili: {
    role: 'B站知识区头部 UP 主的编剧',
    spec: `产出一支 B 站横屏长视频的完整口播脚本。要求：
- 目标时长 6-8 分钟（约 1800-2400 字口播量），横屏讲师风。
- 开头 15 秒钩子（反常识结论或悬念），30 秒内讲清「这期讲什么、为什么值得看完」。
- 正文分 3-5 个章节，每章开头给【章节标题】（用于进度条分P），层层递进；讲机制讲原理，给 B 站观众足够的信息密度和「学到了」的感觉。
- 每 60-90 秒埋一个兴趣点（反转/类比/实测数据）防流失。
- 结尾 20 秒总结要点 + 下期预告钩子 + 引导一键三连（自然口吻，不喊麦）。
- 格式：Markdown，含时间轴标注（如 [0:00-0:15]）。`,
  },
  youtube_long: {
    role: 'a top tech YouTuber\'s scriptwriter',
    spec: `Write a complete English voiceover script for a ~10-minute horizontal YouTube video. Requirements:
- Hook in the first 15 seconds (counterintuitive claim or high-stakes question); state the payoff of watching by 0:45.
- 4-6 chapters with [Chapter Title] markers (for YouTube chapters), escalating logically; explain mechanisms, show evidence, use analogies for non-native-English global audience (clear, medium-paced English).
- A pattern-interrupt every 60-90s (b-roll cue, on-screen text cue, or rhetorical question) — mark them as [B-ROLL: ...] / [ON-SCREEN: ...].
- The angle should differ slightly from a domestic Chinese version: global context, international examples, no China-only references without explanation.
- End: 20s recap + one clear CTA (subscribe reason tied to value, not begging).
- Format: Markdown with timeline marks (e.g. [0:00-0:15]). Target ~1400-1600 words of spoken text.`,
  },
  shorts_en: {
    role: 'a viral short-form video scriptwriter (TikTok / YouTube Shorts)',
    spec: `Write an English voiceover script for ONE ~60-second vertical video, publishable on both TikTok and YouTube Shorts. Requirements:
- First line = 3-second hook (bold claim / surprising number), then fast single-idea explanation; one takeaway only.
- Spoken, punchy English, ~150-170 words total; mark [PAUSE] and [ON-SCREEN: ...] cues.
- Slightly different framing from any domestic Chinese version: global audience, international context.
- End with a snappy loop-friendly closer or question (no "like and subscribe" begging).
- After the script, append: Title (≤80 chars), Description (2-3 lines), and 5-8 hashtags — each in its own clearly labeled section (Title: / Description: / Tags:).`,
  },
  twitter: {
    role: 'a sharp English content writer on X',
    spec: `Write an English thread for X (Twitter). Requirements:
- 3-7 tweets, numbered (1/ 2/ ...). First tweet is a strong standalone hook.
- Each tweet works on its own; punchy, concrete, no fluff.
- No hashtag spam; at most 1-2 relevant hashtags total.
- Output in English.`,
  },
};

// 各平台专属「开场钩子结构」——强制差异化，避免一鱼多吃时几条开头雷同
const HOOK_STYLE = {
  article: '用一个具体场景，或一个真问题切入',
  gongzhonghao: '用一个反常识判断或悬念开场',
  xiaohongshu: '痛点前置——第一句先戳中读者的具体困扰',
  douyin: '一句反差 / 反常识的「黄金3秒」钩子',
  shipinhao: '用一句有态度的金句立住',
  twitter: 'open with a punchy, standalone claim',
  bilibili: '15 秒内抛出反常识结论或悬念，讲清这期为什么值得看完',
  youtube_long: 'open with a counterintuitive claim or high-stakes question in 15s',
  shorts_en: 'a 3-second bold claim or surprising number',
};

// 系统级平台通用规则（跨品牌，账号无关；打底，品牌规则可覆盖）
function systemPlatformBlock(platformId) {
  const rule = contentRuleFor(platformId);
  if (!rule) return '';
  return `【平台通用规则（系统级，所有账号都要遵守）】\n${rule}`;
}

// 品牌的平台专属规则（如 品牌B 三平台实战文案规范），优先级高于通用平台规则
function platformRuleBlock(brand, platformId) {
  const rule = brand?.platformRules?.[platformId];
  if (!rule) return '';
  return `【品牌平台专属规范（实战沉淀，优先级最高，与通用要求冲突时以此为准）】\n${rule}`;
}

function buildText(platformId, idea, brand, options, style, kbContext) {
  const t = TEXT_SPEC[platformId];
  const system = `你是一位${t.role}。${HUMAN_VOICE}`;
  const sb = styleBlock(style);
  const sysPr = systemPlatformBlock(platformId);
  const pr = [sysPr, platformRuleBlock(brand, platformId)].filter(Boolean).join('\n\n');
  const user = `${brandBlock(brand)}

${kbContext ? kbContext + '\n\n' : ''}${sb ? sb + '\n\n' : ''}${optionsBlock(options)}

【创作任务】基于下面这个想法，${t.spec}

${pr ? pr + '\n\n' : ''}【开场钩子】${HOOK_STYLE[platformId]}。咬住本平台的原生表达，不要写成放之四海皆准的通用稿。

【想法 / 原始素材】
${idea}`;
  return { system, user };
}

// ---------- 公众号成品文：结构化 Markdown（frontmatter digest + 单一标题 + 配图占位符）----------
// 复用 gongzhonghao 的角色人设 / 开场钩子风格，但输出格式不同（单一定稿标题 + 可解析 digest + 配图占位符），
// 所以单独起一份 spec，而不是塞进 TEXT_SPEC 里跟着 buildText 走（buildText 的输出契约是纯文字，这里要可解析结构）。
function buildArticleMarkdown(idea, brand, options, style, kbContext) {
  const role = TEXT_SPEC.gongzhonghao.role;
  const system = `你是一位${role}，这次要产出「可直接排版发布」的公众号成品文，不是普通草稿。${HUMAN_VOICE}`;
  const sb = styleBlock(style);
  const sysPr = systemPlatformBlock('gongzhonghao');
  const pr = [sysPr, platformRuleBlock(brand, 'gongzhonghao')].filter(Boolean).join('\n\n');
  const user = `${brandBlock(brand)}

${kbContext ? kbContext + '\n\n' : ''}${sb ? sb + '\n\n' : ''}${optionsBlock(options)}

【创作任务】基于下面这个想法，产出一篇「可直接排版发布」的公众号成品文。严格按下面这个格式输出，不要任何多余解释、不要用代码块包裹：

---
digest: 一句话摘要，100字以内，微信订阅号消息列表里显示的摘要
---
# 最终标题（只给一个，不要罗列候选；要有钩子但不做标题党）

开头用一个具体场景 / 反常识判断 / 真问题制造共鸣或悬念，别铺垫废话。

[[配图: 封面视觉的一句话描述——要呼应标题核心信息，具体到画面，不要写"公众号封面"这种空话]]

## 第一个小标题

正文，口语化、有节奏，适当短句换行方便手机阅读；可以用 > 引用强调金句。

## 后续小标题（2-4 个，逻辑递进）

正文……

[[配图: 某处配图的一句话视觉描述，只在信息密度高、值得停留的地方放]]

结尾自然引导互动（提问 / 在看 / 转发），别硬广。

格式要求：
- Markdown，标题用 ##；正文 1000-1600 字（不含 frontmatter 和占位符文字）。
- [[配图: ...]] 占位符总共放 2-4 个（含开头那个封面占位在内），只放在真正值得配图的地方，别为了凑数硬塞；每个独占一行，描述必须是具体画面/视觉隐喻，不要写"配一张相关的图"这种空话。
- 除了开头那个封面占位符必须紧跟在标题后面，其余占位符位置由你判断，但不要挨在一起。

${pr ? pr + '\n\n' : ''}【开场钩子】${HOOK_STYLE.gongzhonghao}。咬住公众号原生表达，不要写成放之四海皆准的通用稿。

【想法 / 原始素材】
${idea}`;
  return { system, user };
}

// 供 article.js 单向调用：写公众号成品文正文（frontmatter digest + 标题 + 配图占位符）。
// article.js 只导入这个函数（以及 generateOutput/buildLightCost），本文件绝不反向 import article.js，避免循环依赖。
export async function generateArticleMarkdown({ idea, brand, options = {}, style = null, kbContext = '', model = DEFAULT_MODEL }) {
  const { system, user } = buildArticleMarkdown(idea, brand, options, style, kbContext);
  return chat({ model, system, user, maxTokens: 4500, withMeta: true });
}

// ---------- 视频方案 ----------
function buildVideoPlan(idea, brand, options, style, kbContext) {
  const system = `你是一位短视频导演 + 编剧。${HUMAN_VOICE}`;
  const sb = styleBlock(style);
  const user = `${brandBlock(brand)}

${kbContext ? kbContext + '\n\n' : ''}${sb ? sb + '\n\n' : ''}${optionsBlock(options)}

基于下面的想法，产出一份「可直接开拍」的竖屏短视频方案，用 Markdown，包含这几块：

## 0. 五角度备选
用表格给同一选题的 5 种讲法：| 角度 | 3秒钩子 | 切入一句话 |
五个角度固定为：干货效率型 / 痛点共鸣型 / 悬念反转型 / 对比冲击型 / 热点借势型。
表格后写一行「✅ 本方案采用：XX型 — 理由一句话」，后续全部按该角度展开。
⚠️ 角度只改变结构与切入方式；语气、人设、口头禅一律沿用上方品牌既定风格，绝不因角度切换而改变品牌声音。

## 1. 选题与核心信息
一句话说清这条视频要让观众记住什么。末尾标注：制作难度（低/中/高）+ 预估制作耗时。

## 2. 口播逐字稿
带时间轴（如 0:00-0:05），口语化，黄金3秒开场要抓人。

## 3. 分镜表
用表格：| 镜号 | 画面内容 | 屏幕字幕 | 时长 |

## 4. 封面文案
主标题（≤12字）+ 副标题。

## 5. 三平台发布文案
分别给【抖音】【小红书】【视频号】各一版：标题 + 正文 + 话题标签。
${['douyin', 'xiaohongshu', 'shipinhao']
  .filter((id) => brand?.platformRules?.[id])
  .map((id) => `\n该平台文案严格遵守品牌专属规范：\n${brand.platformRules[id]}`)
  .join('\n')}

末尾加一行备注：完整成片可交给 longform-video-podcast 视频管线渲染（重型流程）。

【想法 / 原始素材】
${idea}`;
  return { system, user };
}

// ---------- 图片：先设计提示词，再出图 ----------
function buildImageDesign(idea, brand, platform, options, vstyle) {
  const palette =
    brand && brand.id !== 'none'
      ? `Brand palette — primary ${brand.primaryColor || '#2B6CE8'}, accent ${
          brand.accentColor || brand.primaryColor || '#8B5CF6'
        }, dark ${brand.darkColor || '#172A4A'}, background ${brand.bgColor || '#F4F6FB'}.`
      : 'Use a clean palette that fits the content.';
  // 视觉风格：优先用选中的风格配方，否则退回品牌自带 visualStyle
  const styleDirective = vstyle
    ? `Visual style — ${vstyle.name}: ${vstyle.desc} (${vstyle.usage || ''}). Commit fully to this style.`
    : `Visual style: ${(brand && brand.visualStyle) || 'clean, premium, modern'}.`;

  const kindHint = {
    peitu: 'A 16:9 horizontal editorial illustration / hero image for an article. Usually NO heavy text, focus on a strong visual metaphor.',
    cover:
      'A 3:4 vertical cover image (for Xiaohongshu / WeChat). It SHOULD include a short, bold, crisp Chinese title rendered cleanly on the image.',
    changtu:
      'A 9:16 tall vertical poster. It SHOULD include a clear Chinese headline and can include 2-3 short supporting points as clean typography.',
  }[platform.id];

  const system = `You are an art director writing a single image-generation prompt for the gpt-image-2 model.
Output ONLY the final English prompt, no preamble, no quotes around the whole thing.
Rules:
- Describe the scene, composition, lighting, mood, and style precisely.
- ${kindHint}
- ${styleDirective}
- ${palette}
- If on-image text is needed, specify it EXACTLY using Chinese in 「」 brackets and say "render this text crisply, correct characters, good kerning".
- Do NOT invent statistics, percentages, or chart data. Only put numbers on the image if they appear in the content idea; if the idea has no data, do NOT add any data charts or percentages.
- Any on-image headline must reflect the core message of the content idea — do not drift to an unrelated slogan.
- Keep it tasteful and high-end; avoid clutter, avoid generic stock-photo look, avoid watermarks.`;

  const user = `${brand && brand.id !== 'none' ? `Brand: ${brand.name}. ${brand.tagline || ''}` : ''}
Content idea (may be Chinese):
${idea}

Write the image prompt now.`;
  return { system, user };
}

// 把图片存盘，返回可访问的相对 url
function saveImage(buffer, fileBase) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const name = `${fileBase}.png`;
  fs.writeFileSync(path.join(OUTPUT_DIR, name), buffer);
  return `/output/${name}`;
}

export function buildLightCost(calls) {
  const totals = calls.reduce((sum, call) => {
    sum.inputTokens += Number(call.result.usage?.inputTokens || 0);
    sum.outputTokens += Number(call.result.usage?.outputTokens || 0);
    sum.totalTokens += Number(call.result.usage?.totalTokens || 0);
    return sum;
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  const modelStack = calls.map(({ role, result }) => ({
    role,
    provider: result.provider || 'Flatkey',
    requestedModel: result.requestedModel,
    resolvedModel: result.model,
    model: result.model,
    billingMode: 'flatkey_quota',
    tokenScope: 'exclusive_to_output',
    totalTokens: Number(result.usage?.totalTokens || 0),
    actualCny: null,
  }));
  const byModel = new Map();
  calls.forEach(({ result }) => {
    const model = result.model || result.requestedModel || 'unknown';
    const current = byModel.get(model) || { model, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    current.inputTokens += Number(result.usage?.inputTokens || 0);
    current.outputTokens += Number(result.usage?.outputTokens || 0);
    current.totalTokens += Number(result.usage?.totalTokens || 0);
    byModel.set(model, current);
  });
  return {
    version: 1,
    source: 'flatkey-api-response',
    accuracy: totals.totalTokens ? 'provider_reported_usage' : 'model_recorded_usage_missing',
    calculatedAt: new Date().toISOString(),
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens,
    dedicatedWorkerTokens: totals.totalTokens,
    apiEquivalentCny: null,
    actualCny: null,
    billingMode: 'flatkey_quota',
    requestCount: calls.length,
    primaryModel: modelStack[0]?.model || 'unknown',
    modelNames: [...new Set(modelStack.map((item) => item.model).filter(Boolean))],
    models: [...byModel.values()],
    modelStack,
    note: totals.totalTokens
      ? 'Token 来自 Flatkey 接口响应；当前未配置该模型可靠公开单价，因此不生成虚假人民币估值。'
      : '模型已记录，但 Flatkey 本次响应未返回 usage；Token 与人民币金额保持空缺。',
  };
}

// 风格指令：优先用选中的视觉风格，否则退回品牌自带图风（账号通用风格）
function styleDirectiveFor(vstyle, brand) {
  if (vstyle) return `${vstyle.name}：${vstyle.desc || ''}${vstyle.usage ? '（' + vstyle.usage + '）' : ''}`;
  if (brand && brand.visualStyle) return brand.visualStyle;
  return '';
}

// stage 2：用（可能已被用户改过的）提示词 + 选定风格，渲染实际图片
export async function renderImageFromPrompt({ platformId, prompt, brand, options = {}, vstyle = null, fileBase }) {
  const platform = getPlatform(platformId);
  if (!platform || platform.kind !== 'image') throw new Error(`不是图片类型：${platformId}`);
  const styleDir = styleDirectiveFor(vstyle, brand);
  const basePrompt = `${prompt}${styleDir ? `\n\nVisual style — commit fully: ${styleDir}` : ''}`;
  const ipRef = resolveRefDataUrl(brand && brand.ipImage);
  let imageResult;
  if (ipRef && options.lockCharacter !== false) {
    const lockPrompt = `IMPORTANT: A reference image of a specific character/person is attached. Keep that person's appearance IDENTICAL — same face, hairstyle, glasses, and outfit. Then compose the following image featuring this exact person.\nTarget aspect ratio: ${platform.size || '1024x1536'}.\n\n${basePrompt}`;
    imageResult = await imageWithRef({ prompt: lockPrompt, refImages: [ipRef], withMeta: true });
  } else {
    imageResult = await image({ prompt: basePrompt, size: platform.size, withMeta: true });
  }
  const imageUrl = saveImage(imageResult.buffer, fileBase || `img-${Date.now()}`);
  return {
    kind: 'image',
    imageUrl,
    imagePrompt: prompt,
    characterLocked: !!ipRef && options.lockCharacter !== false,
    cost: buildLightCost([{ role: 'visual_generation', result: imageResult }]),
  };
}

// 主入口：生成单个输出。mode='prompt' 时图片只出提示词不渲染（两步创作 stage 1）
export async function generateOutput(platformId, { idea, brand, options = {}, fileBase, style = null, vstyle = null, kbContext = '', mode = 'full' }) {
  const platform = getPlatform(platformId);
  if (!platform) throw new Error(`未知输出类型：${platformId}`);
  const model = options.model || modelPref('text', DEFAULT_MODEL);

  if (platform.kind === 'text') {
    const { system, user } = buildText(platformId, idea, brand, options, style, kbContext);
    const result = await chat({ model, system, user, withMeta: true });
    return {
      kind: 'text',
      content: result.content,
      quality: checkQuality(result.content, brandBanned(brand)),
      cost: buildLightCost([{ role: 'content_generation', result }]),
    };
  }

  if (platform.kind === 'plan') {
    const { system, user } = buildVideoPlan(idea, brand, options, style, kbContext);
    const result = await chat({ model, system, user, maxTokens: 5000, withMeta: true });
    return {
      kind: 'plan',
      content: result.content,
      quality: checkQuality(result.content, brandBanned(brand)),
      cost: buildLightCost([{ role: 'content_plan', result }]),
    };
  }

  if (platform.kind === 'image') {
    // 1) 设计提示词（快模型）
    const { system, user } = buildImageDesign(idea, brand, platform, options, vstyle);
    const promptResult = await chat({
      model: modelPref('imageDesign', IMAGE_DESIGN_MODEL),
      system,
      user,
      maxTokens: 700,
      withMeta: true,
    });
    // 两步创作 stage 1：只出提示词，不渲染（图慢，等确认平台+风格再制作）
    if (mode === 'prompt') {
      return {
        kind: 'image',
        status: 'prompt',
        imagePrompt: promptResult.content,
        cost: buildLightCost([{ role: 'prompt_design', result: promptResult }]),
      };
    }
    // 2) 出图（mode='full'）：复用 renderImageFromPrompt，把提示词设计成本一起算
    const rendered = await renderImageFromPrompt({ platformId, prompt: promptResult.content, brand, options, vstyle, fileBase });
    return {
      ...rendered,
      cost: buildLightCost([
        { role: 'prompt_design', result: promptResult },
        ...(rendered.cost?.modelStack || []).map((m) => ({ role: 'visual_generation', result: { model: m.model, usage: { inputTokens: m.inputTokens, outputTokens: m.outputTokens, totalTokens: m.totalTokens } } })),
      ]),
    };
  }

  throw new Error(`不支持的 kind：${platform.kind}`);
}

// ---------- 选题 agent：用 agent 帮运营想选题（而不是堆模板让人自己填）----------
const VALID_OUTPUTS = 'article gongzhonghao gongzhonghao_pub xiaohongshu douyin shipinhao twitter peitu cover changtu video_plan bilibili youtube_long shorts_en'.split(' ');

export function extractJson(text) {
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

export async function ideate({ direction, brand, play = null, model = null }) {
  model = model || modelPref('topic', DEFAULT_MODEL);
  const system = `你是品牌内容运营总监。${HUMAN_VOICE}
选题铁律：好选题 = 受众真实痛点 × 一个差异化角度，不自嗨、不空泛。每个选题都要让运营一眼看到「这条能火 / 该发」。`;
  const user = `${brandBlock(brand)}
${play ? `\n【运营玩法】按这套打法来想选题：${play}\n` : ''}
运营给的粗略方向 / 素材：
${direction}

请产出 5 个高质量、互不重复的选题。每个选题给：
- title：钩子式标题（能直接当标题用）
- angle：切入角度，一句话说清这条和别人不一样在哪
- outputs：建议生成哪些形态（数组，从这些里选 2-4 个：${VALID_OUTPUTS.join(' / ')}）
- reason：为什么这个选题值得做，一句话

严格只输出 JSON，不要任何解释或 markdown 代码块：
{"topics":[{"title":"","angle":"","outputs":[""],"reason":""}]}`;

  const raw = await chat({ model, system, user, maxTokens: 2000 });
  const data = extractJson(raw);
  const topics = (data.topics || [])
    .slice(0, 6)
    .map((t) => ({
      title: String(t.title || '').trim(),
      angle: String(t.angle || '').trim(),
      reason: String(t.reason || '').trim(),
      outputs: (Array.isArray(t.outputs) ? t.outputs : []).filter((o) => VALID_OUTPUTS.includes(o)),
    }))
    .filter((t) => t.title);
  if (!topics.length) throw new Error('选题没生成出来，换个方向再试');
  return { topics };
}

// ---------- 建号 agent：一句话品牌描述 → 完整品牌草稿（不落库，只回填表单）----------

// 简单 WCAG 相对亮度，用来兜底校验「背景色 vs 深色」的对比度，避免模型给出浅字配浅底
function relLuminance(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return 0.5;
  const [r, g, b] = [1, 2, 3]
    .map((i) => parseInt(m[i], 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a, b) {
  const l1 = relLuminance(a), l2 = relLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function safeHex(v, fallback) {
  const s = String(v || '').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(s);
  return m ? `#${m[1]}` : fallback;
}

export async function draftBrand(description, { model = null } = {}) {
  model = model || modelPref('text', DEFAULT_MODEL);
  const system = `你是品牌顾问 + 内容操盘手，负责把运营一句话描述，一次性扩写成一份可直接使用的完整品牌档案。${HUMAN_VOICE}
配色铁律（务必遵守）：primaryColor / accentColor / darkColor / bgColor 都要给合法十六进制色值；darkColor 是正文文字色，bgColor 是背景色，这两者的对比度必须足够高、正文在 bgColor 上必须清晰可读——绝不能出现浅色字配浅背景、或深色字配深背景这种低对比度组合。`;
  const user = `运营给的一句话品牌描述：
${description}

请把它扩写成完整品牌档案，覆盖以下每一个字段（缺的信息你要基于描述合理推断出一个具体、可用的版本，不要留空、不要写"待定"）：
- name：品牌 / 账号名
- tagline：一句话定位 / Slogan
- positioning：账号定位（这个号是谁、给谁、解决什么独特价值）
- persona：人设标签 / 气质
- voice：语气调性
- writingStyle：写作风格（具体句式 / 证据标准 / 写作方法）
- catchphrases：口头禅 / 高频词（顿号或逗号分隔，3-6 个）
- audience：目标受众
- taboos：务必避免（文风 / 内容层面）
- bannedWords：禁用词（逗号分隔，绝对不能出现的词，如"颠覆、革命、遥遥领先"这类空话）
- pillars：内容支柱（带占比，如"A 40% / B 30% / C 20% / D 10%"）
- cadence：发布节奏
- benchmarks：对标账号（2-3 个同赛道标杆，可以是类型描述而非真实账号名）
- platformPlan：多平台分工
- goal：账号终极目的
- visualStyle：出图视觉风格描述
- topicScope：选题范围（这个号能讲什么话题，一句话讲清边界）
- redLines：内容红线（绝对不做什么，要具体可执行，不是空话）
- routingHints：给"选题该派给哪个号"这个路由 agent 用的判定规则，一句话说清"什么样的选题适合 / 不适合这个号"
- defaultPack：默认内容包，从这些形态 id 里选 2-4 个最适合这个账号的（数组，只能用这些 id）：${VALID_OUTPUTS.join(' / ')}
- primaryColor / accentColor / darkColor / bgColor：十六进制色值（形如 #112233），四个组合要保证 darkColor 文字在 bgColor 背景上清晰可读，对比度足够

严格只输出 JSON，不要任何解释或 markdown 代码块：
{"name":"","tagline":"","positioning":"","persona":"","voice":"","writingStyle":"","catchphrases":"","audience":"","taboos":"","bannedWords":"","pillars":"","cadence":"","benchmarks":"","platformPlan":"","goal":"","visualStyle":"","topicScope":"","redLines":"","routingHints":"","defaultPack":[""],"primaryColor":"#000000","accentColor":"#000000","darkColor":"#000000","bgColor":"#ffffff"}`;

  const raw = await chat({ model, system, user, maxTokens: 2500 });
  const data = extractJson(raw);
  const str = (v) => String(v || '').trim();

  const draft = {
    name: str(data.name),
    tagline: str(data.tagline),
    positioning: str(data.positioning),
    persona: str(data.persona),
    voice: str(data.voice),
    writingStyle: str(data.writingStyle),
    catchphrases: str(data.catchphrases),
    audience: str(data.audience),
    taboos: str(data.taboos),
    bannedWords: str(data.bannedWords),
    pillars: str(data.pillars),
    cadence: str(data.cadence),
    benchmarks: str(data.benchmarks),
    platformPlan: str(data.platformPlan),
    goal: str(data.goal),
    visualStyle: str(data.visualStyle),
    topicScope: str(data.topicScope),
    redLines: str(data.redLines),
    routingHints: str(data.routingHints),
    defaultPack: (Array.isArray(data.defaultPack) ? data.defaultPack : []).filter((o) => VALID_OUTPUTS.includes(o)).slice(0, 4),
    primaryColor: safeHex(data.primaryColor, '#111827'),
    accentColor: safeHex(data.accentColor, '#F97316'),
    darkColor: safeHex(data.darkColor, '#111827'),
    bgColor: safeHex(data.bgColor, '#F5F5F4'),
  };
  // 兜底：模型给的背景/正文对比度不够时（<4.5:1，WCAG AA 正文标准），换回安全组合，别再让前端渲染出浅字配浅底
  if (contrastRatio(draft.bgColor, draft.darkColor) < 4.5) {
    draft.bgColor = '#F5F5F4';
    draft.darkColor = '#111827';
  }
  if (!draft.name) throw new Error('品牌草稿没生成出来，换个描述再试');
  return draft;
}

// ---------- 选题路由 agent：判断一个选题该派给哪个账号（红线是硬闸）----------
const CROSS_RULES = `跨账号铁律（优先级高于一切）：
1. AI 客服选题绝对分界线：品牌A不碰任何 AI 客服选题（连 VOC 视角讲 AI 客服口碑也不行），沾到「AI客服/智能客服/客服机器人/购物助手/chatbot」一律 reject；AI 客服正是 品牌B 的主场。
2. 品牌边界绝不串：品牌A内容零 品牌B 露出；品牌B 官方大方露出；品牌C 讲 品牌B 必须第三方实测口吻。
3. 品牌C 的选题必须有真实来源（新闻/文章/亲测），无来源即 reject。
4. 拿不准就 weak，不硬塞。`;

export async function routeTopic({ idea, accounts, model = null }) {
  model = model || modelPref('text', DEFAULT_MODEL);
  const cards = accounts
    .map(
      (a) => `### ${a.name}（id: ${a.id}）
- 定位：${a.positioning || a.tagline || ''}
- 选题范围：${a.topicScope || ''}
- 红线（绝对不做）：${a.redLines || ''}
- 路由判定：${a.routingHints || (a.positioning ? `未单独配置路由规则，按账号定位兜底判断是否匹配：${a.positioning}` : '')}`
    )
    .join('\n\n');

  const system = `你是内容运营总编，负责把选题派给正确的账号。红线大于一切——选题沾任何账号的红线就对该账号 reject，绝不硬塞。判断要果断、理由要一句话说清。`;
  const user = `【账号矩阵】
${cards}

${CROSS_RULES}

【待派选题】
${idea}

对每个账号给判定：
- verdict：fit（适合发）/ weak（勉强能发但不推荐）/ reject（红线或完全不符）
- reason：一句话理由（说人话，运营一看就懂）
- angle：若 fit，给该账号的差异化切入角度一句话；否则留空

最后给 best（最该发的账号 id；全都 reject 就填 null）和 bestReason。

严格只输出 JSON：
{"decisions":[{"brandId":"","verdict":"fit","reason":"","angle":""}],"best":"","bestReason":""}`;

  const raw = await chat({ model, system, user, maxTokens: 1500 });
  const data = extractJson(raw);
  const valid = new Set(accounts.map((a) => a.id));
  const decisions = (data.decisions || [])
    .filter((d) => valid.has(d.brandId))
    .map((d) => ({
      brandId: d.brandId,
      verdict: ['fit', 'weak', 'reject'].includes(d.verdict) ? d.verdict : 'weak',
      reason: String(d.reason || '').trim(),
      angle: String(d.angle || '').trim(),
    }));
  if (!decisions.length) throw new Error('路由没判出来，再试一次');
  const best = valid.has(data.best) && decisions.find((d) => d.brandId === data.best && d.verdict !== 'reject') ? data.best : null;
  return { decisions, best, bestReason: String(data.bestReason || '').trim() };
}
