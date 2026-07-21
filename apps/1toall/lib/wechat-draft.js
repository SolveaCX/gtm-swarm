// 公众号草稿箱直发：拿公众号成品文 markdown → 行内样式 HTML → 图片换微信 CDN → draft/add。
// 方法论对齐 477 的 md2wechat skill（本机 CLI 版），这里做成服务端零依赖实现——
// 线上服务器没有那个 CLI，也不该让「发公众号」这一步依赖谁的电脑开着。
// 凭证存 wsSettings.wechat（appid/secret，secret 永不回显）；微信要求服务器出口 IP 在
// 公众号后台「IP 白名单」里，40164 报错时把 IP 拎出来教人加白。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { OUTPUT_DIR } from '../config.js';
import { wsSettings } from './store.js';

const WX = 'https://api.weixin.qq.com/cgi-bin';

let tokenCache = { at: 0, token: null, appid: null };

function creds() {
  const w = (wsSettings.get() || {}).wechat || {};
  if (!w.appid || !w.secret) {
    const e = new Error('还没配公众号凭证——去「设置 → 公众号发布」填 AppID 和 AppSecret（公众号后台「设置与开发 → 基本配置」里拿）');
    e.code = 'NO_CREDS';
    throw e;
  }
  return w;
}

async function wxFetch(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30_000) });
  const data = await res.json().catch(() => ({}));
  if (data.errcode) {
    let msg = `微信接口报错 ${data.errcode}：${data.errmsg || ''}`;
    if (data.errcode === 40164) {
      const ip = /invalid ip ([\d.]+)/.exec(data.errmsg || '')?.[1];
      msg = `服务器 IP${ip ? ` ${ip}` : ''} 不在公众号的 IP 白名单里。去公众号后台「设置与开发 → 基本配置 → IP 白名单」把它加上（生效约 5 分钟），再点一次。`;
    } else if (data.errcode === 40001 || data.errcode === 40125) {
      msg = 'AppSecret 不对或已被重置——去「设置 → 公众号发布」重新填一遍。';
    }
    const e = new Error(msg);
    e.errcode = data.errcode;
    throw e;
  }
  return data;
}

async function accessToken() {
  const { appid, secret } = creds();
  if (tokenCache.token && tokenCache.appid === appid && Date.now() - tokenCache.at < 100 * 60e3) return tokenCache.token;
  const d = await wxFetch(`${WX}/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`);
  tokenCache = { at: Date.now(), token: d.access_token, appid };
  return d.access_token;
}

// /output/xxx.png → 磁盘路径（只认 output 里的产物，不让路径逃逸）
function localImagePath(url) {
  const m = /^\/output\/([^?#]+)/.exec(String(url || '').trim());
  if (!m) return null;
  const p = path.resolve(OUTPUT_DIR, m[1]);
  return p.startsWith(path.resolve(OUTPUT_DIR)) && fs.existsSync(p) ? p : null;
}

// 微信 uploadimg 限 1MB、封面 2MB：超了用 ffmpeg 压成 jpg（服务器跑视频线，ffmpeg 必在）
function readCompressed(p, maxBytes) {
  let buf = fs.readFileSync(p);
  if (buf.length <= maxBytes) return { buf, ext: path.extname(p).slice(1) || 'png' };
  for (const q of [4, 8, 14, 20]) {
    const tmp = path.join(os.tmpdir(), `wx-${Date.now()}-${q}.jpg`);
    try {
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', p, '-vf', 'scale=min(1080\\,iw):-2', '-q:v', String(q), tmp]);
      buf = fs.readFileSync(tmp);
      fs.unlinkSync(tmp);
      if (buf.length <= maxBytes) return { buf, ext: 'jpg' };
    } catch { /* 压不动就用下一档 */ }
  }
  throw new Error(`图片压到最狠还是超过 ${(maxBytes / 1048576).toFixed(0)}MB：${path.basename(p)}`);
}

async function uploadMultipart(url, buf, filename) {
  const form = new FormData();
  form.append('media', new Blob([buf]), filename);
  return wxFetch(url, { method: 'POST', body: form });
}

// 正文图 → 微信 CDN URL（不占素材库额度）；封面 → 永久素材 media_id
async function uploadBodyImage(p, token) {
  const { buf, ext } = readCompressed(p, 1024 * 1024);
  const d = await uploadMultipart(`${WX}/media/uploadimg?access_token=${token}`, buf, `img.${ext}`);
  return d.url;
}
async function uploadThumb(p, token) {
  const { buf, ext } = readCompressed(p, 2 * 1024 * 1024);
  const d = await uploadMultipart(`${WX}/material/add_material?access_token=${token}&type=image`, buf, `cover.${ext}`);
  return d.media_id;
}

// markdown → 公众号编辑器吃得下的行内样式 HTML（微信会剥 class/id，只能行内 style）
const S = {
  p: 'margin:0 0 18px;font-size:16px;line-height:1.8;color:#333;letter-spacing:.4px;',
  h2: 'margin:34px 0 16px;font-size:19px;font-weight:700;color:#111;line-height:1.5;',
  h3: 'margin:26px 0 12px;font-size:17px;font-weight:700;color:#111;',
  img: 'max-width:100%;border-radius:6px;display:block;margin:8px auto 6px;',
  figcap: 'text-align:center;font-size:13px;color:#999;margin:0 0 18px;',
  quote: 'margin:0 0 18px;padding:10px 16px;border-left:3px solid #d0d0d0;color:#666;font-size:15px;line-height:1.75;background:#fafafa;',
  li: 'margin:0 0 8px;font-size:16px;line-height:1.75;color:#333;',
  hr: 'border:none;border-top:1px solid #e5e5e5;margin:28px 0;',
  code: 'background:#f5f5f5;padding:2px 5px;border-radius:4px;font-size:14px;font-family:Menlo,monospace;',
  link: 'color:#576b95;text-decoration:none;',
};
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineWx(s) {
  s = escHtml(s);
  s = s.replace(/`([^`]+)`/g, `<code style="${S.code}">$1</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 公众号正文里外链不可点，保留「文字（链接）」的读法
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, `<span style="${S.link}">$1</span>（$2）`);
  return s;
}

export function mdToWxHtml(md, imgUrlMap = new Map()) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  let html = '';
  let listBuf = null;
  const flushList = () => { if (listBuf) { html += `<ul style="padding-left:22px;margin:0 0 18px;">${listBuf}</ul>`; listBuf = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim());
    if (img) {
      flushList();
      const src = imgUrlMap.get(img[2]) || img[2];
      html += `<img src="${escHtml(src)}" style="${S.img}">`;
      if (img[1]) html += `<p style="${S.figcap}">${escHtml(img[1])}</p>`;
      continue;
    }
    const h = /^(#{1,6})\s+(.+)$/.exec(line);
    if (h) { flushList(); html += `<h${h[1].length <= 2 ? 2 : 3} style="${h[1].length <= 2 ? S.h2 : S.h3}">${inlineWx(h[2])}</h${h[1].length <= 2 ? 2 : 3}>`; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushList(); html += `<hr style="${S.hr}">`; continue; }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) { flushList(); html += `<blockquote style="${S.quote}">${inlineWx(q[1])}</blockquote>`; continue; }
    const li = /^\s*[-*•]\s+(.+)$/.exec(line);
    if (li) { listBuf = (listBuf || '') + `<li style="${S.li}">${inlineWx(li[1])}</li>`; continue; }
    if (!line.trim()) { flushList(); continue; }
    flushList();
    html += `<p style="${S.p}">${inlineWx(line)}</p>`;
  }
  flushList();
  return html;
}

/**
 * 把一篇公众号成品文推进草稿箱。
 * markdown 里的 /output/ 图片全部上传换微信 CDN；封面用 coverUrl（没有就取正文第一张图）。
 * 返回 { media_id, images, title }。
 */
export async function pushDraft({ markdown, title, digest = '', coverUrl = '' }) {
  const token = await accessToken();
  // 1) 收集正文图片 → 上传换 URL
  const imgUrls = [...String(markdown).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  const imgUrlMap = new Map();
  for (const u of imgUrls) {
    if (imgUrlMap.has(u)) continue;
    const p = localImagePath(u);
    if (p) imgUrlMap.set(u, await uploadBodyImage(p, token));
  }
  // 2) 封面：指定的 > 正文第一张能用的
  const thumbSrc = localImagePath(coverUrl) || imgUrls.map(localImagePath).find(Boolean);
  if (!thumbSrc) throw new Error('找不到能当封面的图（公众号草稿必须有封面）——这篇成品文里没有本地产出的图片');
  const thumbId = await uploadThumb(thumbSrc, token);
  // 3) 组稿
  const t = String(title || '').trim().slice(0, 64) || '未命名文章';
  const content = mdToWxHtml(markdown, imgUrlMap);
  const d = await wxFetch(`${WX}/draft/add?access_token=${token}`, {
    method: 'POST',
    // 微信这个接口吃不了 \uXXXX 转义，得发原始 UTF-8
    body: Buffer.from(JSON.stringify({ articles: [{ title: t, digest: String(digest).slice(0, 120), content, thumb_media_id: thumbId, need_open_comment: 1 }] }).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))),
    headers: { 'Content-Type': 'application/json' },
  });
  return { media_id: d.media_id, images: imgUrlMap.size, title: t };
}
