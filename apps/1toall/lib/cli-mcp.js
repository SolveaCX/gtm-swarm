// CLI 接入：把 Claude Code / Codex 绑成系统的产能机。
// MCP Streamable HTTP（POST JSON-RPC）端点 + Bearer token（token 自带 workspace，
// 形如 otk_<workspace>_<48hex>，服务端只存 sha256 哈希）。绑定后 CLI 可以读品牌大脑、
// 领视频任务书、按环境自检指南把本机装成能产视频的 worker，交付后回写交付记录。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA_DIR, OUTPUT_DIR, ASSETS_DIR } from '../config.js';
import { brands, cliTokens, jobs, projects } from './store.js';
import { assembleJobPrompt, harvest, createJob, isNotDue, voiceDirective } from './dispatch.js';
import { runWithWorkspace, currentWorkspace } from './workspace-context.js';
import { costFromUsage } from './video-cost.js';

// 认领后多久没心跳算掉线（视频重活单段可能跑很久，给足余量）
export const STALE_CLAIM_MIN = 90;
// 掉线的认领放回队列：CLI 会话断了任务不该永远卡在「已认领」没人管
export function reapStaleClaims() {
  const now = Date.now();
  const dead = jobs.all().filter((j) => {
    if (j.status !== 'claimed') return false;
    const last = new Date(j.heartbeatAt || j.claimedAt || j.startedAt || 0).getTime();
    return !isNaN(last) && now - last > STALE_CLAIM_MIN * 60e3;
  });
  for (const j of dead) {
    const mins = Math.round((now - new Date(j.heartbeatAt || j.claimedAt).getTime()) / 60e3);
    jobs.update(j.id, {
      status: 'queued', claimedBy: null, claimedAt: null, startedAt: null, heartbeatAt: null,
      logTail: `产能机「${j.claimedBy || 'CLI'}」${mins} 分钟无心跳，判定掉线，已放回队列`,
    });
  }
  return dead.length;
}

const TOKEN_RE = /^otk_([a-z0-9][a-z0-9-]{0,62})_([a-f0-9]{48})$/;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── token 铸造 / 校验 ──
// 只存 sha256，明文不落盘——477 权衡后选了这条（宁可换一根，也不留明文在服务器上）。
// 忘了抄不要紧：rotateCliToken 换一根新的，机器名字和使用记录都保留。
export function mintCliToken(label) {
  const ws = currentWorkspace();
  const token = `otk_${ws}_${crypto.randomBytes(24).toString('hex')}`;
  const row = cliTokens.create({
    label: String(label || 'CLI').slice(0, 60),
    tokenHash: sha256(token),
    tokenTail: token.slice(-6),
    lastUsedAt: null,
  });
  return { row, token }; // 明文只在铸造这一次返回，不入库
}

/** 轮换：换一根新令牌，保留这台机器的名字和历史。老令牌立即失效。 */
export function rotateCliToken(id) {
  const row = cliTokens.get(id);
  if (!row) return null;
  const token = `otk_${currentWorkspace()}_${crypto.randomBytes(24).toString('hex')}`;
  cliTokens.update(id, { tokenHash: sha256(token), tokenTail: token.slice(-6), token: undefined, rotatedAt: new Date().toISOString() });
  return { row: cliTokens.get(id), token }; // 同样只这一次
}

/**
 * 补救：早先有一版把明文令牌存进了库里，这里遇到就地擦掉。
 * 在「列出令牌」和「校验令牌」时顺手跑一次，用到哪个工作区就洗哪个，不用去翻服务器。
 */
export function scrubPlaintextTokens() {
  let n = 0;
  for (const t of cliTokens.all()) {
    if (t.token) { cliTokens.update(t.id, { token: undefined }); n += 1; }
  }
  return n;
}

export function verifyCliToken(authHeader) {
  const raw = String(authHeader || '');
  const bearer = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  const m = TOKEN_RE.exec(bearer);
  if (!m) return null;
  const [, workspace] = m;
  const hash = sha256(bearer);
  return runWithWorkspace(workspace, () => {
    scrubPlaintextTokens();
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

## 🚦 装环境之前，先记住这条

**要对 1toAll 做任何事，一律先用 MCP 工具，不要开浏览器点网页、不要用 computer-use。**
看日历、读灵感、查作品、标已发、看账本、改采集节奏、控制任务，都有对应工具（连上后看 initialize 里的清单）。
确认没有对应工具时才另想办法，并且告诉 477 缺哪个——好补上。
点网页的操作没人记账、不可复现、拿不到结构化结果，出错也查不到是谁干的。

## 📦 交付的两条硬规矩

**1. 以云端为准。** 活干完了 ≠ 交付完了。文件必须传回云端系统、complete_task 收口成功才算数。
留在你本机的文件对 477 不存在——他在网页上看不到、发不了、也不进账本。

**2. 别重复劳动。** 上传前先 list_task_files 看云端已经有什么。
返工任务尤其：**只改文案就只传文案**，视频和封面自动从原作品沿用。为了改一行字重传几十兆视频是浪费。

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
- 配音：统一 ElevenLabs 走 flatkey（FLATKEY_API_KEY 即可，无需单独 ElevenLabs key；Qwen/本地声已全线退役）
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

**没有 flatkey key？** 去 https://flatkey.ai 注册拿一个（一个 key 通文字/出图/配音全部模型）。拿到后：

\`\`\`bash
# macOS 推荐存钥匙串（重启不丢、不进文件）：
security add-generic-password -s FLATKEY_API_KEY -a flatkey -w '你的key'
export FLATKEY_API_KEY="$(security find-generic-password -s FLATKEY_API_KEY -w)"
# Linux：写进 ~/.bashrc / ~/.zshrc：
echo 'export FLATKEY_API_KEY=你的key' >> ~/.bashrc
\`\`\`

> ⚠️ 产能机目前只支持 **macOS / Linux**。Windows 请先用 WSL2，原生支持在计划里。

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
    description: '仅预览：按渠道拼一份任务书看规格（不登记任务、系统不追踪、成片不进作品库）。正式开工用 create_task。',
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
        // 预览也带配音硬要求——不带的话中文渠道的预览稿会让人以为随便选引擎
        brief: `${instruction}${voiceDirective(channel) ? `\n\n${voiceDirective(channel)}` : ''}${brain}`,
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

// ── 任务队列（远程认领）+ 分片上传（断点续传）──
// 上传会话：分片确认后进度元数据落盘（<id>.meta.json + <id>.part），服务器重启不丢——
// 凭同一 upload_id 按 next_index 继续传即可。2 小时不动的会话（含重启遗留的孤儿文件）由扫盘 GC 清掉。
const UPLOADS = new Map();
const UPLOAD_TMP = () => { const d = path.join(OUTPUT_DIR, 'cli-uploads'); fs.mkdirSync(d, { recursive: true }); return d; };
const MAX_PART_B64 = 1_500_000;          // ≈1.1MB 二进制/片，稳过任何反代包体上限
const MAX_TOTAL = 800 * 1024 * 1024;     // 单文件 800MB 顶
const metaPath = (id) => path.join(UPLOAD_TMP(), `${id}.meta.json`);
function saveUploadMeta(id, u) {
  try { fs.writeFileSync(metaPath(id), JSON.stringify(u)); } catch {}
}
function dropUpload(id, u) {
  try { fs.rmSync(u?.tmp || path.join(UPLOAD_TMP(), `${id}.part`), { force: true }); } catch {}
  try { fs.rmSync(metaPath(id), { force: true }); } catch {}
  UPLOADS.delete(id);
}
// 取会话：内存没有（如服务器重启过）就从磁盘元数据复水。
// 崩溃窗口处理：append 成功但 meta 未写 → 盘上比 meta 多半片 → 截回 meta.received 续传；
// 盘上比 meta 少 = 数据损坏 → 作废会话，客户端重新 upload_begin。
function loadUpload(id) {
  if (UPLOADS.has(id)) return UPLOADS.get(id);
  try {
    const u = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
    const onDisk = fs.existsSync(u.tmp) ? fs.statSync(u.tmp).size : 0;
    if (onDisk < u.received) { dropUpload(id, u); return null; }
    if (onDisk > u.received) fs.truncateSync(u.tmp, u.received);
    UPLOADS.set(id, u);
    return u;
  } catch { return null; }
}
setInterval(() => {
  const now = Date.now();
  for (const [id, u] of UPLOADS) if (now - u.touchedAt > 2 * 3600e3) dropUpload(id, u);
  // 扫盘：清重启前遗留、内存里已无记录的过期会话文件
  try {
    for (const f of fs.readdirSync(UPLOAD_TMP())) {
      const p = path.join(UPLOAD_TMP(), f);
      try { if (now - fs.statSync(p).mtimeMs > 2 * 3600e3) fs.rmSync(p, { force: true }); } catch {}
    }
  } catch {}
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
    name: 'create_task',
    description: '正式派单：在系统里登记一单生产任务（工作台可见、可追踪、成片回作品库）。凡是要让系统记账的活都必须先 create_task——只拿任务书开工系统看不见。默认创建后立即认领给自己并返回完整任务书（claim=false 则只入队列等别的产能机领）。',
    inputSchema: {
      type: 'object',
      properties: {
        channel_id: { type: 'string', description: '渠道 id，见 list_video_channels' },
        topic: { type: 'string', description: '选题（一句话或文章链接）' },
        brand_name: { type: 'string' },
        claim: { type: 'boolean', description: '默认 true：创建后立即认领给自己并返回任务书' },
        scheduled_at: { type: 'string', description: '打算什么时候做（ISO 时间或 YYYY-MM-DD）。任务和日历是同一套：填了就排在日历那一天，不填按今天算。定时派单请配 claim=false，让到点的产能机来领。' },
      },
      required: ['channel_id', 'topic'],
    },
    run: ({ channel_id, topic, brand_name, claim = true, scheduled_at = '' } = {}, meta = {}) => {
      const b = resolveBrand(brand_name);
      if (!b) return { error: '当前 workspace 还没有品牌' };
      if (!(b.channels || []).some((c) => c.id === channel_id)) {
        return { error: `渠道不存在：${channel_id}（当前可用：${(b.channels || []).map((c) => c.id).join(', ')}）` };
      }
      let job;
      try { job = createJob({ brandId: b.id, channelId: channel_id, idea: topic, scheduledAt: scheduled_at }); }
      catch (e) { return { error: `派单失败：${e.message}` }; }
      if (!claim) return { task_id: job.id, status: job.status, note: '已入队列，工作台可见；任何产能机可 claim_task 认领' };
      const brief = jobBrief(job);
      if (brief.error) return { task_id: job.id, ...brief };
      jobs.update(job.id, {
        status: 'claimed', claimedBy: meta.label || 'CLI', claimedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(), logTail: `产能机「${meta.label || 'CLI'}」自派自领，本机生产中`,
      });
      return { ...brief, suggestedModel: job.runner?.requestedModel || null, note: '任务已登记并认领；产物传回后 complete_task 收口进作品库' };
    },
  },
  {
    name: 'list_open_tasks',
    description: '看可认领的任务队列（工作台派发的重型任务；服务器没本地 CLI 时都会排在这）。',
    inputSchema: { type: 'object', properties: {} },
    run: () => ({
      // 先把掉线的认领收回队列，别让僵尸任务霸着位置
      reclaimed: reapStaleClaims() || undefined,
      // 排期中的单独列出来：能看到、领不走——到点它们自动出现在 open 里
      scheduled: jobs.all().filter((j) => j.status === 'queued' && isNotDue(j))
        .map((j) => ({ task_id: j.id, channel: j.channelLabel, idea: String(j.idea || '').slice(0, 60), starts_at: j.scheduledAt })),
      // 顺序即优先级：477 在网页上「后移」过的排到队尾，请按返回顺序从上往下接
      open: jobs.all().filter((j) => j.status === 'queued' && !isNotDue(j))
        .sort((a, b) => new Date(a.deferredAt || a.createdAt) - new Date(b.deferredAt || b.createdAt))
        .map((j) => ({
          task_id: j.id, brand: j.brandName, channel: j.channelLabel, idea: j.idea, createdAt: j.createdAt,
          deferred: !!j.deferredAt, // 被手动后移过，优先级低
          assignedTo: j.assignedTo || null, // 指派给某台产能机；有值时请该机器优先认领
        })),
      claimed: jobs.all().filter((j) => j.status === 'claimed').map((j) => ({
        task_id: j.id, channel: j.channelLabel, claimedBy: j.claimedBy, claimedAt: j.claimedAt,
        lastHeartbeat: j.heartbeatAt || null,
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
      if (isNotDue(job)) return { error: `这条排期在 ${new Date(new Date(job.scheduledAt).getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ")}（北京时间）开工，还没到点——到点后它会自动出现在 list_open_tasks 的 open 里` };
      const brief = jobBrief(job);
      if (brief.error) return brief;
      const now = new Date().toISOString();
      jobs.update(task_id, {
        status: 'claimed', claimedBy: meta.label || 'CLI', claimedAt: now,
        heartbeatAt: now, // 心跳：CLI 定期 task_heartbeat 续期，久不续期算掉线自动回队
        startedAt: now, logTail: `产能机「${meta.label || 'CLI'}」已认领，本机生产中`,
      });
      return {
        ...brief,
        suggestedModel: job.runner?.requestedModel || null,
        heartbeat_note: `生产途中每隔十几分钟调一次 task_heartbeat（task_id=${task_id}）报活；超过 ${STALE_CLAIM_MIN} 分钟没心跳，系统会认为你掉线并把任务放回队列。`,
      };
    },
  },
  {
    name: 'task_heartbeat',
    description: '生产途中报活（建议每 10-15 分钟一次）。不报活的认领会被判定掉线、任务自动回队列，别人才好接手。⚠️ 返回里带 stop:true 就是 477 在网页上暂停/取消了这单，照 instruction 停手，别继续烧钱。',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, note: { type: 'string', description: '当前进度，一句话' } }, required: ['task_id'] },
    run: ({ task_id, note } = {}, meta = {}) => {
      const job = jobs.get(task_id);
      if (!job) return { error: `任务不存在：${task_id}` };
      // 477 在网页上按了暂停/取消 → 心跳就是通知产能机停手的那根线
      if (job.status === 'paused' || job.status === 'canceled') {
        return {
          stop: true, status: job.status,
          instruction: job.status === 'paused'
            ? '这单被暂停了：停下手上的活，已产出的中间文件留着别删，等它回到 queued 再继续。'
            : '这单被取消了：立刻停手，不用交付，也不用调 fail_task。',
        };
      }
      if (job.status !== 'claimed') return { error: `任务当前状态是 ${job.status}，只有 claimed 需要心跳` };
      jobs.update(task_id, {
        heartbeatAt: new Date().toISOString(),
        logTail: note ? `「${meta.label || 'CLI'}」${String(note).slice(0, 160)}` : job.logTail,
      });
      return { ok: true, stop: false, staleAfterMinutes: STALE_CLAIM_MIN };
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
    description: '交付收口：先把成片/封面/文案用上传三件套传进任务目录，再调这个。服务器按本地生产线同规则收割产物、进作品库。带上 usage 账本才有真实成本（线上服务器读不到你本机的会话日志）。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        note: { type: 'string', description: '交付摘要（规格/时长/自检结论）' },
        usage: { type: 'object', description: '本单实际 token 用量，同 report_usage 的字段' },
        local_dir: { type: 'string', description: '你本机放这批产物的绝对路径（如 /Users/xxx/Movies/BrandHQ/...）。填了 477 在网页上点「复制地址」才拿得到能用的路径——服务器只知道自己那份拷贝在哪。' },
      },
      required: ['task_id'],
    },
    run: ({ task_id, note, usage, local_dir } = {}, meta = {}) => {
      const job = jobs.get(task_id);
      if (!job) return { error: `任务不存在：${task_id}` };
      if (job.status !== 'claimed') return { error: `只能收口 claimed 的任务（当前 ${job.status}）` };
      let products = harvest(job.outDir);
      // 返工：只改文案就只传文案，视频/封面从原作品继承——别为了改一行字重传几十兆。
      // 同名（同 label）的以本次上传为准，其余沿用原来的。
      let inherited = [];
      if (job.reworkOf) {
        const src = jobs.get(job.reworkOf);
        const mine = new Set(products.map((p) => p.label));
        inherited = (src?.products || []).filter((p) => !mine.has(p.label));
        products = [...products, ...inherited];
      }
      if (!products.length) {
        return { error: '任务目录里还没有产物——先用 upload_begin/part/commit 把成片传上来再收口' };
      }
      const doneAt = new Date().toISOString();
      const cost = usage ? costFromUsage({ ...job, doneAt }, { ...usage, reportedBy: meta.label || 'CLI' }) : null;
      jobs.update(task_id, {
        status: 'done', products, doneAt,
        ...(cost ? { cost } : {}),
        // 产能机上的真实目录：服务器只有上传过来的那份拷贝，477 要在自己机器上打开的是这个
        ...(local_dir ? { workerOutDir: String(local_dir).slice(0, 400), workerMachine: meta.label || 'CLI' } : {}),
        logTail: `产能机「${meta.label || 'CLI'}」交付：${note || ''}`.slice(0, 300),
      });
      return {
        done: true,
        products: products.map((p) => ({ type: p.type, url: p.url })),
        ...(inherited.length ? { inheritedFromRework: inherited.map((p) => p.label) } : {}),
        cost: cost ? { totalTokens: cost.totalTokens, apiEquivalentCny: cost.apiEquivalentCny } : null,
        ...(cost ? {} : { hint: '没报 usage，账本这单只有产物没有成本。补报用 report_usage。' }),
        ...(local_dir ? {} : { dirHint: '没给 local_dir——477 在网页上点「复制地址」会拿不到你机器上的路径。下次带上。' }),
      };
    },
  },
  {
    name: 'list_task_files',
    description: '⚠️ 上传之前先调这个。看这条任务在云端**已经有哪些文件**；返工任务还会列出原作品的文件。只传你这次真的改动了的——别为了改一行文案把几十兆的视频重传一遍。',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    run: ({ task_id } = {}) => {
      const job = jobs.get(task_id);
      if (!job) return { error: `任务不存在：${task_id}` };
      const brief = (p) => ({ file: p.label, type: p.type, url: p.url });
      const already = harvest(job.outDir).map(brief);
      const src = job.reworkOf ? jobs.get(job.reworkOf) : null;
      return {
        task_id,
        uploadedThisTask: already,
        isRework: !!job.reworkOf,
        ...(src ? {
          reworkOf: job.reworkOf,
          originalFiles: (src.products || []).map(brief),
          note: '这是返工。上面 originalFiles 里的文件，你没重新上传的会自动沿用；同名文件以你这次传的为准。只改文案就只传文案。',
        } : { note: '新任务，产物要完整上传。' }),
      };
    },
  },
  {
    name: 'report_usage',
    description: '把这单实际烧的 token 报给账本（收口时忘了报、或事后补账都用这个）。金额由服务器按公开 API 价目表折算，你只报用量。',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        models: {
          type: 'array',
          description: '按模型分开报；只有一个模型也可以直接在顶层写 model/inputTokens 等',
          items: {
            type: 'object',
            properties: {
              model: { type: 'string', description: '实际解析到的模型名，如 glm-5.2' },
              inputTokens: { type: 'number' },
              outputTokens: { type: 'number' },
              cacheCreationInputTokens: { type: 'number' },
              cacheReadInputTokens: { type: 'number' },
            },
          },
        },
        requestedModel: { type: 'string', description: '你请求的模型名（可能和实际解析到的不同）' },
        client: { type: 'string', description: '跑活的客户端，如 Claude Code / Codex' },
        requestCount: { type: 'number' },
        sessionCount: { type: 'number' },
        orchestrator: { type: 'object', description: '统筹侧共享用量（订阅制不摊到单条时写这里）' },
        note: { type: 'string' },
      },
      required: ['task_id'],
    },
    run: ({ task_id, ...usage } = {}, meta = {}) => {
      const job = jobs.get(task_id);
      if (!job) return { error: `任务不存在：${task_id}` };
      const cost = costFromUsage(job, { ...usage, reportedBy: meta.label || 'CLI' });
      if (!cost) return { error: 'usage 里没有有效 token 数——至少报一个模型的 inputTokens/outputTokens' };
      jobs.update(task_id, { cost });
      return {
        recorded: true, totalTokens: cost.totalTokens,
        apiEquivalentUsd: cost.apiEquivalentUsd, apiEquivalentCny: cost.apiEquivalentCny,
        models: cost.modelNames,
      };
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
    description: '开始传一个文件。带 task_id 就进该任务的产物目录（推荐）；不带就进品牌「交付」目录。返回 upload_id。⚠️ 传之前先 list_task_files——返工任务里没改动的文件不用重传，会自动沿用。',
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
      const u = { targetAbs, bytes, received: 0, nextIndex: 0, tmp: path.join(UPLOAD_TMP(), `${id}.part`), touchedAt: Date.now(), workspace: currentWorkspace() };
      UPLOADS.set(id, u);
      saveUploadMeta(id, u);
      return { upload_id: id, part_hint: `每片 base64 ≤ ${MAX_PART_B64} 字符（约 1MB 二进制），按 index 从 0 顺序传；进度落盘，服务器重启不丢，凭同一 upload_id 按 next_index 续传` };
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
      const u = loadUpload(upload_id);
      if (!u || u.workspace !== currentWorkspace()) return { error: 'upload_id 不存在或已过期' };
      if (Number(index) !== u.nextIndex) return { error: `片序不对：期望 index=${u.nextIndex}` };
      const b64 = String(data_base64 || '');
      if (!b64 || b64.length > MAX_PART_B64) return { error: `单片过大（≤${MAX_PART_B64} base64 字符）` };
      let buf;
      try { buf = Buffer.from(b64, 'base64'); } catch { return { error: 'base64 解码失败' }; }
      if (u.received + buf.length > u.bytes) return { error: '超过 upload_begin 申报的 total_bytes' };
      fs.appendFileSync(u.tmp, buf);
      u.received += buf.length; u.nextIndex += 1; u.touchedAt = Date.now();
      saveUploadMeta(upload_id, u); // 分片确认即落盘，重启可续
      return { received: u.received, next_index: u.nextIndex };
    },
  },
  {
    name: 'upload_commit',
    description: '收尾校验并落位：传全文件 sha256，服务器校验字节数+哈希后移入目标目录，返回可访问的 /media URL。',
    inputSchema: { type: 'object', properties: { upload_id: { type: 'string' }, sha256: { type: 'string' } }, required: ['upload_id', 'sha256'] },
    run: ({ upload_id, sha256: want } = {}) => {
      const u = loadUpload(upload_id);
      if (!u || u.workspace !== currentWorkspace()) return { error: 'upload_id 不存在或已过期' };
      if (u.received !== u.bytes) return { error: `字节数不符：收到 ${u.received}，申报 ${u.bytes}` };
      const got = crypto.createHash('sha256').update(fs.readFileSync(u.tmp)).digest('hex');
      if (got !== String(want).toLowerCase()) { dropUpload(upload_id, u); return { error: 'sha256 校验失败，重新上传' }; }
      fs.mkdirSync(path.dirname(u.targetAbs), { recursive: true });
      fs.renameSync(u.tmp, u.targetAbs);
      try { fs.rmSync(metaPath(upload_id), { force: true }); } catch {}
      UPLOADS.delete(upload_id);
      const rel = path.relative(path.resolve(MEDIA_DIR), u.targetAbs);
      return { saved: true, path: rel, url: '/media/' + rel.split(path.sep).map(encodeURIComponent).join('/') };
    },
  },
];
TOOLS.push(...QUEUE_TOOLS);

// ── 平台操控工具（server.js 启动时注入）──
// 以前 CLI 只有「产视频」那一套，agent 想看日历、标已发、查账本，只能回去点网页——
// 那正是这条通道该消灭的事。server.js 持有各个 store 和聚合函数，这里靠它把能力递进来，
// 免得 lib 反向 import server 造成循环。
export function registerPlatformTools(deps) {
  const { calendar, styles, acctStats, projects, pool, worksMeta, saveWorksMeta,
    buildWorks, buildTaskBoard, buildContentLedger, getInspirationCached, radarPlanFrom,
    seedRadarSlots, wsSettings, beijingDay, generateForProject, getPlatform,
    searchInspiration, recordAdoption, adopted, repriceLedger, listFeeds, addFeed, updateFeed } = deps;

  const clip = (v, n = 400) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n)}…` : v);
  const workBrief = (w) => ({
    work_id: w.id, title: w.title, brand: w.brandName, at: w.at,
    types: [...new Set((w.items || []).map((i) => i.type))],
    published: !!w.published, passed: !!w.passed,
    gaps: (w.gaps || []).map((g) => `${g.label}：${g.text}`),
  });

  TOOLS.push(
    {
      name: 'list_calendar',
      description: '看日历：内容排期 + 派过的生产任务 + 灵感采集，都在这一套里（有任务就有日历）。任务条目带真实执行状态（排队/生产中/已完成/失败）和产能机名字。',
      inputSchema: { type: 'object', properties: { days: { type: 'number', description: '从今天起看几天，默认 3' } } },
      run: ({ days } = {}) => {
        const n = Math.min(30, Math.max(1, Math.round(days || 3)));
        const until = beijingDay(Date.now() + (n - 1) * 86400e3);
        const today = beijingDay();
        // 派过的活也在日历里——任务和日历是同一套，别让 agent 以为要分两处查
        const all = [...calendar.all(), ...(deps.jobsAsCalendar ? deps.jobsAsCalendar() : [])];
        const rows = all.filter((e) => e.date >= today && e.date <= until)
          .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));
        return {
          window: `${today} → ${until}`,
          radar: rows.filter((e) => e.kind === 'radar').map((e) => ({ date: e.date, time: e.time, status: e.status, summary: e.summary || null })),
          tasks: rows.filter((e) => e.kind === 'job').map((e) => ({
            id: e.jobId, date: e.date, time: e.time, idea: clip(e.idea, 80),
            channel: e.channelLabel, status: e.jobStatus, worker: e.claimedBy, error: e.errorMsg || null,
          })),
          content: rows.filter((e) => !e.kind || (e.kind !== 'radar' && e.kind !== 'job')).map((e) => ({ id: e.id, date: e.date, time: e.time, idea: clip(e.idea, 80), status: e.status, outputs: e.outputs })),
        };
      },
    },
    {
      name: 'set_radar_schedule',
      description: '改灵感采集节奏（一天几次 / 每隔几小时 / 连排几天），直接写进日历。477 说「每天8次每隔3h」就是调这个。',
      inputSchema: {
        type: 'object',
        properties: { days: { type: 'number' }, timesPerDay: { type: 'number' }, everyHours: { type: 'number' } },
      },
      run: (args = {}) => {
        const plan = radarPlanFrom(args);
        if (!plan) return { error: '节奏说不清：一天几次、间隔几小时至少给一个' };
        wsSettings.set({ radarPlan: { hours: plan.hours, until: plan.endDate, setAt: new Date().toISOString() } });
        for (let i = 0; i < plan.days; i++) {
          const date = beijingDay(Date.now() + i * 86400e3);
          seedRadarSlots(date, i === 0 ? { onlyFrom: plan.todayFrom } : {});
        }
        return { ok: true, days: plan.days, everyHours: plan.everyHours, hours: plan.hours, until: plan.endDate };
      },
    },
    {
      name: 'list_feeds',
      description: '看灵感雷达在采哪些信息源（播客/YouTube/博客/媒体），哪些停用了。想知道「为什么没采到某家的内容」先问它。',
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        const all = listFeeds();
        return {
          total: all.length, active: all.filter((f) => f.enabled !== false).length,
          feeds: all.map((f) => ({ id: f.id, type: f.type, name: f.name, author: f.author || null, url: f.url, enabled: f.enabled !== false, builtin: !!f.builtin })),
        };
      },
    },
    {
      name: 'add_feed',
      description: '给灵感雷达加一个信息源。加之前服务器会先拉一次验证，拉不通不让进——免得每轮采集白跑还静默失败。加完下一轮采集就会带上它。',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { type: 'string', description: 'RSS/Atom 地址' },
          type: { type: 'string', description: 'podcast|youtube|blog|media' },
          channel_id: { type: 'string', description: 'YouTube 频道 ID（UC 开头），给了就不用填 url' },
          author: { type: 'string' },
          bio: { type: 'string', description: '一句话介绍，会喂给打分模型判断信源权威度' },
        },
        required: ['name'],
      },
      run: async ({ channel_id, ...b } = {}) => {
        // 校验失败是预期结果，不是崩溃——要回成 {error} 给对面看懂，别把异常抛出去
        try { return await addFeed({ ...b, channelId: channel_id }); }
        catch (e) { return { error: String(e.message) }; }
      },
    },
    {
      name: 'toggle_feed',
      description: '停用/启用一个信息源（内置源删不掉，但能停）。某家源老是拉不通或者内容不对口味时用。',
      inputSchema: {
        type: 'object',
        properties: { feed_id: { type: 'string' }, enabled: { type: 'boolean' } },
        required: ['feed_id', 'enabled'],
      },
      run: ({ feed_id, enabled } = {}) => {
        try { const f = updateFeed(feed_id, { enabled: !!enabled }); return { ok: true, name: f.name, enabled: f.enabled !== false }; }
        catch (e) { return { error: String(e.message) }; }
      },
    },
    {
      name: 'get_inspiration',
      description: '读灵感雷达最近一次采集结果（分数、切口、公众号钩子）。写内容前先看这里，别自己凭空想选题。',
      inputSchema: { type: 'object', properties: { min_score: { type: 'number', description: '只要 ≥ 这个分的，默认 80' }, limit: { type: 'number' } } },
      run: ({ min_score, limit } = {}) => {
        const d = getInspirationCached();
        if (!d) return { error: '还没采集过，去日历排个采集槽位或调 set_radar_schedule' };
        const min = Number.isFinite(min_score) ? min_score : 80;
        const cards = (d.cards || []).filter((c) => c.score >= min).slice(0, Math.min(30, limit || 10));
        return {
          builtAt: d.builtAt, total: (d.cards || []).length, shown: cards.length,
          cards: cards.map((c) => ({
            score: c.score, source: c.sourceName, author: c.author, authority: c.authorityLabel,
            title: c.zhSummary || c.title, url: c.url, angle: clip(c.angle, 200), hook: clip(c.hook, 200),
          })),
        };
      },
    },
    {
      name: 'search_inspiration',
      description: '按关键词在**已采集的素材池**里找。瞬时、零成本。池里没有想要的方向，就用 add_feed 加个源，下一轮采集就有了——那条路有作者和权威度，比临时抓一把来路不明的结果靠谱。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词，空格分隔多个' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      run: async (args = {}) => {
        const r = await searchInspiration(args);
        if (r.error) return r;
        return {
          ...r,
          cards: (r.cards || []).map((c) => ({
            score: c.score, source: c.sourceName, author: c.author, authority: c.authorityLabel,
            title: c.zhSummary || c.title, url: c.url, angle: clip(c.angle, 200), hook: clip(c.hook, 200),
            adoptedBefore: !!c.adoptedBefore,
          })),
        };
      },
    },
    {
      name: 'record_adoption',
      description: '⚠️ 拿灵感素材写完内容后必须调这个记一笔。作用有二：这条不再被重复推荐；这个人和这类选题下次加一点点权重。不记就等于雷达永远学不会 477 的口味。',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '素材原链接（优先给这个）' },
          title: { type: 'string' },
          author: { type: 'string', description: '素材作者，如 Siqi Chen 或 @blader' },
          sourceName: { type: 'string' },
          work_id: { type: 'string', description: '写出来的那条作品 id' },
        },
      },
      run: ({ work_id, ...rest } = {}) => {
        const row = recordAdoption({ ...rest, workId: work_id });
        return row ? { recorded: true, key: row.key, count: row.count } : { error: '至少要有 url 或 title' };
      },
    },
    {
      name: 'list_adoptions',
      description: '看哪些素材已经被写过了、哪些作者反复出现。想知道「这个人我们写过几次」问它。',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
      run: ({ limit } = {}) => {
        const rows = adopted.all().sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
        const byAuthor = {};
        for (const r of rows) if (r.author) byAuthor[r.author] = (byAuthor[r.author] || 0) + (r.count || 1);
        return {
          total: rows.length,
          topAuthors: Object.entries(byAuthor).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, n]) => ({ author: name, times: n })),
          recent: rows.slice(0, Math.min(50, limit || 20)).map((r) => ({ title: clip(r.title, 60), author: r.author, url: r.url, times: r.count, lastAt: r.lastAt })),
        };
      },
    },
    {
      name: 'list_works',
      description: '看草稿箱/作品库里有什么：做完待验收的、已收录的、已发布的。带 gaps 说明哪条还没交付完（比如公众号缺配图）。',
      inputSchema: {
        type: 'object',
        properties: {
          state: { type: 'string', description: 'todo=待验收 / published=已发 / all，默认 todo' },
          limit: { type: 'number' },
        },
      },
      run: ({ state = 'todo', limit } = {}) => {
        const all = buildWorks();
        const filtered = state === 'all' ? all
          : state === 'published' ? all.filter((w) => w.published)
            : all.filter((w) => !w.published && !w.passed);
        return { total: filtered.length, works: filtered.slice(0, Math.min(50, limit || 20)).map(workBrief) };
      },
    },
    {
      name: 'get_work',
      description: '读某条作品的完整内容（文案全文 + 媒体地址）。验收、改稿、发布前都用它。',
      inputSchema: { type: 'object', properties: { work_id: { type: 'string' } }, required: ['work_id'] },
      run: ({ work_id } = {}) => {
        const w = buildWorks().find((x) => x.id === work_id);
        if (!w) return { error: `作品不存在：${work_id}` };
        return {
          ...workBrief(w),
          items: (w.items || []).map((i) => ({ type: i.type, label: i.label, url: i.url || null, content: i.content || null, seconds: i.seconds ?? null })),
        };
      },
    },
    {
      name: 'mark_published',
      description: '把作品标成已发布（或取消标记）。人工发完平台后回来记一笔，数据面板才对得上。',
      inputSchema: {
        type: 'object',
        properties: { work_id: { type: 'string' }, published: { type: 'boolean', description: '默认 true' } },
        required: ['work_id'],
      },
      run: ({ work_id, published = true } = {}) => {
        const meta = worksMeta();
        meta[work_id] = { ...(meta[work_id] || {}), published: !!published };
        saveWorksMeta(meta);
        return { work_id, published: !!published };
      },
    },
    {
      name: 'get_task_board',
      description: '看全平台流水线卡在哪：每条内容的 生产→质检→收录→发布→数据 走到哪一步、哪些要人推进。',
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        const b = buildTaskBoard();
        return {
          attention: b.attention,
          reminders: b.reminders.map((r) => ({ task: r.keyword, brand: r.brandName, node: r.node, action: r.action || null, level: r.level, text: r.text })),
          tasks: b.tasks.slice(0, 30).map((t) => ({ task_id: t.id, keyword: t.keyword, brand: t.brandName, nodes: t.nodes, ageDays: t.ageDays })),
        };
      },
    },
    {
      name: 'reprice_ledger',
      description: '按当前价目表把账本里所有成本重算一遍。改完模型单价后用它——存下来的金额是当时那张价目表的快照，不会自己变。纯计算：原始 token 一直存着，不重跑任何模型、不花钱。先用 dry_run 看会变多少。',
      inputSchema: {
        type: 'object',
        properties: { dry_run: { type: 'boolean', description: 'true=只试算不写回（建议先跑一次看差多少）' } },
      },
      run: ({ dry_run } = {}) => {
        const r = repriceLedger({ dry: !!dry_run });
        return {
          dryRun: r.dryRun, repriced: r.repriced,
          before: r.beforeTotalCny, after: r.afterTotalCny, delta: r.deltaCny,
          skipped: r.skippedCount, changes: r.changes.slice(0, 10), note: r.note,
        };
      },
    },
    {
      name: 'list_notices',
      description: '看平台有什么变动要你管：任务完成/失败、内容卡在哪个环节等验收、今天钱烧超了、自动任务跑完或跑挂。开工前先看这个，比翻各个页面快。',
      inputSchema: { type: 'object', properties: { level: { type: 'string', description: 'urgent|todo|ok，不填给全部' } } },
      run: ({ level } = {}) => {
        const all = deps.buildNotices ? deps.buildNotices() : [];
        const list = level ? all.filter((n) => n.level === level) : all;
        return { total: list.length, urgent: all.filter((n) => n.level === 'urgent').length, notices: list.slice(0, 20) };
      },
    },
    {
      name: 'get_task_detail',
      description: '看一条任务的详情：每个产出走到哪一步、质检打了多少分、不过关的具体问题清单（引用原文+为什么+怎么改）。get_task_board 说「质检不过关」之后用它看到底哪儿不行。',
      inputSchema: { type: 'object', properties: { task_id: { type: 'string', description: 'get_task_board 返回的 task_id' } }, required: ['task_id'] },
      run: ({ task_id } = {}) => {
        const task = (deps.buildContentTasks ? deps.buildContentTasks() : []).find((t) => t.id === task_id);
        if (!task) return { error: `任务不存在：${task_id}` };
        // nodes 和待办提示在看板那份数据里（buildContentTasks 只出原始任务），取过来一起给
        const boardRow = (deps.buildTaskBoard ? (deps.buildTaskBoard().tasks || []) : []).find((t) => t.id === task_id);
        const proj = task.projectId ? projects.get(task.projectId) : null;
        const outputs = (proj?.outputs || []).map((o) => {
          const q = o.qc;
          return {
            platform: o.platformId,
            status: o.status,
            qc: q ? {
              score: q.score, verdict: q.verdict, dims: q.dims,
              // 不过关的原因要给全：引用哪句、为什么不行、怎么改——只说「不过关」等于没说
              issues: (q.issues || []).map((i) => ({ dim: i.dim, severity: i.severity, quote: i.quote, why: i.why, fix: i.fix })),
              suggestions: q.suggestions || [],
            } : null,
          };
        });
        return {
          task_id, keyword: task.keyword, brand: task.brandName,
          nodes: boardRow?.nodes || null,
          reminder: boardRow?.reminder || null,
          jobs: (task.jobIds || []).map((id) => { const j = jobs.get(id); return j ? { id, status: j.status, channel: j.channelLabel, error: j.logTail || j.error || null } : { id, status: 'missing' }; }),
          outputs,
        };
      },
    },
    {
      name: 'get_ledger',
      description: '看账本：所有内容的真实 token 与等价成本、今天烧了多少、哪些模型还没定价。想知道「这批活花了多少钱」问它。金额按当前价目表实时算，改了单价立刻生效。',
      inputSchema: { type: 'object', properties: {} },
      run: () => {
        const l = buildContentLedger({ jobList: jobs.all(), projectList: projects.all(), worksMeta: worksMeta() });
        return {
          summary: l.summary,
          today: deps.todayWorkload ? deps.todayWorkload(l) : null,
          recent: l.entries.slice(0, 10).map((e) => ({ title: clip(e.title, 40), type: e.contentTypeLabel, at: e.at, tokens: e.cost?.totalTokens ?? null, cny: e.cost?.apiEquivalentCny ?? null })),
        };
      },
    },
    {
      name: 'push_wechat_draft',
      description: '把一条内容的公众号成品文推进公众号后台草稿箱（图片自动转存微信 CDN，封面自动挑）。需要 477 在设置页配好公众号 AppID/AppSecret 且服务器 IP 已加白名单。work_id 用 list_works 里 project 来源的 id。',
      inputSchema: { type: 'object', properties: { work_id: { type: 'string' } }, required: ['work_id'] },
      run: async ({ work_id } = {}) => {
        const project = projects.get(work_id);
        if (!project) return { error: `找不到内容 ${work_id}（只有轻内容项目里的公众号成品文能直发）` };
        const out = (project.outputs || []).find((o) => o.platformId === 'gongzhonghao_pub' && o.content);
        if (!out) return { error: '这条内容里没有公众号成品文' };
        try {
          const md = String(out.content);
          const title = (/^#\s+(.+)$/m.exec(md)?.[1] || project.title || '').trim();
          const digest = md.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('![') && !l.startsWith('>')) || '';
          const cover = (out.images || []).find((i) => i.role === 'cover')?.url || '';
          const r = await deps.pushDraft({ markdown: md, title, digest, coverUrl: cover });
          return { ...r, note: '已进公众号草稿箱，477 在公众号后台预览后群发' };
        } catch (e) { return { error: String(e.message) }; }
      },
    },
    {
      name: 'add_style',
      description: '往风格库加一条风格（writing/visual/video/voice/bgm）。voice/bgm 可以带一段 base64 音频当试听样本（≤2MB，mp3/wav/ogg/m4a）。视频生产规范、声线样本、BGM 母版都从这里入库，入库后网页风格库对应板块可见、渠道可关联。',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'writing|visual|video|voice|bgm' },
          name: { type: 'string' },
          desc: { type: 'string', description: '这套风格是什么（终态标准）' },
          usage: { type: 'string', description: '怎么用（硬规范/参数/来源）' },
          source: { type: 'string', description: '来源说明，如 skill 名/版权（CC BY 4.0）' },
          in_use: { type: 'boolean', description: '默认 true=使用中' },
          audio_data_url: { type: 'string', description: '可选：data:audio/...;base64,xxx 试听样本' },
          audio_name: { type: 'string' },
        },
        required: ['kind', 'name', 'desc'],
      },
      run: ({ kind, name, desc, usage = '', source = '', in_use = true, audio_data_url = '', audio_name = '' } = {}) => {
        if (!['writing', 'visual', 'video', 'voice', 'bgm'].includes(kind)) return { error: `kind 只能是 writing/visual/video/voice/bgm，收到 ${kind}` };
        let sampleAudio = null;
        if (audio_data_url) {
          const m = /^data:audio\/(wav|x-wav|mpeg|mp3|mp4|x-m4a|ogg|aac|webm);base64,(.+)$/.exec(audio_data_url);
          if (!m) return { error: '音频要用 data:audio/...;base64 形式（mp3/wav/ogg/m4a/aac/webm）' };
          const buf = Buffer.from(m[2], 'base64');
          if (buf.length > 2 * 1024 * 1024) return { error: `音频 ${(buf.length / 1048576).toFixed(1)}MB 超过 2MB——剪短或压码率再传（试听 15-20 秒足够）` };
          const extBy = { wav: 'wav', 'x-wav': 'wav', mpeg: 'mp3', mp3: 'mp3', mp4: 'm4a', 'x-m4a': 'm4a', ogg: 'ogg', aac: 'aac', webm: 'webm' };
          const sub = kind === 'bgm' ? 'bgm' : 'voices';
          const safe = String(audio_name || name).replace(/[^\w\u4e00-\u9fff-]/g, '').slice(0, 40) || 'sample';
          const file = `${kind}-${safe}-${Date.now()}.${extBy[m[1]]}`;
          const dir = path.join(ASSETS_DIR, sub);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, file), buf);
          sampleAudio = `/assets/${sub}/${file}`;
        }
        const st = styles.create({ kind, name: String(name).slice(0, 60), desc: String(desc).slice(0, 4000), usage: String(usage).slice(0, 4000), source: String(source).slice(0, 200), inUse: !!in_use, ...(sampleAudio ? { sampleAudio } : {}) });
        return { id: st.id, kind: st.kind, name: st.name, sampleAudio };
      },
    },
    {
      name: 'list_styles',
      description: '看风格库：写作/图片/视频/配音/BGM 各有哪些风格、哪些在用。写内容前确认该套哪套风格。',
      inputSchema: { type: 'object', properties: { kind: { type: 'string', description: 'writing|visual|video|voice|bgm，不填给全部' } } },
      run: ({ kind } = {}) => {
        const all = styles.all().filter((s) => !kind || s.kind === kind);
        return {
          total: all.length,
          styles: all.slice(0, 60).map((s) => ({ style_id: s.id, kind: s.kind, name: s.name, inUse: s.inUse !== false, desc: clip(s.desc, 160) })),
        };
      },
    },
    {
      name: 'list_accounts',
      description: '看账号盘：各平台开了哪些号、粉丝数、近 30 天数据。',
      inputSchema: { type: 'object', properties: {} },
      run: () => ({
        accounts: acctStats.all().map((a) => ({
          account_id: a.id, name: a.name, platform: a.platform, owner: a.owner || a.belong || null,
          fans: a.fans ?? null, net30: a.net30 ?? null, posts30: a.posts30 ?? null, views30: a.views30 ?? null, asOf: a.asOf || null,
        })),
      }),
    },
    {
      name: 'ideate_topics',
      description: '让平台的选题 agent 想 5 个选题。可给 direction（方向），不给就按品牌知识库 + 最近雷达高分素材自己想。返回 title/angle/outputs/reason，选中的可接 create_light_content 直接开工。',
      inputSchema: { type: 'object', properties: {
        direction: { type: 'string', description: '大致方向（可选，不给就自己想）' },
        brand: { type: 'string', description: '品牌名（可选，默认第一个品牌）' },
      } },
      run: async ({ direction, brand } = {}) => {
        const b = deps.resolveBrandByName ? deps.resolveBrandByName(brand) : null;
        const r = await deps.ideate({ direction: (direction || '').trim(), brand: b, feed: deps.ideateFeed ? deps.ideateFeed() : [] });
        return { topics: r.topics, note: direction ? '按你给的方向想的' : '没给方向，按品牌知识库+最近灵感自己想的' };
      },
    },
    {
      name: 'create_light_content',
      description: '起一条轻内容并直接生成（公众号/小红书/抖音文案、配图等，不占产能机）。视频类走 create_task。',
      inputSchema: {
        type: 'object',
        properties: {
          idea: { type: 'string', description: '选题/想法，可带链接' },
          brand_id: { type: 'string' },
          platforms: { type: 'array', items: { type: 'string' }, description: '平台 id，如 gongzhonghao_pub / xiaohongshu / cover' },
        },
        required: ['idea', 'platforms'],
      },
      run: async ({ idea, brand_id, platforms = [] } = {}) => {
        const valid = platforms.filter((id) => getPlatform(id));
        if (!valid.length) return { error: '没有有效的平台 id，先调 one_to_all_status 看可用平台' };
        const brand = brand_id ? brands.get(brand_id) : brands.all()[0];
        const project = projects.create({
          title: String(idea).slice(0, 24), idea: String(idea),
          brandId: brand?.id || null, brandName: brand?.name || null,
          options: {}, outputs: valid.map((id) => ({ platformId: id, status: 'pending' })),
        });
        const done = []; const failed = [];
        for (const pid of valid) {
          try { await generateForProject(project, pid); done.push(pid); }
          catch (e) { failed.push(`${pid}: ${String(e.message).slice(0, 80)}`); }
        }
        return { work_id: project.id, generated: done, failed, note: '产出已进草稿箱，用 get_work 读全文' };
      },
    },
    {
      name: 'control_job',
      description: '控制视频任务：暂停 / 继续 / 取消 / 后移到队尾 / 删记录。别让一条跑错的活白烧钱，也别让做完的活一直堆在看板上。',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          action: { type: 'string', description: 'pause|resume|cancel|defer|delete（delete 只删记录，成片文件保留）' },
        },
        required: ['task_id', 'action'],
      },
      run: ({ task_id, action } = {}) => {
        const job = jobs.get(task_id);
        if (!job) return { error: `任务不存在：${task_id}` };
        if (action === 'pause') {
          if (['done', 'canceled'].includes(job.status)) return { error: `已经${job.status}，暂停不了` };
          jobs.update(task_id, { status: 'paused', pausedAt: new Date().toISOString(), pausedFrom: job.status, logTail: '已暂停' });
          return { ok: true, status: 'paused', note: '在跑的活要等它下次心跳才收到停手通知' };
        }
        if (action === 'resume') {
          if (job.status !== 'paused') return { error: `当前 ${job.status}，没在暂停` };
          jobs.update(task_id, { status: 'queued', claimedBy: null, claimedAt: null, heartbeatAt: null, pausedAt: null, logTail: '已继续' });
          return { ok: true, status: 'queued' };
        }
        if (action === 'cancel') {
          if (job.status === 'done') return { error: '已交付，取消不了' };
          jobs.update(task_id, { status: 'canceled', canceledAt: new Date().toISOString(), logTail: '已取消' });
          return { ok: true, status: 'canceled' };
        }
        if (action === 'defer') {
          if (job.status !== 'queued') return { error: `只有排队中的能后移（当前 ${job.status}）` };
          jobs.update(task_id, { deferredAt: new Date().toISOString(), logTail: '已后移到队尾' });
          return { ok: true, note: '排到队尾了' };
        }
        if (action === 'delete') {
          const kept = (job.products || []).length;
          jobs.remove(task_id);
          return { ok: true, deleted: true, keptFiles: kept, note: '只删了记录，成片文件还在 media/ 里' };
        }
        return { error: `不认识的动作：${action}（pause|resume|cancel|defer|delete）` };
      },
    },
  );
}

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
      instructions: `已接入 1toAll（workspace: ${currentWorkspace()}，令牌: ${meta.label || 'CLI'}）。

🚦 第一条规矩：**要对这个平台做任何事，一律先用这里的工具，不要去开浏览器点网页、不要用 computer-use、不要直接读写它的数据文件。**
这条通道就是为此存在的：看日历、读灵感、查作品、标已发、看账本、改采集节奏、控制任务，都有对应工具。
只有当你确认这里**真的没有**对应工具时，才考虑别的办法——并且请顺带告诉 477 缺哪个工具，好补上。
理由不是洁癖：点网页的操作没人记账、不可复现、拿不到结构化结果，出了错也查不到是谁干的。

看情况用哪个：
· 平台现在什么状况 → one_to_all_status / get_task_board
· 今天/这几天要干什么 → list_calendar
· 写什么选题 → get_inspiration（别自己凭空想）
· 雷达在采哪些源 / 加一个源 → list_feeds · add_feed · toggle_feed
· 做完的东西在哪、内容是什么 → list_works / get_work
· 发完了回来记一笔 → mark_published
· 花了多少钱 → get_ledger；改完单价要让旧记录跟上 → reprice_ledger
· 用哪套风格、发哪个号 → list_styles / list_accounts
· 起一条轻内容（文案/配图，不占产能机）→ create_light_content
· 采集节奏改成一天几次 → set_radar_schedule
· 找某个具体话题的素材 → search_inspiration（比等下一轮定时采集快）
· **写完了必须** record_adoption 记一笔 → 这条不再重复推、这个人下次加一点点权重
· 这个人我们写过几次 → list_adoptions
· 任务跑错了要停 → control_job

产视频（重活，占一台机器）：list_video_channels 看渠道 → create_task 派单并认领 → 本机生产 → **list_task_files 看云端已有什么** → upload_begin/part/commit 只传缺的/改的 → complete_task 收口（带上 usage 和 local_dir）。工作台派的活用 list_open_tasks → claim_task 领。get_video_task_brief 只是预览规格，不登记任务。新机器先 get_setup_guide 装环境。

📦 交付的两条硬规矩：
1. **以云端为准。** 活干完了不等于交付完了——文件必须真的传回云端系统、complete_task 收口成功，才算交付。留在你本机的文件对 477 不存在：他在网页上看不到、发不了、也不进账本。
2. **别重复劳动。** 上传前先 list_task_files 看云端已经有什么。返工任务尤其：只改文案就**只传文案**，视频和封面会自动从原作品沿用——为了改一行字重传几十兆的视频，纯属浪费你的时间和带宽。`,
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
