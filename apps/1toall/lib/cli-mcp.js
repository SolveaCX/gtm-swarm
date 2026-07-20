// CLI 接入：把 Claude Code / Codex 绑成系统的产能机。
// MCP Streamable HTTP（POST JSON-RPC）端点 + Bearer token（token 自带 workspace，
// 形如 otk_<workspace>_<48hex>，服务端只存 sha256 哈希）。绑定后 CLI 可以读品牌大脑、
// 领视频任务书、按环境自检指南把本机装成能产视频的 worker，交付后回写交付记录。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MEDIA_DIR } from '../config.js';
import { brands, cliTokens } from './store.js';
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

## L2 视频环境清单（macOS / Linux 通用）

逐条在终端执行自检，缺哪个装哪个：

\`\`\`bash
# 1) CLI 本体（Claude Code 或 Codex，至少其一）
claude --version || codex --version

# 2) ffmpeg / ffprobe（拼接与检测）
ffmpeg -version | head -1 || { echo 安装: brew install ffmpeg  # Linux: apt install ffmpeg; }

# 3) python3 + Pillow（画面渲染）
python3 -c "import PIL; print('Pillow ok')" || pip3 install pillow

# 4) faster-whisper（字幕词级转写，免费本地跑；替代 mlx_whisper）
python3 -c "import faster_whisper; print('faster-whisper ok')" || pip3 install faster-whisper

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
      const out = await tool.run(params?.arguments || {});
      return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: !!(out && out.error) });
    } catch (e) {
      return reply({ content: [{ type: 'text', text: `工具执行失败：${e.message}` }], isError: true });
    }
  }
  return err(-32601, `method not found: ${method}`);
}
