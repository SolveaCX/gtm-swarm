// CLI 接入：把 Claude Code / Codex 绑成系统的产能机。
// MCP Streamable HTTP（POST JSON-RPC）端点 + Bearer token（token 自带 workspace，
// 形如 otk_<workspace>_<48hex>，服务端只存 sha256 哈希）。绑定后 CLI 可以读品牌大脑、
// 领视频任务书、按环境自检指南把本机装成能产视频的 worker，交付后回写交付记录。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA_DIR, OUTPUT_DIR } from '../config.js';
import { brands, cliTokens, jobs } from './store.js';
import { assembleJobPrompt, harvest } from './dispatch.js';
import { runWithWorkspace, currentWorkspace } from './workspace-context.js';

const TOKEN_RE = /^otk_([a-z0-9][a-z0-9-]{0,62})_([a-f0-9]{48})$/;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── token 铸造 / 校验 ──
export function mintCliToken(label) {
  const ws = currentWorkspace();
  const token = `otk_${ws}_${crypto.randomBytes(24).toString('hex')}`;
  const row = cliTokens.create({
    label: String(label || 'CLI').slice(0, 60),
    tokenHash: sha256(token),
    tokenTail: token.slice(-6),
    lastUsedAt: null,
  });
  return { row, token }; // token 只在铸造这一次返回明文
}

export function verifyCliToken(authHeader) {
  const raw = String(authHeader || '');
  const bearer = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  const m = TOKEN_RE.exec(bearer);
  if (!m) return null;
  const [, workspace] = m;
  const hash = sha256(bearer);
  return runWithWorkspace(workspace, () => {
    const row = cliTokens.all().find((t) => t.tokenHash === hash);
    if (!row) return null;
    cliTokens.update(row.id, { lastUsedAt: new Date().toISOString() });
    return { workspace, tokenId: row.id, label: row.label };
  });
}

// ── 品牌目录解析（与 server.js 的 mediaRootDirs/hqDirForBrand 同规则的最小副本）──
function mediaDirs() {
  try {
    return fs.readdirSync(MEDIA_DIR, { withFileTypes: true })
      .filter((e) => {
        if (e.name.startsWith('.') || e.name.startsWith('_')) return false;
        if (e.isDirectory()) return true;
        if (e.isSymbolicLink()) {
          try { return fs.statSync(path.join(MEDIA_DIR, e.name)).isDirectory(); } catch { return false; }
        }
        return false;
      })
      .map((e) => e.name);
  } catch { return []; }
}
function dirForBrand(brand) {
  if (!brand) return null;
  const names = mediaDirs();
  return names.find((n) => n === brand.name) ||
    names.find((n) => brand.name.includes(n) || n.includes(brand.name.split(' ')[0])) || null;
}
function resolveBrand(brandName) {
  const all = brands.all();
  if (!all.length) return null;
  if (!brandName) return all[0];
  const q = String(brandName).trim().toLowerCase();
  return all.find((b) => b.name.toLowerCase() === q) ||
    all.find((b) => b.name.toLowerCase().includes(q)) || all[0];
}
function readBrainDoc(dir, name) {
  try {
    const p = path.join(MEDIA_DIR, dir, '知识库', `${name}.md`);
    const raw = fs.readFileSync(p, 'utf8');
    return raw.length > 6000 ? raw.slice(0, 6000) + '\n…（截断）' : raw;
  } catch { return null; }
}

// ── 工具实现 ──
const SETUP_GUIDE = `# 1toAll 产能机环境自检与安装指南

绑定 CLI 后，你的电脑就是系统的一台产能机。按能力装环境——装到哪级，就能接哪级的活。

## 能力分级

| 级别 | 能干的活 | 必装 |
|---|---|---|
| L1 文字 | 文案/脚本（系统线上自己也能干） | 无（CLI 即可） |
| L2 视频 | 竖屏/横屏成片全链路 | 下面全部 |

## ⓪ 先判断：这台机器是不是已经满配？

**跑过 1toAll 视频生产线的电脑（比如 477 的 Mac）= 天然满配，下面全部跳过、直接开工领活。**
自检原则：**等价能力即通过，绝不重复安装**——
- 字幕转写：已有 **mlx_whisper**（Apple 芯片）或 faster-whisper，任一即可
- 中文字体：macOS 自带 PingFang 即可，不用装 Noto
- 配音：本机已有可用 TTS 管线（Qwen/keke/ElevenLabs 任一按渠道要求）即可
- CLI：claude 或 codex 任一即可

## L2 视频环境清单（macOS / Linux 通用）

逐条在终端执行自检，**缺哪个装哪个，已有等价物就跳过**：

\`\`\`bash
# 1) CLI 本体（Claude Code 或 Codex，至少其一）
claude --version || codex --version

# 2) ffmpeg / ffprobe（拼接与检测）
ffmpeg -version | head -1 || { echo 安装: brew install ffmpeg  # Linux: apt install ffmpeg; }

# 3) python3 + Pillow（画面渲染）
python3 -c "import PIL; print('Pillow ok')" || pip3 install pillow

# 4) 字幕词级转写：mlx_whisper（Apple 芯片）或 faster-whisper 任一即可，都没有才装
python3 -c "import mlx_whisper" 2>/dev/null && echo "mlx_whisper ok（跳过 faster-whisper）" \
  || python3 -c "import faster_whisper; print('faster-whisper ok')" || pip3 install faster-whisper

# 5) 中文字体（渲染字幕/标题）
#    macOS 自带 PingFang 即可；Linux 装 Noto：apt install fonts-noto-cjk

# 6) flatkey key（文字/图片/配音全走它；用你自己的 key，绝不写进代码/仓库）
[ -n "$FLATKEY_API_KEY" ] && echo "key ok" || echo "缺 FLATKEY_API_KEY 环境变量"
\`\`\`

## 配音与转写怎么走（一个 key 架构）

- 配音（中英）：ElevenLabs 走 flatkey **原生路由** \`POST https://router.flatkey.ai/v1/text-to-speech/{voice_id}\`（不是 OpenAI 的 /audio/speech）
- 字幕转写：本地 faster-whisper（词级时间戳，无 key），输出整形成 \`segments[].words[].{word,start,end}\`

## 视频 skill 包

成片方法论在私有 skill 包里（含渲染脚本/字幕对齐/画幅规范）。当前版本：找 477 领取解压到 \`~/shared-skills/\`；后续版本改为系统内直发。

## 开工方式

1. 让 CLI 调 \`list_video_channels\` 看有哪些渠道（画幅/时长/超时）
2. 调 \`get_video_task_brief\` 传 channel_id + 选题，拿到完整任务书（含品牌大脑）
3. 本机跑完，调 \`submit_work_note\` 回报交付（成片路径/时长/自检结论）
`;

const TOOLS = [
  {
    name: 'one_to_all_status',
    description: '看当前接入状态：workspace、品牌数、可用渠道数。绑定后先调这个确认连通。',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const bs = brands.all();
      const channels = bs.flatMap((b) => b.channels || []);
      return {
        workspace: currentWorkspace(),
        brands: bs.map((b) => ({ name: b.name, type: b.type || 'brand' })),
        videoChannels: channels.length,
        server: '1toall',
      };
    },
  },
  {
    name: 'get_brand_brain',
    description: '读品牌大脑（业务档案/品牌规范/内容策略三份核心知识）。产任何内容前必读。',
    inputSchema: { type: 'object', properties: { brand_name: { type: 'string', description: '品牌名，缺省取第一个品牌' } } },
    run: ({ brand_name } = {}) => {
      const b = resolveBrand(brand_name);
      if (!b) return { error: '当前 workspace 还没有品牌' };
      const dir = dirForBrand(b);
      const docs = {};
      for (const name of ['业务档案', '品牌规范', '内容策略']) {
        const t = dir ? readBrainDoc(dir, name) : null;
        if (t) docs[name] = t;
      }
      return { brand: b.name, type: b.type || 'brand', tagline: b.tagline || '', docs, docsFound: Object.keys(docs).length };
    },
  },
  {
    name: 'list_video_channels',
    description: '列出品牌的视频渠道（id/画幅说明/超时分钟）。领活前先看这里。',
    inputSchema: { type: 'object', properties: { brand_name: { type: 'string' } } },
    run: ({ brand_name } = {}) => {
      const b = resolveBrand(brand_name);
      if (!b) return { error: '当前 workspace 还没有品牌' };
      return {
        brand: b.name,
        channels: (b.channels || []).map((c) => ({ id: c.id, label: c.label, timeoutMin: c.timeoutMin || 90 })),
      };
    },
  },
  {
    name: 'get_video_task_brief',
    description: '按渠道生成完整视频任务书：渠道生产指令（{{idea}} 已替换为选题）+ 品牌大脑三份文档。拿到后在本机执行。',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string', description: '渠道 id，见 list_video_channels' },
        topic: { type: 'string', description: '选题（一句话或文章链接）' },
      },
      required: ['channel_id', 'topic'],
    },
    run: ({ channel_id, topic }) => {
      const all = brands.all();
      let brand = null; let channel = null;
      for (const b of all) {
        const hit = (b.channels || []).find((c) => c.id === channel_id);
        if (hit) { brand = b; channel = hit; break; }
      }
      if (!channel) return { error: `渠道不存在：${channel_id}（用 list_video_channels 查可用 id）` };
      const dir = dirForBrand(brand);
      const brain = ['业务档案', '品牌规范', '内容策略']
        .map((n) => { const t = dir ? readBrainDoc(dir, n) : null; return t ? `\n\n---\n\n# ${n}\n\n${t}` : ''; })
        .join('');
      const instruction = String(channel.promptTemplate || channel.prompt || '')
        .replaceAll('{{idea}}', String(topic))
        .replaceAll('{{outDir}}', '（本机自选产物目录，交付时用 submit_work_note 报路径）');
      return {
        brand: brand.name,
        channel: { id: channel.id, label: channel.label, timeoutMin: channel.timeoutMin || 90 },
        topic,
        brief: `${instruction}${brain}`,
      };
    },
  },
  {
    name: 'get_setup_guide',
    description: '产能机环境自检与安装指南：ffmpeg/python/faster-whisper/字体/flatkey key/skill 包。新机器绑定后先跑一遍。',
    inputSchema: { type: 'object', properties: {} },
    run: () => ({ guide: SETUP_GUIDE }),
  },
  {
    name: 'submit_work_note',
    description: '交付回报：把完成情况写进品牌空间「交付记录」（标题/渠道/摘要/产物路径）。成片文件本身暂留产能机本机，媒体直传后续版本开放。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '这单活的标题' },
        channel_id: { type: 'string' },
        summary: { type: 'string', description: '交付摘要：成片规格/时长/自检结论' },
        files_note: { type: 'string', description: '产物在哪台机器哪个路径' },
        brand_name: { type: 'string' },
      },
      required: ['title', 'summary'],
    },
    run: ({ title, channel_id, summary, files_note, brand_name } = {}) => {
      const b = resolveBrand(brand_name);
      if (!b) return { error: '当前 workspace 还没有品牌' };
      let dir = dirForBrand(b);
      if (!dir) {
        dir = b.name.replace(/[^\w一-龥-]+/g, '-');
        fs.mkdirSync(path.join(MEDIA_DIR, dir), { recursive: true });
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
      const slug = String(title).replace(/[^\w一-龥-]+/g, '-').slice(0, 40) || 'delivery';
      const rel = path.join(dir, '交付记录', `${stamp}-${slug}.md`);
      const abs = path.join(MEDIA_DIR, rel);
      const body = `# ${title}\n\n- 时间：${new Date().toISOString()}\n- 渠道：${channel_id || '-'}\n- 品牌：${b.name}\n\n## 摘要\n\n${summary}\n\n## 产物位置\n\n${files_note || '（未填）'}\n`;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
      return { saved: true, path: rel };
    },
  },
];

// ── 任务队列（远程认领）+ 分片上传 ──
// 上传会话：内存态 + OUTPUT_DIR/cli-uploads/ 下的临时文件；2 小时不动就清。
const UPLOADS = new Map();
const UPLOAD_TMP = () => { const d = path.join(OUTPUT_DIR, 'cli-uploads'); fs.mkdirSync(d, { recursive: true }); return d; };
const MAX_PART_B64 = 1_500_000;          // ≈1.1MB 二进制/片，稳过任何反代包体上限
const MAX_TOTAL = 800 * 1024 * 1024;     // 单文件 800MB 顶
setInterval(() => {
  const now = Date.now();
  for (const [id, u] of UPLOADS) if (now - u.touchedAt > 2 * 3600e3) { try { fs.rmSync(u.tmp, { force: true }); } catch {} UPLOADS.delete(id); }
}, 10 * 60e3).unref?.();

function jobBrief(job) {
  const assembled = assembleJobPrompt(job);
  if (assembled.error) return { error: assembled.error };
  return {
    task_id: job.id,
    brand: job.brandName,
    channel: { id: job.channelId, label: job.channelLabel, timeoutMin: assembled.ch?.timeoutMin || 90 },
    idea: job.idea,
    voice: job.voice || null,
    brief: assembled.prompt,
    deliver: '产物在本机做完后：用 upload_begin/upload_part/upload_commit 逐个传上来（传 task_id 即可入库到该任务目录），全部传完调 complete_task。',
  };
}

const QUEUE_TOOLS = [
  {
    name: 'list_open_tasks',
    description: '看可认领的任务队列（工作台派发的重型任务；服务器没本地 CLI 时都会排在这）。',
    inputSchema: { type: 'object', properties: {} },
    run: () => ({
      open: jobs.all().filter((j) => j.status === 'queued').map((j) => ({
        task_id: j.id, brand: j.brandName, channel: j.channelLabel, idea: j.idea, createdAt: j.createdAt,
      })),
      claimed: jobs.all().filter((j) => j.status === 'claimed').map((j) => ({
        task_id: j.id, channel: j.channelLabel, claimedBy: j.claimedBy, claimedAt: j.claimedAt,
      })),
    }),
  },
  {
    name: 'claim_task',
    description: '认领一个排队任务，返回完整任务书（与本地生产线一字不差）。认领后其他产能机看得到归属。',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    run: ({ task_id } = {}, meta = {}) => {
      const job = jobs.get(task_id);
      if (!job) return { error: `任务不存在：${task_id}` };
      if (job.status !== 'queued') return { error: `任务当前状态是 ${job.status}，只能认领 queued 的任务` };
      const brief = jobBrief(job);
      if (brief.error) return brief;
      jobs.update(task_id, {
        status: 'claimed', claimedBy: meta.label || 'CLI', claimedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(), logTail: `产能机「${meta.label || 'CLI'}」已认领，本机生产中`,
      });
      return { ...brief, suggestedModel: job.runner?.requestedModel || null };
    },
  },
  {
    name: 'release_task',
    description: '认领后干不了（环境缺/要换机器）就放回队列。',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, reason: { type: 'string' } }, required: ['task_id'] },
    run: ({ task_id, reason } = {}, meta = {}) => {
      const job = jobs.get(task_id);
      if (!job) return { error: `任务不存在：${task_id}` };
      if (job.status !== 'claimed') return { error: `只能放回 claimed 的任务（当前 ${job.status}）` };
      jobs.update(task_id, { status: 'queued', claimedBy: null, claimedAt: null, startedAt: null, logTail: `「${meta.label || 'CLI'}」放回：${reason || ''}`.slice(0, 200) });
      return { released: true };
    },
  },
  {
    name: 'complete_task',
    description: '交付收口：先把成片/封面/文案用上传三件套传进任务目录，再调这个。服务器按本地生产线同规则收割产物、进作品库。',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, note: { type: 'string', description: '交付摘要（规格/时长/自检结论）' } }, required: ['task_id'] },
    run: ({ task_id, note } = {}, meta = {}) => {
      const job = jobs.get(task_id);
      if (!job) return { error: `任务不存在：${task_id}` };
      if (job.status !== 'claimed') return { error: `只能收口 claimed 的任务（当前 ${job.status}）` };
      const products = harvest(job.outDir);
      if (!products.length) return { error: '任务目录里还没有产物——先用 upload_begin/part/commit 把成片传上来再收口' };
      jobs.update(task_id, {
        status: 'done', products, doneAt: new Date().toISOString(),
        logTail: `产能机「${meta.label || 'CLI'}」交付：${note || ''}`.slice(0, 300),
      });
      return { done: true, products: products.map((p) => ({ type: p.type, url: p.url })) };
    },
  },
  {
    name: 'fail_task',
    description: '这单确认做不出来时标失败（附原因），工作台可见可重派。',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, reason: { type: 'string' } }, required: ['task_id', 'reason'] },
    run: ({ task_id, reason } = {}, meta = {}) => {
      const job = jobs.get(task_id);
      if (!job) return { error: `任务不存在：${task_id}` };
      jobs.update(task_id, { status: 'failed', error: `产能机「${meta.label || 'CLI'}」：${reason}`.slice(0, 300), doneAt: new Date().toISOString() });
      return { failed: true };
    },
  },
  {
    name: 'upload_begin',
    description: '开始传一个文件。带 task_id 就进该任务的产物目录（推荐）；不带就进品牌「交付」目录。返回 upload_id。',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: '纯文件名，如 sample_9x16.mp4' },
        total_bytes: { type: 'number' },
        task_id: { type: 'string' },
        brand_name: { type: 'string' },
      },
      required: ['filename', 'total_bytes'],
    },
    run: ({ filename, total_bytes, task_id, brand_name } = {}) => {
      const name = path.basename(String(filename || '')).replace(/[^\w.一-龥-]+/g, '_');
      if (!name || name.startsWith('.')) return { error: '文件名不合法' };
      const bytes = Number(total_bytes);
      if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_TOTAL) return { error: `total_bytes 不合法（上限 ${MAX_TOTAL} 字节）` };
      let targetDir;
      if (task_id) {
        const job = jobs.get(task_id);
        if (!job) return { error: `任务不存在：${task_id}` };
        targetDir = job.outDir;
      } else {
        const b = resolveBrand(brand_name);
        if (!b) return { error: '没有品牌可挂靠' };
        const dir = dirForBrand(b) || b.name.replace(/[^\w一-龥-]+/g, '-');
        targetDir = path.join(MEDIA_DIR, dir, '交付');
      }
      const targetAbs = path.resolve(targetDir, name);
      const mediaRootAbs = path.resolve(MEDIA_DIR);
      if (targetAbs !== mediaRootAbs && !targetAbs.startsWith(mediaRootAbs + path.sep)) return { error: '目标越界' };
      const id = `up_${crypto.randomBytes(8).toString('hex')}`;
      UPLOADS.set(id, { targetAbs, bytes, received: 0, nextIndex: 0, tmp: path.join(UPLOAD_TMP(), `${id}.part`), touchedAt: Date.now(), workspace: currentWorkspace() });
      return { upload_id: id, part_hint: `每片 base64 ≤ ${MAX_PART_B64} 字符（约 1MB 二进制），按 index 从 0 顺序传` };
    },
  },
  {
    name: 'upload_part',
    description: '传一片（base64），index 从 0 递增。',
    inputSchema: {
      type: 'object',
      properties: { upload_id: { type: 'string' }, index: { type: 'number' }, data_base64: { type: 'string' } },
      required: ['upload_id', 'index', 'data_base64'],
    },
    run: ({ upload_id, index, data_base64 } = {}) => {
      const u = UPLOADS.get(upload_id);
      if (!u || u.workspace !== currentWorkspace()) return { error: 'upload_id 不存在或已过期' };
      if (Number(index) !== u.nextIndex) return { error: `片序不对：期望 index=${u.nextIndex}` };
      const b64 = String(data_base64 || '');
      if (!b64 || b64.length > MAX_PART_B64) return { error: `单片过大（≤${MAX_PART_B64} base64 字符）` };
      let buf;
      try { buf = Buffer.from(b64, 'base64'); } catch { return { error: 'base64 解码失败' }; }
      if (u.received + buf.length > u.bytes) return { error: '超过 upload_begin 申报的 total_bytes' };
      fs.appendFileSync(u.tmp, buf);
      u.received += buf.length; u.nextIndex += 1; u.touchedAt = Date.now();
      return { received: u.received, next_index: u.nextIndex };
    },
  },
  {
    name: 'upload_commit',
    description: '收尾校验并落位：传全文件 sha256，服务器校验字节数+哈希后移入目标目录，返回可访问的 /media URL。',
    inputSchema: { type: 'object', properties: { upload_id: { type: 'string' }, sha256: { type: 'string' } }, required: ['upload_id', 'sha256'] },
    run: ({ upload_id, sha256: want } = {}) => {
      const u = UPLOADS.get(upload_id);
      if (!u || u.workspace !== currentWorkspace()) return { error: 'upload_id 不存在或已过期' };
      if (u.received !== u.bytes) return { error: `字节数不符：收到 ${u.received}，申报 ${u.bytes}` };
      const got = crypto.createHash('sha256').update(fs.readFileSync(u.tmp)).digest('hex');
      if (got !== String(want).toLowerCase()) { try { fs.rmSync(u.tmp, { force: true }); } catch {} UPLOADS.delete(upload_id); return { error: 'sha256 校验失败，重新上传' }; }
      fs.mkdirSync(path.dirname(u.targetAbs), { recursive: true });
      fs.renameSync(u.tmp, u.targetAbs);
      UPLOADS.delete(upload_id);
      const rel = path.relative(path.resolve(MEDIA_DIR), u.targetAbs);
      return { saved: true, path: rel, url: '/media/' + rel.split(path.sep).map(encodeURIComponent).join('/') };
    },
  },
];
TOOLS.push(...QUEUE_TOOLS);

// ── JSON-RPC 处理 ──
export async function handleMcpRequest(body, meta = {}) {
  const { id, method, params } = body || {};
  const reply = (result) => ({ jsonrpc: '2.0', id: id ?? null, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!method) return err(-32600, 'invalid request');
  if (String(method).startsWith('notifications/')) return null; // 通知无响应
  if (method === 'initialize') {
    return reply({
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: '1toall', version: '1.0.0' },
      instructions: `已接入 1toAll（workspace: ${currentWorkspace()}，令牌: ${meta.label || 'CLI'}）。先调 one_to_all_status 确认连通；新机器先 get_setup_guide 装环境；产视频用 list_video_channels → get_video_task_brief → 本机执行 → submit_work_note。`,
    });
  }
  if (method === 'ping') return reply({});
  if (method === 'tools/list') {
    return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return err(-32602, `unknown tool: ${params?.name}`);
    try {
      const out = await tool.run(params?.arguments || {}, meta);
      return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: !!(out && out.error) });
    } catch (e) {
      return reply({ content: [{ type: 'text', text: `工具执行失败：${e.message}` }], isError: true });
    }
  }
  return err(-32601, `method not found: ${method}`);
}
