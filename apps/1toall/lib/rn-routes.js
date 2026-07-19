// 移植自 11agents-rednote server.js（/Users/YOU/Downloads/APP/11ag/11agents-rednote/server.js）
// 挂载小红书四件套路由：学风格 / 风格列表 / 生成成套文案 / 批量出图 / 合成视频。
// multipart 解析用的是源码里那套极简 parseMultipart，一起搬了过来。
import { read, write } from './store.js';
import {
  fetchXhsNote,
  learnStyle,
  generateXhs,
  generateImages,
  composeVideo,
} from './rednote-engine.js';

/* ── learnedStyles 集合：store.js 只导出成品集合（brands/styles/...）和 read/write 原语，
   没有把内部的 makeCollection 工厂函数导出。按「不改 store.js」的约束，这里直接用它导出的
   read/write 原语复刻一套同样行为的集合，落盘到 data/learnedStyles.json（跟其他集合同目录）── */
function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(performance.now() % 1000)}`;
}
const learnedStyles = {
  all: () => read('learnedStyles', []),
  get: (itemId) => read('learnedStyles', []).find((x) => x.id === itemId) || null,
  create: (obj) => {
    const list = read('learnedStyles', []);
    const item = { id: genId('ls'), createdAt: new Date().toISOString(), ...obj };
    list.unshift(item);
    write('learnedStyles', list);
    return item;
  },
  remove: (itemId) => {
    const list = read('learnedStyles', []);
    const next = list.filter((x) => x.id !== itemId);
    write('learnedStyles', next);
    return list.length !== next.length;
  },
};

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, err, code = 500) => res.status(code).json({ ok: false, error: err?.message || String(err) });

// multipart 极简解析（照搬 rednote server.js，只取字段和文件，够用）
function parseMultipart(buf, boundary) {
  const parts = []; const b = Buffer.from(`--${boundary}`);
  let i = buf.indexOf(b);
  while (i !== -1) {
    const next = buf.indexOf(b, i + b.length);
    if (next === -1) break;
    const seg = buf.slice(i + b.length + 2, next - 2);
    const hEnd = seg.indexOf('\r\n\r\n');
    if (hEnd !== -1) {
      const head = seg.slice(0, hEnd).toString();
      const body = seg.slice(hEnd + 4);
      const name = /name="([^"]+)"/.exec(head)?.[1] || '';
      const mime = /Content-Type: (\S+)/.exec(head)?.[1] || '';
      parts.push({ name, mime, body });
    }
    i = next;
  }
  return parts;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const XHS_LINK_RE = /https?:\/\/(?:xhslink\.com|www\.xiaohongshu\.com|xiaohongshu\.com)\/[^\s]+/;

export function mountRn(app) {
  // POST /api/rn/learn-style — multipart：text 字段（一句话描述 / 一段爆文正文 / 一个小红书链接）+ image 文件≤5张
  // → AI 多模态蒸馏出 {name,desc,dna[],visual}，过质量闸门后入 learnedStyles 集合
  app.post('/api/rn/learn-style', async (req, res) => {
    try {
      const ct = req.headers['content-type'] || '';
      let text = '', images = [];
      if (ct.includes('multipart/form-data')) {
        const boundary = /boundary=(.+)$/.exec(ct)?.[1];
        const raw = await readRawBody(req);
        for (const pt of parseMultipart(raw, boundary)) {
          if (pt.name === 'text') text = pt.body.toString('utf8');
          else if (pt.name === 'image' && /^image\//.test(pt.mime) && images.length < 5)
            images.push(`data:${pt.mime};base64,${pt.body.toString('base64')}`);
        }
      } else {
        text = (req.body && req.body.text) || '';
      }
      // 贴的是小红书链接 → 服务端自动抓正文
      const urlM = text.match(XHS_LINK_RE);
      if (urlM) {
        const fetched = fetchXhsNote(urlM[0]);
        if (fetched && fetched.length > 100) text = fetched;
        else if (!images.length) return fail(res, new Error('抓不到这条笔记（可能需要登录或已下架）——直接贴正文文字试试'), 422);
      }
      const st = await learnStyle({ text, images });
      ok(res, learnedStyles.create(st));
    } catch (e) {
      fail(res, e, 422);
    }
  });

  // GET /api/rn/styles — 已学到的风格列表
  app.get('/api/rn/styles', (req, res) => ok(res, learnedStyles.all()));

  // DELETE /api/rn/styles/:id — 删掉一个学到的风格
  app.delete('/api/rn/styles/:id', (req, res) => ok(res, { removed: learnedStyles.remove(req.params.id) }));

  // POST /api/rn/xhs — {idea, brandBlock, styleId} → 生成小红书成套内容
  // {titles, body, tags, coverText, imageHints, visual, compliance}
  app.post('/api/rn/xhs', async (req, res) => {
    try {
      const { idea, brandBlock, styleId } = req.body || {};
      const style = styleId ? learnedStyles.get(styleId) : null;
      ok(res, await generateXhs({ idea, brandBlock, style }));
    } catch (e) {
      fail(res, e, 422);
    }
  });

  // POST /api/rn/images — {imageHints, coverText, visual, fileBase} → 逐张生成，返回 [{url:'/output/xx.png'}]
  app.post('/api/rn/images', async (req, res) => {
    try {
      const { imageHints, coverText, visual, fileBase } = req.body || {};
      const urls = await generateImages({ imageHints, coverText, visual, fileBase });
      ok(res, urls.map((url) => ({ url })));
    } catch (e) {
      fail(res, e, 422);
    }
  });

  // POST /api/rn/video — {imageUrls:['/output/..']} → ffmpeg 合成，返回 {url:'/output/xx.mp4'}
  app.post('/api/rn/video', async (req, res) => {
    try {
      const { imageUrls } = req.body || {};
      const url = await composeVideo({ imageUrls });
      ok(res, { url });
    } catch (e) {
      fail(res, e, 500);
    }
  });
}
