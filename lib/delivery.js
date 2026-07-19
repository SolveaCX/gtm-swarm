// 本地交付文件夹（示例）：人（运营人）→ 账号（品牌）→ 交付包 → {视频,图片,文案}
//   一条内容 = 一个交付包，视频/图片/文案各归各的子文件夹，附「交付清单.md」。
import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, ASSETS_DIR } from '../config.js';
import { MEDIA_ROOT } from './dispatch.js';

// 交付根目录
const DELIVERY_ROOT = path.join(MEDIA_ROOT, '_交付');

// 运营人归属：品牌B/某公司 归 团队B，其余归 用户（与账号看板一致）
export function ownerOfBrand(brandName) {
  return /shulex|某公司/i.test(brandName || '') ? '团队B' : '用户';
}

// /media|/output|/assets url → 本地绝对路径
function urlToLocal(url) {
  const dec = decodeURIComponent(String(url || ''));
  if (dec.startsWith('/media/')) return path.join(MEDIA_ROOT, dec.slice(7));
  if (dec.startsWith('/output/')) return path.join(OUTPUT_DIR, dec.slice(8));
  if (dec.startsWith('/assets/')) return path.join(ASSETS_DIR, dec.slice(8));
  return null;
}

const safe = (s) => String(s || '').replace(/[\/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

// 交付标准（每个交付包必须齐的东西，写进交付清单）
const STANDARD = [
  '视频/：成片（.mp4/.mov），横屏 16:9 或竖屏 9:16 按平台',
  '图片/：封面 + 配图（.png/.jpg）；封面按平台尺寸（YouTube 16:9、B站 4:3、竖屏 3:4）',
  '文案/：标题 + 正文 + tags（publish_copy.md / 各平台文案）',
  '缺任何一类 = 交付不完整，回原任务补齐',
];

// 把一条内容（work）整理成一个交付包
export function organizeDelivery(work, { owner, brandName }) {
  const packName = safe(`${String(work.at || '').slice(0, 10) || '未注日期'}-${work.title || work.id}`);
  const dir = path.join(DELIVERY_ROOT, safe(owner), safe(brandName || '无品牌'), packName);
  const sub = { 视频: path.join(dir, '视频'), 图片: path.join(dir, '图片'), 文案: path.join(dir, '文案') };
  Object.values(sub).forEach((d) => fs.mkdirSync(d, { recursive: true }));

  const counts = { 视频: 0, 图片: 0, 文案: 0 };
  let textIdx = 0;
  for (const it of work.items || []) {
    try {
      if (it.type === 'video') {
        const src = urlToLocal(it.url);
        if (src && fs.existsSync(src)) { fs.copyFileSync(src, path.join(sub.视频, path.basename(src))); counts.视频++; }
      } else if (it.type === 'image') {
        const src = urlToLocal(it.url);
        if (src && fs.existsSync(src)) { fs.copyFileSync(src, path.join(sub.图片, path.basename(src))); counts.图片++; }
      } else if (it.type === 'text') {
        if (it.url) { // 已是文件（如 publish_copy.md）
          const src = urlToLocal(it.url);
          if (src && fs.existsSync(src)) { fs.copyFileSync(src, path.join(sub.文案, path.basename(src))); counts.文案++; }
        } else if (it.content) { // 轻内容正文，落成 md
          const name = safe(it.label || `文案${++textIdx}`) + '.md';
          fs.writeFileSync(path.join(sub.文案, name), String(it.content)); counts.文案++;
        }
      }
    } catch { /* 单个文件失败不阻塞整包 */ }
  }

  // 交付清单：标准 + 本包实况 + 缺漏提醒
  const missing = ['视频', '图片', '文案'].filter((k) => !counts[k]);
  const listMd = `# 交付清单 · ${work.title || work.id}

- 运营人：${owner}
- 账号（品牌）：${brandName || '无品牌'}
- 交付包：${packName}
- 整理时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')}

## 本包实况

| 类别 | 数量 |
|---|---|
| 🎬 视频 | ${counts.视频} |
| 🖼 图片 | ${counts.图片} |
| ✍️ 文案 | ${counts.文案} |

${missing.length ? `> ⚠️ 缺：${missing.join(' / ')} —— 交付不完整，回原任务补齐。` : '> ✅ 视频 / 图片 / 文案齐全。'}

## 交付标准

${STANDARD.map((s) => `- ${s}`).join('\n')}
`;
  fs.writeFileSync(path.join(dir, '交付清单.md'), listMd);
  return { dir, counts, missing };
}
