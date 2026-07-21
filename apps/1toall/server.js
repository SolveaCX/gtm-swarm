// 1toAll 服务器：API + 静态前端
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import {
  PORT,
  PUBLIC_DIR,
  OUTPUT_DIR,
  ASSETS_DIR,
  DATA_DIR,
  MODELS,
  DEFAULT_MODEL,
  IMAGE_DESIGN_MODEL,
} from './config.js';
import { PLATFORMS, GROUPS, getPlatform } from './lib/platforms.js';
import { brands, styles, plays, presets, projects, calendar, accounts, jobs, chats, pool, cliTokens, wsSettings, acctStats, drafts, xPool } from './lib/store.js';
import { ensureXPool } from './lib/x-pool.js';
import { mintCliToken, verifyCliToken, handleMcpRequest, reapStaleClaims, STALE_CLAIM_MIN } from './lib/cli-mcp.js';
import {
  createJob,
  retryJob,
  holdJob,
  resumeJob,
  deliveryError,
  recoverOnBoot,
  harvest,
  channelOf,
  hasLocalClaude,
  probeSeconds,
  MEDIA_ROOT,
} from './lib/dispatch.js';
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, validModel, chatTurn } from './lib/chat.js';
import { generateOutput, renderImageFromPrompt, ideate, routeTopic, draftBrand, extractJson } from './lib/generate.js';
import { chat } from './lib/flatkey.js';
import { modelPref } from './lib/model-prefs.js';
import { buildWechatArticle, generateArticleImages } from './lib/article.js';
import { renderWechatHtml } from './lib/wechat-layout.js';
import { getNews, getNewsCached } from './lib/news.js';
import { getInspiration, getInspirationCached } from './lib/inspiration-radar.js';
import { organizeDelivery, ownerOfBrand } from './lib/delivery.js';
import { keyAvailable, listModels } from './lib/flatkey.js';
import { splitCopy } from './lib/copysplit.js';
import { listZip } from './lib/unzip.js';
import { tts, listVoices, elevenKeyAvailable } from './lib/tts.js';
import { calculateAndWriteVideoCost, loadCostSettings } from './lib/video-cost.js';
import { buildContentLedger } from './lib/content-ledger.js';
import { execFile } from 'node:child_process';
import { ensureSeed } from './data/seed.js';
import { ensureHunterStyles, hunterWxWriting, hunterWxCover, hunterWxIllus } from './lib/hunter-style.js';
import { readUsageDay, beijingDay } from './lib/usage-log.js';
import { costCny, pricingTable, priceFor } from './lib/pricing.js';
import { qcWithExposure } from './lib/qc.js';
import { cookiesFromRequest, runWithActor, runWithWorkspace, tenantFromRequest, workspaceFromRequest } from './lib/workspace-context.js';
import { ELEVENAGENTS_SESSION_COOKIE, verifyElevenAgentsSession } from './lib/elevenagents-sso.js';

[DATA_DIR, OUTPUT_DIR, ASSETS_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));
ensureSeed();
try { ensureHunterStyles(); } catch (e) { console.warn('Hunter 风格播种失败:', e.message); }

// 品牌渠道矩阵：data/channels-patch.json 幂等合入 brands（P2 蒸馏产物）
try {
  const patchFile = path.join(DATA_DIR, 'channels-patch.json');
  if (fs.existsSync(patchFile)) {
    const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
    for (const [bid, v] of Object.entries(patch)) {
      const b = brands.get(bid);
      if (b && Array.isArray(v.channels)) brands.update(bid, { channels: v.channels });
    }
    console.log('[指挥部] 渠道矩阵已合入', Object.keys(patch).length, '个品牌');
  }
} catch (e) { console.error('[指挥部] channels-patch 合入失败：', e.message); }
recoverOnBoot();

// 灵感雷达 + AI 快讯：每天 4 次定时自动抓取（北京时间 08:00 / 12:00 / 16:00 / 20:00，每 5 分钟对表）
// 采集节奏写进日历：每天 4 个槽位以 kind=radar 卡片出现在日历页（待采集 → 完成后带统计），
// status 用 auto/done 而不是 scheduled，避免被「一键跑全部」当成内容排期去生成。
const AUTO_FETCH_HOURS = [8, 12, 16, 20];
// 采集节奏可以临时改（派活台里说一句「7天每天8次每隔3h」就是改这个），
// 到期后自动回落到默认的一天 4 次。
function radarHours() {
  const plan = (wsSettings.get() || {}).radarPlan;
  if (!plan?.hours?.length) return AUTO_FETCH_HOURS;
  if (plan.until && beijingDay() > plan.until) return AUTO_FETCH_HOURS;
  return plan.hours;
}
// 每天的默认槽位；477 也可以在日历里手加任意时间点（kind=radar 的排期）
function seedRadarSlots(dateStr, { onlyFrom = null } = {}) {
  const have = new Set(calendar.all().filter((e) => e.kind === 'radar' && e.date === dateStr).map((e) => e.time));
  for (const h of radarHours()) {
    const time = `${String(h).padStart(2, '0')}:00`;
    if (have.has(time)) continue;
    // 中途改节奏时不给今天补已经过去的点——否则一轮采集会把一串过期槽位一起标成「已完成」
    if (onlyFrom && time < onlyFrom) continue;
    calendar.create({
      kind: 'radar', date: dateStr, time, idea: '灵感雷达自动采集', brandId: 'none', brandName: '系统',
      outputs: [], auto: true, status: 'auto',
    });
  }
}
setInterval(async () => {
  const bj = new Date(Date.now() + 8 * 3600e3); // 北京时间
  const dateStr = bj.toISOString().slice(0, 10);
  const nowHHMM = bj.toISOString().slice(11, 16);
  try { seedRadarSlots(dateStr); } catch {}
  // 到期即跑：今天已过点且还没采过的槽位（默认 4 个 + 手加的），一轮采集把它们一起结掉
  let due = [];
  try {
    due = calendar.all().filter((e) => e.kind === 'radar' && e.status === 'auto' && e.date === dateStr && String(e.time || '') <= nowHHMM);
  } catch {}
  if (!due.length) return;
  let stats = null;
  try {
    const data = await getInspiration({ refresh: true });
    stats = data?.stats || null;
    console.log(`[cron] 灵感雷达已刷新（${due.map((e) => e.time).join('/')}）`);
  } catch (e) { console.log('[cron] 灵感雷达刷新失败:', e.message); }
  const patch = stats
    ? { status: 'done', summary: `采集 ${stats.total} 条 · 必写 ${stats.must} · 值得写 ${stats.strong}`, ranAt: new Date().toISOString() }
    : { status: 'error', summary: '采集失败，等下一个时间点重试' };
  for (const e of due) { try { calendar.update(e.id, patch); } catch {} }
  try { await getNews({ refresh: true }); console.log('[cron] AI 快讯已刷新'); }
  catch (e) { console.log('[cron] AI 快讯刷新失败:', e.message); }
}, 5 * 60e3).unref?.();

const app = express();
app.use(express.json({ limit: '12mb' }));

// Production workbench protection. The service has write endpoints and paid
// model calls, so it must never be published as an anonymous website.
const AUTH_USER = String(process.env.ONE_TO_ALL_AUTH_USER || '').trim();
const AUTH_PASSWORD = String(process.env.ONE_TO_ALL_AUTH_PASSWORD || '');
if (process.env.NODE_ENV === 'production' && (!AUTH_USER || !AUTH_PASSWORD)) {
  throw new Error('ONE_TO_ALL_AUTH_USER and ONE_TO_ALL_AUTH_PASSWORD are required in production');
}

function sameSecret(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

const SESSION_COOKIE = 'one_to_all_session';
const SESSION_TOKEN = AUTH_PASSWORD
  ? createHmac('sha256', AUTH_PASSWORD).update(`1toall:${AUTH_USER}`).digest('hex')
  : '';

function safeNext(value) {
  const next = String(value || '/');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function loginPage(next) {
  const destination = JSON.stringify(safeNext(next)).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · one</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui;color:#111827;background:#f6f7f9}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(420px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:30px;box-shadow:0 18px 50px #11182712}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.12em;color:#635bff;text-transform:uppercase}h1{margin:10px 0 6px;font-size:28px}p{margin:0 0 24px;color:#6b7280;line-height:1.55}label{display:block;margin:14px 0 6px;font-size:13px;font-weight:700}input{width:100%;border:1px solid #d8dce3;border-radius:10px;padding:12px 13px;font-size:15px;outline:none}input:focus{border-color:#635bff;box-shadow:0 0 0 3px #635bff18}button{width:100%;margin-top:20px;border:0;border-radius:10px;padding:13px;background:#111827;color:#fff;font-size:15px;font-weight:800;cursor:pointer}.error{min-height:20px;margin-top:12px;color:#b42318;font-size:13px}</style></head><body><main class="card"><div class="eyebrow">11agents · Flatkey</div><h1>one 工作台</h1><p>Hunter × 47 的内容分发 Agent。登录后可进入当前项目的数据空间。</p><form id="login"><label for="user">用户名</label><input id="user" autocomplete="username" value="hunter"><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" autofocus><button>进入工作台</button><div class="error" id="error"></div></form></main><script>
  const next=${destination};document.getElementById('login').addEventListener('submit',async(e)=>{e.preventDefault();const error=document.getElementById('error');error.textContent='';const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('user').value,password:document.getElementById('password').value})});if(r.ok)location.assign(next);else error.textContent='用户名或密码不正确';});
  </script></body></html>`;
}

// Health stays unauthenticated so pm2/nginx/CI can verify the service without
// distributing operator credentials.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: '1toall',
    release: process.env.ONE_TO_ALL_RELEASE_SHA || 'development',
    keyOk: keyAvailable(),
    models: MODELS.length,
  });
});

app.get('/login', (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.type('html').send(loginPage(req.query.next));
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!sameSecret(username, AUTH_USER) || !sameSecret(password, AUTH_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'invalid credentials' });
  }
  res.cookie(SESSION_COOKIE, SESSION_TOKEN, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  return res.json({ ok: true });
});

// ═══ CLI 接入端点（Claude Code / Codex 经 MCP 直连）═══
// 挂在会话认证之前：它用 Bearer 令牌自证身份，令牌串自带 workspace（otk_<ws>_…），
// 服务端只存哈希。命中后所有 store 读写都跑在该 workspace 上下文里。
app.post('/api/cli/mcp', async (req, res) => {
  const auth = verifyCliToken(req.headers.authorization);
  if (!auth) {
    return res.status(401).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32001, message: 'invalid or missing token' } });
  }
  try {
    const out = await runWithWorkspace(auth.workspace, () => handleMcpRequest(req.body, { label: auth.label }));
    if (out === null) return res.status(202).end(); // notification：无响应体
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32000, message: e.message } });
  }
});
app.get('/api/cli/mcp', (req, res) => res.status(405).json({ ok: false, error: 'POST JSON-RPC only' }));

app.use(async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  const requestCookies = cookiesFromRequest(req);
  const sharedSession = requestCookies[ELEVENAGENTS_SESSION_COOKIE] || '';
  if (sharedSession) {
    const sso = await verifyElevenAgentsSession({
      token: sharedSession,
      workspace: workspaceFromRequest(req),
      tenantId: tenantFromRequest(req),
    });
    if (sso) {
      req.authSource = 'elevenagents';
      req.elevenAgentsUser = sso.user;
      req.elevenAgentsWorkspace = sso.workspace;
      return next();
    }
  }

  // Local auth remains available as a break-glass path, but it must never
  // mask a valid 11agents session during normal use.
  if (!AUTH_USER && !AUTH_PASSWORD) {
    req.authSource = 'disabled';
    return next();
  }
  const session = requestCookies[SESSION_COOKIE] || '';
  if (sameSecret(session, SESSION_TOKEN)) {
    req.authSource = 'emergency';
    return next();
  }
  const raw = String(req.headers.authorization || '');
  const encoded = raw.startsWith('Basic ') ? raw.slice(6) : '';
  let user = '';
  let password = '';
  try {
    [user, password] = Buffer.from(encoded, 'base64').toString('utf8').split(/:(.*)/s, 2);
  } catch {}
  if (sameSecret(user, AUTH_USER) && sameSecret(password, AUTH_PASSWORD)) {
    req.authSource = 'basic';
    return next();
  }
  if (String(req.headers.accept || '').includes('text/html')) {
    return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || '/')}`);
  }
  return res.status(401).json({ ok: false, error: 'authentication required' });
});

// The selected 11agents project is carried by a small cookie after the entry
// link opens `?workspace=<slug>`. All JSON collections below are scoped by this
// context, while the scheduler defaults to Flatkey outside a request.
app.use((req, res, next) => {
  const workspace = workspaceFromRequest(req);
  const tenantId = tenantFromRequest(req);
  if (req.query.workspace) {
    res.cookie('one_to_all_workspace', workspace, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
  if (tenantId && req.query.tenant_id) {
    res.cookie('one_to_all_tenant', tenantId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
  // 操作人：SSO 登录时挂在 req.elevenAgentsUser（{id,email,name}），本地无登录 /
  // emergency / basic 分支下不存在，此时传 null。store 的 create/update 会自动盖 createdBy/updatedBy。
  const actor = req.elevenAgentsUser
    ? { id: req.elevenAgentsUser.id, email: req.elevenAgentsUser.email }
    : null;
  return runWithWorkspace(workspace, () => runWithActor(actor, next));
});

// A protected, read-only proof point for production SSO acceptance. It never
// returns session tokens or local emergency credentials.
app.get('/api/auth/status', (req, res) => {
  const workspace = req.elevenAgentsWorkspace || {
    slug: workspaceFromRequest(req),
    tenant_id: tenantFromRequest(req) || null,
  };
  return res.json({
    ok: true,
    source: req.authSource || 'unknown',
    user: req.elevenAgentsUser
      ? {
          id: req.elevenAgentsUser.id,
          email: req.elevenAgentsUser.email,
          name: req.elevenAgentsUser.name,
        }
      : null,
    workspace,
  });
});

// 静态资源
// index.html 绝不缓存，且把 app.js / style.css 的引用打上本次 release 版本号——
// 发版后浏览器必然拉到新代码，不会像以前那样吃着旧缓存看老界面。
// 线上按 release SHA 打版本（同一版本长缓存）；本地没有 SHA 时按进程启动时间，
// 保证每次重启前端都能拉到刚改的代码，开发时不会对着旧缓存 debug。
const RELEASE_SHA = process.env.ONE_TO_ALL_RELEASE_SHA || '';
const IMMUTABLE_ASSETS = Boolean(RELEASE_SHA);
const ASSET_V = RELEASE_SHA ? RELEASE_SHA.slice(0, 12) : `dev${Date.now().toString(36)}`;
app.get(['/', '/index.html'], (req, res) => {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  html = html.replace(/(href|src)="\/(css\/style\.css|js\/app\.js)"/g, `$1="/$2?v=${ASSET_V}"`);
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
});
app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    // 线上带 release 版本号的 js/css 才长缓存；本地一律不缓存
    if (/\.(?:js|css)$/.test(filePath)) {
      res.set('Cache-Control', IMMUTABLE_ASSETS ? 'public, max-age=31536000, immutable' : 'no-store');
    } else if (filePath.endsWith('index.html')) res.set('Cache-Control', 'no-store');
  },
}));
app.use('/output', express.static(OUTPUT_DIR));
fs.mkdirSync(MEDIA_ROOT, { recursive: true });
app.use('/media', express.static(MEDIA_ROOT));
app.use('/assets', express.static(ASSETS_DIR));

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, err, code = 500) =>
  res.status(code).json({ ok: false, error: err?.message || String(err) });

app.get('/api/features', (req, res) => ok(res, { workPass: true }));

// ---- 启动配置（前端一次性拉取）----
app.get('/api/bootstrap', (req, res) => {
  ok(res, {
    platforms: PLATFORMS,
    groups: GROUPS,
    models: MODELS,
    defaultModel: DEFAULT_MODEL,
    brands: brands.all(),
    styles: styles.all(),
    plays: plays.all(),
    presets: presets.all(),
    workspace: workspaceFromRequest(req),
    keyOk: keyAvailable(),
    localEngine: hasLocalClaude(), // false=本机无 claude CLI，重型任务等产能机认领
  });
});

// ---- 品牌库 ----
// ── 模型全家桶：flatkey 模型目录（10 分钟缓存）+ workspace 模型偏好 ──
let MODEL_CATALOG = { at: 0, items: [] };
app.get('/api/models/catalog', async (req, res) => {
  try {
    if (!MODEL_CATALOG.items.length || Date.now() - MODEL_CATALOG.at > 10 * 60e3) {
      MODEL_CATALOG = { at: Date.now(), items: await listModels() };
    }
    ok(res, MODEL_CATALOG.items);
  } catch (e) { fail(res, e); }
});
app.get('/api/settings/models', (req, res) => ok(res, {
  prefs: (wsSettings.get() || {}).models || {},
  defaults: { text: DEFAULT_MODEL, topic: DEFAULT_MODEL, imageDesign: IMAGE_DESIGN_MODEL, image: 'gpt-image-2', worker: 'claude-opus-4-8-fk-cc', qc: 'gpt-5.4-mini' },
}));
app.put('/api/settings/models', (req, res) => {
  const m = (req.body || {}).models || {};
  const clean = {};
  for (const k of ['text', 'topic', 'imageDesign', 'image', 'worker', 'qc']) {
    if (typeof m[k] === 'string') clean[k] = m[k].trim(); // 空串=清掉该项回默认
  }
  const cur = (wsSettings.get() || {}).models || {};
  const merged = { ...cur, ...clean };
  for (const k of Object.keys(merged)) if (!merged[k]) delete merged[k];
  ok(res, wsSettings.set({ models: merged }));
});

// ── AI 开风格：一句话 + 可选样本 → 按 kind 出配方字段（预填表单，人过目后才存）──
app.post('/api/styles/draft', async (req, res) => {
  const { kind = 'writing', brief = '', sample = '' } = req.body || {};
  if (!brief.trim()) return fail(res, '先说一句想要什么风格', 400);
  const specs = {
    writing: '输出 {"name":"风格名(≤12字)","voice":"语气/调性","sentence":"句式/节奏","devices":"常用手法","banned":"务必避开","example":"一段 100 字内的示范文字（按该风格现写）"}',
    visual: '输出 {"name":"风格名(≤12字)","desc":"视觉描述：配色/线条/质感/构图/文字排版，具体到能直接喂给出图模型","usage":"适合场景"}',
    video: '输出 {"name":"风格名(≤12字)","desc":"画面语言：节奏/运镜/字幕样式/封面感/BGM 情绪，具体到能指导剪辑","market":"适配市场与平台","usage":"适合场景"}',
  };
  try {
    const raw = await chat({
      model: modelPref('text', DEFAULT_MODEL), maxTokens: 900, purpose: 'style-draft',
      system: '你是内容风格设计师。只输出 JSON，别的什么都不说。配方要具体可执行，不要套话。',
      user: `按下面的要求起草一套${kind === 'video' ? '视频' : kind === 'visual' ? '图片' : '写作'}风格配方。\n需求：${brief.slice(0, 400)}\n${sample ? `参考样本（从中蒸馏特征）：\n${sample.slice(0, 2500)}\n` : ''}${specs[kind] || specs.writing}`,
    });
    const parsed = extractJson(raw);
    ok(res, parsed);
  } catch (e) { fail(res, e); }
});

// ── 模型单价表（上游 API 参考价，可改；flatkey 实扣以其控制台为准）──
// 表里带上「用过但还没定价」的模型（近 14 天用量日志里扫出来）——
// 价目缺一行，账本就少算一笔钱，与其闷着不如摆到 477 眼前让他填。
app.get('/api/pricing', (req, res) => {
  const table = pricingTable();
  const seen = new Set();
  for (let i = 0; i < 14; i++) {
    const day = beijingDay(Date.now() - i * 24 * 3600e3);
    for (const row of readUsageDay(day)) {
      const model = row.model || row.requestedModel;
      if (model && !priceFor(model)) seen.add(String(model));
    }
  }
  for (const job of jobs.all()) {
    for (const name of (job.cost?.modelNames || [])) if (!priceFor(name)) seen.add(String(name));
  }
  ok(res, [
    ...table,
    ...[...seen].map((match) => ({ match, type: 'token', usdInPerM: 0, usdOutPerM: 0, note: '用过但还没定价——填上就进账本' })),
  ]);
});
app.put('/api/pricing', (req, res) => {
  const rows = Array.isArray((req.body || {}).pricing) ? req.body.pricing : [];
  const clean = rows.filter((r) => r && typeof r.match === 'string' && r.match.trim())
    .map((r) => ({
      match: r.match.trim(), type: ['token', 'image', 'char'].includes(r.type) ? r.type : 'token',
      usdInPerM: Number(r.usdInPerM) || 0, usdOutPerM: Number(r.usdOutPerM) || 0,
      usdPerImage: Number(r.usdPerImage) || 0, usdPerMChars: Number(r.usdPerMChars) || 0,
      note: String(r.note || '').slice(0, 80),
    }));
  wsSettings.set({ pricing: clean });
  ok(res, pricingTable());
});

// ── 自有 X 账号库（灵感雷达自采集的账号池）──
app.get('/api/xpool', (req, res) => ok(res, ensureXPool()));
app.post('/api/xpool', (req, res) => {
  const { handle, name, bio, group } = req.body || {};
  const h = String(handle || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return fail(res, 'handle 不合法', 400);
  ensureXPool();
  if (xPool.all().some((x) => x.handle.toLowerCase() === h.toLowerCase())) return fail(res, '已在库里', 400);
  ok(res, xPool.create({ handle: h, name: String(name || h).slice(0, 60), bio: String(bio || '').slice(0, 120), group: group === '官方' ? '官方' : 'builder' }));
});
app.delete('/api/xpool/:id', (req, res) => ok(res, { removed: xPool.remove(req.params.id) }));

// ── 草稿箱：追加式生成历史，只有显式删除才消失 ──
app.get('/api/drafts', (req, res) => ok(res, drafts.all().slice(0, 300)));
app.delete('/api/drafts/:id', (req, res) => ok(res, { removed: drafts.remove(req.params.id) }));

// ── 对话式派活（✳ 派活台）：自然语言 → 解析成派单动作或普通回复 ──
app.post('/api/desk/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    if (!String(message || '').trim()) return fail(res, '说点什么', 400);
    const allChans = brands.all().flatMap((b) => (b.channels || []).map((c) => ({ brandId: b.id, brand: b.name, id: c.id, label: c.label })));
    const machines = cliTokens.all().map((t) => t.label);
    const activeJobs = jobs.all().filter((j) => j.status !== 'done').slice(0, 8)
      .map((j) => `${j.channelLabel}:${j.status}${j.claimedBy ? '@' + j.claimedBy : ''}${j.assignedTo ? '→' + j.assignedTo : ''}`);
    // 确定性前置：这类句子人一眼就懂，不该赌模型。
    // 「排节奏」信号 + 「灵感采集」信号同时出现 → 直接当排期解析，连模型都不调。
    const msg = String(message);
    const cadenceHit = /每天|每隔|每小时|每\s*\d+\s*(小时|h|H)|连续\s*\d+\s*天|\d+\s*天(任务|内|的任务)|定时|排期|节奏/.test(msg);
    const radarHit = /灵感|雷达|采集|抓取|抓一次|抓一遍/.test(msg);
    if (cadenceHit && radarHit) {
      const pick = (re) => { const m = re.exec(msg); return m ? Number(m[1]) : 0; };
      const plan = radarPlanFrom({
        days: pick(/(\d+)\s*天/),
        timesPerDay: pick(/每天\s*(\d+)\s*次/) || pick(/(\d+)\s*次\s*\/?\s*天/),
        everyHours: pick(/每隔?\s*(\d+)\s*(?:个)?\s*(?:小时|h|H)/),
      });
      if (plan) {
        return ok(res, {
          schedule: plan,
          thinking: [
            '这句话里同时有「节奏」和「灵感采集」，直接按排期理解，没走模型',
            `连续 ${plan.days} 天：${plan.startDate} → ${plan.endDate}`,
            `每天 ${plan.hours.length} 次，间隔 ${plan.everyHours} 小时`,
            `具体时间点：${plan.hours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' / ')}`,
            `今天从 ${plan.todayFrom} 之后的点开始算，已经过去的点不补`,
          ],
          reply: `要把灵感采集改成「每天 ${plan.hours.length} 次、连排 ${plan.days} 天」吗？`,
        });
      }
    }
    const system = `你是派活台的意图解析器。你不写内容、不出方案、不列标题——只把用户的话解析成一个调度动作。
你的输出必须是且只能是一个 JSON 对象：第一个字符是 { ，最后一个字符是 } ，无任何前后文字或代码块。
三种动作：
{"action":"dispatch","brandId":"<渠道表里的brandId>","channelId":"<渠道表里的id>","topic":"<选题原文，保留链接>","assignTo":"<用户点名的产能机名，没点名就空串>","reply":"<一句话确认>"}
{"action":"schedule","target":"radar","days":<连续几天，数字>,"timesPerDay":<一天几次，数字>,"everyHours":<间隔几小时，数字，没说就 0>,"reply":"<一句话确认>"}
{"action":"reply","reply":"<信息不够时的自然反问，或对查询的简短回答>"}
所有字符串值必须是字面量，数字值必须是数字。channelId 只能取渠道表里存在的 id。

⚠️ 分清「做内容」和「排节奏」：
- 说要一条视频/一篇文章、给了选题 → dispatch
- 说「每天几次」「每隔几小时」「连续几天」「定时」「抓灵感」「采集」→ schedule，**不是** dispatch。
  排采集节奏跟做视频毫无关系，别硬塞进 dispatch。
  例：「布置7天任务，从今天开始每天8次，每隔3h抓一次灵感雷达采集」
  → {"action":"schedule","target":"radar","days":7,"timesPerDay":8,"everyHours":3,"reply":"..."}`;
    const userMsg = `【可用渠道表】${JSON.stringify(allChans)}
【产能机】${JSON.stringify(machines)}
【进行中任务】${JSON.stringify(activeJobs)}
【用户的话】${String(message).slice(0, 2000)}
解析成 JSON：`;
    const msgs = [...history.slice(-8).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.text || '').slice(0, 800) })), { role: 'user', content: userMsg }];
    // 最多两轮：首轮解析不出可用动作（既不能派单也没有回复文案）→ 追加「不合法请重出」再试一次
    let norm = null, rawText = '';
    for (let attempt = 0; attempt < 2 && !norm; attempt++) {
      const attemptMsgs = attempt === 0 ? msgs : [...msgs,
        { role: 'assistant', content: String(rawText).slice(0, 300) },
        { role: 'user', content: '输出不符合规则。重新输出：只有一个 JSON 对象，含 "action"（dispatch 或 reply）；dispatch 必带渠道表里存在的 "channelId" 和 "topic"；reply 必带 "reply" 文案。' }];
      rawText = await chat({ model: modelPref('text', DEFAULT_MODEL), system, messages: attemptMsgs, maxTokens: 400, purpose: 'desk-chat' });
      let parsed = null;
      try { parsed = extractJson(rawText); } catch { /* 非 JSON → 下一轮或落兜底 */ }
      if (!parsed || typeof parsed !== 'object') continue;
      // 宽容归一化：模型偶尔自造字段名/漏 action，按语义收拢
      const num = (...vals) => { for (const v of vals) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; } return 0; };
      const cand = {
        action: parsed.action || (parsed.channelId || parsed.channel_id ? 'dispatch' : 'reply'),
        channelId: String(parsed.channelId || parsed.channel_id || ''),
        brandId: String(parsed.brandId || parsed.brand_id || ''),
        topic: String(parsed.topic || parsed.idea || parsed.subject || '').trim(),
        assignTo: String(parsed.assignTo || parsed.assign_to || parsed.assigneeMachine || parsed.assignee || parsed.machine || '').trim(),
        target: String(parsed.target || 'radar').trim(),
        days: num(parsed.days, parsed.dayCount),
        timesPerDay: num(parsed.timesPerDay, parsed.times_per_day, parsed.perDay),
        everyHours: num(parsed.everyHours, parsed.every_hours, parsed.intervalHours),
        reply: String(parsed.reply || parsed.message || '').trim(),
      };
      if ((cand.action === 'dispatch' && cand.channelId) || (cand.action === 'schedule' && (cand.timesPerDay || cand.everyHours)) || cand.reply) norm = cand;
    }
    // 确定性兜底：用户话里直接点名了产能机而模型漏填 → 文本匹配补上
    if (norm && norm.action === 'dispatch' && !norm.assignTo) {
      const hit = machines.find((m) => m && String(message).includes(m));
      if (hit) norm.assignTo = hit;
    }
    if (!norm) {
      return ok(res, { reply: String(rawText || '').replace(/```[a-z]*\n?|```/g, '').trim().slice(0, 400) || '没听清，再说一次？' });
    }
    // 排采集节奏：同样先回确认卡，点了才落到日历
    if (norm.action === 'schedule') {
      const plan = radarPlanFrom(norm);
      if (!plan) return ok(res, { reply: '节奏没说清——一天几次？间隔几小时？连续几天？' });
      return ok(res, {
        schedule: plan,
        thinking: [
          '听懂的是：排「灵感雷达采集」的节奏，不是做视频',
          `连续 ${plan.days} 天：${plan.startDate} → ${plan.endDate}`,
          `每天 ${plan.hours.length} 次，间隔 ${plan.everyHours} 小时`,
          `具体时间点：${plan.hours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' / ')}`,
          `今天从 ${plan.todayFrom} 之后的点开始算，已经过去的点不补`,
        ],
        reply: norm.reply || `要把灵感采集改成「每天 ${plan.hours.length} 次、连排 ${plan.days} 天」吗？`,
      });
    }
    // 派活不当场执行，先回一张「要派这条吗」的确认卡：一条视频动辄几十块几十分钟，
    // 解析错了让 477 在开工前就看见，比事后取消便宜得多。
    if (norm.action === 'dispatch' && norm.channelId) {
      const brand = brands.get(norm.brandId) || brands.all().find((b) => (b.channels || []).some((c) => c.id === norm.channelId));
      if (!brand) return ok(res, { reply: '没找到对应品牌/渠道，换个说法试试？' });
      if (!norm.topic) return ok(res, { reply: '选题是什么？给我一句话或文章链接。' });
      const ch = (brand.channels || []).find((c) => c.id === norm.channelId);
      const machine = norm.assignTo
        ? `点名了「${norm.assignTo}」`
        : (machines.length ? `没点名机器 → 谁先认领谁做（在线的：${machines.join('、')}）` : '没点名机器，而且现在一台产能机都没绑——派了也没人接');
      return ok(res, {
        proposal: {
          brandId: brand.id, brandName: brand.name,
          channelId: norm.channelId, channelLabel: ch?.label || norm.channelId,
          topic: norm.topic, assignTo: norm.assignTo || '',
          estimate: ch?.estimate || ch?.eta || null,
        },
        thinking: [
          `听懂的是：要一条 ${ch?.label || norm.channelId}`,
          `账号：${brand.name}`,
          `选题：${norm.topic.slice(0, 120)}${norm.topic.length > 120 ? '…' : ''}`,
          `机器：${machine}`,
        ],
        reply: norm.reply || `要派「${ch?.label || norm.channelId}」这条吗？确认了才开工。`,
      });
    }
    return ok(res, { reply: norm.reply || '再说详细一点？' });
  } catch (e) { fail(res, e); }
});
// 「一天 N 次 / 每隔 M 小时 / 连排 D 天」→ 具体到点的采集计划。
// 只说了其中一项也能推：给了间隔就算次数，给了次数就算间隔。
function radarPlanFrom({ days, timesPerDay, everyHours }) {
  let every = Math.round(everyHours || 0);
  let times = Math.round(timesPerDay || 0);
  if (!every && times) every = Math.max(1, Math.round(24 / times));
  if (!times && every) times = Math.max(1, Math.floor(24 / every));
  if (!every || !times) return null;
  every = Math.min(24, Math.max(1, every));
  times = Math.min(24, Math.max(1, times));
  const hours = [];
  for (let i = 0; i < times; i++) {
    const h = (i * every) % 24;
    if (!hours.includes(h)) hours.push(h);
  }
  hours.sort((a, b) => a - b);
  const d = Math.min(60, Math.max(1, Math.round(days || 1)));
  const startDate = beijingDay();
  const endDate = beijingDay(Date.now() + (d - 1) * 86400e3);
  const todayFrom = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
  return { target: 'radar', days: d, everyHours: every, hours, startDate, endDate, todayFrom };
}
// 确认排期：写进 wsSettings（cron 按它出槽位）+ 把这几天的点直接铺进日历，477 立刻看得见
app.post('/api/desk/schedule', (req, res) => {
  try {
    const plan = radarPlanFrom(req.body || {});
    if (!plan) return fail(res, '节奏说不清：一天几次、间隔几小时至少给一个', 400);
    wsSettings.set({ radarPlan: { hours: plan.hours, until: plan.endDate, setAt: new Date().toISOString() } });
    let created = 0;
    for (let i = 0; i < plan.days; i++) {
      const date = beijingDay(Date.now() + i * 86400e3);
      const before = calendar.all().filter((e) => e.kind === 'radar' && e.date === date).length;
      seedRadarSlots(date, i === 0 ? { onlyFrom: plan.todayFrom } : {});
      created += calendar.all().filter((e) => e.kind === 'radar' && e.date === date).length - before;
    }
    ok(res, { ...plan, created });
  } catch (e) { fail(res, e); }
});
// 确认派活：只接上一步 /api/desk/chat 回的 proposal，点了确认才真正建任务
app.post('/api/desk/dispatch', (req, res) => {
  try {
    const { brandId, channelId, topic, assignTo } = req.body || {};
    const brand = brands.get(brandId);
    if (!brand) return fail(res, '品牌不存在', 400);
    const ch = (brand.channels || []).find((c) => c.id === channelId);
    if (!ch) return fail(res, '渠道不存在', 400);
    if (!String(topic || '').trim()) return fail(res, '选题是空的', 400);
    const job = createJob({ brandId: brand.id, channelId, idea: String(topic).trim() });
    if (assignTo) jobs.update(job.id, { assignedTo: String(assignTo).slice(0, 60) });
    ok(res, { taskId: job.id, channel: ch.label, assignTo: assignTo || '' });
  } catch (e) { fail(res, e); }
});

// ── CLI 接入令牌管理（登录会话内操作；明文令牌只在铸造时返回一次）──
app.get('/api/cli/tokens', (req, res) => ok(res, cliTokens.all().map((t) => ({
  id: t.id, label: t.label, tail: t.tokenTail, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt,
}))));
app.post('/api/cli/tokens', (req, res) => {
  const { row, token } = mintCliToken((req.body || {}).label);
  ok(res, { id: row.id, label: row.label, token });
});
app.delete('/api/cli/tokens/:id', (req, res) => ok(res, { removed: cliTokens.remove(req.params.id) }));

app.get('/api/brands', (req, res) => ok(res, brands.all()));
app.post('/api/brands', (req, res) => ok(res, brands.create(req.body || {})));
app.put('/api/brands/:id', (req, res) => {
  const r = brands.update(req.params.id, req.body || {});
  return r ? ok(res, r) : fail(res, '品牌不存在', 404);
});
app.delete('/api/brands/:id', (req, res) => ok(res, { removed: brands.remove(req.params.id) }));

// 一句话品牌描述 → AI 帮忙填好整份品牌草稿（只回给前端预填表单，不落库）
app.post('/api/brands/draft', async (req, res) => {
  const { description } = req.body || {};
  if (!description || !description.trim()) return fail(res, '先写一句话品牌描述', 400);
  try {
    ok(res, await draftBrand(description.trim()));
  } catch (e) {
    fail(res, e);
  }
});

// 上传 logo（base64 data url）→ 存盘返回路径
app.post('/api/brands/logo', (req, res) => {
  try {
    const { dataUrl, name } = req.body || {};
    const m = /^data:image\/(png|jpe?g|svg\+xml|webp);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return fail(res, '不是合法的图片 data url', 400);
    const ext = m[1] === 'svg+xml' ? 'svg' : m[1].replace('jpeg', 'jpg');
    const file = `logo-${(name || 'brand').replace(/[^\w-]/g, '')}-${Date.now()}.${ext}`;
    const dir = path.join(ASSETS_DIR, 'brands');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], 'base64'));
    ok(res, { url: `/assets/brands/${file}` });
  } catch (e) {
    fail(res, e);
  }
});

// IP 人物参考图上传（用于"固定人物形象"生图，走 Nano 参考图通道）
app.post('/api/brands/ip-image', (req, res) => {
  try {
    const { dataUrl, name } = req.body || {};
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return fail(res, '请传 png/jpg/webp 图片', 400);
    const ext = m[1].replace('jpeg', 'jpg');
    const file = `ip-${(name || 'brand').replace(/[^\w-]/g, '')}-${Date.now()}.${ext}`;
    const dir = path.join(ASSETS_DIR, 'brands');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], 'base64'));
    ok(res, { url: `/assets/brands/${file}` });
  } catch (e) {
    fail(res, e);
  }
});

// 声音样音上传：样音和本地配音参考音共用同一份平台资产。
app.post('/api/styles/audio', (req, res) => {
  try {
    const { dataUrl, name } = req.body || {};
    const m = /^data:audio\/(wav|x-wav|mpeg|mp4|x-m4a|aiff|x-aiff|aac|ogg|webm);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return fail(res, '请上传 wav/mp3/m4a/aiff/aac/ogg/webm 音频', 400);
    const extByType = { wav: 'wav', 'x-wav': 'wav', mpeg: 'mp3', mp4: 'm4a', 'x-m4a': 'm4a', aiff: 'aiff', 'x-aiff': 'aiff', aac: 'aac', ogg: 'ogg', webm: 'webm' };
    const ext = extByType[m[1]];
    const safeName = String(name || 'voice').replace(/[^\w\u4e00-\u9fff-]/g, '').slice(0, 40) || 'voice';
    const kind = req.body?.kind === 'bgm' ? 'bgm' : 'voice'; // \u58f0\u7ebf\u6837\u97f3 / \u80cc\u666f\u97f3\u4e50\uff0c\u5206\u76ee\u5f55\u653e
    const file = `${kind}-${safeName}-${Date.now()}.${ext}`;
    const dir = path.join(ASSETS_DIR, kind === 'bgm' ? 'bgm' : 'voices');
    fs.mkdirSync(dir, { recursive: true });
    const localPath = path.join(dir, file);
    fs.writeFileSync(localPath, Buffer.from(m[2], 'base64'));
    ok(res, { url: `/assets/${kind === 'bgm' ? 'bgm' : 'voices'}/${file}`, path: localPath, seconds: probeSeconds(localPath) });
  } catch (e) {
    fail(res, e);
  }
});

// ---- 风格库（写作 / 视觉 / 声音风格配方）----
app.get('/api/styles', (req, res) => ok(res, styles.all()));
app.post('/api/styles', (req, res) => ok(res, styles.create(req.body || {})));
// 视觉风格补示例图：拿风格自己的描述当提示词现出一张，存回 sampleImage。
// 风格库里一堆「还没有预览图」的空框，光看文字描述根本判断不了长什么样。
app.post('/api/styles/:id/sample', async (req, res) => {
  const st = styles.get(req.params.id);
  if (!st) return fail(res, '风格不存在', 404);
  if (st.kind !== 'visual') return fail(res, '只有视觉风格能出示例图', 400);
  const desc = [st.desc, st.usage].filter(Boolean).join('\n');
  if (!desc.trim()) return fail(res, '这个风格还没写描述，出不了图', 400);
  try {
    const r = await renderImageFromPrompt({
      platformId: (req.body || {}).platformId || 'peitu',
      prompt: `按这套视觉风格出一张代表性示例图（画面本身即风格样板，不要出现说明文字）：\n${desc}`,
      brand: null, options: { lockCharacter: false }, vstyle: st,
      fileBase: `style-${st.id}-${Date.now().toString(36)}`,
    });
    ok(res, styles.update(st.id, { sampleImage: r.imageUrl }));
  } catch (e) { fail(res, e); }
});
app.put('/api/styles/:id', (req, res) => {
  const r = styles.update(req.params.id, req.body || {});
  return r ? ok(res, r) : fail(res, '风格不存在', 404);
});
app.delete('/api/styles/:id', (req, res) => {
  for (const brand of brands.all()) {
    if (brand.voiceStyleId === req.params.id) brands.update(brand.id, { voiceStyleId: null });
  }
  ok(res, { removed: styles.remove(req.params.id) });
});

// ---- 运营玩法库（来自运营 skill）----
app.get('/api/plays', (req, res) => ok(res, plays.all()));
app.post('/api/plays', (req, res) => ok(res, plays.create(req.body || {})));
app.put('/api/plays/:id', (req, res) => {
  const r = plays.update(req.params.id, req.body || {});
  return r ? ok(res, r) : fail(res, '玩法不存在', 404);
});
app.delete('/api/plays/:id', (req, res) => ok(res, { removed: plays.remove(req.params.id) }));

// ---- 运营需求库（品牌+形态+偏好配方）----
app.get('/api/presets', (req, res) => ok(res, presets.all()));
app.post('/api/presets', (req, res) => ok(res, presets.create(req.body || {})));
app.put('/api/presets/:id', (req, res) => {
  const r = presets.update(req.params.id, req.body || {});
  return r ? ok(res, r) : fail(res, '需求不存在', 404);
});
app.delete('/api/presets/:id', (req, res) => ok(res, { removed: presets.remove(req.params.id) }));

// ---- 新闻板块：AI builders 每日快讯（免 key feed + flatkey 加工，按天缓存）----
// 第一次加工当天新闻要调一次 LLM（约 1 分钟），之后当天全走缓存
app.get('/api/news', async (req, res) => {
  try {
    ok(res, await getNews({ refresh: req.query.refresh === '1' }));
  } catch (e) {
    fail(res, e);
  }
});

// ---- 灵感雷达：Podcast / YouTube / X → Taste 打分素材卡 ----
app.get('/api/inspiration', async (req, res) => {
  try { ok(res, await getInspiration({ refresh: req.query.refresh === '1' })); }
  catch (e) { fail(res, e); }
});

// ---- 项目（历史）----
app.get('/api/projects', (req, res) => ok(res, projects.all()));
app.get('/api/projects/:id', (req, res) => {
  const p = projects.get(req.params.id);
  return p ? ok(res, p) : fail(res, '项目不存在', 404);
});
app.delete('/api/projects/:id', (req, res) => ok(res, { removed: projects.remove(req.params.id) }));
// 暂停 / 继续 / 取消。产能机在云端另一头，靠心跳把停手指令捎过去（见 cli-mcp task_heartbeat）。
app.post('/api/jobs/:id/pause', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return fail(res, '任务不存在', 404);
  if (['done', 'canceled'].includes(job.status)) return fail(res, `已经${job.status === 'done' ? '完成' : '取消'}了，暂停不了`, 400);
  const wasRunning = job.status === 'claimed';
  ok(res, {
    job: jobs.update(req.params.id, { status: 'paused', pausedAt: new Date().toISOString(), pausedFrom: job.status, logTail: '已暂停（等 477 点继续）' }),
    // 已经在跑的活不是立刻停：产能机下一次心跳（最多 10-15 分钟）才收得到通知
    note: wasRunning ? '产能机下次报活时会收到停手通知，最多十几分钟' : '还没开工，直接停在队列里了',
  });
});
app.post('/api/jobs/:id/resume', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return fail(res, '任务不存在', 404);
  if (job.status !== 'paused') return fail(res, `当前状态是 ${job.status}，没在暂停`, 400);
  // 一律回队列重新认领：暂停期间原来那台机器多半已经把活丢了
  ok(res, jobs.update(req.params.id, {
    status: 'queued', claimedBy: null, claimedAt: null, heartbeatAt: null,
    pausedAt: null, pausedFrom: null, logTail: '已继续，回队列等认领',
  }));
});
// 后移顺序：不取消，只把它挪到队尾，让别的活先做。队列按 deferredAt || createdAt 排。
app.post('/api/jobs/:id/defer', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return fail(res, '任务不存在', 404);
  if (job.status !== 'queued') return fail(res, `只有排队中的能后移（当前 ${job.status}）`, 400);
  const queued = jobs.all().filter((j) => j.status === 'queued');
  ok(res, {
    job: jobs.update(req.params.id, { deferredAt: new Date().toISOString(), logTail: '已后移到队尾' }),
    note: queued.length > 1 ? `排到队尾了，前面还有 ${queued.length - 1} 条` : '队列里就它一条，后移了也还是它先做',
  });
});
app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return fail(res, '任务不存在', 404);
  if (job.status === 'done') return fail(res, '已经交付完了，取消不了——要清记录用删除', 400);
  if (job.status === 'canceled') return ok(res, job); // 已经是取消态，别报错，幂等返回
  ok(res, jobs.update(req.params.id, {
    status: 'canceled', canceledAt: new Date().toISOString(),
    logTail: `已取消${(req.body || {}).reason ? `：${String(req.body.reason).slice(0, 100)}` : ''}`,
  }));
});
// 删掉一条视频任务的记录。成片文件留在 media/ 不动——重复登记要清，素材不能陪葬。
app.delete('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return fail(res, '任务不存在', 404);
  return ok(res, { removed: jobs.remove(req.params.id), keptFiles: (job.products || []).length });
});

// 选题 agent：方向 + 品牌 → 5 个可勾选选题
// 选题路由：一个想法 → 该派给哪个账号（红线硬闸）
app.post('/api/route', async (req, res) => {
  const { idea } = req.body || {};
  if (!idea || !idea.trim()) return fail(res, '先写下想法', 400);
  const allBrands = brands.all();
  // 完全没有品牌：别报错撞墙，让前端能接着给「先按无品牌生成 / 30秒建号」的出路
  if (!allBrands.length) return ok(res, { decisions: [], best: null, bestReason: '', noBrands: true });
  // 有品牌但没配 routingHints 时，按账号定位（positioning）兜底路由，而不是硬性要求每个品牌都配好路由规则
  const routable = allBrands.filter((b) => b.routingHints || b.positioning);
  if (!routable.length) return fail(res, '没有可路由的账号（品牌里没配 routingHints 或 账号定位）', 400);
  try {
    ok(res, await routeTopic({ idea: idea.trim(), accounts: routable }));
  } catch (e) {
    fail(res, e);
  }
});

// 工作台：一次拉全今日所需（新闻走纯缓存，绝不烧 LLM，保证首屏快）
app.get('/api/dashboard', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = Date.now() - 7 * 86400e3;
  const allProjects = projects.all();
  const routable = brands.all().filter((b) => b.routingHints);
  const news = getNewsCached();
  const inspiration = getInspirationCached();
  ok(res, {
    today,
    news: news
      ? { date: news.date, stale: news.date !== today, flashes: (news.flashes || []).slice(0, 6), products: (news.products || []).slice(0, 3) }
      : null,
    inspiration: inspiration ? {
      builtAt: inspiration.builtAt,
      stats: inspiration.stats,
      cards: (inspiration.cards || []).filter((x) => x.score >= 70).slice(0, 8),
    } : null,
    accounts: routable.map((b) => ({
      id: b.id, name: b.name, tagline: b.tagline, positioning: b.positioning,
      redLine: (b.redLines || '').split('；')[0], platforms: Object.keys(b.platformRules || {}),
      primaryColor: b.primaryColor, accentColor: b.accentColor, logo: b.logo, logos: b.logos || [], defaultPack: b.defaultPack || [],
      weekCount: allProjects.filter((p) => p.brandId === b.id && new Date(p.createdAt).getTime() > weekAgo).length,
    })),
    todayCalendar: calendar.all().filter((e) => e.date === today),
    pendingCount: calendar.all().filter((e) => e.status === 'scheduled').length,
    recent: allProjects.slice(0, 4).map((p) => ({
      id: p.id, title: p.title, brandName: p.brandName, createdAt: p.createdAt,
      done: (p.outputs || []).filter((o) => o.status === 'done').length, total: (p.outputs || []).length,
    })),
  });
});

app.post('/api/ideate', async (req, res) => {
  const { direction, brandId, play } = req.body || {};
  if (!direction || !direction.trim()) return fail(res, '先给个大致方向', 400);
  try {
    const brand = brandId && brandId !== 'none' ? brands.get(brandId) : null;
    const data = await ideate({ direction: direction.trim(), brand, play });
    ok(res, data);
  } catch (e) {
    fail(res, e);
  }
});

// 创建项目（占位，输出标记 pending）
app.post('/api/projects', (req, res) => {
  const { idea, brandId, outputs = [], options = {} } = req.body || {};
  if (!idea || !idea.trim()) return fail(res, '想法不能为空', 400);
  if (!outputs.length) return fail(res, '至少选一种输出', 400);
  const brand = brandId ? brands.get(brandId) : null;
  const title = idea.trim().slice(0, 24);
  const project = projects.create({
    title,
    idea: idea.trim(),
    brandId: brandId || null,
    brandName: brand?.name || null,
    options,
    outputs: outputs
      .filter((id) => getPlatform(id))
      .map((id) => ({ platformId: id, status: 'pending' })),
  });
  ok(res, project);
});

// 共享生成 helper：路由 + 日历定时器都用它
// ── 品牌知识库串通：找品牌对应的 BrandHQ 目录 / 读知识库注入生成 / 运营动作沉淀台账 ──
// 媒体根下的一级目录，含指向目录的软链（本地常用软链把品牌目录桥到 BrandHQ）
function mediaRootDirs() {
  try {
    return fs.readdirSync(MEDIA_ROOT, { withFileTypes: true })
      .filter((e) => {
        if (e.name.startsWith('.')) return false;
        if (e.isDirectory()) return true;
        if (e.isSymbolicLink()) {
          try { return fs.statSync(path.join(MEDIA_ROOT, e.name)).isDirectory(); } catch { return false; }
        }
        return false;
      })
      .map((e) => e.name);
  } catch { return []; }
}
function hqDirForBrand(brand) {
  if (!brand) return null;
  const names = mediaRootDirs().filter((n) => !n.startsWith('_'));
  return names.find((n) => n === brand.name) ||
    names.find((n) => brand.name.includes(n) || n.includes(brand.name.split(' ')[0])) || null;
}
// 生成前读知识库核心文档（业务档案/品牌规范/内容策略），拼成 ≤2400 字上下文
function kbContextForBrand(brand) {
  const dir = hqDirForBrand(brand);
  if (!dir) return '';
  const kbDir = path.join(MEDIA_ROOT, dir, '知识库');
  const picks = ['业务档案.md', '品牌规范.md', '内容策略.md'];
  const parts = [];
  for (const f of picks) {
    try {
      const raw = fs.readFileSync(path.join(kbDir, f), 'utf8');
      parts.push(`《${f.replace('.md', '')}》\n${raw.replace(/\n{2,}/g, '\n').slice(0, 800)}`);
    } catch {}
  }
  if (!parts.length) return '';
  return `【品牌知识库（生成前先吸收，与素材冲突时以素材为准）】\n${parts.join('\n---\n')}`.slice(0, 2400);
}
// 发布动作自动沉淀：知识库/_运营台账.md（系统维护，追加一行）
function appendOpsLedger(brandName, entry) {
  try {
    const brand = brands.all().find((b) => b.name === brandName) || { name: brandName };
    const dir = hqDirForBrand(brand) || brandName;
    const kbDir = path.join(MEDIA_ROOT, dir, '知识库');
    if (!fs.existsSync(path.join(MEDIA_ROOT, dir))) return;
    fs.mkdirSync(kbDir, { recursive: true });
    const f = path.join(kbDir, '_运营台账.md');
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, `# 运营台账\n\n> 系统自动记录（发布/数据回填），别手改这个文件。\n\n| 日期 | 动作 | 内容 | 平台 | 链接/数据 |\n|---|---|---|---|---|\n`);
    }
    const today = new Date().toISOString().slice(0, 10);
    // 单元格清洗：换行/竖线会撑断 markdown 表格行，统一压成空格
    const cell = (v, max) => String(v ?? '-').replace(/\s*[\r\n|]+\s*/g, ' ').trim().slice(0, max) || '-';
    fs.appendFileSync(f, `| ${today} | ${cell(entry.action, 10)} | ${cell(entry.title, 30)} | ${cell(entry.platform, 16)} | ${cell(entry.detail, 60)} |\n`);
  } catch {}
}

// ideaOverride：一键派生场景用（如"把公众号成品文正文喂给小红书改写版式"），
// 只影响这一次生成，不改 project.idea，其它卡片、后续重写都还是按原始想法走。
async function generateForProject(project, platformId, mode = 'full', ideaOverride = null) {
  const platform = getPlatform(platformId);
  if (!platform) throw new Error('未知输出类型');
  const brand = project.brandId && project.brandId !== 'none' ? brands.get(project.brandId) : null;
  const styleId = project.options?.styleId;
  let style = styleId ? styles.get(styleId) : null; // 写作风格
  // 公众号形态没显式选风格时，默认吃从 Hunter 实文蒸馏的公众号文风
  if (!style && /^gongzhonghao/.test(platformId)) style = hunterWxWriting();
  const vstyleId = project.options?.vstyleId;
  const vstyle = vstyleId ? styles.get(vstyleId) : null; // 视觉风格
  const fileBase = `${project.id}-${platform.id}-${Date.now().toString(36)}`;
  const idea = ideaOverride || project.idea;
  try {
    let result;
    if (platform.kind === 'article_layout') {
      // 公众号成品文：走 article.js 编排（写正文，先不出图——省钱省等待，配图走独立端点）
      const article = await buildWechatArticle({
        idea, brand, options: project.options || {}, style, kbContext: kbContextForBrand(brand),
        model: project.options?.model, withImages: false, vstyle, fileBase,
      });
      result = { kind: 'article_layout', title: article.title, digest: article.digest, content: article.markdown, images: article.images, quality: article.quality, cost: article.cost };
    } else {
      result = await generateOutput(platform.id, {
        idea,
        brand,
        kbContext: kbContextForBrand(brand),
        options: project.options || {},
        style,
        vstyle,
        fileBase,
        mode,
      });
    }
    // 图片 stage 1 只出提示词 → status='prompt'（待制作）；其余 done
    const status = result.status === 'prompt' ? 'prompt' : 'done';
    const out = { platformId: platform.id, status, ...result, at: new Date().toISOString() };
    saveOutput(project.id, platform.id, out);
    // 文字类产出生成完自动质检（fire-and-forget：质检失败不影响出稿）
    if (status === 'done' && typeof out.content === 'string' && out.content.length > 80 && platform.kind !== 'image') {
      queueQc(project.id, platform.id).catch(() => {});
    }
    return out;
  } catch (e) {
    const out = { platformId: platform.id, status: 'error', error: e.message };
    saveOutput(project.id, platform.id, out);
    throw e;
  }
}

// 质检一条产出并把结果写回 output.qc（生成后自动触发；也可手动重跑）
async function queueQc(projectId, platformId) {
  const project = projects.get(projectId);
  const out = (project?.outputs || []).find((o) => o.platformId === platformId);
  if (!project || !out || typeof out.content !== 'string') return null;
  const brand = project.brandId && project.brandId !== 'none' ? brands.get(project.brandId) : null;
  const style = project.options?.styleId ? styles.get(project.options.styleId) : null;
  const qc = await qcWithExposure({
    content: out.content, title: out.title || project.title || '', platformId,
    brand, style, brandName: project.brandName || brand?.name || '',
  });
  // 直接 update 而不是 saveOutput：质检不是新版本，不该再进一次草稿箱
  const cur = projects.get(projectId);
  if (!cur) return qc;
  const outputs = (cur.outputs || []).map((o) => (o.platformId === platformId ? { ...o, qc } : o));
  projects.update(projectId, { outputs });
  return qc;
}
app.post('/api/qc/:projectId/:platformId', async (req, res) => {
  try {
    const qc = await queueQc(req.params.projectId, req.params.platformId);
    if (!qc) return fail(res, '找不到可质检的产出', 404);
    ok(res, qc);
  } catch (e) { fail(res, e); }
});

// 生成单个输出（前端为每个输出并行调用，卡片独立刷新）
// body.mode='prompt' → 图片只出提示词（两步创作 stage 1）；默认 full
// body.idea → 可选，一次性顶替 project.idea（一键派生用，如"拿公众号成品文正文改写小红书"）
app.post('/api/projects/:id/generate/:platformId', async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return fail(res, '项目不存在', 404);
  try {
    const { mode, idea, qcFix } = req.body || {};
    // qcFix：按质检问题清单重写——一次性把问题拼进想法，重写后自动复检
    const override = qcFix
      ? `${idea || project.idea}\n\n【上一版质检发现的问题，这次必须逐条修复】\n${String(qcFix).slice(0, 1500)}`
      : (idea || null);
    ok(res, await generateForProject(project, req.params.platformId, mode || 'full', override));
  } catch (e) {
    fail(res, e);
  }
});

// stage 2：用（可编辑的）提示词 + 选定风格渲染实际图片
app.post('/api/projects/:id/render/:platformId', async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return fail(res, '项目不存在', 404);
  const platform = getPlatform(req.params.platformId);
  if (!platform || platform.kind !== 'image') return fail(res, '不是图片类型', 400);
  const brand = project.brandId && project.brandId !== 'none' ? brands.get(project.brandId) : null;
  const { prompt, vstyleId } = req.body || {};
  const vstyle = vstyleId ? styles.get(vstyleId) : (project.options?.vstyleId ? styles.get(project.options.vstyleId) : null);
  const savedPrompt = prompt || (project.outputs || []).find((o) => o.platformId === platform.id)?.imagePrompt || '';
  if (!savedPrompt) return fail(res, '没有可用的图片提示词', 400);
  const fileBase = `${project.id}-${platform.id}-${Date.now().toString(36)}`;
  try {
    const rendered = await renderImageFromPrompt({ platformId: platform.id, prompt: savedPrompt, brand, options: project.options || {}, vstyle, fileBase });
    const out = { platformId: platform.id, status: 'done', ...rendered, at: new Date().toISOString() };
    saveOutput(project.id, platform.id, out);
    ok(res, out);
  } catch (e) {
    fail(res, e);
  }
});

// 内联编辑：直接保存改过的文案
app.put('/api/projects/:id/output/:platformId', (req, res) => {
  const p = projects.get(req.params.id);
  if (!p) return fail(res, '项目不存在', 404);
  const { content } = req.body || {};
  if (typeof content !== 'string') return fail(res, '内容不合法', 400);
  const outputs = (p.outputs || []).map((o) =>
    o.platformId === req.params.platformId ? { ...o, content, edited: true } : o
  );
  projects.update(p.id, { outputs });
  ok(res, { saved: true });
});

// upsert：platformId 已在 outputs 里就地更新；不在（比如一键派生出的新形态）就追加一条。
function saveOutput(projectId, platformId, out) {
  const p = projects.get(projectId);
  if (!p) return;
  const list = p.outputs || [];
  const exists = list.some((o) => o.platformId === platformId);
  const outputs = exists ? list.map((o) => (o.platformId === platformId ? out : o)) : [...list, out];
  projects.update(projectId, { outputs });
  // 草稿保险：每次生成结果（含把旧版顶掉的重新生成）都追加进草稿箱，永不静默丢失
  if (out && out.status !== 'error' && (out.content || out.imageUrl || out.title)) {
    try {
      drafts.create({
        projectId, platformId, kind: out.kind || '', brandId: p.brandId || null,
        idea: String(p.idea || '').slice(0, 200), title: out.title || '',
        content: typeof out.content === 'string' ? out.content : '',
        imageUrl: out.imageUrl || '', status: out.status,
      });
    } catch { /* 草稿失败不阻断主流程 */ }
  }
}

// ---- 公众号向导：从灵感素材出 3 个候选标题 + 摘要（轻调用，全文生成走 gongzhonghao_pub 管线）----
app.post('/api/wechat/titles', async (req, res) => {
  const { material, brandId, styleId } = req.body || {};
  if (!material || !String(material).trim()) return fail(res, '素材不能为空', 400);
  const brand = brandId && brandId !== 'none' ? brands.get(brandId) : null;
  const style = styleId ? styles.get(styleId) : null;
  try {
    const raw = await chat({
      model: modelPref('text', DEFAULT_MODEL),
      system: '你是公众号主编，给一篇待写文章起标题。只输出 JSON，别的什么都不说。',
      purpose: 'wechat-titles',
      user: `${brand ? `账号：${brand.name}（${brand.tagline || brand.positioning || ''}；人设：${brand.persona || ''}）\n` : ''}${style ? `写作风格：${style.name}（${String(style.tone || '').slice(0, 80)}）\n` : ''}素材：
${String(material).slice(0, 1600)}

出 3 个候选标题，三种路数各一个：①直给价值 ②悬念/反差 ③具体数字或事实钩子。每个 ≤28 字、贴账号口吻、不标题党不喊叫。再给一句 ≤50 字的摘要 digest（公众号卡片摘要）。
严格输出：{"titles":["…","…","…"],"digest":"…"}`,
      maxTokens: 600,
    });
    const parsed = extractJson(raw);
    const titles = (Array.isArray(parsed.titles) ? parsed.titles : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 3);
    if (!titles.length) return fail(res, '标题生成失败，重试一次', 500);
    ok(res, { titles, digest: String(parsed.digest || '').trim() });
  } catch (e) {
    fail(res, e);
  }
});

// ---- 公众号成品文：预览/导出 HTML + 补出配图 ----
// HTML 不落库，每次现算（存的只有 markdown + title + digest + images，避免大字符串塞进 projects.json）
app.get('/api/article/:projectId/html', (req, res) => {
  const project = projects.get(req.params.projectId);
  if (!project) return fail(res, '项目不存在', 404);
  const platformId = req.query.platformId || 'gongzhonghao_pub';
  const out = (project.outputs || []).find((o) => o.platformId === platformId);
  if (!out || out.status !== 'done') return fail(res, '这篇成品文还没生成完成', 400);
  const brand = project.brandId && project.brandId !== 'none' ? brands.get(project.brandId) : null;
  try {
    const html = renderWechatHtml(out.content || '', { brand, title: out.title, digest: out.digest });
    res.type('html').send(html);
  } catch (e) {
    fail(res, e);
  }
});

// 两步创作第二步：给已生成正文里剩下的 [[配图: ...]] 占位符补图（增量、可重复点）
app.post('/api/article/:projectId/images', async (req, res) => {
  const project = projects.get(req.params.projectId);
  if (!project) return fail(res, '项目不存在', 404);
  const platformId = (req.body && req.body.platformId) || 'gongzhonghao_pub';
  const out = (project.outputs || []).find((o) => o.platformId === platformId);
  if (!out || out.status !== 'done') return fail(res, '先把正文生成出来', 400);
  const brand = project.brandId && project.brandId !== 'none' ? brands.get(project.brandId) : null;
  const vstyleId = project.options?.vstyleId;
  const vstyle = vstyleId ? styles.get(vstyleId) : null;
  const fileBase = `${project.id}-${platformId}-img-${Date.now().toString(36)}`;
  try {
    const filled = await generateArticleImages({
      markdown: out.content || '',
      idea: project.idea,
      brand,
      options: project.options || {},
      vstyle,
      // 没显式选视觉风格时，公众号封面/信息图各走 Hunter 蒸馏配方
      vstyleCover: vstyle || hunterWxCover(),
      vstyleBody: vstyle || hunterWxIllus(),
      fileBase,
      hasCover: (out.images || []).some((img) => img.role === 'cover' && img.url),
    });
    const updated = { ...out, content: filled.markdown, images: [...(out.images || []), ...filled.images], at: new Date().toISOString() };
    saveOutput(project.id, platformId, updated);
    ok(res, updated);
  } catch (e) {
    fail(res, e);
  }
});

// ---- 内容日历 ----
app.get('/api/calendar', (req, res) => ok(res, calendar.all()));
app.post('/api/calendar', (req, res) => {
  const { date, time, brandId, idea, outputs = [] } = req.body || {};
  // 灵感采集排期：系统自己跑，不要品牌/想法/形态
  if (req.body?.kind === 'radar') {
    const at = String(time || '').match(/^\d{2}:\d{2}$/) ? time : '09:00';
    const day = date || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const dup = calendar.all().find((e) => e.kind === 'radar' && e.date === day && e.time === at);
    if (dup) return fail(res, `${day} ${at} 已经有一条灵感采集了`, 400);
    return ok(res, calendar.create({
      kind: 'radar', date: day, time: at, idea: '灵感雷达自动采集', brandId: 'none', brandName: '系统',
      outputs: [], auto: true, status: 'auto',
    }));
  }
  if (!idea || !idea.trim()) return fail(res, '想法不能为空', 400);
  if (!outputs.length) return fail(res, '至少选一种形态', 400);
  const brand = brandId && brandId !== 'none' ? brands.get(brandId) : null;
  ok(res, calendar.create({
    date: date || new Date().toISOString().slice(0, 10),
    time: time || '09:00',
    brandId: brandId || 'none',
    brandName: brand?.name || '无品牌',
    idea: idea.trim(),
    outputs: outputs.filter((id) => getPlatform(id)),
    status: 'scheduled',
    auto: req.body.auto !== false,
    projectId: null,
  }));
});
app.put('/api/calendar/:id', (req, res) => {
  const r = calendar.update(req.params.id, req.body || {});
  return r ? ok(res, r) : fail(res, '日程不存在', 404);
});
app.delete('/api/calendar/:id', (req, res) => ok(res, { removed: calendar.remove(req.params.id) }));

// 跑一条日程：建项目 + 生成全部形态
async function runCalendarEntry(entry) {
  calendar.update(entry.id, { status: 'running' });
  const brand = entry.brandId && entry.brandId !== 'none' ? brands.get(entry.brandId) : null;
  const project = projects.create({
    title: entry.idea.slice(0, 24),
    idea: entry.idea,
    brandId: entry.brandId || null,
    brandName: brand?.name || null,
    options: { length: '中', model: DEFAULT_MODEL },
    fromCalendar: entry.id,
    outputs: entry.outputs.map((id) => ({ platformId: id, status: 'pending' })),
  });
  let okCount = 0;
  const errors = [];
  for (const pid of entry.outputs) {
    try { await generateForProject(project, pid); okCount++; }
    catch (e) { errors.push(`${getPlatform(pid)?.label || pid}：${String(e.message || e).slice(0, 120)}`); }
  }
  calendar.update(entry.id, {
    status: okCount === entry.outputs.length ? 'done' : okCount ? 'partial' : 'error',
    projectId: project.id,
    ranAt: new Date().toISOString(),
    // 运行记录：失败原因写回排期，日历页直接可见，不用去翻项目
    errorMsg: errors.length ? errors.join('；') : '',
  });
  return project.id;
}

// 手动跑一条
app.post('/api/calendar/:id/run', async (req, res) => {
  const entry = calendar.get(req.params.id);
  if (!entry) return fail(res, '日程不存在', 404);
  if (entry.kind === 'radar') return fail(res, '采集记录不是内容排期，去灵感页看结果', 400);
  try {
    ok(res, { projectId: await runCalendarEntry(entry) });
  } catch (e) {
    fail(res, e);
  }
});

// 一键跑全部待生成
app.post('/api/calendar/run-all', async (req, res) => {
  const pending = calendar.all().filter((e) => e.status === 'scheduled');
  const done = [];
  for (const e of pending) {
    try { done.push(await runCalendarEntry(e)); } catch {}
  }
  ok(res, { ran: done.length });
});

// ---- 账号（最小版：手动登记 / 导入，浏览器自动抓取列为下一步）----
app.get('/api/accounts', (req, res) => ok(res, accounts.all()));
app.post('/api/accounts', (req, res) => ok(res, accounts.create(req.body || {})));
app.put('/api/accounts/:id', (req, res) => {
  const r = accounts.update(req.params.id, req.body || {});
  return r ? ok(res, r) : fail(res, '账号不存在', 404);
});
app.delete('/api/accounts/:id', (req, res) => ok(res, { removed: accounts.remove(req.params.id) }));

// ⚠️ 平台通用规则是机密：不开任何对外 API、不进前端。只在服务端 generate.js 内部注入生成。
//    规则本体在 lib/platform-rules.js + data/platform-rules.json（本机文件，勿暴露）。要改直接改文件。

// 账号后台（系统自库；不再实时拉钉钉。历史钉钉数据经 /import 一次性搬入，
// 之后由发布连接器自动回流更新——回流没上线前可在页面手动编辑）
// 发布凭证（YouTube token / VMOS 设备号 / 公众号 secret…）：存服务端数据目录，
// 接口永不回明文——只回「已配了哪些字段 + 尾 4 位」，编辑时留空 = 不改，填「-」= 清除。
function cleanCreds(input, current = {}) {
  const next = { ...current };
  for (const [k, v] of Object.entries(input || {})) {
    const val = String(v ?? '').trim();
    if (!val) continue;            // 留空不改
    if (val === '-') delete next[k]; // 显式清除
    else next[k] = val;
  }
  return next;
}
function maskRow(r) {
  const { creds, ...rest } = r;
  const credsMask = Object.fromEntries(Object.entries(creds || {})
    .map(([k, v]) => [k, `••••${String(v).slice(-4)}`]));
  return { ...rest, credsMask, credsCount: Object.keys(credsMask).length };
}
// 账号卡上的 belong/owner 是自由填的文字（「Hunter」「477」「个人」），
// 品牌页却按 brandId 认亲——名字对得上就认，否则品牌卡永远显示「还没有账号」。
function resolveBrandId(row) {
  if (row.brandId && brands.get(row.brandId)) return row.brandId;
  const tags = [row.belong, row.owner].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  const acctName = String(row.name || '').trim().toLowerCase();
  const hit = brands.all().find((b) => {
    const name = String(b.name || '').toLowerCase();
    // 「Hunter · Agent101」既要能被「Hunter」认领，也要能被「Agent101」认领
    const parts = name.split(/[·・/|,，、]+/).map((s) => s.trim()).filter(Boolean);
    if (tags.some((t) => t === name || parts.includes(t))) return true;
    // 账号名里带着品牌名也算（「Agent101 (B站)」→ Hunter · Agent101）。
    // 只认 ≥3 字的名字片段，免得「AI」这种短词乱认亲。
    return acctName && parts.some((p) => p.length >= 3 && acctName.includes(p));
  });
  return hit?.id || null;
}
app.get('/api/accounts/board', (req, res) => {
  // 列表瘦身：看板全量数据（趋势/内容明细）不进列表，只给 hasDashboard 标记；详情走 /:id
  const rows = acctStats.all().map((r) => {
    const { dashboard, ...rest } = maskRow(r);
    const brandId = resolveBrandId(r);
    return {
      ...rest, brandId, brandName: brandId ? brands.get(brandId)?.name || null : null,
      brandLinkedBy: r.brandId && brands.get(r.brandId) ? 'explicit' : (brandId ? 'name' : null),
      hasDashboard: !!dashboard, dashAsOf: dashboard?.asOf || null,
    };
  });
  const asOf = rows.map((r) => r.asOf).filter(Boolean).sort().pop() || null;
  ok(res, { rows, cachedAt: asOf, cached: false });
});
app.get('/api/accounts/board/:id', (req, res) => {
  const r = acctStats.get(req.params.id);
  if (!r) return fail(res, '账号不存在', 404);
  const brandId = resolveBrandId(r);
  return ok(res, {
    ...maskRow(r), brandId, brandName: brandId ? brands.get(brandId)?.name || null : null,
    brandLinkedBy: r.brandId && brands.get(r.brandId) ? 'explicit' : (brandId ? 'name' : null),
  });
});
app.post('/api/accounts/board', (req, res) => {
  const { creds, ...body } = req.body || {};
  ok(res, maskRow(acctStats.create({ ...body, creds: cleanCreds(creds) })));
});
app.put('/api/accounts/board/:id', (req, res) => {
  const cur = acctStats.get(req.params.id);
  if (!cur) return fail(res, '账号不存在', 404);
  const { creds, ...body } = req.body || {};
  const r = acctStats.update(req.params.id, { ...body, creds: cleanCreds(creds, cur.creds || {}) });
  return ok(res, maskRow(r));
});
app.delete('/api/accounts/board/:id', (req, res) => ok(res, { removed: acctStats.remove(req.params.id) }));
// 账号数据看板：平台导出数据整体挂载（fansTrend/contents/summary/extras），并把汇总数字同步进账号行
app.put('/api/accounts/board/:id/dashboard', (req, res) => {
  const cur = acctStats.get(req.params.id);
  if (!cur) return fail(res, '账号不存在', 404);
  const d = req.body?.dashboard;
  if (!d || typeof d !== 'object') return fail(res, 'dashboard 不能为空', 400);
  const s = d.summary || {};
  const num = (v) => (v == null || v === '' ? null : Number(v));
  const patch = { dashboard: { ...d, importedAt: new Date().toISOString() } };
  // 汇总数字回写账号行：卡片上的粉丝/净增/播放等与看板保持一口径
  if (s.fans != null) patch.fans = num(s.fans);
  if (s.fansDelta30 != null) patch.net30 = num(s.fansDelta30);
  if (s.views30 != null) patch.views30 = num(s.views30);
  if (s.likes30 != null) patch.likes30 = num(s.likes30);
  if (s.comments30 != null) patch.comments30 = num(s.comments30);
  if (s.posts30 != null) patch.posts30 = num(s.posts30);
  if (d.asOf) patch.asOf = String(d.asOf);
  return ok(res, maskRow(acctStats.update(req.params.id, patch)));
});
// 一次性/增量导入（如旧钉钉多维表导出）：按 dtId 或 名称+平台 幂等去重
app.post('/api/accounts/board/import', (req, res) => {
  const rows = Array.isArray((req.body || {}).rows) ? req.body.rows : [];
  let imported = 0;
  for (const raw of rows) {
    if (!raw || !raw.name) continue;
    const doc = { ...raw };
    const dtId = doc.id || doc.dtId || null;
    delete doc.id;
    doc.dtId = dtId;
    const prev = acctStats.all().find((x) => (dtId && x.dtId === dtId) || (x.name === doc.name && x.platform === doc.platform));
    if (prev) acctStats.update(prev.id, doc); else acctStats.create(doc);
    imported += 1;
  }
  ok(res, { imported, total: acctStats.all().length });
});

// ═══ 品牌指挥部 3.0：重型生产线 jobs ═══
app.get('/api/jobs', (req, res) => {
  let list = jobs.all();
  if (req.query.brandId) list = list.filter((j) => j.brandId === req.query.brandId);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  ok(res, list.slice(0, 100));
});
app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  return j ? ok(res, j) : fail(res, 'job 不存在', 404);
});
app.post('/api/jobs', (req, res) => {
  try { ok(res, createJob(req.body || {})); } catch (e) { fail(res, e, 400); }
});
app.post('/api/jobs/:id/retry', (req, res) => {
  try { ok(res, retryJob(req.params.id)); } catch (e) { fail(res, e, 400); }
});
app.post('/api/jobs/:id/hold', (req, res) => {
  try { ok(res, holdJob(req.params.id, (req.body || {}).reason)); } catch (e) { fail(res, e, 400); }
});
app.post('/api/jobs/:id/resume', (req, res) => {
  try { ok(res, resumeJob(req.params.id)); } catch (e) { fail(res, e, 400); }
});
// 重新收片：对超时/中断但成品已在盘上的 job 重扫产物，捞到视频就标 done（不重跑、不烧钱）
app.post('/api/jobs/:id/reharvest', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return fail(res, 'job 不存在', 404);
  const products = harvest(j.outDir);
  const doneAt = new Date().toISOString();
  const cost = calculateAndWriteVideoCost({ ...j, doneAt });
  if (products.some((p) => p.type === 'video')) {
    const error = deliveryError(j, products);
    if (error) {
      ok(res, jobs.update(j.id, { status: 'failed', products, cost, error, doneAt }));
    } else {
      ok(res, jobs.update(j.id, { status: 'done', products, cost, error: null, doneAt }));
    }
  } else {
    ok(res, jobs.update(j.id, { products, cost }));
  }
});
app.post('/api/jobs/:id/recalculate-cost', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return fail(res, 'job 不存在', 404);
  const cost = calculateAndWriteVideoCost(j);
  if (!cost) return fail(res, '未找到可回填的 Claude Token 日志', 404);
  ok(res, jobs.update(j.id, { cost }));
});
app.get('/api/cost-settings', (req, res) => ok(res, loadCostSettings()));
app.delete('/api/jobs/:id', (req, res) => ok(res, { removed: jobs.remove(req.params.id) }));

// 一键品牌包：轻活建 project（沿用现有生成），重活开 jobs。assignTo=指派给某台产能机（按令牌名）
app.post('/api/pack/run', async (req, res) => {
  const { brandId, idea, channelIds = [], assignTo = '' } = req.body || {};
  const brand = brands.get(brandId);
  if (!brand) return fail(res, '品牌不存在', 400);
  if (!idea?.trim()) return fail(res, '想法不能为空', 400);
  const chans = (brand.channels || []).filter((c) => channelIds.includes(c.id));
  if (!chans.length) return fail(res, '没选中任何渠道', 400);
  const heavy = chans.filter((c) => c.engine === 'claude');
  const light = chans.filter((c) => c.engine === 'flatkey');
  const out = { jobs: [], projectId: null, rn: [] };
  for (const c of heavy) {
    const job = createJob({ brandId, channelId: c.id, idea });
    if (assignTo) jobs.update(job.id, { assignedTo: String(assignTo).slice(0, 60) });
    out.jobs.push(jobs.get(job.id));
  }
  const platformLight = light.filter((c) => c.platform && getPlatform(c.platform));
  const rnLight = light.filter((c) => c.platform === 'rn_xhs');
  if (platformLight.length) {
    const project = projects.create({
      title: idea.trim().slice(0, 24), idea: idea.trim(), brandId, brandName: brand.name,
      options: {}, outputs: platformLight.map((c) => ({ platformId: c.platform, status: 'pending' })),
    });
    out.projectId = project.id;
    // 异步逐个生成，不阻塞响应
    (async () => {
      for (const c of platformLight) { try { await generateForProject(project, c.platform); } catch {} }
    })();
  }
  out.rn = rnLight.map((c) => c.id); // rednote 成套渠道由前端调 /api/rn/xhs 流程（引擎挂载后可用）
  ok(res, out);
});

// 统一作品库：projects（轻）+ jobs（重）合并视图
const worksMeta = () => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'works-meta.json'), 'utf8')); } catch { return {}; }
};
const saveWorksMeta = (m) => fs.writeFileSync(path.join(DATA_DIR, 'works-meta.json'), JSON.stringify(m, null, 2));
// 存量视频没存时长：首次读到时探测一次并记住（进程内缓存，ffprobe 不重复跑）
const DUR_CACHE = new Map();
function durationOf(item) {
  if (item.seconds != null) return item.seconds;
  if (item.type !== 'video' || !item.url) return null;
  if (DUR_CACHE.has(item.url)) return DUR_CACHE.get(item.url);
  const local = urlToLocal(item.url);
  const secs = local && fs.existsSync(local) ? probeSeconds(local) : null;
  DUR_CACHE.set(item.url, secs);
  return secs;
}
const withDuration = (items) => (items || []).map((it) => (it.type === 'video' ? { ...it, seconds: durationOf(it) } : it));

function buildWorks() {
  const meta = worksMeta();
  const works = [];
  for (const j of jobs.all()) {
    if (j.status !== 'done') continue;
    works.push({ id: j.id, kind: 'job', brandId: j.brandId, brandName: j.brandName,
      title: `${j.channelLabel} · ${String(j.idea || '').replace(/https?:\/\/\S+/g, '').replace(/^[（(\s]+/, '').slice(0, 20) || j.channelLabel}`, at: j.doneAt || j.createdAt,
      status: 'done', published: !!meta[j.id]?.published, passed: !!meta[j.id]?.passed,
      passedAt: meta[j.id]?.passedAt || null, cost: j.cost || null, items: withDuration(j.products) });
  }
  for (const pj of projects.all()) {
    const items = [];
    // 公众号的「完整交付」= 排版好的成品文 + 配图。缺一样就不该当成能发的东西。
    const gaps = [];
    for (const o of pj.outputs || []) {
      if (o.status !== 'done' && o.status !== 'edited') continue;
      const pf = getPlatform(o.platformId);
      if (o.platformId === 'gongzhonghao') {
        gaps.push({ platformId: o.platformId, label: '公众号', need: 'layout',
          text: '这是纯文字稿，还没排版也没配图——要出「公众号成品文」才算能发' });
      } else if (pf?.kind === 'article_layout' && !(o.images || []).length) {
        gaps.push({ platformId: o.platformId, label: pf.label || '公众号成品文', need: 'images',
          text: '正文排好了，但一张配图都没有——配图补上才算交付完' });
      }
      if (o.imageUrl) items.push({ type: 'image', url: o.imageUrl, label: pf?.label || o.platformId });
      else if (o.content) items.push({ type: 'text', url: '', label: pf?.label || o.platformId, content: String(o.content) });
      // 成品文里的配图也进作品，验收时看得见图
      for (const img of (o.images || [])) {
        if (img?.url) items.push({ type: 'image', url: img.url, label: `${pf?.label || '配图'}${img.role === 'cover' ? ' · 封面' : ''}` });
      }
    }
    if (!items.length) continue;
    works.push({ id: pj.id, kind: 'project', brandId: pj.brandId, brandName: pj.brandName || '',
      title: pj.title || pj.idea?.slice(0, 20) || '', at: pj.createdAt,
      status: 'done', published: !!meta[pj.id]?.published, passed: !!meta[pj.id]?.passed,
      passedAt: meta[pj.id]?.passedAt || null, items, gaps });
  }
  works.sort((a, b) => new Date(b.at) - new Date(a.at));
  return works;
}

function taskTopicSeed(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/(?:原始来源|本地抓取稿|来源)[:：]?/g, ' ')
    .replace(/\/Users\/\S+/g, ' ')
    .replace(/[（）()[\]{}<>*_`#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function taskKeywordFromJob(job) {
  for (const product of job.products || []) {
    if (product.type !== 'text' || !product.content) continue;
    const text = String(product.content);
    const match = /(?:^|\n)(?:标题|Title)[:：]\s*(.+)/i.exec(text)
      || /(?:^|\n)##\s*Title\s*\n+(.+)/i.exec(text);
    if (match?.[1]) return match[1].trim().slice(0, 28);
  }
  return taskTopicSeed(job.idea).slice(0, 28) || job.channelLabel || '内容任务';
}

function taskDateLabel(value) {
  const date = new Date(value || Date.now());
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function taskLabel({ at, brandName, keyword }) {
  return `${taskDateLabel(at)} · ${brandName || '无品牌'} · 1toAll · ${keyword || '内容任务'}`;
}

function buildContentTasks() {
  const works = buildWorks();
  const workById = Object.fromEntries(works.map((work) => [work.id, work]));
  const tasks = [];

  // 项目一律进看板——不能只收「已出成品」的：正在生成、排队、失败的活也必须看得见，
  // 否则派完活到出片这段时间任务中心是空的，失败的更是永远不出现。
  const projectStatus = (outs) => {
    if (!outs.length) return 'queued';
    if (outs.some((o) => o.status === 'running')) return 'running';
    if (outs.some((o) => o.status === 'pending')) return 'queued';
    if (outs.every((o) => o.status === 'error')) return 'failed';
    return 'done';
  };
  const PROJ_STATUS_LABEL = { running: '生成中', queued: '排队中', failed: '生成失败', done: '已完成' };
  for (const project of projects.all()) {
    const work = workById[project.id];
    const outs = project.outputs || [];
    const status = work ? 'done' : projectStatus(outs);
    const keyword = taskTopicSeed(project.title || project.idea).slice(0, 28) || '内容任务';
    const at = project.createdAt;
    tasks.push({
      id: `project:${project.id}`,
      kind: 'project',
      projectId: project.id,
      jobIds: [],
      brandId: project.brandId || 'none',
      brandName: project.brandName || '无品牌',
      keyword,
      label: taskLabel({ at, brandName: project.brandName || '无品牌', keyword }),
      at,
      idea: project.idea || '',
      status,
      statusLabel: PROJ_STATUS_LABEL[status] || status,
      waitReason: status === 'failed' ? (outs.find((o) => o.error)?.error || '') : '',
      works: work ? [work] : [],
    });
  }

  const jobGroups = new Map();
  for (const job of jobs.all()) {
    const day = String(job.doneAt || job.createdAt || '').slice(0, 10);
    const topicSeed = taskTopicSeed(job.idea).slice(0, 140);
    const digest = createHash('sha1').update(`${job.brandId || 'none'}|${day}|${topicSeed}`).digest('hex').slice(0, 10);
    const runId = job.cost?.productionRunId || job.cost?.sharedUsage?.productionRunId;
    const key = runId ? `run:${runId}` : `jobs:${digest}`;
    if (!jobGroups.has(key)) jobGroups.set(key, []);
    jobGroups.get(key).push(job);
  }

  for (const [id, group] of jobGroups) {
    const ordered = [...group].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const first = ordered[0];
    const keyword = taskKeywordFromJob(first);
    const at = first.createdAt;
    const taskWorks = ordered.map((job) => workById[job.id]).filter(Boolean);
    const statusOrder = ['running', 'claimed', 'paused', 'queued', 'waiting_external', 'failed', 'canceled', 'done'];
    const status = statusOrder.find((candidate) => ordered.some((job) => job.status === candidate)) || 'done';
    const statusLabels = { running: '生产中', claimed: '产能机生产中', paused: '已暂停', queued: '排队中', waiting_external: '等待确认', failed: '失败', canceled: '已取消', done: '已完成' };
    tasks.push({
      id,
      kind: 'video_run',
      projectId: null,
      jobIds: ordered.map((job) => job.id),
      brandId: first.brandId || 'none',
      brandName: first.brandName || '无品牌',
      keyword,
      label: taskLabel({ at, brandName: first.brandName || '无品牌', keyword }),
      at,
      idea: first.idea || '',
      status,
      statusLabel: statusLabels[status] || status,
      waitReason: ordered.find((job) => job.status === 'waiting_external')?.error || '',
      works: taskWorks,
    });
  }

  return tasks
    .map((task) => ({
      ...task,
      workCount: task.works.length,
      contentCount: task.works.reduce((sum, work) => sum + (work.items || []).length, 0),
      works: task.works.map((work) => ({
        ...work,
        taskId: task.id,
        taskLabel: task.label,
        taskKeyword: task.keyword,
      })),
    }))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

const findWork = (id) => buildWorks().find((w) => w.id === id) || null;
// /media|/output|/assets URL → 本地文件绝对路径
function urlToLocal(url) {
  const dec = decodeURIComponent(String(url || ''));
  if (dec.startsWith('/media/')) return path.join(MEDIA_ROOT, dec.slice(7));
  if (dec.startsWith('/output/')) return path.join(OUTPUT_DIR, dec.slice(8));
  if (dec.startsWith('/assets/')) return path.join(ASSETS_DIR, dec.slice(8));
  return null;
}
// 作品对应的本地文件夹（用于「打开访达」）
function workFolder(id) {
  const j = jobs.get(id);
  if (j?.outDir) return j.outDir;
  const w = findWork(id);
  for (const it of w?.items || []) {
    const lp = it.url ? urlToLocal(it.url) : null;
    if (lp && fs.existsSync(lp)) return path.dirname(lp);
  }
  return null;
}

app.get('/api/tasks', (req, res) => ok(res, buildContentTasks()));

// 任务中心：把「生产 → 收录 → 发布 → 数据」串成生命周期节点 + 卡住的节点出提醒
function buildTaskBoard() {
  const tasks = buildContentTasks();
  const poolAll = pool.all();
  const DAY = 86400000;
  const notesAll = taskNotes();
  const out = tasks.map((t) => {
    const skipped = notesAll[t.id]?.skipped || {};
    const notes = notesAll[t.id]?.notes || [];
    const activeWorks = (t.works || []).filter((work) => !work.passed);
    const passedWorks = (t.works || []).filter((work) => work.passed);
    const allPassed = (t.works || []).length > 0 && activeWorks.length === 0;
    const workIds = new Set([...activeWorks.map((w) => w.id), ...(t.jobIds || []).filter((id) => activeWorks.some((work) => work.id === id)), activeWorks.some((work) => work.id === t.projectId) ? t.projectId : null].filter(Boolean));
    const entries = poolAll.filter((e) => workIds.has(e.workId));
    const published = entries.filter((e) => e.status === 'published');
    const withData = published.filter((e) => e.stats && (e.stats.views != null || e.stats.likes != null));
    const produce = t.status || 'done'; // running/queued/waiting_external/failed/done
    const producedDone = produce === 'done';
    // 质检节点：轻内容项目按各产出的 qc 结论汇总；重型视频暂无质检链路，生产完自动放行
    let qcNode = 'wait';
    if (t.projectId) {
      const qcs = (projects.get(t.projectId)?.outputs || []).filter((o) => o.qc).map((o) => o.qc);
      if (qcs.length) qcNode = qcs.some((q) => q.verdict === 'fail') ? 'failed' : qcs.some((q) => q.verdict === 'warn') ? 'warn' : 'done';
      else qcNode = producedDone ? 'pending' : 'wait';
    } else {
      qcNode = producedDone ? 'done' : 'wait';
    }
    // 公众号缺配图/缺排版 = 还没做完，别让它安静地躺在「待收录」里等人发现
    const gap = activeWorks.flatMap((w) => w.gaps || [])[0] || null;
    const collect = allPassed ? 'passed' : (entries.length ? 'done' : (producedDone ? 'pending' : 'wait'));
    const publish = allPassed ? 'passed' : published.length
      ? (published.length >= entries.length ? 'done' : 'partial')
      : (entries.length ? 'pending' : 'wait');
    const data = allPassed ? 'passed' : (withData.length ? 'done' : (published.length ? 'pending' : 'wait'));
    const ageDays = Math.floor((Date.now() - new Date(t.at || Date.now())) / DAY);

    // 当前卡在哪个节点 → 一条提醒（就近最急的）；手动跳过的节点不再提醒
    let reminder = null;
    if (produce === 'failed' && !skipped.produce) reminder = { level: 'urgent', node: '生产', text: '生产失败，去重跑' };
    else if (produce === 'waiting_external') reminder = { level: 'todo', node: '生产', text: '等待外部资源确认' };
    else if (produce === 'paused') reminder = { level: 'todo', node: '生产', text: '暂停中，等你点继续或取消' };
    else if (produce === 'canceled') reminder = null; // 取消掉的不催
    else if (produce === 'running' || produce === 'claimed' || produce === 'queued') reminder = null; // 进行中不算待办
    else if (qcNode === 'failed' && !skipped.qc) reminder = { level: 'urgent', node: '质检', text: '质检不过关，看问题清单去修' };
    else if (gap && !skipped.collect) reminder = { level: 'todo', node: '生产', text: gap.need === 'images' ? '公众号还差配图，补上才算交付完' : '公众号还是纯文字稿，要出成品文（排版+配图）' };
    else if (collect === 'pending' && qcNode !== 'pending' && !skipped.collect) reminder = { level: 'todo', node: '收录', text: '已生产，待收录到账号' };
    else if ((publish === 'pending' || publish === 'partial') && !skipped.publish) reminder = { level: ageDays >= 2 ? 'urgent' : 'todo', node: '发布', text: publish === 'partial' ? '部分已发，还有没发的' : `已收录${ageDays >= 2 ? `${ageDays}天` : ''}，待发布` };
    else if (data === 'pending' && !skipped.data) reminder = { level: 'info', node: '数据', text: '已发布，待回填数据' };

    // 跳过的节点在看板上显示成 passed（P），不再当待办
    const nodes = { produce, qc: qcNode, collect, publish, data };
    for (const k of Object.keys(skipped)) if (nodes[k] != null) nodes[k] = 'passed';

    return {
      id: t.id, keyword: t.keyword, label: t.label, brandName: t.brandName, brandId: t.brandId, at: t.at,
      projectId: t.projectId, jobIds: t.jobIds || [],
      nodes,
      counts: { entries: entries.length, published: published.length, withData: withData.length, passed: passedWorks.length },
      ageDays, reminder, notes: notes.slice(-3), skipped: Object.keys(skipped),
    };
  });
  const levelRank = { urgent: 0, todo: 1, info: 2 };
  const reminders = out.filter((t) => t.reminder)
    .map((t) => ({ taskId: t.id, keyword: t.keyword, brandName: t.brandName, ...t.reminder }))
    .sort((a, b) => levelRank[a.level] - levelRank[b.level]);
  return { tasks: out, reminders, attention: reminders.filter((r) => r.level !== 'info').length };
}
app.get('/api/tasks/board', (req, res) => ok(res, buildTaskBoard()));
// 任务节点：记一句说明 / 跳过某个环节（跳过后不再提醒，链路继续往下）
const taskNotes = () => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'task-nodes.json'), 'utf8')); } catch { return {}; }
};
const saveTaskNotes = (m) => fs.writeFileSync(path.join(DATA_DIR, 'task-nodes.json'), JSON.stringify(m, null, 2));
const NODE_KEYS = ['produce', 'qc', 'collect', 'publish', 'data'];
app.post('/api/tasks/:id/note', (req, res) => {
  const { node, note } = req.body || {};
  if (!NODE_KEYS.includes(node)) return fail(res, '未知节点', 400);
  if (!note || !String(note).trim()) return fail(res, '说明不能为空', 400);
  const all = taskNotes();
  const t = (all[req.params.id] = all[req.params.id] || {});
  (t.notes = t.notes || []).push({ node, note: String(note).slice(0, 800), at: new Date().toISOString() });
  saveTaskNotes(all);
  ok(res, { saved: true, count: t.notes.length });
});
app.post('/api/tasks/:id/skip', (req, res) => {
  const { node, note } = req.body || {};
  if (!NODE_KEYS.includes(node)) return fail(res, '未知节点', 400);
  const all = taskNotes();
  const t = (all[req.params.id] = all[req.params.id] || {});
  (t.skipped = t.skipped || {})[node] = { at: new Date().toISOString(), note: String(note || '').slice(0, 400) };
  if (note) (t.notes = t.notes || []).push({ node, note: `[跳过] ${String(note).slice(0, 700)}`, at: new Date().toISOString() });
  saveTaskNotes(all);
  ok(res, { skipped: node });
});
app.get('/api/tasks/:id', (req, res) => {
  const task = buildContentTasks().find((item) => item.id === req.params.id);
  return task ? ok(res, task) : fail(res, '任务不存在', 404);
});
app.get('/api/works', (req, res) => ok(res, buildContentTasks().flatMap((task) => task.works)));
app.get('/api/ledger', (req, res) => {
  const ledger = buildContentLedger({
    jobList: jobs.all(),
    projectList: projects.all(),
    worksMeta: worksMeta(),
  });
  const taskByWorkId = new Map(buildContentTasks().flatMap((task) => task.works.map((work) => [work.id, task])));
  ledger.entries = ledger.entries.map((entry) => {
    const task = taskByWorkId.get(entry.workId);
    return task ? { ...entry, taskId: task.id, taskLabel: task.label, taskKeyword: task.keyword } : entry;
  });
  // 今日工作量：中央用量日志按天聚合（含 news/灵感/派单等平台开销）+ 今日产出与自动运行
  try {
    const today = beijingDay();
    const rows = readUsageDay(today);
    const byPurpose = new Map();
    let tokens = 0; let images = 0; let chars = 0; let cny = 0; let pricedAny = false;
    for (const r of rows) {
      const key = r.purpose || (r.kind === 'image' ? '出图' : r.kind === 'tts' ? '配音' : '其他生成');
      const cur = byPurpose.get(key) || { purpose: key, requests: 0, totalTokens: 0, images: 0, chars: 0, cny: 0 };
      cur.requests++;
      cur.totalTokens += Number(r.totalTokens || 0);
      cur.images += Number(r.images || 0);
      cur.chars += Number(r.chars || 0);
      const c = costCny(r.model || r.requestedModel, r);
      if (c != null) { cur.cny += c; cny += c; pricedAny = true; }
      byPurpose.set(key, cur);
      tokens += Number(r.totalTokens || 0); images += Number(r.images || 0); chars += Number(r.chars || 0);
    }
    const worksToday = buildWorks().filter((w) => w.at && beijingDay(new Date(w.at).getTime()) === today).length;
    const runsToday = calendar.all().filter((e) => e.ranAt && beijingDay(new Date(e.ranAt).getTime()) === today).length;
    ledger.today = {
      date: today, requests: rows.length, totalTokens: tokens, images, ttsChars: chars,
      apiEquivalentCny: pricedAny ? Math.round(cny * 100) / 100 : null,
      worksProduced: worksToday, autoRuns: runsToday,
      byPurpose: [...byPurpose.values()].sort((a, b) => b.requests - a.requests),
    };
  } catch { ledger.today = null; }
  ok(res, ledger);
});
app.post('/api/works/:id/published', (req, res) => {
  const meta = worksMeta();
  meta[req.params.id] = { ...(meta[req.params.id] || {}), published: !!(req.body || {}).published };
  saveWorksMeta(meta);
  ok(res, { id: req.params.id, published: !!(req.body || {}).published });
});

// Pass：作品不进入账号库，也不再产生发布/数据待办；可随时从作品 Pass箱恢复。
app.post('/api/works/:id/pass', (req, res) => {
  const work = findWork(req.params.id);
  if (!work) return fail(res, '作品不存在', 404);
  const passed = (req.body || {}).passed !== false;
  if (passed && pool.all().some((entry) => entry.workId === work.id)) {
    return fail(res, '作品已经收录到账号，请先从账号库移除后再 Pass', 400);
  }
  const meta = worksMeta();
  meta[work.id] = {
    ...(meta[work.id] || {}),
    passed,
    passedAt: passed ? new Date().toISOString() : null,
  };
  saveWorksMeta(meta);
  ok(res, { id: work.id, passed, passedAt: meta[work.id].passedAt });
});

// 发布通道 ①：打包成 zip 下载（视频 + 封面 + 文案）
app.get('/api/works/:id/bundle', (req, res) => {
  const work = findWork(req.params.id);
  if (!work) return fail(res, '作品不存在', 404);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  const used = new Set();
  const uniq = (name) => { let n = name, i = 1; while (used.has(n)) { const e = path.extname(name); n = name.slice(0, -e.length || undefined) + '_' + (i++) + e; } used.add(n); return n; };
  try {
    for (const it of work.items || []) {
      if (it.url) {
        const local = urlToLocal(it.url);
        if (!local || !fs.existsSync(local)) continue;
        const arc = uniq(path.basename(local));
        fs.copyFileSync(local, path.join(stage, arc));
      } else if (it.type === 'text' && it.content) {
        const base = (String(it.label || '文案').replace(/[\/\\]+/g, '_')) + (/\.md$/.test(it.label || '') ? '' : '.md');
        fs.writeFileSync(path.join(stage, uniq(base)), it.content);
      }
    }
    if (!used.size) { fs.rmSync(stage, { recursive: true, force: true }); return fail(res, '没有可打包的文件', 400); }
    const safe = (work.title || '作品').replace(/[^\w一-龥-]+/g, '_').slice(0, 40) || '作品';
    const zip = path.join(os.tmpdir(), `${safe}-${Date.now()}.zip`);
    execFileSync('zip', ['-q', '-r', '-j', zip, stage]);
    res.download(zip, `${safe}.zip`, () => {
      try { fs.rmSync(stage, { recursive: true, force: true }); fs.rmSync(zip, { force: true }); } catch {}
    });
  } catch (e) {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    fail(res, '打包失败：' + e.message);
  }
});

// 发布通道 ②：在访达打开该作品的本地文件夹，并返回路径（供复制）
app.post('/api/works/:id/reveal', (req, res) => {
  const folder = workFolder(req.params.id);
  if (!folder || !fs.existsSync(folder)) return fail(res, '找不到本地文件夹', 404);
  try { execFileSync('open', [folder]); } catch {}
  ok(res, { folder });
});
// 只取本地路径（复制用，不打开访达）
app.get('/api/works/:id/folder', (req, res) => {
  const folder = workFolder(req.params.id);
  if (!folder || !fs.existsSync(folder)) return fail(res, '找不到本地文件夹', 404);
  ok(res, { folder });
});
// 整理成交付包：人（运营人）→ 账号（品牌）→ 交付包 → {视频,图片,文案}
app.post('/api/works/:id/deliver', (req, res) => {
  const w = findWork(req.params.id);
  if (!w) return fail(res, '作品不存在', 404);
  try {
    const r = organizeDelivery(w, { owner: ownerOfBrand(w.brandName), brandName: w.brandName });
    ok(res, r);
  } catch (e) { fail(res, e); }
});

// ═══ 平台账号内容池：作品收录进某账号 → 在账号内容库发布 ═══
function splitSections(text) {
  const secs = []; let cur = null;
  for (const ln of String(text || '').split('\n')) {
    const m = /^#{1,2}\s+(.+?)\s*$/.exec(ln);
    if (m) { cur = { title: m[1].trim(), body: [] }; secs.push(cur); }
    else if (cur) { if (ln.trim() === '---') continue; cur.body.push(ln); }
  }
  return secs.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })).filter((s) => s.body);
}
function splitTopSections(text) {
  const secs = []; let cur = null;
  for (const ln of String(text || '').split('\n')) {
    const m = /^#(?!#)\s+(.+?)\s*$/.exec(ln);
    if (m) { cur = { title: m[1].trim(), body: [] }; secs.push(cur); }
    else if (cur) { if (ln.trim() === '---') continue; cur.body.push(ln); }
  }
  return secs.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })).filter((s) => s.body);
}
const PLAT_ALIAS = {
  抖音: ['抖音', 'douyin', 'dy'], 小红书: ['小红书', 'xhs', 'red', '小红薯'],
  视频号: ['视频号', 'shipinhao', '微信视频号'], YouTube: ['youtube', '油管', 'yt', 'youtobe'],
  公众号: ['公众号', 'gongzhonghao', '微信公众号'], X: ['x', '推特', 'twitter'], B站: ['b站', 'bilibili', '哔哩'],
};
function pickCopyForPlatform(work, platform) {
  const ti = (work.items || []).find((it) => it.type === 'text' && it.content);
  if (!ti) return '';
  const want = String(platform || '').toLowerCase();
  const al = PLAT_ALIAS[platform] || [want];
  const matches = (s) => {
    const t = s.title.toLowerCase();
    return t.includes(want) || al.some((a) => t.includes(String(a).toLowerCase()));
  };
  const topHit = splitTopSections(ti.content).find(matches);
  if (topHit) return topHit.body;
  const secs = splitSections(ti.content);
  if (!secs.length) return '';
  const hit = secs.find(matches);
  return hit ? hit.body : (secs.length === 1 ? secs[0].body : '');
}
function workMedia(work) {
  const v = (work.items || []).find((it) => it.type === 'video');
  const c = (work.items || []).find((it) => it.type === 'image');
  return { videoUrl: v?.url || '', coverUrl: c?.url || '' };
}
function ensureAccount(brandId, platform, brandName) {
  const ex = accounts.all().find((a) => a.brandId === brandId && a.platform === platform);
  if (ex) return ex;
  return accounts.create({ brandId: brandId || null, brandName: brandName || '', platform, name: `${brandName || '账号'} · ${platform}` });
}

// 收录：把作品收进选中平台账号的内容池（账号不存在则自动建）
app.post('/api/works/:id/pool', (req, res) => {
  const work = findWork(req.params.id);
  if (!work) return fail(res, '作品不存在', 404);
  if (work.passed) return fail(res, '作品在 Pass箱，请先恢复再收录', 400);
  // 质检卡点：有 fail 的产出不给收录（传 force:true 可强收，问题自己兜着）
  if (!(req.body || {}).force && work.kind === 'project') {
    const failed = (projects.get(work.id)?.outputs || []).filter((o) => o.qc?.verdict === 'fail');
    if (failed.length) return fail(res, `质检不过关（${failed.map((o) => getPlatform(o.platformId)?.label || o.platformId).join('、')}），修完再收录；坚持收录请带 force`, 400);
  }
  const platforms = (req.body || {}).platforms || [];
  if (!platforms.length) return fail(res, '至少选一个平台', 400);
  const created = [];
  for (const p of platforms) {
    const acc = ensureAccount(work.brandId, p, work.brandName);
    const dup = pool.all().find((e) => e.workId === work.id && e.accountId === acc.id);
    if (dup) { created.push(dup); continue; }
    created.push(pool.create({ accountId: acc.id, workId: work.id, brandId: work.brandId, brandName: work.brandName, platform: p, title: work.title, status: 'draft' }));
  }
  ok(res, { created });
});

// 账号列表 + 各自内容池条数（内容库首页）
// 作品的收录去向：草稿箱（未收录）与作品库（已收录到账号）靠它分流
app.get('/api/works/pooled', (req, res) => {
  const map = {};
  for (const e of pool.all()) {
    (map[e.workId] = map[e.workId] || []).push({
      entryId: e.id, accountId: e.accountId, platform: e.platform,
      status: e.status || 'draft', publishedUrl: e.publishedUrl || '', publishedAt: e.publishedAt || '',
    });
  }
  ok(res, map);
});

app.get('/api/accounts/pool-summary', (req, res) => {
  const cnt = {}, pub = {};
  for (const e of pool.all()) { cnt[e.accountId] = (cnt[e.accountId] || 0) + 1; if (e.status === 'published') pub[e.accountId] = (pub[e.accountId] || 0) + 1; }
  const brandOf = (id) => brands.get(id);
  ok(res, accounts.all().map((a) => {
    const b = brandOf(a.brandId);
    return { ...a, count: cnt[a.id] || 0, published: pub[a.id] || 0, primaryColor: b?.primaryColor, accentColor: b?.accentColor, logo: b?.logo, logos: b?.logos || [] };
  }).sort((x, y) => (y.count - x.count)));
});

// 某账号的内容池（enriched：视频/封面/匹配到的平台文案）
app.get('/api/pool', (req, res) => {
  const tasks = buildContentTasks();
  const works = tasks.flatMap((task) => task.works);
  const wById = Object.fromEntries(works.map((w) => [w.id, w]));
  const taskByWorkId = new Map(tasks.flatMap((task) => task.works.map((work) => [work.id, task])));
  let list = pool.all();
  if (req.query.accountId) list = list.filter((e) => e.accountId === req.query.accountId);
  list = list.map((e) => {
    const w = wById[e.workId];
    const m = w ? workMedia(w) : {};
    const copy = w ? pickCopyForPlatform(w, e.platform) : '';
    const sc = splitCopy(copy); // 三段复制：标题 / 正文 / tags 分开
    const task = taskByWorkId.get(e.workId);
    return {
      ...e,
      workExists: !!w,
      videoUrl: m.videoUrl || '',
      coverUrl: m.coverUrl || '',
      copy,
      copyTitle: sc.title,
      copyBody: sc.body,
      copyTags: sc.tags,
      taskId: task?.id || null,
      taskLabel: task?.label || '',
      taskKeyword: task?.keyword || '',
    };
  }).sort((a, b) => new Date(b.addedAt || b.createdAt) - new Date(a.addedAt || a.createdAt));
  ok(res, list);
});
// 标记已发布（可带回填链接）→ 自动沉淀进品牌知识库台账
app.post('/api/pool/:id/published', (req, res) => {
  const { published, url } = req.body || {};
  const patch = { status: published ? 'published' : 'draft', publishedAt: published ? new Date().toISOString() : null };
  if (url !== undefined) patch.publishedUrl = String(url || '').trim();
  const r = pool.update(req.params.id, patch);
  if (r && published) appendOpsLedger(r.brandName, { action: '✅发布', title: r.title, platform: r.platform, detail: patch.publishedUrl || '-' });
  return r ? ok(res, r) : fail(res, '内容池条目不存在', 404);
});
// 回填数据（播放/点赞/评论等）→ 同步沉淀台账
app.put('/api/pool/:id/stats', (req, res) => {
  const e = pool.get(req.params.id);
  if (!e) return fail(res, '内容池条目不存在', 404);
  const stats = { ...(e.stats || {}), ...(req.body || {}), updatedAt: new Date().toISOString() };
  const r = pool.update(e.id, { stats });
  appendOpsLedger(e.brandName, { action: '📈数据', title: e.title, platform: e.platform, detail: `播放${stats.views ?? '-'} 赞${stats.likes ?? '-'} 评${stats.comments ?? '-'}` });
  ok(res, r);
});
app.delete('/api/pool/:id', (req, res) => ok(res, { removed: pool.remove(req.params.id) }));

// 发布通道 ③：YouTube 直发（hunter skill 的 youtube_publish.py，凭证在 ~/.secrets/publishing-platforms.env）
const YT_SCRIPT = path.join(os.homedir(), 'shared-skills/hunter-account-video-production/scripts/youtube_publish.py');
// 多账号 YouTube：拿这条内容所属账号在账号库里配的凭据，注入脚本环境变量。
// 账号库没配就回落到机器上的 ~/.secrets（老行为不变）。
function youtubeEnvFor(entry) {
  const rows = acctStats.all().filter((r) => /youtube/i.test(r.platform || '') && r.creds?.refreshToken);
  if (!rows.length) return { env: null, note: '账号库未配 YouTube 凭据，使用本机 ~/.secrets' };
  let row = null;
  if (rows.length === 1) row = rows[0];
  else {
    // 多个 YouTube 号：按内容所属账号名 / 品牌名对上
    const acct = entry.accountId ? accounts.get(entry.accountId) : null;
    const wanted = [acct?.name, entry.brandName].filter(Boolean).map((s) => String(s).toLowerCase());
    row = rows.find((r) => wanted.some((w) => w.includes(String(r.name).toLowerCase()) || String(r.name).toLowerCase().includes(w))) || null;
    if (!row) return { env: null, error: `账号库里有 ${rows.length} 个配了凭据的 YouTube 号（${rows.map((r) => r.name).join('、')}），认不出这条内容该发哪个——把作品收录到对应账号，或只保留一个号的凭据` };
  }
  const c = row.creds;
  return {
    row,
    env: {
      ...process.env,
      YOUTUBE_CLIENT_ID: c.oauthClientId || '',
      YOUTUBE_CLIENT_SECRET: c.oauthClientSecret || '',
      YOUTUBE_REFRESH_TOKEN: c.refreshToken || '',
      YOUTUBE_CHANNEL_ID: c.channelId || '',
    },
    note: `使用账号库凭据：${row.name}`,
  };
}
app.post('/api/pool/:id/publish-youtube', (req, res) => {
  const e = pool.get(req.params.id);
  if (!e) return fail(res, '内容池条目不存在', 404);
  const works = buildWorks();
  const w = works.find((x) => x.id === e.workId);
  if (!w) return fail(res, '作品不存在了', 404);
  const { videoUrl, coverUrl } = workMedia(w);
  const local = videoUrl ? urlToLocal(videoUrl) : null;
  if (!local || !fs.existsSync(local)) return fail(res, '找不到本地视频文件', 400);
  if (!fs.existsSync(YT_SCRIPT)) return fail(res, 'youtube_publish.py 不存在', 500);
  // 封面：作品里的 cover 图作为 YouTube 自定义缩略图（需频道已验证才设得上）
  // YouTube 缩略图上限 2MB；超了自动用 sips 压成 jpg（1280 宽）再传
  const coverLocal = coverUrl ? urlToLocal(coverUrl) : null;
  let thumb = coverLocal && fs.existsSync(coverLocal) ? coverLocal : '';
  if (thumb && fs.statSync(thumb).size > 2 * 1024 * 1024) {
    try {
      const small = path.join(os.tmpdir(), `yt-thumb-${e.id}.jpg`);
      execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', '1280', thumb, '--out', small], { stdio: 'ignore' });
      if (fs.existsSync(small) && fs.statSync(small).size <= 2 * 1024 * 1024) thumb = small;
    } catch { /* 压缩失败就用原图，让脚本回执报大小超限 */ }
  }
  const sc = splitCopy(pickCopyForPlatform(w, e.platform) || '');
  const title = (req.body || {}).title || sc.title || w.title || 'Untitled';
  const desc = (req.body || {}).description || sc.body || '';
  const tags = ((req.body || {}).tags || sc.tags || '').replace(/#/g, '').trim().split(/\s+/).filter(Boolean).join(',');
  const privacy = (req.body || {}).privacy || 'public'; // 用户 要求默认公开发布（前端也提供可见性选择器）
  const yt = youtubeEnvFor(e);
  if (yt.error) return fail(res, yt.error, 400);
  const ytOpt = yt.env ? { env: yt.env } : {};

  // 已经发过（有视频 ID）→ 走「更新」：设公开 + 设封面，绝不重传（避免重复视频）
  const vidMatch = /[?&]v=([\w-]{6,})/.exec(e.publishedUrl || '');
  if (vidMatch) {
    const vid = vidMatch[1];
    return execFile('python3', [YT_SCRIPT, '--update', vid, privacy, thumb], { timeout: 5 * 60e3, ...ytOpt }, (err, stdout, stderr) => {
      if (err) return fail(res, `YouTube 更新失败：${(stderr || err.message).slice(-300)}`);
      try {
        const out = JSON.parse((/\{[\s\S]*\}/.exec(stdout) || ['{}'])[0]);
        if (!out.ok) return fail(res, 'YouTube 更新异常：' + stdout.slice(-300));
        pool.update(e.id, { status: 'published', publishPrivacy: privacy });
        appendOpsLedger(e.brandName, { action: '▶YouTube更新', title: e.title, platform: e.platform, detail: `${out.url}（${privacy}${out.thumbnail_set ? '·封面已设' : ''}）` });
        const isShort = /shorts|竖屏/i.test(`${e.title || ''} ${w.title || ''}`);
        const coverMsg = out.thumbnail_set
          ? (isShort ? '，普通观看页封面已上传；Shorts 信息流需在 YouTube 手机 App 选择视频帧' : '，封面已设 ✓')
          : out.thumbnail_error ? `，封面没设上：${out.thumbnail_error}` : (thumb ? '' : '，没有封面文件');
        return ok(res, {
          url: out.url, privacy, updated: true, thumbnailSet: !!out.thumbnail_set,
          shortsFrameRequired: isShort, thumbnailError: out.thumbnail_error || '', coverMsg,
        });
      } catch { fail(res, '解析更新结果失败：' + stdout.slice(-300)); }
    });
  }

  execFile('python3', [YT_SCRIPT, local, title, desc, tags, privacy, thumb], { timeout: 15 * 60e3, ...ytOpt }, (err, stdout, stderr) => {
    if (err) return fail(res, `YouTube 上传失败：${(stderr || err.message).slice(-300)}`);
    try {
      const m = /\{[\s\S]*\}/.exec(stdout);
      const out = m ? JSON.parse(m[0]) : {};
      if (out.ok && out.url) {
        pool.update(e.id, { status: 'published', publishedAt: new Date().toISOString(), publishedUrl: out.url, publishPrivacy: privacy });
        appendOpsLedger(e.brandName, { action: '▶YouTube直发', title: e.title, platform: e.platform, detail: `${out.url}（${privacy}）` });
        const isShort = /shorts|竖屏/i.test(`${e.title || ''} ${w.title || ''}`);
        const coverMsg = out.thumbnail_set
          ? (isShort ? '，普通观看页封面已上传；Shorts 信息流需在 YouTube 手机 App 选择视频帧' : '，封面已设')
          : out.thumbnail_error ? `，但封面没设上：${out.thumbnail_error}` : (thumb ? '' : '，没有封面文件');
        return ok(res, {
          url: out.url, privacy, thumbnailSet: !!out.thumbnail_set,
          shortsFrameRequired: isShort, thumbnailError: out.thumbnail_error || '', coverMsg,
        });
      }
      fail(res, 'YouTube 返回异常：' + stdout.slice(-300));
    } catch (e2) {
      fail(res, '解析上传结果失败：' + stdout.slice(-300));
    }
  });
});

// YouTube 运营数据抓取（Data API 只读，复用发布凭证）
const YT_STATS = path.join(os.homedir(), 'shared-skills/hunter-account-video-production/scripts/youtube_stats.py');
// 频道数据（订阅/总播放/视频数）
app.get('/api/youtube/channel', (req, res) => {
  if (!fs.existsSync(YT_STATS)) return fail(res, 'youtube_stats.py 不存在', 500);
  execFile('python3', [YT_STATS, '--channel'], { timeout: 60e3 }, (err, stdout) => {
    if (err) return fail(res, `抓频道数据失败：${err.message.slice(-200)}`);
    try {
      const out = JSON.parse((/\{[\s\S]*\}/.exec(stdout) || ['{}'])[0]);
      out.ok ? ok(res, out) : fail(res, out.error || '抓取失败', 502);
    } catch { fail(res, '解析失败：' + stdout.slice(-200)); }
  });
});
// 抓某条已发 YouTube 视频的真实数据 → 自动回填到 pool 条目 stats（补数据节点）
app.post('/api/pool/:id/youtube-stats', (req, res) => {
  const e = pool.get(req.params.id);
  if (!e) return fail(res, '内容池条目不存在', 404);
  const vid = (/[?&]v=([\w-]{6,})/.exec(e.publishedUrl || '') || [])[1];
  if (!vid) return fail(res, '这条还没发到 YouTube（没有视频链接）', 400);
  if (!fs.existsSync(YT_STATS)) return fail(res, 'youtube_stats.py 不存在', 500);
  const ytS = youtubeEnvFor(e);
  if (ytS.error) return fail(res, ytS.error, 400);
  execFile('python3', [YT_STATS, '--videos', vid], { timeout: 60e3, ...(ytS.env ? { env: ytS.env } : {}) }, (err, stdout) => {
    if (err) return fail(res, `抓视频数据失败：${err.message.slice(-200)}`);
    try {
      const out = JSON.parse((/\{[\s\S]*\}/.exec(stdout) || ['{}'])[0]);
      const v = out.videos?.[vid];
      if (!out.ok || !v) return fail(res, 'YouTube 没返回这条视频数据（可能刚发还没统计）', 502);
      const stats = { views: v.views, likes: v.likes, comments: v.comments, source: 'youtube_api', updatedAt: new Date().toISOString() };
      const r = pool.update(e.id, { stats });
      appendOpsLedger(e.brandName, { action: '📊YT数据', title: e.title, platform: e.platform, detail: `播放${v.views} 赞${v.likes} 评${v.comments}` });
      ok(res, { stats, video: v });
    } catch { fail(res, '解析失败：' + stdout.slice(-200)); }
  });
});

// 发布通道 ④：TikTok 直发（通过 VMOS TikTok 自动化）——⚠️ 自动化流程尚未搭建，先接好线路
// VMOS TikTok 发布脚本约定路径（存在则调用，不存在则给出清晰的未就绪回执）
const VMOS_TK_SCRIPT = path.join(os.homedir(), 'shared-skills/vmos-tiktok-publisher/publish.py');
app.post('/api/pool/:id/publish-tiktok', (req, res) => {
  const e = pool.get(req.params.id);
  if (!e) return fail(res, '内容池条目不存在', 404);
  const works = buildWorks();
  const w = works.find((x) => x.id === e.workId);
  if (!w) return fail(res, '作品不存在了', 404);
  const { videoUrl } = workMedia(w);
  const local = videoUrl ? urlToLocal(videoUrl) : null;
  if (!local || !fs.existsSync(local)) return fail(res, '找不到本地视频文件', 400);
  if (!fs.existsSync(VMOS_TK_SCRIPT)) {
    return fail(res, 'TikTok 一键发布线路已就绪，但 VMOS TikTok 自动化流程还没搭建（需先做 vmos-tiktok-publisher：VMOS 设备 + TikTok app 发布模板 + 截图验收）。搭好后此按钮即可直发。', 501);
  }
  const sc = splitCopy(pickCopyForPlatform(w, e.platform) || '');
  const caption = (req.body || {}).caption || [sc.title, sc.tags].filter(Boolean).join(' ') || w.title || '';
  execFile('python3', [VMOS_TK_SCRIPT, local, caption], { timeout: 20 * 60e3 }, (err, stdout, stderr) => {
    if (err) return fail(res, `TikTok 发布失败：${(stderr || err.message).slice(-300)}`);
    try {
      const m = /\{[\s\S]*\}/.exec(stdout);
      const out = m ? JSON.parse(m[0]) : {};
      if (out.ok) {
        pool.update(e.id, { status: 'published', publishedAt: new Date().toISOString(), publishedUrl: out.url || '', publishPrivacy: 'public' });
        appendOpsLedger(e.brandName, { action: '▶TikTok直发', title: e.title, platform: e.platform, detail: out.url || 'VMOS 已发布' });
        return ok(res, { url: out.url || '', message: 'TikTok 已通过 VMOS 发布 ✓' });
      }
      fail(res, 'TikTok 返回异常：' + stdout.slice(-300));
    } catch (e2) {
      fail(res, '解析发布结果失败：' + stdout.slice(-300));
    }
  });
});

// ═══ ElevenLabs 配音：声音清单 + 试听 ═══
app.get('/api/tts/voices', async (req, res) => {
  try { ok(res, { keyOk: elevenKeyAvailable(), voices: await listVoices() }); } catch (e) { fail(res, e); }
});
app.post('/api/tts/preview', async (req, res) => {
  const { text, voiceId } = req.body || {};
  if (!text || !voiceId) return fail(res, '需要 text 和 voiceId', 400);
  try {
    const buf = await tts({ text: String(text).slice(0, 300), voiceId });
    const name = `tts-preview-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(OUTPUT_DIR, name), buf);
    ok(res, { url: `/output/${name}` });
  } catch (e) {
    fail(res, e);
  }
});

// ═══ 品牌空间：浏览 BrandHQ/<品牌>/ 下的文件（对话窗/生产线写的东西在这里看）═══
const HQ_SKIP = new Set(['_chat-uploads', '_quarantine', '.DS_Store', 'node_modules']);
function safeHqPath(rel) {
  const abs = path.resolve(MEDIA_ROOT, String(rel || ''));
  if (!abs.startsWith(path.resolve(MEDIA_ROOT) + path.sep) && abs !== path.resolve(MEDIA_ROOT)) return null;
  return abs;
}
// 一级目录清单 + 是否已登记为品牌
app.get('/api/brandhq/dirs', (req, res) => {
  try {
    const names = mediaRootDirs().filter((n) => !HQ_SKIP.has(n));
    const bs = brands.all();
    ok(res, names.map((n) => ({
      dir: n,
      brandId: (bs.find((b) => b.name === n || b.name.includes(n) || n.includes(b.name.split(' ')[0])) || {}).id || null,
    })));
  } catch (e) { fail(res, e); }
});
// 目录文件树（深度≤3）
app.get('/api/brandhq/files', (req, res) => {
  const root = safeHqPath(req.query.dir);
  if (!root || !fs.existsSync(root)) return fail(res, '目录不存在', 404);
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 3 || out.length > 500) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (HQ_SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r, depth + 1);
      else {
        const st = fs.statSync(path.join(dir, e.name));
        out.push({ rel: r, name: e.name, size: st.size, mtime: st.mtimeMs, ext: path.extname(e.name).toLowerCase() });
      }
    }
  };
  walk(root, '', 0);
  out.sort((a, b) => b.mtime - a.mtime);
  ok(res, out);
});
// 读单个文件：文本回内容，媒体回 /media url
const HQ_TEXT = new Set(['.md', '.txt', '.json', '.csv', '.srt', '.vtt', '.html', '.log', '.yaml', '.yml']);
app.get('/api/brandhq/file', (req, res) => {
  const abs = safeHqPath(req.query.path);
  if (!abs || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return fail(res, '文件不存在', 404);
  const ext = path.extname(abs).toLowerCase();
  const url = '/media/' + path.relative(MEDIA_ROOT, abs).split(path.sep).map(encodeURIComponent).join('/');
  if (HQ_TEXT.has(ext) && fs.statSync(abs).size <= 2 * 1024 * 1024) {
    return ok(res, { kind: 'text', ext, content: fs.readFileSync(abs, 'utf8'), url });
  }
  const kind = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? 'image'
    : ['.mp4', '.mov', '.webm'].includes(ext) ? 'video'
    : ['.mp3', '.wav', '.m4a'].includes(ext) ? 'audio' : 'other';
  ok(res, { kind, ext, url });
});
// ═══ 品牌知识库（11ag project-knowledge 能力移植 · 文件系统真相版）═══
// 索引：扫描品牌目录全部 md → {title, tags, links[[双链]], backlinks, headings, mtime, words}
app.get('/api/brandhq/kb', (req, res) => {
  const root = safeHqPath(req.query.dir);
  if (!root || !fs.existsSync(root)) return fail(res, '目录不存在', 404);
  const docs = [];
  const walk = (dir, rel, depth) => {
    if (depth > 3 || docs.length > 300) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (HQ_SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), r, depth + 1); continue; }
      if (!e.name.endsWith('.md')) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, e.name), 'utf8');
        const st = fs.statSync(path.join(dir, e.name));
        const title = (raw.match(/^#\s+(.+)$/m) || [])[1] || e.name.replace(/\.md$/, '');
        const tags = [...new Set((raw.match(/(^|\s)#([^\s#，。,][^\s，。,]{0,24})/g) || []).map((t) => t.trim()).filter((t) => !/^#{2,}/.test(t)))].slice(0, 12);
        const links = [...new Set([...raw.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()))];
        const headings = [...raw.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 12);
        docs.push({ rel: r, title, tags, links, headings, mtime: st.mtimeMs, words: raw.replace(/\s/g, '').length });
      } catch {}
    }
  };
  walk(root, '', 0);
  // 反链：谁的 [[link]] 指到我（按 title 或文件名匹配）
  for (const d of docs) {
    const names = [d.title, d.rel.split('/').pop().replace(/\.md$/, '')];
    d.backlinks = docs.filter((o) => o !== d && o.links.some((l) => names.includes(l))).map((o) => o.rel);
  }
  docs.sort((a, b) => b.mtime - a.mtime);
  ok(res, docs);
});

// 写/新建 md（浏览器内编辑）
app.post('/api/brandhq/write', (req, res) => {
  const { path: rel, content } = req.body || {};
  const abs = safeHqPath(rel);
  if (!abs || !String(rel).endsWith('.md')) return fail(res, '只能写品牌目录内的 .md', 400);
  if (typeof content !== 'string' || content.length > 2 * 1024 * 1024) return fail(res, '内容不合法', 400);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    ok(res, { saved: true, path: rel });
  } catch (e) { fail(res, e); }
});

// URL/文本 → LLM 蒸馏「品牌知识四件套」写入品牌目录（11ag startmdSynthesis 中文移植）
app.post('/api/brandhq/import', async (req, res) => {
  const { dir, url, text: rawText, title } = req.body || {};
  const root = safeHqPath(dir);
  if (!root) return fail(res, '目录不合法', 400);
  let source = String(rawText || '').trim();
  if (!source && url) {
    try {
      const r = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(45000) });
      source = (await r.text()).slice(0, 60000);
    } catch (e) { return fail(res, `抓取失败：${e.message}（可改为直接粘贴正文）`); }
  }
  if (!source) return fail(res, '需要 url 或 text', 400);
  try {
    const sys = '你是品牌知识库构建师。只输出合法 JSON，不要 markdown 代码块，不要任何解释。';
    const user = `根据下面的素材，为品牌生成四份中文 Markdown 知识文档。素材没提到的写「待补充」，绝不编造数字。\n\n来源：${url || title || '用户粘贴'}\n素材：\n${source.slice(0, 50000)}\n\n输出 JSON：{"business_profile":"# 业务档案\\n## 在做什么\\n## 核心产品\\n## 目标客群\\n## 定价\\n## 关键数据/背书\\n## 主要竞对\\n## 护城河","brand_guideline":"# 品牌规范\\n## 品牌人格\\n## 语气与措辞\\n## 关键信息支柱\\n## 内容要做\\n## 内容禁忌","market_research":"# 市场调研\\n## 市场背景\\n## 竞争格局\\n## 差异化机会\\n## 受众信号\\n## 关键词机会","strategy":"# 内容策略\\n## 北极星目标\\n## 内容主线\\n## 平台打法\\n## 发布节奏\\n## 主要风险"}\n四个值都必须是完整 markdown 全文（按给定标题结构填实内容），文档之间可用 [[业务档案]] 这样的双链互相引用。`;
    const { extractJson } = await import('./lib/generate.js');
    const raw = await (await import('./lib/flatkey.js')).chat({ model: DEFAULT_MODEL, system: sys, user, maxTokens: 6000 });
    const four = extractJson(raw);
    const kbDir = path.join(root, '知识库');
    fs.mkdirSync(kbDir, { recursive: true });
    const nameMap = { business_profile: '业务档案.md', brand_guideline: '品牌规范.md', market_research: '市场调研.md', strategy: '内容策略.md' };
    const written = [];
    for (const [k, fname] of Object.entries(nameMap)) {
      if (four[k]) { fs.writeFileSync(path.join(kbDir, fname), `${four[k]}\n\n> 来源：${url || '用户粘贴'} · AI 蒸馏于 ${new Date().toISOString().slice(0, 10)}，仅供参考`); written.push(`知识库/${fname}`); }
    }
    if (!written.length) return fail(res, '蒸馏结果为空，换个来源试试');
    ok(res, { written });
  } catch (e) { fail(res, e); }
});

// AI 整理（neat-freak 移植）：派给本地 Claude 跑（复用 dispatch 无头通道）
app.post('/api/brandhq/organize', (req, res) => {
  const { dir } = req.body || {};
  const root = safeHqPath(dir);
  if (!root || !fs.existsSync(root)) return fail(res, '目录不存在', 404);
  const brand = brands.all().find((b) => b.name === dir || b.name.includes(dir) || dir.includes((b.name || '').split(' ')[0]));
  try {
    const job = jobs.create({
      brandId: brand?.id || null, brandName: brand?.name || dir,
      channelId: 'kb_organize', channelLabel: '🧹 知识库整理',
      idea: `整理 ${dir} 品牌知识库`, eta: '约5-15分钟', status: 'queued',
      outDir: root, products: [], logTail: '', error: null, startedAt: null, doneAt: null,
      promptOverride: `你是知识库洁癖管理员。整理目录 ${root} 下的 markdown 知识库（绝不动 mp4/png 等媒体文件和 素材包/ 目录）：1) 通读全部 .md；2) 松散文件按主题归入子目录（定位与策略/选题库/复盘 等，已有结构就沿用）；3) 明显重复的内容合并（保最新，旧文件内容并入后删除）；4) 每个文档确保首行有 # 标题；5) 相关文档间补 [[双链]]（用对方文档标题）；6) 生成/更新根目录 index.md：知识库地图（分组列出所有文档+一句话说明+双链）。改动要克制——宁少勿多，不确定就不动。完成后输出一行改动摘要。`,
    });
    (async () => { try { const { tick } = await import('./lib/dispatch.js'); tick(); } catch {} })();
    ok(res, { jobId: job.id });
  } catch (e) { fail(res, e); }
});

// 品牌全景：知识库 + 排期 + 作品 + 发布 + 创作 一次拉全（知识库串通整个项目）
app.get('/api/brandhq/overview', (req, res) => {
  const dir = String(req.query.dir || '');
  const brand = brands.all().find((b) => b.name === dir || b.name.includes(dir) || dir.includes((b.name || ' ').split(' ')[0]));
  const bid = brand?.id || null;
  const today = new Date().toISOString().slice(0, 10);
  const cal = bid ? calendar.all().filter((e) => e.brandId === bid) : [];
  const upcoming = cal.filter((e) => e.date >= today && e.status === 'scheduled').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 6);
  const works = bid ? buildWorks().filter((w) => w.brandId === bid).slice(0, 6) : [];
  const poolItems = bid ? pool.all().filter((p) => p.brandId === bid).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8) : [];
  const projs = bid ? projects.all().filter((p) => p.brandId === bid).slice(0, 6) : [];
  ok(res, {
    brandId: bid, brandName: brand?.name || dir,
    upcoming,
    works: works.map((w) => ({ id: w.id, title: w.title, at: w.at, published: w.published, cover: (w.items || []).find((i) => i.type === 'image')?.url || '', video: (w.items || []).find((i) => i.type === 'video')?.url || '' })),
    pool: poolItems.map((p) => ({ id: p.id, title: p.title, platform: p.platform, status: p.status, url: p.publishedUrl || '', stats: p.stats || null })),
    projects: projs.map((p) => ({ id: p.id, title: p.title, createdAt: p.createdAt, done: (p.outputs || []).filter((o) => o.status === 'done').length, total: (p.outputs || []).length })),
  });
});

// 在访达打开
app.post('/api/brandhq/reveal', (req, res) => {
  const abs = safeHqPath((req.body || {}).dir);
  if (!abs || !fs.existsSync(abs)) return fail(res, '目录不存在', 404);
  try { execFileSync('open', [abs]); } catch {}
  ok(res, { folder: abs });
});

// ═══ 对话窗口：本地 claude CLI（fk-cc 通道，可切模型）═══
app.get('/api/chat/models', (req, res) => ok(res, { models: CHAT_MODELS, default: DEFAULT_CHAT_MODEL }));

// 对话附件上传（base64 JSON）：存到 BrandHQ/_chat-uploads，路径附进消息给本地 Claude 用 Read 看
// 创作页素材投喂：文本类抽正文当素材，压缩包解开逐个抽，图片存下来当参考图
const TEXTY = /\.(txt|md|markdown|csv|tsv|json|ya?ml|html?|xml|srt|vtt|log|js|ts|py|css)$/i;
app.post('/api/create/material', (req, res) => {
  try {
    const { name, dataUrl } = req.body || {};
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return fail(res, '不是合法的文件数据', 400);
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 25 * 1024 * 1024) return fail(res, '单个文件别超过 25MB', 400);
    const safe = String(name || 'file').replace(/[^\w.一-龥-]+/g, '_').slice(-80) || 'file';
    const dir = path.join(MEDIA_ROOT, '_materials');
    fs.mkdirSync(dir, { recursive: true });
    const fname = `${Date.now()}-${safe}`;
    const abs = path.join(dir, fname);
    fs.writeFileSync(abs, buf);
    const isImage = m[1].startsWith('image/');
    const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…（截断，原文 ${s.length} 字）` : s);

    if (isImage) {
      return ok(res, { kind: 'image', name: safe, url: `/media/_materials/${encodeURIComponent(fname)}`, path: abs, size: buf.length });
    }
    if (/\.zip$/i.test(safe)) {
      // 纯 JS 解压（服务器没装 unzip，实测踩过）：文本拼成素材，图片落盘当参考图
      try {
        const entries = listZip(buf);
        const texts = entries.filter((e) => TEXTY.test(e.name)).slice(0, 20);
        const imgs = entries.filter((e) => /\.(png|jpe?g|webp|gif)$/i.test(e.name)).slice(0, 8);
        const images = imgs.map((e) => {
          const iname = `${Date.now()}-${path.basename(e.name).replace(/[^\w.一-龥-]+/g, '_')}`;
          fs.writeFileSync(path.join(dir, iname), e.read());
          return { name: path.basename(e.name), url: `/media/_materials/${encodeURIComponent(iname)}` };
        });
        const body = texts.map((e) => `── ${e.name} ──\n${clip(e.read().toString('utf8'), 4000)}`).join('\n\n');
        if (!texts.length && !images.length) {
          return ok(res, { kind: 'note', name: safe, text: `（压缩包 ${safe}：${entries.length} 个文件，没有可读文本或图片）` });
        }
        return ok(res, {
          kind: texts.length ? 'text' : 'note',
          name: safe,
          text: texts.length ? clip(body, 24000) : `（压缩包 ${safe}：${images.length} 张图已作为参考图）`,
          fileCount: entries.length, textCount: texts.length, imageCount: images.length, images,
        });
      } catch (e) {
        return fail(res, `解压失败：${String(e.message).slice(0, 140)}`, 400);
      }
    }
    if (TEXTY.test(safe)) {
      return ok(res, { kind: 'text', name: safe, text: clip(buf.toString('utf8'), 24000) });
    }
    // 其它二进制（pdf/docx/视频…）：留着路径，正文提取交给产能机 CLI
    return ok(res, { kind: 'file', name: safe, url: `/media/_materials/${encodeURIComponent(fname)}`, path: abs, size: buf.length });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/chat/upload', (req, res) => {
  try {
    const { name, dataUrl } = req.body || {};
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(dataUrl || '');
    if (!m) return fail(res, '不是合法的 data url', 400);
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 10 * 1024 * 1024) return fail(res, '文件超过 10MB', 400);
    const safe = String(name || 'file').replace(/[^\w.一-龥-]+/g, '_').slice(-80) || 'file';
    const dir = path.join(MEDIA_ROOT, '_chat-uploads');
    fs.mkdirSync(dir, { recursive: true });
    const fname = `${Date.now()}-${safe}`;
    fs.writeFileSync(path.join(dir, fname), buf);
    ok(res, {
      path: path.join(dir, fname), // 绝对路径（给 Claude Read 用）
      url: `/media/_chat-uploads/${encodeURIComponent(fname)}`, // 网页预览用
      isImage: m[1].startsWith('image/'),
      size: buf.length,
    });
  } catch (e) {
    fail(res, e);
  }
});
app.get('/api/chat', (req, res) => {
  const list = chats.all().map((c) => ({
    id: c.id, title: c.title || '新对话', model: c.model || DEFAULT_CHAT_MODEL,
    count: (c.messages || []).length, updatedAt: c.updatedAt || c.createdAt,
  }));
  ok(res, list.slice(0, 50));
});
app.post('/api/chat', (req, res) => {
  const model = validModel((req.body || {}).model);
  ok(res, chats.create({ title: '', model, claudeSessionId: null, messages: [] }));
});
app.get('/api/chat/:id', (req, res) => {
  const c = chats.get(req.params.id);
  return c ? ok(res, c) : fail(res, '会话不存在', 404);
});
app.delete('/api/chat/:id', (req, res) => ok(res, { removed: chats.remove(req.params.id) }));

// 发消息：SSE 流式回（delta 逐字 / tool 工具芯片 / done / error）
app.post('/api/chat/:id/send', async (req, res) => {
  const chat = chats.get(req.params.id);
  if (!chat) return fail(res, '会话不存在', 404);
  const { text, model } = req.body || {};
  if (!text || !String(text).trim()) return fail(res, '消息不能为空', 400);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (o) => { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch {} };
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
  try {
    const out = await chatTurn({ chatId: chat.id, text: String(text).trim(), model, onEvent: send });
    send({ type: 'done', text: out.text, tools: out.tools });
  } catch (e) {
    send({ type: 'error', error: e.message });
  }
  clearInterval(heartbeat);
  res.end();
});

// rednote 引擎（P1a 产物，存在则挂载）
try {
  const { mountRn } = await import('./lib/rn-routes.js');
  mountRn(app);
  console.log('[指挥部] rednote 引擎已挂载');
} catch (e) { console.log('[指挥部] rednote 引擎未就绪（可稍后挂载）：', e.message); }

// ---- 自动化运行：每 60 秒扫一遍日历，到点的（且 auto）自动生成 ----
let schedulerBusy = false;
async function tickScheduler() {
  if (schedulerBusy) return;
  const now = Date.now();
  const due = calendar.all().filter((e) => {
    if (e.status !== 'scheduled' || e.auto === false) return false;
    const ts = new Date(`${e.date}T${(e.time || '09:00')}:00`).getTime();
    return !isNaN(ts) && ts <= now;
  });
  if (!due.length) return;
  schedulerBusy = true;
  try {
    for (const e of due) {
      console.log(`  ⏰ 自动生成日程：${e.idea.slice(0, 20)}…`);
      try { await runCalendarEntry(e); }
      catch (err) {
        console.error('日程失败:', err.message);
        // 崩在建项目/更早的环节时排期会卡在 running——把失败写回排期，日历上看得见
        try { calendar.update(e.id, { status: 'error', ranAt: new Date().toISOString(), errorMsg: String(err.message || err).slice(0, 200) }); } catch {}
      }
    }
  } finally {
    schedulerBusy = false;
  }
}
setInterval(tickScheduler, 60000);

// 僵尸认领回收：产能机 CLI 会话断了，任务不该永远卡在「已认领」没人管
setInterval(() => {
  try {
    const n = reapStaleClaims();
    if (n) console.log(`  ♻️ ${n} 个任务超过 ${STALE_CLAIM_MIN} 分钟无心跳，已放回队列`);
  } catch (e) { console.error('回收僵尸认领失败:', e.message); }
}, 5 * 60e3).unref?.();

// SPA 兜底
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const server = app.listen(PORT, () => {
  console.log(`\n  ✦ 1toAll 已启动`);
  console.log(`  ▸ 打开浏览器访问：http://localhost:${PORT}`);
  console.log(`  ▸ flatkey key：${keyAvailable() ? '已就绪 ✓' : '缺失 ✗（请检查 Keychain）'}\n`);
});
// 对话窗 SSE 是长请求（claude 跑工具可能 >5 分钟）。
// Node 默认 requestTimeout=300s 会掐断连接 → 前端 network error。本机服务，放开。
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 75_000;
