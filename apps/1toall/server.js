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
import { brands, styles, plays, presets, projects, calendar, accounts, jobs, chats, pool, cliTokens, wsSettings, acctStats } from './lib/store.js';
import { mintCliToken, verifyCliToken, handleMcpRequest } from './lib/cli-mcp.js';
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
  MEDIA_ROOT,
} from './lib/dispatch.js';
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, validModel, chatTurn } from './lib/chat.js';
import { generateOutput, renderImageFromPrompt, ideate, routeTopic, draftBrand } from './lib/generate.js';
import { buildWechatArticle, generateArticleImages } from './lib/article.js';
import { renderWechatHtml } from './lib/wechat-layout.js';
import { getNews, getNewsCached } from './lib/news.js';
import { getInspiration, getInspirationCached } from './lib/inspiration-radar.js';
import { organizeDelivery, ownerOfBrand } from './lib/delivery.js';
import { keyAvailable, listModels } from './lib/flatkey.js';
import { splitCopy } from './lib/copysplit.js';
import { tts, listVoices, elevenKeyAvailable } from './lib/tts.js';
import { calculateAndWriteVideoCost, loadCostSettings } from './lib/video-cost.js';
import { buildContentLedger } from './lib/content-ledger.js';
import { execFile } from 'node:child_process';
import { ensureSeed } from './data/seed.js';
import { cookiesFromRequest, runWithActor, runWithWorkspace, tenantFromRequest, workspaceFromRequest } from './lib/workspace-context.js';
import { ELEVENAGENTS_SESSION_COOKIE, verifyElevenAgentsSession } from './lib/elevenagents-sso.js';

[DATA_DIR, OUTPUT_DIR, ASSETS_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));
ensureSeed();

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
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录 · 1toAll</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui;color:#111827;background:#f6f7f9}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(420px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:30px;box-shadow:0 18px 50px #11182712}.eyebrow{font-size:12px;font-weight:800;letter-spacing:.12em;color:#635bff;text-transform:uppercase}h1{margin:10px 0 6px;font-size:28px}p{margin:0 0 24px;color:#6b7280;line-height:1.55}label{display:block;margin:14px 0 6px;font-size:13px;font-weight:700}input{width:100%;border:1px solid #d8dce3;border-radius:10px;padding:12px 13px;font-size:15px;outline:none}input:focus{border-color:#635bff;box-shadow:0 0 0 3px #635bff18}button{width:100%;margin-top:20px;border:0;border-radius:10px;padding:13px;background:#111827;color:#fff;font-size:15px;font-weight:800;cursor:pointer}.error{min-height:20px;margin-top:12px;color:#b42318;font-size:13px}</style></head><body><main class="card"><div class="eyebrow">11agents · Flatkey</div><h1>1toAll 工作台</h1><p>Hunter × 47 的内容分发 Agent。登录后可进入当前项目的数据空间。</p><form id="login"><label for="user">用户名</label><input id="user" autocomplete="username" value="hunter"><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" autofocus><button>进入工作台</button><div class="error" id="error"></div></form></main><script>
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
app.use(express.static(PUBLIC_DIR));
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
  defaults: { text: DEFAULT_MODEL, topic: DEFAULT_MODEL, imageDesign: IMAGE_DESIGN_MODEL, worker: 'claude-opus-4-8-fk-cc' },
}));
app.put('/api/settings/models', (req, res) => {
  const m = (req.body || {}).models || {};
  const clean = {};
  for (const k of ['text', 'topic', 'imageDesign', 'worker']) {
    if (typeof m[k] === 'string') clean[k] = m[k].trim(); // 空串=清掉该项回默认
  }
  const cur = (wsSettings.get() || {}).models || {};
  const merged = { ...cur, ...clean };
  for (const k of Object.keys(merged)) if (!merged[k]) delete merged[k];
  ok(res, wsSettings.set({ models: merged }));
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
    const file = `voice-${safeName}-${Date.now()}.${ext}`;
    const dir = path.join(ASSETS_DIR, 'voices');
    fs.mkdirSync(dir, { recursive: true });
    const localPath = path.join(dir, file);
    fs.writeFileSync(localPath, Buffer.from(m[2], 'base64'));
    ok(res, { url: `/assets/voices/${file}`, path: localPath });
  } catch (e) {
    fail(res, e);
  }
});

// ---- 风格库（写作 / 视觉 / 声音风格配方）----
app.get('/api/styles', (req, res) => ok(res, styles.all()));
app.post('/api/styles', (req, res) => ok(res, styles.create(req.body || {})));
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
      cards: (inspiration.cards || []).filter((x) => x.score >= 70).slice(0, 4),
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
  const style = styleId ? styles.get(styleId) : null; // 写作风格
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
    return out;
  } catch (e) {
    const out = { platformId: platform.id, status: 'error', error: e.message };
    saveOutput(project.id, platform.id, out);
    throw e;
  }
}

// 生成单个输出（前端为每个输出并行调用，卡片独立刷新）
// body.mode='prompt' → 图片只出提示词（两步创作 stage 1）；默认 full
// body.idea → 可选，一次性顶替 project.idea（一键派生用，如"拿公众号成品文正文改写小红书"）
app.post('/api/projects/:id/generate/:platformId', async (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return fail(res, '项目不存在', 404);
  try {
    const { mode, idea } = req.body || {};
    ok(res, await generateForProject(project, req.params.platformId, mode || 'full', idea || null));
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
}

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
  for (const pid of entry.outputs) {
    try { await generateForProject(project, pid); okCount++; } catch {}
  }
  calendar.update(entry.id, {
    status: okCount === entry.outputs.length ? 'done' : okCount ? 'partial' : 'error',
    projectId: project.id,
    ranAt: new Date().toISOString(),
  });
  return project.id;
}

// 手动跑一条
app.post('/api/calendar/:id/run', async (req, res) => {
  const entry = calendar.get(req.params.id);
  if (!entry) return fail(res, '日程不存在', 404);
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
app.get('/api/accounts/board', (req, res) => {
  const rows = acctStats.all();
  const asOf = rows.map((r) => r.asOf).filter(Boolean).sort().pop() || null;
  ok(res, { rows, cachedAt: asOf, cached: false });
});
app.post('/api/accounts/board', (req, res) => ok(res, acctStats.create(req.body || {})));
app.put('/api/accounts/board/:id', (req, res) => {
  const r = acctStats.update(req.params.id, req.body || {});
  return r ? ok(res, r) : fail(res, '账号不存在', 404);
});
app.delete('/api/accounts/board/:id', (req, res) => ok(res, { removed: acctStats.remove(req.params.id) }));
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

// 一键品牌包：轻活建 project（沿用现有生成），重活开 jobs
app.post('/api/pack/run', async (req, res) => {
  const { brandId, idea, channelIds = [] } = req.body || {};
  const brand = brands.get(brandId);
  if (!brand) return fail(res, '品牌不存在', 400);
  if (!idea?.trim()) return fail(res, '想法不能为空', 400);
  const chans = (brand.channels || []).filter((c) => channelIds.includes(c.id));
  if (!chans.length) return fail(res, '没选中任何渠道', 400);
  const heavy = chans.filter((c) => c.engine === 'claude');
  const light = chans.filter((c) => c.engine === 'flatkey');
  const out = { jobs: [], projectId: null, rn: [] };
  for (const c of heavy) out.jobs.push(createJob({ brandId, channelId: c.id, idea }));
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
function buildWorks() {
  const meta = worksMeta();
  const works = [];
  for (const j of jobs.all()) {
    if (j.status !== 'done') continue;
    works.push({ id: j.id, kind: 'job', brandId: j.brandId, brandName: j.brandName,
      title: `${j.channelLabel} · ${String(j.idea || '').replace(/https?:\/\/\S+/g, '').replace(/^[（(\s]+/, '').slice(0, 20) || j.channelLabel}`, at: j.doneAt || j.createdAt,
      status: 'done', published: !!meta[j.id]?.published, passed: !!meta[j.id]?.passed,
      passedAt: meta[j.id]?.passedAt || null, cost: j.cost || null, items: j.products || [] });
  }
  for (const pj of projects.all()) {
    const items = [];
    for (const o of pj.outputs || []) {
      if (o.status !== 'done' && o.status !== 'edited') continue;
      const pf = getPlatform(o.platformId);
      if (o.imageUrl) items.push({ type: 'image', url: o.imageUrl, label: pf?.label || o.platformId });
      else if (o.content) items.push({ type: 'text', url: '', label: pf?.label || o.platformId, content: String(o.content) });
    }
    if (!items.length) continue;
    works.push({ id: pj.id, kind: 'project', brandId: pj.brandId, brandName: pj.brandName || '',
      title: pj.title || pj.idea?.slice(0, 20) || '', at: pj.createdAt,
      status: 'done', published: !!meta[pj.id]?.published, passed: !!meta[pj.id]?.passed,
      passedAt: meta[pj.id]?.passedAt || null, items });
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

  for (const project of projects.all()) {
    const work = workById[project.id];
    if (!work) continue;
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
      works: [work],
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
    const statusOrder = ['running', 'queued', 'waiting_external', 'failed', 'done'];
    const status = statusOrder.find((candidate) => ordered.some((job) => job.status === candidate)) || 'done';
    const statusLabels = { running: '生产中', queued: '排队中', waiting_external: '等待确认', failed: '失败', done: '已完成' };
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
  const out = tasks.map((t) => {
    const activeWorks = (t.works || []).filter((work) => !work.passed);
    const passedWorks = (t.works || []).filter((work) => work.passed);
    const allPassed = (t.works || []).length > 0 && activeWorks.length === 0;
    const workIds = new Set([...activeWorks.map((w) => w.id), ...(t.jobIds || []).filter((id) => activeWorks.some((work) => work.id === id)), activeWorks.some((work) => work.id === t.projectId) ? t.projectId : null].filter(Boolean));
    const entries = poolAll.filter((e) => workIds.has(e.workId));
    const published = entries.filter((e) => e.status === 'published');
    const withData = published.filter((e) => e.stats && (e.stats.views != null || e.stats.likes != null));
    const produce = t.status || 'done'; // running/queued/waiting_external/failed/done
    const producedDone = produce === 'done';
    const collect = allPassed ? 'passed' : (entries.length ? 'done' : (producedDone ? 'pending' : 'wait'));
    const publish = allPassed ? 'passed' : published.length
      ? (published.length >= entries.length ? 'done' : 'partial')
      : (entries.length ? 'pending' : 'wait');
    const data = allPassed ? 'passed' : (withData.length ? 'done' : (published.length ? 'pending' : 'wait'));
    const ageDays = Math.floor((Date.now() - new Date(t.at || Date.now())) / DAY);

    // 当前卡在哪个节点 → 一条提醒（就近最急的）
    let reminder = null;
    if (produce === 'failed') reminder = { level: 'urgent', node: '生产', text: '生产失败，去重跑' };
    else if (produce === 'waiting_external') reminder = { level: 'todo', node: '生产', text: '等待外部资源确认' };
    else if (produce === 'running' || produce === 'queued') reminder = null; // 进行中不算待办
    else if (collect === 'pending') reminder = { level: 'todo', node: '收录', text: '已生产，待收录到账号' };
    else if (publish === 'pending' || publish === 'partial') reminder = { level: ageDays >= 2 ? 'urgent' : 'todo', node: '发布', text: publish === 'partial' ? '部分已发，还有没发的' : `已收录${ageDays >= 2 ? `${ageDays}天` : ''}，待发布` };
    else if (data === 'pending') reminder = { level: 'info', node: '数据', text: '已发布，待回填数据' };

    return {
      id: t.id, keyword: t.keyword, label: t.label, brandName: t.brandName, brandId: t.brandId, at: t.at,
      projectId: t.projectId, jobIds: t.jobIds || [],
      nodes: { produce, collect, publish, data },
      counts: { entries: entries.length, published: published.length, withData: withData.length, passed: passedWorks.length },
      ageDays, reminder,
    };
  });
  const levelRank = { urgent: 0, todo: 1, info: 2 };
  const reminders = out.filter((t) => t.reminder)
    .map((t) => ({ taskId: t.id, keyword: t.keyword, brandName: t.brandName, ...t.reminder }))
    .sort((a, b) => levelRank[a.level] - levelRank[b.level]);
  return { tasks: out, reminders, attention: reminders.filter((r) => r.level !== 'info').length };
}
app.get('/api/tasks/board', (req, res) => ok(res, buildTaskBoard()));
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

  // 已经发过（有视频 ID）→ 走「更新」：设公开 + 设封面，绝不重传（避免重复视频）
  const vidMatch = /[?&]v=([\w-]{6,})/.exec(e.publishedUrl || '');
  if (vidMatch) {
    const vid = vidMatch[1];
    return execFile('python3', [YT_SCRIPT, '--update', vid, privacy, thumb], { timeout: 5 * 60e3 }, (err, stdout, stderr) => {
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

  execFile('python3', [YT_SCRIPT, local, title, desc, tags, privacy, thumb], { timeout: 15 * 60e3 }, (err, stdout, stderr) => {
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
  execFile('python3', [YT_STATS, '--videos', vid], { timeout: 60e3 }, (err, stdout) => {
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
      try { await runCalendarEntry(e); } catch (err) { console.error('日程失败:', err.message); }
    }
  } finally {
    schedulerBusy = false;
  }
}
setInterval(tickScheduler, 60000);

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
