// dispatch.js — 重型生产线调度器：把渠道任务派给本地 Claude（claude -p 无头）后台跑，
// 盯进程、收日志、产物回流。品牌指挥部 3.0 核心。
import { spawn, spawnSync, execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jobs, brands, styles } from './store.js';
import { calculateAndWriteVideoCost } from './video-cost.js';
import { MEDIA_DIR } from '../config.js';

export const MEDIA_ROOT = MEDIA_DIR;
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELEVENLABS_TTS_SCRIPT = path.join(APP_ROOT, 'scripts', 'elevenlabs_tts.mjs');
const PYTHON_WITH_OPENAI = path.join(APP_ROOT, 'scripts', 'python_with_openai.sh');
const MAX_HEAVY = 2;              // 同时最多 2 条重生产线（TTS/渲染吃资源）
const DEFAULT_TIMEOUT_MS = 90 * 60e3;  // 默认 90 分钟兜底；渠道可用 timeoutMin 覆盖（如 10min 横屏 180）
const running = new Map();        // jobId -> { child, timer, logBuf }

const workerLogPath = (outDir) => path.join(outDir, '.1toall-worker.log');

function workerLogTail(outDir, limit = 4) {
  try {
    const lines = fs.readFileSync(workerLogPath(outDir), 'utf8').split('\n').filter((line) => line.trim());
    return lines.slice(-limit).join(' · ').slice(-400);
  } catch { return ''; }
}

const slug = (s) =>
  String(s || '')
    .replace(/[^一-龥A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'job';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function channelOf(brand, channelId) {
  return (brand?.channels || []).find((c) => c.id === channelId) || null;
}

function selectedVoiceStyle(brand) {
  if (!brand?.voiceStyleId) return null;
  const voice = styles.get(brand.voiceStyleId);
  return voice?.kind === 'voice' && voice.status !== 'rejected' ? voice : null;
}

function localVoiceReference(voice) {
  if (!voice) return '';
  if (voice.refPath && fs.existsSync(voice.refPath)) return voice.refPath;
  const sample = decodeURIComponent(String(voice.sampleAudio || '').split('?')[0]);
  if (sample.startsWith('/assets/')) {
    const candidate = path.join(APP_ROOT, 'assets', sample.slice('/assets/'.length));
    if (fs.existsSync(candidate)) return candidate;
  }
  if (sample.startsWith('/media/')) {
    const candidate = path.join(MEDIA_ROOT, sample.slice('/media/'.length));
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function voiceForJob(brand, channel) {
  const selected = selectedVoiceStyle(brand);
  if (!selected) return channel?.voice || null;
  return {
    engine: 'keke',
    voiceStyleId: selected.id,
    name: selected.name,
    provider: selected.provider || 'Keke Voice',
    modelId: selected.modelId || 'chatterbox-multilingual',
    language: selected.language || '中文',
    refPath: localVoiceReference(selected),
    sampleAudio: selected.sampleAudio || '',
  };
}

// key 取值：优先 process.env.<NAME>（生产 Linux GCP VM 走环境变量注入），
// 环境变量没有再 fallback 到 macOS 钥匙串（本机开发用）。security 在 Linux 上不存在会抛，
// 包在 try/catch 里，取不到就返回空串，绝不让 claudeEnv 崩。
function keychainOrEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    return execSync(`security find-generic-password -s ${name} -w`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// 无头 claude 的运行环境：清掉会串号的 ANTHROPIC_/CLAUDE 变量，
// 认证走 flatkey 的 Claude Code 专用通道（fk-cc）。key 优先取环境变量、退回钥匙串；
// 代理只透传外部已设置的（生产无本地代理，写死会连不上）。
// dispatch（重型生产线）和 chat（对话窗口）共用。
export function claudeEnv(model = 'claude-opus-4-8-fk-cc') {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(ANTHROPIC_|CLAUDE)/i.test(k)) delete env[k];
  }
  env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || '/usr/bin:/bin'}`;
  const flatkey = keychainOrEnv('FLATKEY_API_KEY');
  if (flatkey) env.ANTHROPIC_AUTH_TOKEN = flatkey;
  const elevenlabs = keychainOrEnv('ELEVENLABS_API_KEY');
  if (elevenlabs) env.ELEVENLABS_API_KEY = elevenlabs;
  const dashscope = keychainOrEnv('DASHSCOPE_API_KEY');
  if (dashscope) env.DASHSCOPE_API_KEY = dashscope;
  env.ANTHROPIC_BASE_URL = 'https://router.flatkey.ai';
  env.ANTHROPIC_MODEL = model;
  // HTTPS_PROXY / HTTP_PROXY：env 已是 process.env 的副本，外部设了就自然带上，
  // 没设就不带（不再写死 127.0.0.1:1082 默认值，否则生产 Linux 上连不上）。NO_PROXY 保留。
  env.NO_PROXY = 'localhost,127.0.0.1';
  return env;
}

// ── 产物回流：递归扫产出目录，收成片/封面/文案（跳过中间产物目录）──
const SKIP_DIRS = new Set([
  '素材包',
  '.keke-cut',
  'node_modules',
  'assets',
  'evidence',
  'snapshots',
  'sources',
  'qa',
  'generated_visuals',
  'recovered_audio',
  'music',
  'sfx',
]);
export function harvest(outDir) {
  const products = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
        continue;
      }
      const fp = path.join(dir, e.name);
      const rel = path.relative(MEDIA_ROOT, fp);
      if (rel.startsWith('..')) continue; // 只回流 BrandHQ 内的
      const url = '/media/' + rel.split(path.sep).map(encodeURIComponent).join('/');
      const ext = path.extname(e.name).toLowerCase();
      const sub = path.relative(outDir, fp);
      if (ext === '.mp4') products.push({ type: 'video', url, label: sub });
      else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') products.push({ type: 'image', url, label: sub });
      else if (ext === '.md' && /publish|copy|文案|发布/.test(e.name)) {
        let content = '';
        try { content = fs.readFileSync(fp, 'utf8').slice(0, 6000); } catch {}
        products.push({ type: 'text', url, label: sub, content });
      }
    }
  };
  walk(outDir);
  // 兜底：进程被超时 SIGKILL 杀在「素材包→顶层 cp」之前时，成品只在 素材包/ 里，
  // 而正常 walk 跳过了 素材包（防重复）。此时若没收到视频，去 素材包/ 捞最终成品。
  if (!products.some((p) => p.type === 'video')) salvageFromSucai(outDir, products);
  // 视频优先；同类候选优先最新 vN，图片再优先正式封面，避免 UI 默认打开旧版。
  const typeRank = { video: 0, image: 1, text: 2 };
  const versionOf = (product) => {
    const match = path.basename(product.label || '').match(/(?:^|[_-])v(\d+)(?=\D|$)/i);
    return match ? Number(match[1]) : 0;
  };
  const isCover = (product) => product.type === 'image' && /(?:^|[\\/])cover(?:[_-]v\d+)?\.(?:png|jpe?g)$/i.test(product.label || '');
  products.sort((a, b) => {
    const typeDiff = typeRank[a.type] - typeRank[b.type];
    if (typeDiff) return typeDiff;
    if (a.type === 'image' && isCover(a) !== isCover(b)) return isCover(a) ? -1 : 1;
    const versionDiff = versionOf(b) - versionOf(a);
    if (versionDiff) return versionDiff;
    return String(a.label || '').localeCompare(String(b.label || ''), 'zh-CN');
  });
  return products;
}

// 从 素材包/ 目录捞最终成品（sample_*.mp4 / cover_*.png / publish_copy*.md），去重同名
function salvageFromSucai(outDir, products) {
  const seen = new Set(products.map((p) => path.basename(p.label)));
  const findSucai = (dir, depth = 0) => {
    if (depth > 3) return [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    let out = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name === '素材包') out.push(path.join(dir, e.name));
      else if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) out = out.concat(findSucai(path.join(dir, e.name), depth + 1));
    }
    return out;
  };
  for (const sucai of findSucai(outDir)) {
    let files = [];
    try { files = fs.readdirSync(sucai); } catch { continue; }
    for (const name of files) {
      const ext = path.extname(name).toLowerCase();
      const fp = path.join(sucai, name);
      const rel = path.relative(MEDIA_ROOT, fp);
      if (rel.startsWith('..')) continue;
      const url = '/media/' + rel.split(path.sep).map(encodeURIComponent).join('/');
      const label = path.relative(outDir, fp);
      if (ext === '.mp4' && /^sample_/.test(name) && !seen.has(name)) {
        seen.add(name); products.push({ type: 'video', url, label, salvaged: true });
      } else if (ext === '.png' && /^cover_/.test(name) && !/_textless|_bg/.test(name) && !seen.has(name)) {
        seen.add(name); products.push({ type: 'image', url, label, salvaged: true });
      } else if (ext === '.md' && /publish|copy|文案|发布/.test(name) && !seen.has(name)) {
        let content = '';
        try { content = fs.readFileSync(fp, 'utf8').slice(0, 6000); } catch {}
        seen.add(name); products.push({ type: 'text', url, label, content, salvaged: true });
      }
    }
  }
}

function findNamed(root, name, depth = 0) {
  if (depth > 5) return null;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const found = findNamed(full, name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function audioMeanVolume(file) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file,
    '-vn', '-af', 'volumedetect', '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const out = `${result.stdout || ''}\n${result.stderr || ''}`;
  const m = /mean_volume:\s*(-?[\d.]+)\s*dB/i.exec(out);
  return m ? Number(m[1]) : null;
}

function hasAudioStream(file) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', file,
    ], { encoding: 'utf8' }).trim();
    return !!out;
  } catch {
    return false;
  }
}

function validateVoiceDelivery(channel, outDir, products, jobVoice = null) {
  const voice = jobVoice || channel?.voice;
  if (!voice || !['elevenlabs', 'qwen', 'keke'].includes(voice.engine)) return null;

  let voiceFile = null;
  if (voice.engine === 'elevenlabs') {
    const manifestFile = findNamed(outDir, 'tts_manifest.json');
    if (!manifestFile) return 'ElevenLabs 验收失败：缺 tts_manifest.json';
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch {
      return 'ElevenLabs 验收失败：tts_manifest.json 无法解析';
    }
    if (manifest.engine !== 'elevenlabs') return 'ElevenLabs 验收失败：manifest engine 不匹配';
    if (manifest.voiceId !== voice.voiceId) return 'ElevenLabs 验收失败：manifest voiceId 与渠道配置不匹配';
    voiceFile = manifest.output && fs.existsSync(manifest.output)
      ? manifest.output
      : findNamed(outDir, 'sample_voice.wav') || findNamed(outDir, 'sample_voice_fast.wav');
  } else if (voice.engine === 'qwen') {
    voiceFile = findNamed(outDir, 'sample_voice_fast.wav') || findNamed(outDir, 'sample_voice.wav');
  } else {
    const manifestFile = findNamed(outDir, 'voice_manifest.json');
    if (manifestFile) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        voiceFile = manifest.output && fs.existsSync(manifest.output) ? manifest.output : null;
      } catch {}
    }
    voiceFile ||= findNamed(outDir, 'sample_voice.wav') || findNamed(outDir, 'sample_voice_fast.wav');
  }
  const engineLabel = voice.engine === 'elevenlabs' ? 'ElevenLabs' : voice.engine === 'qwen' ? 'Qwen' : 'Keke Voice';
  if (!voiceFile) return `${engineLabel} 验收失败：找不到配音文件`;
  const voiceMean = audioMeanVolume(voiceFile);
  if (voiceMean == null || voiceMean < -55) return `${engineLabel} 验收失败：配音文件无声或电平异常`;

  const video = products.find((p) => p.type === 'video');
  if (!video) return null;
  const videoFile = path.join(outDir, video.label);
  if (!hasAudioStream(videoFile)) return `${engineLabel} 验收失败：成片缺音轨`;
  const finalMean = audioMeanVolume(videoFile);
  if (finalMean == null || finalMean < -55) return `${engineLabel} 验收失败：成片音轨无声或电平异常`;
  return null;
}

export function deliveryError(job, products) {
  const brand = brands.get(job?.brandId);
  const channel = channelOf(brand, job?.channelId);
  if (!channel) return '渠道配置丢失';
  return validateVoiceDelivery(channel, job.outDir, products, job.voice);
}

// ── 建 job（入队）──
export function createJob({ brandId, channelId, idea, hold = false, holdReason = '', outDir: requestedOutDir = '' }) {
  const brand = brands.get(brandId);
  if (!brand) throw new Error('品牌不存在');
  const ch = channelOf(brand, channelId);
  if (!ch || ch.engine !== 'claude') throw new Error('该渠道不是重型生产线');
  // outDir 必须每 job 唯一：同一 idea 同一分钟派多个渠道会撞路径 → harvest 交叉污染。
  // 用渠道短标签（去品牌前缀）区分；idea 里的 URL 从目录名剔除，保持可读。
  const chTag = channelId.replace(/^[a-z]+_/, '') || channelId;
  const ideaSlug = slug(String(idea || '').replace(/https?:\/\/\S+/g, '').trim()) || 'ep';
  const fallbackOutDir = path.join(MEDIA_ROOT, slug(brand.name), `${stamp()}-${ideaSlug}-${chTag}`);
  const outDir = requestedOutDir ? path.resolve(String(requestedOutDir)) : fallbackOutDir;
  const mediaRoot = path.resolve(MEDIA_ROOT);
  if (outDir !== mediaRoot && !outDir.startsWith(`${mediaRoot}${path.sep}`)) {
    throw new Error('任务输出目录必须位于 BrandHQ 内');
  }
  const job = jobs.create({
    brandId,
    brandName: brand.name,
    channelId,
    channelLabel: ch.label,
    idea: String(idea || '').trim(),
    eta: ch.eta || '',
    voice: voiceForJob(brand, ch),
    runner: {
      provider: 'Flatkey',
      client: 'Claude Code',
      requestedModel: 'claude-opus-4-8-fk-cc',
    },
    status: hold ? 'waiting_external' : 'queued',
    outDir,
    products: [],
    logTail: '',
    error: hold ? String(holdReason || '等待外部确认') : null,
    startedAt: null,
    doneAt: null,
  });
  if (!hold) tick();
  return job;
}

function voiceDirective(channel) {
  const voice = channel?.voice;
  if (!voice) return '';
  if (voice.engine === 'qwen') {
    return `

【1toAll 中文配音硬要求】
- 必须使用 Qwen Omni，voice=Ethan，成片语速目标 ${voice.speed || 1.25}x；禁止使用 ElevenLabs 或系统 TTS。
- DASHSCOPE_API_KEY 已由 1toAll 从 macOS Keychain 注入环境变量，禁止把 key 写入任何文件、日志或命令输出。
- 使用素材包内 qwen_omni_tts.py；通过 "${PYTHON_WITH_OPENAI}" 启动，避免系统 Python 缺 openai 包；中文绝不要加 --lang en。
- 长稿按 skill 规范分段生成并拼接，末尾加入抛弃句防截断。
- 字幕时间轴必须从最终 Qwen 音轨重新转写/对齐，不能沿用模板或占位时间轴。
- 最终验收必须检查：配音非静音、头中尾电平差≤3dB、末句完整、口播与字幕逐句匹配。
`.trim();
  }
  if (voice.engine === 'keke') {
    const speed = Number(voice.speed || 1.12);
    return `

【1toAll 本地英文配音硬要求】
- 必须使用本地 Keke Voice 的 Chatterbox 原生英文模型；禁止使用 ElevenLabs、Qwen、DashScope 或系统 TTS。
- 运行 /Users/YOU/local-tts/.venv/bin/python /Users/YOU/local-tts/tts.py --text-file narration.txt --out sample_voice_local_raw.wav --chunk --device mps；英文原生模型禁止传 --lang。
- 用 ffmpeg atempo=${speed} 生成 sample_voice_fast.wav，并以最终音轨重新转写/对齐字幕。
- 生成 voice_manifest.json，至少记录 engine=keke、model=${voice.modelId || 'chatterbox-english'}、language=en、speed=${speed} 和 output 绝对路径。
- 最终验收必须检查：配音非静音、头中尾电平差≤3dB、末句完整、口播与字幕逐句匹配。
`.trim();
  }
  if (voice.engine !== 'elevenlabs') return '';
  const modelId = voice.modelId || 'eleven_multilingual_v2';
  return `

【1toAll 配音硬要求】
- 必须使用 ElevenLabs，禁止使用 Qwen、DashScope、系统 TTS 或其他配音后端。
- voice_id=${voice.voiceId}（${voice.name || 'configured voice'}），model_id=${modelId}。
- ELEVENLABS_API_KEY 已由 1toAll 从 macOS Keychain 注入环境变量，禁止把 key 写入任何文件、日志或命令输出。
- 这是受限权限 key：不要调用 /v1/user、订阅或账户资料接口做预检；这些接口可能返回 401，但不代表 TTS 权限失效。
- 鉴权以实际 text-to-speech 请求为唯一准据。直接运行下面的工具；只有该工具本身返回 401 才能判定配音阻塞。
- 禁止自行拼 curl、Python requests 或把 key 放进命令参数；只能调用下面的 1toAll 工具。
- 使用 1toAll 的长文本配音工具：
  node "${ELEVENLABS_TTS_SCRIPT}" --text-file narration.txt --output sample_voice.wav --voice-id "${voice.voiceId}" --model-id "${modelId}" --cache-dir .elevenlabs-cache --manifest tts_manifest.json
- 长稿按句自动分段；生成后必须保留 tts_manifest.json，并确认 engine=elevenlabs、voiceId 与本任务一致。
- 字幕时间轴必须从最终 ElevenLabs 音轨重新转写/对齐，不能沿用旧 Qwen 时间轴。
- 最终验收必须检查：人声清晰、头中尾电平差≤3dB、末句完整、口播与字幕逐句匹配。
`.trim();
}

function selectedVoiceDirective(brand) {
  const voice = selectedVoiceStyle(brand);
  if (!voice) return '';
  const refPath = localVoiceReference(voice);
  if (!refPath) return `【1toAll 品牌声音库】已选择「${voice.name}」，但本地参考音文件不存在。停止配音并返回 missing-input receipt，禁止改用其他声音。`;
  return `
【1toAll 品牌声音库硬要求】
- 当前品牌已选声音：${voice.name}（${voice.provider || 'Keke Voice'} / ${voice.language || '中文'} / ${voice.gender || '女声'}）。
- 必须使用本地 Keke Voice，参考音绝对路径：${refPath}；禁止改用 Qwen、ElevenLabs 或系统 TTS。
- 运行 /Users/YOU/local-tts/.venv/bin/python /Users/YOU/local-tts/tts.py --text-file narration.txt --ref "${refPath}" --lang zh --out sample_voice.wav。
- 生成 voice_manifest.json，至少记录 engine=keke、voiceStyleId=${voice.id}、model=${voice.modelId || 'chatterbox-multilingual'}、refPath 和 output 绝对路径。
- 字幕时间轴必须从最终 Keke Voice 音轨重新转写/对齐；交付前检查人声非静音、末句完整、口播与字幕逐句匹配。
`.trim();
}

function continuityDirective(job) {
  return `
【1toAll 断点续跑规则】
- 本任务唯一根目录是 ${job.outDir}。如果目标子目录已经存在，必须原地更新和复用，不得再次创建同名嵌套目录（例如 短-讲师/短-讲师、横版长/横版长）。
- 开始前必须先读取根目录及 edit/ 下已有的 TODO_STATE.md、project.md、manifest.json 和验收记录；已验收的本期素材、音轨和脚本直接复用，只继续未完成步骤。
- Scaffold 只允许补缺脚本和素材；旧视频、旧封面、旧文案、旧音轨、旧字幕、旧 acceptance/report 不得直接当本期产物。
- 完成前必须核对 narration、画面标题、发布文案都对应当前 source/idea；任何来自模板的旧主题内容都必须重写。
- 若发现旧模板成片，移出本 job 根目录后再继续，禁止靠修改时间或复制动作让旧产物通过 harvest。
`.trim();
}

function mediaStyleDirective(brand, channel) {
  const hunterEnglish = /hunter/i.test(String(brand?.name || ''))
    && /(^|_)en_|english|英文/i.test(`${channel?.id || ''} ${channel?.label || ''}`);
  const hunterEnglishRule = hunterEnglish
    ? '- 品牌C 英文视频禁止在口播、字幕、画面、封面或发布文案中使用 China / Chinese 作为地域或身份定位；除非用户在当前 idea 中明确要求。'
    : '';
  return `
【1toAll 音乐与封面硬要求】
- 背景音乐禁止使用脉冲、鼓点、节拍器、kick、循环打击、arpeggio、tremolo、gating 或 sidechain pumping；不得用周期性音量起伏制造“科技感”。
- 只允许无打击乐、无周期泵动的持续型纪录片氛围音乐。章节提示音必须是离散短音效，不能伪装成持续背景节拍。
- 封面不得出现 品牌C、HUNTER、频道X、作者姓名、账号名或“关注某某”等署名/引流文字。
- 英文竖屏短视频封面必须单独制作 3:4 工业风大字报：明确工业硬件主体 + 超大粗体标题；禁止直接拿视频首帧或普通信息卡当封面。
- 证据截图禁止出现 404、登录遮罩、连接失败、停放域名、空白页或报错页；无法取得有效网页时，改用本地流程图并明确标注 RECREATED FROM SOURCE NOTES。
${hunterEnglishRule}
- 交付前对封面生成脚本、可见文字和 OCR 结果检查上述禁词；命中即返工。
`.trim();
}

export function brandKnowledgeDirective(brand) {
  if (!brand?.name) return '';
  const direct = path.join(MEDIA_ROOT, slug(brand.name), '知识库');
  let kbDir = direct;
  if (!fs.existsSync(kbDir)) {
    try {
      const first = String(brand.name).split(/[ ·]/)[0];
      const matched = fs.readdirSync(MEDIA_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .find((name) => name === brand.name || brand.name.includes(name) || name.includes(first));
      if (matched) kbDir = path.join(MEDIA_ROOT, matched, '知识库');
    } catch {}
  }
  if (!fs.existsSync(kbDir)) return '';

  const allowed = new Set(['.md', '.txt', '.html', '.json', '.csv']);
  const files = [];
  const walk = (dir, depth = 0) => {
    if (depth > 3 || files.length >= 40) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, depth + 1);
      else if (allowed.has(path.extname(entry.name).toLowerCase())) files.push(abs);
      if (files.length >= 40) break;
    }
  };
  walk(kbDir);
  if (!files.length) return '';
  files.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const manifest = files.map((file) => `- ${file}`).join('\n');
  return `
【1toAll 品牌知识库与视频素材】
- 规划和写分镜前，先读取下面与当前任务最相关的文件；当前 source 与知识库冲突时，以当前 source 为准。
- HTML 文件可以作为可交互演示、产品 UI 录屏或画面素材；必须同时读取同目录说明文档，遵守真实案例/演示数据边界。
- 不要把知识库中的 Demo 对话、订单号、指标或结果表述成真实客户事实。
${manifest}
`.trim();
}

// ── 调度循环：有空位就开跑 ──
export function tick() {
  const all = jobs.all();
  const act = all.filter((j) => j.status === 'running').length;
  if (act >= MAX_HEAVY) return;
  const next = all.filter((j) => j.status === 'queued').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const j of next.slice(0, MAX_HEAVY - act)) startJob(j.id);
}

function startJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'queued') return;
  const brand = brands.get(job.brandId);
  // promptOverride：不走渠道模板的任务（如知识库整理），直接用 job 自带的 prompt；此时 ch 为 null
  const ch = job.promptOverride ? null : channelOf(brand, job.channelId);
  if (!job.promptOverride && !ch) { jobs.update(jobId, { status: 'failed', error: '渠道配置丢失' }); return; }
  const prompt = job.promptOverride
    ? String(job.promptOverride)
    : [
        String(ch.promptTemplate || '')
        .replaceAll('{{idea}}', job.idea)
        .replaceAll('{{outDir}}', job.outDir),
        brandKnowledgeDirective(brand),
        selectedVoiceStyle(brand) ? '' : voiceDirective(ch),
        selectedVoiceDirective(brand),
        continuityDirective(job),
        mediaStyleDirective(brand, ch),
      ].filter(Boolean).join('\n\n');
  fs.mkdirSync(job.outDir, { recursive: true });
  if (!prompt.trim()) { jobs.update(jobId, { status: 'failed', error: '渠道缺 promptTemplate' }); return; }

  const env = claudeEnv();

  const logFd = fs.openSync(workerLogPath(job.outDir), 'a');
  const child = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions', '--output-format', 'text', '--model', 'claude-opus-4-8-fk-cc'], {
    cwd: job.outDir,
    env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  child.unref();

  jobs.update(jobId, { status: 'running', startedAt: new Date().toISOString(), pid: child.pid });

  const logBuf = [];
  const logTimer = setInterval(() => {
    const tail = workerLogTail(job.outDir, 3);
    if (tail) jobs.update(jobId, { logTail: tail.slice(-300) });
  }, 5000);
  logTimer.unref?.();

  const timeoutMs = ch.timeoutMin ? ch.timeoutMin * 60e3 : DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    clearInterval(logTimer);
    try { child.kill('SIGKILL'); } catch {}
    jobs.update(jobId, { status: 'failed', error: `超时（>${Math.round(timeoutMs / 60e3)} 分钟）已终止，可重跑`, doneAt: new Date().toISOString() });
    running.delete(jobId);
    tick();
  }, timeoutMs);

  child.on('exit', (code) => {
    clearTimeout(timer);
    clearInterval(logTimer);
    if (timedOut) return;
    running.delete(jobId);
    const products = harvest(jobs.get(jobId)?.outDir || job.outDir);
    const hasVideoExpected = /video|视频/.test(ch.label) || (ch.expectedProducts || []).some((p) => p.endsWith('.mp4'));
    const gotCore = hasVideoExpected ? products.some((p) => p.type === 'video') : products.length > 0;
    const voiceError = code === 0 && gotCore ? validateVoiceDelivery(ch, job.outDir, products, job.voice) : null;
    const doneAt = new Date().toISOString();
    const completedJob = { ...jobs.get(jobId), doneAt };
    const cost = calculateAndWriteVideoCost(completedJob);
    if (code === 0 && gotCore && !voiceError) {
      jobs.update(jobId, { status: 'done', products, cost, doneAt, logTail: workerLogTail(job.outDir, 2) });
    } else {
      jobs.update(jobId, {
        status: 'failed',
        products,
        cost,
        error: code !== 0
          ? `Claude 进程退出码 ${code}`
          : voiceError || '跑完了但没找到预期成片（详见日志）',
        doneAt,
        logTail: workerLogTail(job.outDir, 4),
      });
    }
    tick();
  });

  running.set(jobId, { child, timer, logTimer, logBuf });
}

export function retryJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('job 不存在');
  if (job.status === 'running') throw new Error('还在跑');
  const brand = brands.get(job.brandId);
  const channel = channelOf(brand, job.channelId);
  jobs.update(jobId, {
    status: 'queued',
    error: null,
    doneAt: null,
    logTail: '',
    products: [],
    voice: voiceForJob(brand, channel) || job.voice || null,
  });
  tick();
  return jobs.get(jobId);
}

export function holdJob(jobId, reason = '等待外部资源') {
  const job = jobs.get(jobId);
  if (!job) throw new Error('job 不存在');
  if (job.status === 'running') throw new Error('任务仍在运行，请先停止生产进程');
  return jobs.update(jobId, {
    status: 'waiting_external',
    error: String(reason || '等待外部资源'),
    doneAt: null,
    logTail: '',
  });
}

export function resumeJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new Error('job 不存在');
  if (job.status !== 'waiting_external') throw new Error('只有等待外部资源的任务可以继续');
  const brand = brands.get(job.brandId);
  if (/Keke Voice|声音|配音/.test(String(job.error || '')) && !selectedVoiceStyle(brand)) {
    throw new Error('请先在风格库上传样音，并设为该品牌当前声音');
  }
  return retryJob(jobId);
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function finalizeRecoveredJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  const brand = brands.get(job.brandId);
  const channel = channelOf(brand, job.channelId);
  const products = harvest(job.outDir);
  const expectsVideo = /video|视频/.test(channel?.label || '') || (channel?.expectedProducts || []).some((p) => p.endsWith('.mp4'));
  const gotCore = expectsVideo ? products.some((product) => product.type === 'video') : products.length > 0;
  const voiceError = gotCore ? validateVoiceDelivery(channel, job.outDir, products, job.voice) : null;
  const doneAt = new Date().toISOString();
  const cost = calculateAndWriteVideoCost({ ...job, doneAt });
  if (gotCore && !voiceError) {
    jobs.update(jobId, {
      status: 'done', products, cost, doneAt, error: null,
      logTail: '服务重启后已接管原进程，并自动完成收片',
    });
  } else {
    jobs.update(jobId, {
      status: 'failed', products, cost, doneAt,
      error: voiceError || '接管的生产进程已结束，但还没有找到预期成片，可从断点重跑',
      logTail: '服务重启后已接管原进程；进程结束时自动收片未找到完整交付',
    });
  }
  tick();
}

function adoptRunningJob(job) {
  jobs.update(job.id, {
    status: 'running', error: null, doneAt: null,
    logTail: '服务重启后已重新接管原生产进程',
  });
  const timer = setInterval(() => {
    if (processAlive(job.pid)) {
      const tail = workerLogTail(job.outDir, 3);
      if (tail) jobs.update(job.id, { logTail: tail.slice(-300) });
      return;
    }
    clearInterval(timer);
    running.delete(job.id);
    finalizeRecoveredJob(job.id);
  }, 5000);
  timer.unref?.();
  running.set(job.id, { child: null, timer, logBuf: [], adopted: true });
}

// 服务重启恢复：子进程可能仍存活。存活则接管并轮询，确认已死才标记中断。
export function recoverOnBoot() {
  for (const j of jobs.all()) {
    const interrupted = j.status === 'failed' && j.error === '服务重启中断，可重跑';
    if (j.status !== 'running' && !interrupted) continue;
    if (processAlive(j.pid)) {
      adoptRunningJob(j);
    } else if (j.status === 'running') {
      jobs.update(j.id, { status: 'failed', error: '服务重启中断，可重跑', doneAt: new Date().toISOString() });
    }
  }
}
