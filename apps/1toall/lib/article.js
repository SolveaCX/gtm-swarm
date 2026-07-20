// 公众号成品文编排：想法 → 结构化 Markdown（frontmatter digest + 标题 + 配图占位符）→（可选）出图替换占位符。
// 单向依赖 generate.js（复用写作 prompt 组装 + 已有的"提示词→出图"链），不反向被 generate.js 引用，避免循环 import。
import { generateArticleMarkdown, generateOutput, buildLightCost } from './generate.js';
import { checkQuality } from './quality.js';

// 品牌专属禁用词（和 generate.js 内部的 brandBanned 同一份小逻辑，太小没必要为它单独导出）
function brandBanned(brand) {
  if (!brand || !brand.bannedWords) return [];
  return String(brand.bannedWords).split(/[、,，/\s]+/).map((s) => s.trim()).filter(Boolean);
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
// 配图占位符：[[配图: 一句话描述]]，独占一行（中英文冒号都认）
const PLACEHOLDER_RE_G = () => /^\[\[\s*配图\s*[:：]\s*(.+?)\s*\]\]\s*$/gm;

// 从模型原始输出里剥离 frontmatter，抠出 digest，剩下的是正文 markdown（标题+占位符原样保留）
function parseFrontmatter(raw) {
  const trimmed = String(raw || '').trim();
  const m = FRONTMATTER_RE.exec(trimmed);
  if (!m) return { digest: '', body: trimmed };
  const digestMatch = /digest\s*[:：]\s*(.+)/.exec(m[1]);
  const digest = digestMatch ? digestMatch[1].trim() : '';
  return { digest, body: trimmed.slice(m[0].length).trim() };
}

// 正文里抠标题：第一个 H1；模型没按格式给时兜底用 idea 前 30 字
function extractTitle(body, fallbackIdea) {
  const m = /^#\s+(.+)$/m.exec(body);
  const t = m ? m[1].trim() : '';
  return t || String(fallbackIdea || '').trim().slice(0, 30);
}

// 正文里现存的（未出图的）占位符描述列表，按出现顺序
function listPlaceholders(body) {
  const out = [];
  const re = PLACEHOLDER_RE_G();
  let m;
  while ((m = re.exec(body))) out.push(m[1].trim());
  return out;
}

// alt 文本不能带 [ ] 或换行，否则会把 markdown 图片语法撑断
function sanitizeAlt(s) {
  return String(s || '').replace(/[[\]\n\r]/g, ' ').trim().slice(0, 60);
}

// 按顺序把占位符替换成 resolved[i] 对应的 ![desc](url)；某项没解析出 url（生成失败）就原样保留，方便重试
function replacePlaceholdersWithImages(body, resolved) {
  let idx = 0;
  return body.replace(PLACEHOLDER_RE_G(), (full) => {
    const item = resolved[idx++];
    if (item && item.url) return `![${sanitizeAlt(item.desc)}](${item.url})`;
    return full;
  });
}

// 给现有 markdown 里剩下的占位符出图（增量、可重复调用——已解析过的占位符已经变成 ![]() ，不会再被扫到）。
// 第一个仍未解析的占位符当封面（3:4，除非 hasCover=true 说明之前已经出过封面了），其余当正文配图（16:9）。
// 复用 generateOutput('cover'/'peitu', ...) —— 这就是 generate.js 里现成的"提示词设计→出图"两步链，不另起炉灶。
// vstyleCover/vstyleBody：封面与正文配图可以吃不同的视觉风格（如 Hunter 封面米白红条 vs 信息图近黑底）；
// 只传 vstyle 时两者共用，保持旧调用兼容。
export async function generateArticleImages({ markdown, idea, brand, options = {}, vstyle = null, vstyleCover = null, vstyleBody = null, fileBase, hasCover = false }) {
  const body = String(markdown || '');
  const placeholders = listPlaceholders(body).slice(0, 5); // 单篇最多处理 5 张，防止跑飞
  if (!placeholders.length) return { markdown: body, images: [] };

  const images = [];
  const resolved = [];
  let coverDone = hasCover;
  for (let idx = 0; idx < placeholders.length; idx++) {
    const desc = placeholders[idx];
    const isCover = !coverDone;
    if (isCover) coverDone = true;
    const platformId = isCover ? 'cover' : 'peitu';
    const combinedIdea = `${idea}\n\n【本图具体要求（这是文章配图，不是要重新设计整篇内容，只按下面这句话画）】${desc}`;
    try {
      const rendered = await generateOutput(platformId, {
        idea: combinedIdea,
        brand,
        options,
        vstyle: (isCover ? vstyleCover : vstyleBody) || vstyle,
        fileBase: `${fileBase || 'article'}-${idx + 1}`,
      });
      images.push({ description: desc, url: rendered.imageUrl, role: isCover ? 'cover' : 'body' });
      resolved.push({ desc, url: rendered.imageUrl });
    } catch (e) {
      console.error('[article] 配图生成失败：', desc, e.message);
      resolved.push({ desc, url: null });
    }
  }
  return { markdown: replacePlaceholdersWithImages(body, resolved), images };
}

// 主入口：想法 → 公众号成品文（title + digest + markdown + images）。
// withImages=false（默认）时只出文字，markdown 里保留 [[配图: ...]] 占位符待后续单独出图（省钱省等待）。
export async function buildWechatArticle({
  idea, brand, options = {}, style = null, kbContext = '', model,
  withImages = false, vstyle = null, fileBase,
}) {
  if (!idea || !idea.trim()) throw new Error('想法不能为空');

  const writeResult = await generateArticleMarkdown({ idea, brand, options, style, kbContext, model });
  const { digest, body } = parseFrontmatter(writeResult.content);
  const title = extractTitle(body, idea);

  let markdown = body;
  let images = [];
  if (withImages) {
    const filled = await generateArticleImages({ markdown, idea, brand, options, vstyle, fileBase });
    markdown = filled.markdown;
    images = filled.images;
  }

  return {
    title,
    digest,
    markdown,
    images,
    quality: checkQuality(markdown, brandBanned(brand)),
    cost: buildLightCost([{ role: 'content_generation', result: writeResult }]),
  };
}
