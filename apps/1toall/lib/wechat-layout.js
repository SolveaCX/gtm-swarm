// 微信公众号内联样式排版器 —— 移植自 ~/shared-skills/md2wechat/convert_to_wechat.py，
// 排版规范对齐 ~/shared-skills/md2wechat/WECHAT_PUBLISH_SOP.md（技能101 House Style）。
// 关键升级：色值不再写死，从 brand（primaryColor/accentColor/darkColor/bgColor）取，
// 没传 brand 时退回一套中性默认色（与原 python 脚本的橙色方案等价）。
// 纯函数、无副作用、无外部依赖——微信不吃外链 CSS/class，全部内联 style。

const DEFAULT_PALETTE = { accent: '#FF8124', dark: '#1A1A1A', bg: '#FFFFFF' };

function safeHex(v) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(v || '').trim());
  return m ? `#${m[1]}` : null;
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 26, g: 26, b: 26 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// hex + 透明度 → rgba() 字符串（微信 webview 是 webkit 内核，rgba 支持稳定，比 8 位 hex alpha 更保险）
function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// brand → { accent, dark, bg }。无品牌 / 色值非法时退回中性默认色。
function resolvePalette(brand) {
  const b = brand && brand.id !== 'none' ? brand : null;
  return {
    accent: safeHex(b && b.accentColor) || DEFAULT_PALETTE.accent,
    dark: safeHex(b && b.darkColor) || DEFAULT_PALETTE.dark,
    bg: safeHex(b && b.bgColor) || DEFAULT_PALETTE.bg,
  };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 行内 markdown（**粗** / *斜* / `码` / [链接]）→ 内联样式 HTML。
// 入参 text 必须已经过 escapeHtml（顺序：先转义再套 markdown token，和标题一致；
// 转义只动 &<>"，不影响 markdown 的 *_`[]() 记号，两步互不冲突）。
function inlineFormat(text, pal) {
  let s = text;
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:bold;">$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong style="font-weight:bold;">$1</strong>');
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
  s = s.replace(
    /`([^`]+)`/g,
    `<code style="background:${rgba(pal.dark, 0.06)};color:${pal.accent};padding:2px 5px;border-radius:3px;font-size:14px;">$1</code>`
  );
  // 微信正文超链接经常被吞/需要额外校验，和原 SOP 一样只保留文字、用 accent 色标出
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<span style="color:${pal.accent};">$1</span>`);
  return s;
}

// 配图占位符：[[配图: 一句话描述]]（article.js 写作时插入，出图后会被换成真正的 ![]() ）
const PLACEHOLDER_LINE = /^\[\[\s*配图\s*[:：]\s*(.+?)\s*\]\]$/;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)$/;

// Markdown 正文 → HTML 片段（不含外层 section/摘要框）
function mdBodyToHtml(mdContent, pal) {
  let lines = String(mdContent).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // 跳过开头的 frontmatter（--- ... ---），防御性处理：article.js 正常会先剥掉，
  // 但直接把原始 chat 输出喂进来时也不炸。
  if (lines.length && lines[0].trim() === '---') {
    for (let j = 1; j < lines.length; j++) {
      if (lines[j].trim() === '---') { lines = lines.slice(j + 1); break; }
    }
  }

  const htmlParts = [];
  let i = 0;
  const n = lines.length;
  let inCode = false;
  let codeBuf = [];
  let paraBuf = [];
  let blockquoteBuf = [];
  let inBlockquote = false;
  let listItems = [];
  let inList = false;
  let isOrderedList = false;
  let titleSeen = false; // 第一个 H1 当标题吃掉，不进正文（微信标题走单独字段，和原脚本一致）

  const flushPara = () => {
    if (paraBuf.length) {
      const text = paraBuf.join(' ').trim();
      if (text) {
        htmlParts.push(
          `<p style="font-size:14px;line-height:1.5;color:${rgba(pal.dark, 0.9)};margin:8px 0;text-align:justify;">${inlineFormat(escapeHtml(text), pal)}</p>`
        );
      }
      paraBuf = [];
    }
  };
  const flushBlockquote = () => {
    if (blockquoteBuf.length) {
      const inner = blockquoteBuf.map((l) => inlineFormat(escapeHtml(l), pal)).join('<br>');
      htmlParts.push(
        `<blockquote style="border-left:4px solid ${pal.accent};margin:1.2em 0;padding:10px 16px;background:${rgba(pal.accent, 0.05)};border-radius:0 6px 6px 0;">` +
        `<p style="font-size:14px;line-height:1.5;color:${rgba(pal.dark, 0.75)};margin:0;font-style:italic;">${inner}</p></blockquote>`
      );
      blockquoteBuf = [];
      inBlockquote = false;
    }
  };
  const flushList = () => {
    if (listItems.length) {
      const tag = isOrderedList ? 'ol' : 'ul';
      const itemsHtml = listItems
        .map((t) => `<li style="font-size:14px;line-height:1.5;color:${rgba(pal.dark, 0.9)};margin-bottom:4px;">${inlineFormat(escapeHtml(t), pal)}</li>`)
        .join('');
      htmlParts.push(`<${tag} style="padding-left:1.5em;margin:0.8em 0;">${itemsHtml}</${tag}>`);
      listItems = [];
      inList = false;
      isOrderedList = false;
    }
  };

  while (i < n) {
    const line = lines[i];
    const stripped = line.trim();

    // 代码围栏
    if (stripped.startsWith('```')) {
      flushPara(); flushBlockquote(); flushList();
      if (!inCode) {
        inCode = true;
        codeBuf = [];
      } else {
        const codeText = escapeHtml(codeBuf.join('\n')).replace(/ {2}/g, '&nbsp;&nbsp;');
        htmlParts.push(
          `<pre style="background:${rgba(pal.dark, 0.06)};border-radius:6px;padding:14px 16px;font-size:13px;line-height:1.65;overflow-x:auto;margin:1em 0;font-family:Monaco,Menlo,Consolas,monospace;color:${rgba(pal.dark, 0.85)};"><code>${codeText}</code></pre>`
        );
        inCode = false;
        codeBuf = [];
      }
      i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    // 分割线
    if (stripped && /^([-*_])\1{2,}$/.test(stripped.replace(/\s+/g, ''))) {
      flushPara(); flushBlockquote(); flushList();
      htmlParts.push(`<hr style="border:none;border-top:1px solid ${rgba(pal.dark, 0.15)};margin:2em 0;">`);
      i++; continue;
    }

    // H1（第一个吃掉当标题不渲染，后续的才渲染成 <h1>）
    if (stripped.startsWith('# ') && !stripped.startsWith('## ')) {
      flushPara(); flushBlockquote(); flushList();
      const text = stripped.slice(2).trim();
      if (!titleSeen) {
        titleSeen = true;
      } else {
        htmlParts.push(`<h1 style="font-size:22px;font-weight:bold;color:${pal.dark};margin:1.5em 0 0.5em;">${inlineFormat(escapeHtml(text), pal)}</h1>`);
      }
      i++; continue;
    }

    // H2 —— 品牌 accent 色，magazine style
    if (/^#{2}\s/.test(stripped) && !/^#{3}/.test(stripped)) {
      flushPara(); flushBlockquote(); flushList();
      const text = stripped.replace(/^#{2}\s+/, '');
      htmlParts.push(
        `<h2 style="font-size:17px;font-weight:bold;color:${pal.accent};margin:1em 0 0.4em;padding-bottom:4px;border-bottom:2px solid ${rgba(pal.accent, 0.3)};">${inlineFormat(escapeHtml(text), pal)}</h2>`
      );
      i++; continue;
    }

    // H3
    if (/^#{3}\s/.test(stripped) && !/^#{4}/.test(stripped)) {
      flushPara(); flushBlockquote(); flushList();
      const text = stripped.replace(/^#{3}\s+/, '');
      htmlParts.push(`<h3 style="font-size:15px;font-weight:bold;color:${pal.dark};margin:0.8em 0 0.3em;">${inlineFormat(escapeHtml(text), pal)}</h3>`);
      i++; continue;
    }

    // H4+
    if (/^#{4,}\s/.test(stripped)) {
      flushPara(); flushBlockquote(); flushList();
      const text = stripped.replace(/^#{4,}\s+/, '');
      htmlParts.push(`<h4 style="font-size:14px;font-weight:bold;color:${rgba(pal.dark, 0.75)};margin:0.8em 0 0.3em;">${inlineFormat(escapeHtml(text), pal)}</h4>`);
      i++; continue;
    }

    // 引用
    if (stripped.startsWith('>')) {
      flushPara(); flushList();
      inBlockquote = true;
      blockquoteBuf.push(stripped.slice(1).trim());
      i++; continue;
    } else if (inBlockquote && stripped) {
      flushBlockquote();
      // 不 continue —— 和原脚本一致，这一行继续往下走列表/图片/段落判断
    }

    // 有序列表
    const olMatch = /^\d+\.\s+(.+)$/.exec(stripped);
    if (olMatch) {
      flushPara(); flushBlockquote();
      if (!inList) { inList = true; isOrderedList = true; }
      listItems.push(olMatch[1]);
      i++; continue;
    }

    // 无序列表
    const ulMatch = /^[-*+]\s+(.+)$/.exec(stripped);
    if (ulMatch) {
      flushPara(); flushBlockquote();
      if (!inList || isOrderedList) { flushList(); inList = true; isOrderedList = false; }
      listItems.push(ulMatch[1]);
      i++; continue;
    } else if (inList && !stripped) {
      flushList();
      // 不 continue —— 紧接着的空行判断会再 flush 一次（幂等）并推进 i
    }

    // 空行
    if (!stripped) {
      flushPara(); flushBlockquote(); flushList();
      i++; continue;
    }

    // 配图占位符（未出图）
    const placeholder = PLACEHOLDER_LINE.exec(stripped);
    if (placeholder) {
      flushPara(); flushBlockquote(); flushList();
      const desc = escapeHtml(placeholder[1]);
      htmlParts.push(
        `<div style="margin:1.2em 0;padding:28px 16px;border:1.5px dashed ${rgba(pal.accent, 0.45)};border-radius:10px;background:${rgba(pal.accent, 0.05)};text-align:center;">` +
        `<div style="font-size:22px;line-height:1;margin-bottom:8px;">🖼️</div>` +
        `<div style="font-size:13px;color:${rgba(pal.dark, 0.55)};line-height:1.5;">建议配图：${desc}</div>` +
        `<div style="font-size:11px;color:${rgba(pal.dark, 0.35)};margin-top:4px;">（尚未生成，点"生成配图"后自动替换）</div>` +
        `</div>`
      );
      i++; continue;
    }

    // 图片 ![alt](src) —— 按 SOP：不加 border-radius，全宽居中显示
    const img = IMAGE_LINE.exec(stripped);
    if (img) {
      flushPara(); flushBlockquote(); flushList();
      const alt = escapeHtml(img[1]);
      const src = escapeHtml(img[2].trim());
      htmlParts.push(
        `<p style="text-align:center;margin:1.2em 0;"><img src="${src}" alt="${alt}" style="max-width:100%;height:auto;display:block;margin:0 auto;"></p>`
      );
      i++; continue;
    }

    // 普通段落
    paraBuf.push(stripped);
    i++;
  }

  flushPara(); flushBlockquote(); flushList();
  return htmlParts.join('\n');
}

function buildFullHtml(bodyHtml, digest, pal) {
  const digestBox = digest
    ? `<section style="background:${rgba(pal.accent, 0.07)};border-radius:8px;padding:16px 20px;margin:0 0 2em 0;">
  <p style="font-size:14px;line-height:1.5;color:${rgba(pal.dark, 0.65)};margin:0;font-style:italic;">${escapeHtml(digest)}</p>
</section>`
    : '';
  return `<section style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;max-width:720px;margin:0 auto;padding:0 16px;background:${pal.bg};color:${rgba(pal.dark, 0.9)};">
${digestBox}
${bodyHtml}
<p style="font-size:13px;color:#999;text-align:center;margin-top:3em;padding-top:1em;border-top:1px solid ${rgba(pal.dark, 0.12)};">
  — END —
</p>
</section>`;
}

// 主入口：markdown → 微信可直接粘贴的内联样式 HTML 字符串。
// opts.brand 传品牌对象则取 accentColor/darkColor/bgColor；不传或 brand.id==='none' 时用中性默认色。
// opts.title 目前仅作为可读性注释写入（微信标题走后台单独字段，不进正文，和原脚本行为一致）。
export function renderWechatHtml(markdown, opts = {}) {
  const { brand, title = '', digest = '' } = opts;
  const pal = resolvePalette(brand);
  const bodyHtml = mdBodyToHtml(markdown, pal);
  const titleComment = title ? `<!-- 标题：${escapeHtml(title).replace(/--/g, '——')} -->\n` : '';
  return titleComment + buildFullHtml(bodyHtml, digest, pal);
}
