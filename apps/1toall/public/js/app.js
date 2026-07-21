// 1toAll 前端 · 原生 JS SPA
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeHref = (s = '') => {
  try {
    const url = new URL(String(s));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch { return '#'; }
};

// #RRGGBB → rgba（带透明度），用于品牌色玻璃质感
function hexA(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
  if (!m) return `rgba(139,92,246,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
const BRAND_VARS = ['--accent', '--accent-2', '--accent-ink', '--accent-grad', '--glow-accent', '--accent-soft', '--accent-line'];
// 把创作区的 accent / 渐变 / 光晕换成所选品牌的色
function applyBrandTheme(brand) {
  const root = $('#view');
  if (!root) return;
  if (!brand || brand.id === 'none' || !brand.primaryColor) {
    BRAND_VARS.forEach((v) => root.style.removeProperty(v));
    return;
  }
  const p = brand.primaryColor, a = brand.accentColor || p;
  root.style.setProperty('--accent', p);
  root.style.setProperty('--accent-2', a);
  root.style.setProperty('--accent-ink', brand.darkColor || p);
  root.style.setProperty('--accent-grad', `linear-gradient(135deg, ${p}, ${a})`);
  root.style.setProperty('--glow-accent', `0 8px 24px ${hexA(p, 0.4)}`);
  root.style.setProperty('--accent-soft', hexA(p, 0.1));
  root.style.setProperty('--accent-line', hexA(p, 0.24));
}

// ---------- API ----------
const api = {
  async req(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({ ok: false, error: '响应解析失败' }));
    if (!j.ok) throw new Error(j.error || `请求失败 ${r.status}`);
    return j.data;
  },
  get: (u) => api.req('GET', u),
  post: (u, b) => api.req('POST', u, b),
  put: (u, b) => api.req('PUT', u, b),
  del: (u) => api.req('DELETE', u),
};

// ---------- 全局状态 ----------
const S = {
  boot: null,
  view: 'home',
  nav: { stack: [] }, // 页内跳转返回栈：每项 { label, restore }
  create: { idea: '', brandId: 'none', outputs: new Set(), options: { tone: '', styleId: null, vstyleId: null, length: '中', model: '' }, project: null, results: {} },
};
const NONE_BRAND = { id: 'none', name: '无品牌', tagline: '按内容最佳调性', synthetic: true };
const brandList = () => [NONE_BRAND, ...(S.boot?.brands || [])];
const brandById = (id) => brandList().find((b) => b.id === id) || NONE_BRAND;
const platformsByGroup = (g) => (S.boot?.platforms || []).filter((p) => p.group === g);
const getPlat = (id) => (S.boot?.platforms || []).find((p) => p.id === id);

// ---------- toast ----------
function toast(msg, kind = '') {
  const t = el(`<div class="toast ${kind}">${esc(msg)}</div>`);
  $('#toastRoot').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2600);
}

// ---------- modal ----------
function modal({ title, bodyHtml, footHtml, onMount }) {
  const mask = el(`<div class="modal-mask"><div class="modal">
    <div class="modal-head"><div class="modal-title">${esc(title)}</div></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot">${footHtml || ''}</div></div></div>`);
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  $('#modalRoot').appendChild(mask);
  onMount?.(mask, close);
  return { mask, close };
}

// prompt()/confirm() 在部分浏览器/内嵌视图被禁用（会抛错），统一用弹窗替代
function askConfirm(title, msg) {
  return new Promise((resolve) => {
    modal({
      title,
      bodyHtml: msg ? `<p class="ask-msg">${esc(msg).replace(/\n/g, '<br>')}</p>` : '',
      footHtml: `<button class="btn btn-ghost" data-no>取消</button><button class="btn btn-accent" data-yes>确定</button>`,
      onMount: (mask, close) => {
        $('[data-no]', mask).onclick = () => { close(); resolve(false); };
        $('[data-yes]', mask).onclick = () => { close(); resolve(true); };
      },
    });
  });
}
// 返回 {key: value}（点取消返回 null）。fields: [{key,label,value,placeholder,type}]，type='textarea' 出多行框
function askText({ title, fields, okText = '确定', msg }) {
  return new Promise((resolve) => {
    const body = (msg ? `<p class="ask-msg">${esc(msg)}</p>` : '') + fields.map((f, i) => `<label class="field"><span class="lab">${esc(f.label)}</span>
      ${f.type === 'textarea'
        ? `<textarea class="textarea" id="ask_${i}" rows="${f.rows || 5}" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea>`
        : f.type === 'select'
        ? `<select class="input" id="ask_${i}">${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`
        : `<input class="input" id="ask_${i}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}"/>`}</label>`).join('');
    modal({
      title,
      bodyHtml: body,
      footHtml: `<button class="btn btn-ghost" data-no>取消</button><button class="btn btn-accent" data-yes>${esc(okText)}</button>`,
      onMount: (mask, close) => {
        const first = $('#ask_0', mask); if (first) setTimeout(() => first.focus(), 30);
        $('[data-no]', mask).onclick = () => { close(); resolve(null); };
        const submit = () => {
          const out = {};
          fields.forEach((f, i) => (out[f.key] = $(`#ask_${i}`, mask).value));
          close(); resolve(out);
        };
        $('[data-yes]', mask).onclick = submit;
        mask.querySelectorAll('input').forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
      },
    });
  });
}

// ---------- 恢复卡：把「撞墙」的死路变成有出路的引导（无品牌 / 路由失败等空状态统一走这个）----------
// 只用现有 CSS 类 + 内联样式，不新增 style.css 规则（本次改动范围只限 generate.js / server.js / app.js）
function renderRecoveryCard({ icon = '🧭', title, desc = '', actions = [] }) {
  const card = el(`<div style="display:flex;gap:14px;align-items:flex-start;padding:18px 20px;border-radius:var(--radius);background:var(--glass);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--glass-border);box-shadow:var(--shadow-sm);margin:14px 0">
    <div style="font-size:26px;line-height:1;opacity:.85">${icon}</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:14.5px;margin-bottom:4px">${esc(title)}</div>
      ${desc ? `<div class="hint" style="margin-bottom:12px;line-height:1.5">${esc(desc)}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-accent' : 'btn-ghost'} btn-sm" data-rcv="${i}">${esc(a.label)}</button>`).join('')}</div>
    </div>
  </div>`);
  actions.forEach((a, i) => { const b = $(`[data-rcv="${i}"]`, card); if (b) b.onclick = a.onClick; });
  return card;
}

// ---------- 极简 Markdown ----------
function inlineMd(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
// 判断某行是不是块级起点（用于段落聚合时提前收尾）
function mdIsBlockStart(line, next) {
  if (line == null) return false;
  if (/^\s*(#{1,6})\s+/.test(line)) return true;              // 标题
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return true;        // 分割线
  if (/^\s*[-*•]\s+/.test(line)) return true;                 // 无序列表
  if (/^\s*\d+[.)]\s+/.test(line)) return true;               // 有序列表
  if (/^\s*>\s?/.test(line)) return true;                     // 引用
  if (/^```/.test(line.trim())) return true;                  // 代码围栏
  if (line.includes('|') && /^[\s|:\-]+$/.test(next || '') && (next || '').includes('|')) return true; // 表格
  return false;
}
function mdToHtml(md) {
  const lines = String(md).replace(/\r/g, '').split('\n');
  let out = '', i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    // 代码围栏 ```
    if (/^```/.test(line.trim())) {
      i++; const code = [];
      while (i < n && !/^```/.test(lines[i].trim())) { code.push(lines[i]); i++; }
      i++; // 跳过收尾 ```
      out += `<pre><code>${esc(code.join('\n'))}</code></pre>`; continue;
    }
    // 表格
    if (line.includes('|') && /^[\s|:\-]+$/.test(next) && next.includes('|')) {
      const head = line.split('|').map((c) => c.trim()).filter((c, idx, a) => !(c === '' && (idx === 0 || idx === a.length - 1)));
      i += 2;
      const rows = [];
      while (i < n && lines[i].includes('|')) {
        rows.push(lines[i].split('|').map((c) => c.trim()).filter((c, idx, a) => !(c === '' && (idx === 0 || idx === a.length - 1))));
        i++;
      }
      out += '<table><thead><tr>' + head.map((h) => `<th>${inlineMd(h)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map((r) => '<tr>' + r.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }
    // 分割线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out += '<hr>'; i++; continue; }
    // 标题
    const h = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (h) { const lv = Math.min(h[1].length, 4); out += `<h${lv}>${inlineMd(h[2])}</h${lv}>`; i++; continue; }
    // 引用（连续 > 合并）
    if (/^\s*>\s?/.test(line)) {
      const q = [];
      while (i < n && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out += `<blockquote>${q.map(inlineMd).join('<br>')}</blockquote>`; continue;
    }
    // 无序列表
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < n && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++; }
      out += '<ul>' + items.map((t) => `<li>${inlineMd(t)}</li>`).join('') + '</ul>'; continue;
    }
    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < n && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      out += '<ol>' + items.map((t) => `<li>${inlineMd(t)}</li>`).join('') + '</ol>'; continue;
    }
    // 空行
    if (line.trim() === '') { i++; continue; }
    // 段落：聚合连续普通行，行内换行保留为 <br>
    const para = [];
    while (i < n && lines[i].trim() !== '' && !mdIsBlockStart(lines[i], lines[i + 1])) { para.push(lines[i]); i++; }
    out += `<p>${para.map(inlineMd).join('<br>')}</p>`;
  }
  return out;
}

// ---------- 启动 ----------
async function boot() {
  try {
    S.boot = await api.get('/api/bootstrap');
    S.passReady = await api.get('/api/features').then((features) => !!features.workPass).catch(() => false);
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><div class="em-glyph">⚠️</div><div class="em-text">后端没连上：${esc(e.message)}<br>请确认服务已启动（node server.js）。</div></div>`;
    return;
  }
  S.create.options.model = S.boot.defaultModel;
  const ks = $('#keyStatus');
  if (S.boot.keyOk) { ks.classList.add('ok'); ks.innerHTML = '<span class="dot"></span> flatkey 已就绪'; }
  else { ks.classList.add('bad'); ks.innerHTML = '<span class="dot"></span> flatkey key 缺失'; }

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  const brandsNav = document.querySelector('.nav-item[data-view="brands"]');
  if (brandsNav) brandsNav.innerHTML = '<span class="ni-ic">◈</span> 品牌 & IP';
  // 刷新回到刷新前的页面（含品牌/IP 空间）
  const savedView = (() => { try { return localStorage.getItem('ag_last_view'); } catch { return null; } })();
  if (savedView && savedView.startsWith('space:')) {
    switchView('brands');
    const dir = savedView.slice(6);
    let brand = null;
    try {
      const dirs = await api.get('/api/brandhq/dirs');
      const hit = dirs.find((d) => d.dir === dir);
      if (hit && hit.brandId) brand = (S.boot.brands || []).find((x) => x.id === hit.brandId) || null;
    } catch {}
    openBrandSpace(dir, brand);
  } else if (savedView && document.querySelector(`.nav-item[data-view="${savedView}"]`)) {
    switchView(savedView);
  } else {
    render();
  }
  maybeOnboard();
  api.get('/api/tasks/board').then((b) => updateTaskBadge(b.attention)).catch(() => {}); // 启动即点亮任务角标
}

function switchView(v, opts = {}) {
  if (!opts.keepStack) S.nav.stack = []; // 侧栏点击=全新导航，清空返回栈
  S.view = v;
  try { localStorage.setItem('ag_last_view', v); } catch {} // 刷新回到当前页
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  render();
}

// 「访达/打开文件夹/复制本地路径」只在本地环境有效——线上按了打开的是服务器的文件系统
const IS_LOCAL_HOST = ['localhost', '127.0.0.1'].includes(location.hostname);
function freezeIfRemote(btn) {
  if (IS_LOCAL_HOST || !btn) return;
  btn.disabled = true;
  btn.classList.add('remote-frozen');
  btn.title = '仅本地环境可用';
}

// 页内跳转（如品牌全景→日历）：记住来处，跳过去时保留返回栈
function navGo(view, label, restore) {
  S.nav.stack.push({ label, restore });
  switchView(view, { keepStack: true });
}
function navBack() {
  const top = S.nav.stack.pop();
  if (!top) return;
  top.restore(); // restore 自己负责把界面还原到来处
}
function renderBackBar() {
  let bar = $('#navBack');
  if (!bar) {
    bar = el('<button id="navBack" class="nav-back"></button>');
    bar.onclick = navBack;
    document.body.appendChild(bar);
  }
  const top = S.nav.stack[S.nav.stack.length - 1];
  if (top) { bar.innerHTML = `← 返回${top.label || ''}`; bar.style.display = 'flex'; }
  else bar.style.display = 'none';
}

function render() {
  const v = $('#view');
  BRAND_VARS.forEach((x) => v.style.removeProperty(x)); // 离开创作区清掉品牌主题
  if (S.view !== 'home') stopJobsPoll(); // 只在 home 可见时轮询生产中任务
  renderBackBar();
  if (S.view === 'home') renderHome(v);
  else if (S.view === 'create') renderCreate(v);
  else if (S.view === 'news') renderNews(v);
  else if (S.view === 'calendar') renderCalendar(v);
  else if (S.view === 'works') renderWorks(v);
  else if (S.view === 'draftbox') renderDraftbox(v);
  else if (S.view === 'pool') renderContentLibrary(v);
  else if (S.view === 'ledger') renderLedger(v);
  else if (S.view === 'brands') renderBrands(v);
  else if (S.view === 'styles') renderStyles(v);
  else if (S.view === 'plays') renderPlays(v);
  else if (S.view === 'history') renderHistory(v);
  else if (S.view === 'settings') renderSettings(v);
  else if (S.view === 'cli-doc') renderCliDoc(v);
}

// =========================================================
//  CLI 说明书：给「第一次来、什么都还没配」的人看
// =========================================================
function cliCmds(token = '<你的令牌>') {
  const base = location.origin;
  return {
    claude: `claude mcp add --transport http 1toall ${base}/api/cli/mcp --header "Authorization: Bearer ${token}"`,
    codex: `codex mcp add 1toall -- npx -y mcp-remote ${base}/api/cli/mcp --header "Authorization: Bearer ${token}"`,
  };
}

function codeBlock(cmd, id) {
  return `<div class="code-wrap"><pre class="code-pre">${esc(cmd)}</pre><button class="btn btn-ghost btn-sm code-copy" data-copy="${id}">复制</button></div>`;
}

async function renderCliDoc(root) {
  let machines = [];
  try { machines = await api.get('/api/cli/tokens'); } catch {}
  const c = cliCmds();
  const step = (n, title, body) => `<div class="doc-step"><span class="doc-num">${n}</span><div><b>${title}</b><div class="doc-body">${body}</div></div></div>`;
  root.innerHTML = `
    <div class="page-head"><div><div class="page-title">CLI 说明书</div>
      <div class="page-sub">把你的电脑变成一台「产能机」：网页负责派活，电脑负责真正把视频做出来。</div></div>
      <button class="btn btn-accent" id="docMint">＋ 生成接入令牌</button></div>

    <div class="doc-card">
      <div class="section-label">这是什么，为什么需要它</div>
      <p class="doc-p">这个网站能想选题、写文案、出封面——这些都在云端跑，打开就能用。<b>但剪视频不行</b>：配音、字幕对齐、转码合成这些活要占用一台真实电脑的算力和软件，服务器上没装这些东西。</p>
      <p class="doc-p">所以做视频是这样分工的：<b>你在网页上派活 → 你自己的电脑接活、干活 → 成片自动传回网页</b>。把电脑接上来的这一步，就叫「绑定 CLI」。</p>
      <p class="doc-p">CLI 指的是你电脑上装的 AI 编程助手命令行工具——<b>Claude Code</b> 或 <b>Codex</b>，两个都行，装哪个用哪个。绑定之后，它就能读到你的品牌资料、领到任务书、按规范把片子做完交回来。</p>
      <div class="doc-note">谁的电脑都可以绑，一台电脑一个令牌。你的 Mac、同事的电脑、公司的服务器，绑几台就有几台产能机，任务可以指定派给谁。</div>
    </div>

    <div class="doc-card">
      <div class="section-label">四步接上来</div>
      ${step(1, '电脑上先装好 CLI（装过就跳过）', `
        Claude Code：终端跑 <code>npm i -g @anthropic-ai/claude-code</code>，然后 <code>claude</code> 登录一次。<br>
        Codex：终端跑 <code>npm i -g @openai/codex</code>，然后 <code>codex</code> 登录一次。<br>
        <span class="hint">两个二选一即可。没装过 npm 的话先装 <a href="https://nodejs.org" target="_blank" rel="noopener">Node.js</a>。</span>`)}
      ${step(2, '在这个页面点右上角「＋ 生成接入令牌」', `
        给它起个名字（比如「477 的 Mac」），系统会给你一串令牌。<b>令牌只显示一次</b>，弹窗里会同时给出可以直接复制的绑定命令。丢了没关系，吊销旧的重发一个就行。`)}
      ${step(3, '把绑定命令粘到终端回车', `
        Claude Code 用这条（把 <code>&lt;你的令牌&gt;</code> 换成实际令牌，或直接从弹窗复制现成的）：
        ${codeBlock(c.claude, 'd1')}
        Codex 用这条：
        ${codeBlock(c.codex, 'd2')}
        <span class="hint">跑完没报错就是绑上了。可以对 CLI 说「列一下 1toall 的工具」验证一下。</span>`)}
      ${step(4, '让 CLI 自己把做视频的环境装齐', `
        绑定完直接对它说这句话：
        <div class="doc-say">调 1toall 的 get_setup_guide，带我把做视频的环境装齐</div>
        它会自检 ffmpeg、python、语音转写、中文字体、flatkey key 这些依赖，缺什么装什么，不用你自己查。
        <span class="hint">已经跑过视频流程的电脑基本都是满配，它会告诉你「无需操作」。</span>`)}
    </div>

    <div class="doc-card">
      <div class="section-label">日常怎么用</div>
      <p class="doc-p">绑好之后，你有两种派活方式，选顺手的：</p>
      <div class="doc-two">
        <div class="doc-half"><b>方式一：在网页上派</b>
          <p class="doc-p">点右下角的小狗打开派活台，用大白话说：「给 Hunter 来条 B 站长视频，讲 XX，指派给 477 的 Mac」。任务会进队列，绑定的电脑上的 CLI 主动来领。</p></div>
        <div class="doc-half"><b>方式二：直接跟 CLI 说</b>
          <p class="doc-p">在电脑终端里对 CLI 说：「用 1toall 领活」，它会自己查有没有待办任务、拿任务书、做完交回来。</p></div>
      </div>
      <div class="section-label" style="margin-top:18px">CLI 能调用的工具（不用背，说人话它自己会挑）</div>
      <div class="doc-tools">
        <div><code>status</code><span>看当前绑的是哪个工作区</span></div>
        <div><code>get_brand_brain</code><span>读品牌定位、口吻、红线</span></div>
        <div><code>list_video_channels</code><span>看有哪些视频渠道规格</span></div>
        <div><code>create_task</code><span>登记一条新任务（自己发起的活也要登记，否则系统看不见）</span></div>
        <div><code>list_open_tasks</code> / <code>claim_task</code><span>查待办 / 认领</span></div>
        <div><code>get_video_task_brief</code><span>拿完整任务书（渠道模板＋选题＋品牌大脑）</span></div>
        <div><code>upload_begin/part/commit</code><span>把成片分片传回服务器（断点续传）</span></div>
        <div><code>complete_task</code> / <code>fail_task</code><span>交付 / 报告失败</span></div>
        <div><code>report_usage</code><span>报这单实际烧的 token（账本靠它算钱）</span></div>
        <div><code>get_setup_guide</code><span>环境自检清单</span></div>
      </div>
      <div class="doc-note">⚠️ 一条重要规矩：<b>自己发起的活也要用 create_task 登记</b>。不登记的话片子做出来了，网页上的任务中心和作品库却是空的，等于白干一场没人知道。</div>
      <div class="doc-note">💰 第二条：<b>交付时把 usage 一起报上来</b>（<code>complete_task</code> 带 usage，或事后 <code>report_usage</code>）。服务器在云上，读不到你本机的会话日志——你不报，账本这单就只有产物、没有成本。</div>
    </div>

    <div class="doc-card">
      <div class="section-label">常见问题</div>
      <div class="doc-qa"><b>绑定命令报错怎么办？</b><span>先确认 <code>claude</code> 或 <code>codex</code> 命令本身能跑通（终端敲一下试试）。再确认令牌没写错、没多空格。还不行就吊销令牌重发一个。</span></div>
      <div class="doc-qa"><b>令牌丢了 / 想换电脑？</b><span>去「设置」页把旧令牌吊销（那台电脑立刻断开），重新生成一个给新电脑用。</span></div>
      <div class="doc-qa"><b>网页上派了活，电脑没反应？</b><span>确认那台电脑的 CLI 还开着、且绑定没被吊销。可以在终端对 CLI 说「用 1toall 看看有没有待办任务」手动催一下。</span></div>
      <div class="doc-qa"><b>安全吗？</b><span>令牌只在服务端存哈希，网页永远看不到明文；随时可以吊销，吊销后那台机器立刻失去访问权。</span></div>
    </div>

    <div class="doc-card">
      <div class="section-label">当前已接入的产能机</div>
      ${machines.length
        ? `<div class="list">${machines.map((m) => `<div class="list-row"><div class="lr-main"><div class="lr-title">🖥 ${esc(m.label)} <span class="hint">…${esc(m.tail || '')}</span></div><div class="lr-sub">${m.lastUsedAt ? '最近活跃 ' + esc(m.lastUsedAt.slice(0, 16).replace('T', ' ')) : '还没用过——绑定命令跑了吗？'}</div></div></div>`).join('')}</div>`
        : `<div class="hint" style="padding:10px 0">还没有任何电脑接进来。按上面四步走一遍，这里就会出现你的机器。</div>`}
    </div>`;

  $('#docMint', root).onclick = async () => {
    const a = await askText({ title: '生成 CLI 接入令牌', msg: '这个令牌给谁的电脑用？绑定后那台机器就能领活产片。', fields: [{ key: 'label', label: '备注', placeholder: '477 的 Mac / Hunter 的电脑 / 服务器' }] });
    if (!a) return;
    try {
      const r = await api.post('/api/cli/tokens', { label: a.label || 'CLI' });
      cliBindModal(r.token, a.label || 'CLI');
    } catch (e) { toast(e.message, 'err'); }
  };
  $$('[data-copy]', root).forEach((b) => b.onclick = async () => {
    const cmd = b.dataset.copy === 'd1' ? c.claude : c.codex;
    try { await navigator.clipboard.writeText(cmd); toast('已复制（记得把 <你的令牌> 换成实际令牌）', 'ok'); } catch {}
  });
}

// =========================================================
//  工作台（首页）：今天发什么，一屏看全
// =========================================================
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
function greetWord() {
  const h = new Date().getHours();
  return h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
}

async function renderHome(root) {
  root.innerHTML = `<div class="page-head"><div class="page-title">工作台</div><div class="page-sub">加载中…</div></div>`;
  let d;
  try { d = await api.get('/api/dashboard'); } catch (e) {
    root.innerHTML = `<div class="empty"><div class="em-glyph">⚠️</div><div class="em-text">${esc(e.message)}</div></div>`;
    return;
  }
  const now = new Date();
  const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日 周${WEEKDAYS[now.getDay()]}`;

  root.innerHTML = `
    <div class="home-hero">
      <div>
        <div class="home-greet">${greetWord()} · ${dateLabel}</div>
        <div class="home-headline">今天发什么？</div>
      </div>
      <button class="btn btn-accent btn-lg" id="homeIdeate">✨ 让 agent 帮我想选题</button>
    </div>

    <div id="cliBanner"></div>

    <div class="section-label">我的账号</div>
    <div class="acct-row" id="acctRow"></div>

    <div id="jobsSection" style="display:none"></div>
    <div id="costSection" style="display:none"></div>

    <div class="home-cols">
      <div class="home-col-l">
        <div class="entity-card home-card">
          <div class="hc-head"><span><i class="lic" data-icon="spark"></i>今日灵感 · 值得写</span>
            <span class="hint">${d.inspiration ? '采集于 ' + esc(relTime(d.inspiration.builtAt)) : ''}</span>
            <a class="hc-link" id="goRadar">灵感页 →</a></div>
          <div id="inspRows">${d.inspiration && d.inspiration.cards.length ? '' : '<div class="hint" style="padding:14px 0">还没有高分素材——去灵感页采集一轮。</div>'}</div>
        </div>
      </div>
      <div class="home-col-r">
        <div class="entity-card home-card">
          <div class="hc-head"><span><i class="lic" data-icon="calendar"></i>今日排期</span><a class="hc-link" id="goCal">日历 →</a></div>
          <div id="calRows">${d.todayCalendar.length ? '' : '<div class="hint" style="padding:10px 0">今天没有排期</div>'}</div>
          ${d.pendingCount ? `<div class="hint" style="margin-top:6px">全部待生成 ${d.pendingCount} 条</div>` : ''}
        </div>
        <div class="entity-card home-card">
          <div class="hc-head"><span><i class="lic" data-icon="loop"></i>最近生成</span><a class="hc-link" id="goHist">任务 →</a></div>
          <div id="recentRows">${d.recent.length ? '' : '<div class="hint" style="padding:10px 0">还没有产出，从上面的灵感或账号开工</div>'}</div>
        </div>
      </div>
    </div>`;

  // 一台产能机都没绑时，工作台顶部给一条引导——不然新人不知道视频为什么做不出来
  api.get('/api/cli/tokens').catch(() => []).then((machines) => {
    const box = $('#cliBanner', root);
    if (!box || (machines || []).length) return;
    box.innerHTML = `<div class="cli-banner">
      <img class="cb-dog" src="/brand/mark.png" alt="" />
      <div class="cb-main"><b>还没有电脑接进来，视频做不了</b>
        <p>想选题、写文案、出封面现在就能用。<b>剪视频要占一台真实电脑</b>——把你电脑上的 Claude Code 或 Codex 绑上来，它就能领活产片、成片自动传回这里。四步，几分钟搞定。</p></div>
      <button class="btn btn-accent" id="cbGo">看怎么接 →</button></div>`;
    $('#cbGo', box).onclick = () => switchView('cli-doc');
  });

  $('#homeIdeate', root).onclick = () => { switchView('create'); setTimeout(() => ideateModal(), 60); };
  $('#goRadar', root).onclick = () => switchView('news');

  // 今日灵感行：灵感中心直通工作台——每条可直接带切口+钩子进创作
  if (d.inspiration && d.inspiration.cards.length) {
    const wrap = $('#inspRows', root);
    d.inspiration.cards.forEach((c) => {
      const rowEl = el(`<div class="mini-row insp-row">
        <span class="insp-score">${esc(String(c.score))}</span>
        <div class="insp-main">
          <div class="mini-title" title="${esc(c.zhSummary || c.title)}">${esc((c.zhSummary || c.title).slice(0, 46))}</div>
          <div class="insp-sub">${esc(c.author || c.sourceName || '')}${c.angle ? ` · ${esc(c.angle.slice(0, 34))}…` : ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-wx title="从这条循序写一篇公众号">📰 写公众号</button>
        <button class="btn btn-accent btn-sm" data-make title="带切口+钩子进创作页，出全套内容">✶ 创作全套</button></div>`);
      $('[data-wx]', rowEl).onclick = () => wechatWizard(c);
      $('[data-make]', rowEl).onclick = () => newsToCreate({ text: `${c.title}\n\n切入角度：${c.angle || ''}${c.hook ? `\n首段钩子：${c.hook}` : ''}\nTaste：${c.score}/100（${c.reason || ''}）`, url: c.url });
      wrap.appendChild(rowEl);
    });
  }
  $('#goCal', root).onclick = () => switchView('calendar');
  $('#goHist', root).onclick = () => switchView('history');

  // 账号卡
  const row = $('#acctRow', root);
  d.accounts.forEach((a) => {
    const accountLogo = brandLogoUrl(a, 'compact');
    const logo = accountLogo
      ? `<img class="acct-logo" src="${esc(accountLogo)}" alt="${esc(a.name)} Logo"/>`
      : `<div class="acct-logo" style="background:linear-gradient(135deg,${esc(a.primaryColor)},${esc(a.accentColor || a.primaryColor)});display:grid;place-items:center;color:#fff;font-weight:800;font-size:17px">${esc(a.name[0])}</div>`;
    const card = el(`<div class="acct-card" style="--acct:${esc(a.primaryColor)}" data-brand="${esc(a.id)}">
      <div class="acct-badges" data-badges></div>
      <div class="acct-top">${logo}<div style="min-width:0"><div class="acct-name">${esc(a.name)}</div>
        <div class="acct-pos">${esc((a.positioning || a.tagline || '').slice(0, 30))}</div></div></div>
      ${a.redLine ? `<div class="acct-redline">🚫 ${esc(a.redLine.slice(0, 32))}</div>` : ''}
      <div class="acct-meta"><span>${a.platforms.map((p) => { const pl = getPlat(p); return pl ? pl.emoji : ''; }).join(' ')}</span>
        <span class="hint">本周 ${a.weekCount} 条</span></div>
      <div class="acct-actions">
        <button class="btn btn-ghost btn-sm" data-ideate>✨ 想选题</button>
        <button class="btn btn-primary btn-sm" data-pack>⚡ 一键内容包</button>
      </div></div>`);
    $('[data-ideate]', card).onclick = () => { S.create.brandId = a.id; switchView('create'); setTimeout(() => ideateModal(), 60); };
    $('[data-pack]', card).onclick = () => {
      S.create.brandId = a.id;
      if (a.defaultPack && a.defaultPack.length) S.create.outputs = new Set(a.defaultPack);
      S.create.project = null; S.create.results = {};
      localStorage.setItem('1toall_mode', 'simple');
      switchView('create');
      toast(`已锁定「${a.name}」，写一句话点「交给 agent」就出全套`, 'ok');
    };
    row.appendChild(card);
  });

  // 今日排期行
  if (d.todayCalendar.length) {
    const wrap = $('#calRows', root);
    d.todayCalendar.forEach((e) => {
      if (e.kind === 'radar') {
        const done = e.status === 'done';
        wrap.appendChild(el(`<div class="mini-row">
          <span class="mono-time">${esc(e.time || '')}</span>
          <span class="mini-title">⚡ 灵感采集${done && e.summary ? ` · ${esc(e.summary.split(' · ')[0])}` : ''}</span>
          <span class="rc-badge ${done ? 'done' : 'pending'}">${done ? '已采集' : '待采集'}</span></div>`));
        return;
      }
      const st = { scheduled: ['待生成', 'pending'], running: ['生成中', 'running'], done: ['完成', 'done'], partial: ['部分', 'running'], error: ['失败', 'error'] }[e.status] || ['待生成', 'pending'];
      const rowEl = el(`<div class="mini-row">
        <span class="mono-time">${esc(e.time || '09:00')}</span>
        <span class="mini-title">${esc(e.idea.slice(0, 18))}</span>
        <span class="rc-badge ${st[1]}">${st[0]}</span>
        ${e.status === 'scheduled' ? '<button class="btn btn-accent btn-sm" data-run>▶</button>' : ''}</div>`);
      const runBtn = $('[data-run]', rowEl);
      if (runBtn) runBtn.onclick = async () => {
        runBtn.disabled = true; runBtn.innerHTML = '<span class="spin"></span>';
        try { await api.post(`/api/calendar/${e.id}/run`); toast('已生成 ✓', 'ok'); } catch (err) { toast(err.message, 'err'); }
        renderHome(root);
      };
      wrap.appendChild(rowEl);
    });
  }

  // 最近生成
  if (d.recent.length) {
    const wrap = $('#recentRows', root);
    d.recent.forEach((p) => {
      const rowEl = el(`<div class="mini-row" style="cursor:pointer">
        <span class="mini-title" style="flex:1">${esc((p.title || '').slice(0, 18))}</span>
        <span class="pill">${esc(p.brandName || '无品牌')}</span>
        <span class="hint">${p.done}/${p.total}</span></div>`);
      rowEl.onclick = () => openProject(p.id);
      wrap.appendChild(rowEl);
    });
  }

  // 生产中任务（8 秒轮询，只在 home 可见时跑）
  startJobsPoll(root);
}

// =========================================================
//  生产中任务轮询（home 专属）
// =========================================================
const S_JOBS = { timer: null };

function stopJobsPoll() {
  if (S_JOBS.timer) { clearInterval(S_JOBS.timer); S_JOBS.timer = null; }
}

function startJobsPoll(root) {
  stopJobsPoll();
  const tick = () => {
    if (S.view !== 'home') { stopJobsPoll(); return; }
    refreshJobs(root);
  };
  tick();
  S_JOBS.timer = setInterval(tick, 8000);
}

async function refreshJobs(root) {
  if (!root || S.view !== 'home') return;
  let jobs = [];
  try { const jd = await api.get('/api/jobs'); jobs = Array.isArray(jd) ? jd : (jd.jobs || []); } catch (e) { return; } // 拉不到就静默跳过，不打断首页
  renderJobsSection(root, jobs);
  renderVideoCostSection(root, jobs);
  renderAcctBadges(root, jobs);
}

function jobTiming(j, now) {
  if (j.status === 'waiting_external') return '等待外部资源';
  if (j.status === 'queued') {
    const base = j.createdAt ? new Date(j.createdAt).getTime() : now;
    const hint = j.assignedTo ? ` · 指派给「${j.assignedTo}」等认领` : (S.boot && S.boot.localEngine === false ? ' · 等产能机认领' : '');
    return `排队 ${Math.max(0, Math.round((now - base) / 60000))} 分钟${hint}`;
  }
  if (j.status === 'claimed') {
    const base = j.claimedAt ? new Date(j.claimedAt).getTime() : now;
    const mins = Math.max(0, Math.round((now - base) / 60000));
    // 心跳说实话：久不报活是掉线不是在跑，别让挂钟时间冒充进度
    const beat = j.heartbeatAt ? new Date(j.heartbeatAt).getTime() : null;
    const silent = Math.round((now - (beat || base)) / 60000);
    if (silent > 90) return `产能机「${j.claimedBy || 'CLI'}」已失联 ${silent} 分钟 · 即将放回队列`;
    if (beat) return `产能机「${j.claimedBy || 'CLI'}」生产中 ${mins} 分钟 · ${silent} 分钟前报活`;
    return `产能机「${j.claimedBy || 'CLI'}」已认领 ${mins} 分钟 · 尚未报活`;
  }
  const base = j.startedAt ? new Date(j.startedAt).getTime() : (j.createdAt ? new Date(j.createdAt).getTime() : now);
  const mins = Math.max(0, Math.round((now - base) / 60000));
  return j.status === 'failed' ? `运行 ${mins} 分钟后失败` : `已运行 ${mins} 分钟`;
}

function renderJobsSection(root, jobs) {
  const sec = $('#jobsSection', root);
  if (!sec) return;
  const active = jobs.filter((j) => j.status !== 'done');
  if (!active.length) { sec.style.display = 'none'; sec.innerHTML = ''; return; }
  sec.style.display = '';
  // 长列表可折叠：任务一多就占满一屏，记住折叠状态
  const folded = localStorage.getItem('1toall_fold_jobs') === '1';
  sec.innerHTML = `<div class="section-label fold-head" id="jobsFold" role="button" tabindex="0">
      <span class="fold-caret ${folded ? '' : 'open'}">▸</span>⚙ 生产中<span class="hint">${active.length} 条${folded ? ' · 已收起' : ''}</span></div>
    <div class="jobs-row" id="jobsRow" ${folded ? 'hidden' : ''}></div>`;
  $('#jobsFold', sec).onclick = () => {
    localStorage.setItem('1toall_fold_jobs', folded ? '0' : '1');
    renderJobsSection(root, jobs);
  };
  const wrap = $('#jobsRow', sec);
  const now = Date.now();
  active.forEach((j) => {
    const brand = brandById(j.brandId);
    const dotCls = j.status === 'running' || j.status === 'claimed'
      ? 'running'
      : j.status === 'failed'
        ? 'failed'
        : j.status === 'waiting_external'
          ? 'waiting'
          : 'queued';
    const card = el(`<div class="job-card">
      <div class="job-top">
        <span class="job-dot ${dotCls}"></span>
        <span class="job-brand">${esc(brand.name)}</span>
        <span class="job-chan">${esc(j.channelLabel || '')}</span>
        <span class="job-timer">${esc(jobTiming(j, now))}</span>
      </div>
      ${j.idea ? `<div class="job-idea">${esc(j.idea.slice(0, 50))}</div>` : ''}
      ${j.logTail ? `<div class="job-log">${esc(j.logTail)}</div>` : ''}
      ${j.status === 'waiting_external' && j.error ? `<div class="job-log">${esc(j.error)}</div>` : ''}
      ${j.status === 'failed' ? `<div><button class="btn btn-ghost btn-sm" data-retry>⟳ 重跑</button></div>` : ''}
      ${j.status === 'waiting_external' ? `<div><button class="btn btn-primary btn-sm" data-resume>继续生产</button></div>` : ''}
    </div>`);
    const retryBtn = $('[data-retry]', card);
    if (retryBtn) retryBtn.onclick = () => retryJob(j.id);
    const resumeBtn = $('[data-resume]', card);
    if (resumeBtn) resumeBtn.onclick = () => resumeJob(j.id);
    wrap.appendChild(card);
  });
}

function compactTokens(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}

function costBreakdown(cost) {
  if (!cost) return '';
  return [
    `输入 ${compactTokens(cost.inputTokens)}`,
    `输出 ${compactTokens(cost.outputTokens)}`,
    `缓存写入 ${compactTokens(cost.cacheCreationInputTokens)}`,
    `缓存读取 ${compactTokens(cost.cacheReadInputTokens)}`,
  ].join(' · ');
}

function modelDisplayName(model) {
  const raw = String(model || '');
  if (raw === 'gpt-5.6-sol') return 'GPT-5.6 Sol';
  if (raw === 'glm-5.2') return 'GLM-5.2';
  if (raw === 'gpt-image-2') return 'gpt-image-2';
  return raw;
}

function costModelNames(cost) {
  if (Array.isArray(cost?.modelStack) && cost.modelStack.length) {
    const labels = cost.modelStack.map((item) => {
      const model = modelDisplayName(item.model);
      if (item.role === 'orchestration_revision') return `${model}（OpenAI Pro 统筹/修订）`;
      if (item.role === 'video_worker') return `Flatkey → ${model}（视频执行）`;
      if (item.role === 'visual_generation') return `Flatkey → ${model}（封面/视觉）`;
      if (item.role === 'voice') return `${item.provider} → ${model}（配音）`;
      return `${item.provider ? `${item.provider} → ` : ''}${model}`;
    });
    return labels.join(' · ');
  }
  const names = Array.isArray(cost?.modelNames) && cost.modelNames.length
    ? cost.modelNames
    : (cost?.models || []).map((item) => item.model).filter(Boolean);
  return names.length ? names.map(modelDisplayName).join(' + ') : '模型未记录';
}

function modelRoleName(role) {
  return {
    orchestration_revision: '统筹',
    video_worker: '执行',
    visual_generation: '视觉',
    voice: '配音',
    prompt_design: '提示词',
    content_generation: '生成',
    content_plan: '方案',
  }[role] || '模型';
}

function costModelChips(cost) {
  const stack = Array.isArray(cost?.modelStack) ? cost.modelStack : [];
  if (!stack.length) return `<span class="model-chip">${esc(costModelNames(cost))}</span>`;
  const chips = [];
  const seen = new Set();
  stack.forEach((item) => {
    const role = modelRoleName(item.role);
    const key = `${role}:${item.provider}`;
    if (seen.has(key)) return;
    seen.add(key);
    const model = item.role === 'voice' && stack.filter((x) => x.role === 'voice' && x.provider === item.provider).length > 1
      ? item.provider
      : modelDisplayName(item.model);
    chips.push(`<span class="model-chip ${esc(item.role || '')}"><i>${esc(role)}</i>${esc(model)}</span>`);
  });
  return chips.join('');
}

function costModelDetails(cost) {
  const stack = Array.isArray(cost?.modelStack) ? cost.modelStack : [];
  if (!stack.length) return '';
  return stack.map((item) => {
    const provider = item.provider ? `${item.provider} · ` : '';
    const requested = item.requestedModel ? `（请求 ${item.requestedModel}）` : '';
    return `<div class="cost-detail-row"><span>${esc(modelRoleName(item.role))}</span>
      <b>${esc(`${provider}${modelDisplayName(item.model)}${requested}`)}</b></div>`;
  }).join('');
}

function renderVideoCostSection(root, jobs) {
  const sec = $('#costSection', root);
  if (!sec) return;
  const recent = jobs
    .filter((j) => j.status === 'done' && j.cost?.totalTokens)
    .sort((a, b) => new Date(b.doneAt || b.createdAt) - new Date(a.doneAt || a.createdAt))
    .slice(0, 8);
  if (!recent.length) {
    sec.style.display = 'none';
    sec.innerHTML = '';
    return;
  }
  const dedicatedTokens = recent.reduce((sum, job) => sum + Number(job.cost.dedicatedWorkerTokens || job.cost.totalTokens || 0), 0);
  const apiEquivalentCny = recent.reduce((sum, job) => sum + Number(job.cost.apiEquivalentCny ?? job.cost.estimatedCny ?? 0), 0);
  const sharedRuns = new Map();
  recent.forEach((job) => {
    const shared = job.cost.sharedUsage;
    if (shared?.productionRunId) sharedRuns.set(shared.productionRunId, shared);
  });
  const sharedTokens = [...sharedRuns.values()]
    .reduce((sum, shared) => sum + Number(shared.usage?.totalTokens || 0), 0);
  sec.style.display = '';
  sec.innerHTML = `<div class="section-label">视频成本账本</div>
    <div class="cost-ledger">
      <div class="cost-summary">
        <div><span class="cost-summary-label">视频专属 Worker</span><b>${compactTokens(dedicatedTokens)}</b><small>Token</small></div>
        <div><span class="cost-summary-label">共享 GPT 统筹</span><b>${compactTokens(sharedTokens)}</b><small>Token</small></div>
        <div><span class="cost-summary-label">Worker API 等价</span><b>¥${apiEquivalentCny.toFixed(2)}</b><small>非实扣</small></div>
      </div>
      <div class="cost-billing-note">Flatkey、OpenAI Pro、ElevenLabs 和 Qwen 均按套餐或额度使用，实际人民币成本未按视频强行分摊。</div>
      <div class="cost-shared-list"></div>
      <div class="cost-grid"></div>
    </div>`;
  const sharedList = $('.cost-shared-list', sec);
  sharedRuns.forEach((shared) => {
    sharedList.appendChild(el(`<div class="cost-shared">
      <div class="cost-shared-copy"><span>共享统筹</span><b>${esc(shared.label || '批次共享')}</b>
        <small>${esc(`${modelDisplayName(shared.model)} · ${shared.provider} ${shared.accountPlan || ''} · 统筹 / 验收 / 修订`)}</small></div>
      <strong>${compactTokens(shared.usage?.totalTokens)} <i>Token</i></strong>
      <em>套餐内 · 未分摊</em>
    </div>`));
  });
  const grid = $('.cost-grid', sec);
  recent.forEach((job) => {
    const brand = brandById(job.brandId);
    const cost = job.cost;
    const card = el(`<article class="cost-item" title="${esc(costBreakdown(cost))}">
      <div class="cost-item-head"><div><span class="cost-item-brand">${esc(brand.name)}</span>
        <h3>${esc(job.channelLabel || job.channelId || '')}</h3></div>
        <div class="cost-item-metrics">
          <div><span>专属 Token</span><b>${compactTokens(cost.dedicatedWorkerTokens || cost.totalTokens)}</b></div>
          <div><span>API 等价</span><b>¥${Number(cost.apiEquivalentCny ?? cost.estimatedCny ?? 0).toFixed(2)}</b></div>
        </div></div>
      <div class="model-chips">${costModelChips(cost)}</div>
      <details class="cost-details"><summary>模型明细</summary>
        <div class="cost-detail-list">${costModelDetails(cost)}</div>
      </details>
    </article>`);
    grid.appendChild(card);
  });
}

// =========================================================
//  内容账本（视频 + 文字 + 图片 + 方案）
// =========================================================
const S_LEDGER = { data: null, brand: 'all', type: 'all', usage: 'all', query: '' };

async function renderLedger(root) {
  root.innerHTML = `<div class="page-head"><div class="page-title">内容账本</div>
    <div class="page-sub">平台生产过的内容统一入账。真实用量照实记录，历史缺失不补猜。</div></div>
    <div id="ledgerBody"><div class="empty"><div class="em-glyph"><span class="spin"></span></div><div class="em-text">正在汇总账本…</div></div></div>`;
  const body = $('#ledgerBody', root);
  try {
    S_LEDGER.data = await api.get('/api/ledger');
    paintLedger(body);
  } catch (e) {
    body.innerHTML = `<div class="rc-err">${esc(e.message)}</div>`;
  }
}

function ledgerSummaryHtml(summary) {
  return `<div class="ledger-summary">
    <div><span>内容总数</span><b>${summary.contentCount}</b><small>条</small></div>
    <div><span>已记录 Token</span><b>${compactTokens(summary.totalTokens)}</b><small>含共享统筹</small></div>
    <div><span>API 等价</span><b>¥${Number(summary.apiEquivalentCny || 0).toFixed(2)}</b><small>非实扣</small></div>
    <div><span>用量覆盖</span><b>${summary.coveragePct}%</b><small>${summary.recordedCount}/${summary.contentCount}</small></div>
  </div>`;
}

// 今日工作量：中央用量日志按天聚合——包含账本条目覆盖不到的平台开销（快讯蒸馏/灵感打分/选题路由等）
function ledgerTodayHtml(t) {
  if (!t) return '';
  const rows = (t.byPurpose || []).slice(0, 8).map((p) => {
    const bits = [`${p.requests} 次`];
    if (p.totalTokens) bits.push(compactTokens(p.totalTokens));
    if (p.images) bits.push(`${p.images} 张图`);
    if (p.chars) bits.push(`${fmtNum(p.chars)} 字配音`);
    if (p.cny) bits.push(`¥${p.cny.toFixed(2)}`);
    const label = { 'radar-score': '灵感打分', 'news-digest': '快讯蒸馏', ideate: '想选题', 'route-topic': '选题路由', 'draft-brand': 'AI 建号', 'ref-image': '锁人出图', generate: '内容生成', voice: '配音' }[p.purpose] || p.purpose;
    return `<span class="lt-chip" title="${esc(bits.join(' · '))}">${esc(label)} <i>${p.requests}</i></span>`;
  }).join('');
  return `<div class="ledger-today">
    <div class="lt-head">📆 今天干了多少活 <span class="hint">${esc(t.date)}</span></div>
    <div class="lt-stats">
      <div><b>${t.worksProduced}</b><span>产出内容</span></div>
      <div><b>${t.autoRuns}</b><span>自动运行</span></div>
      <div><b>${t.requests}</b><span>模型调用</span></div>
      <div><b>${compactTokens(t.totalTokens)}</b><span>Token</span></div>
      <div><b>${t.images}</b><span>出图</span></div>
      <div><b>${t.apiEquivalentCny != null ? '¥' + t.apiEquivalentCny.toFixed(2) : '—'}</b><span>API 等价（非实扣）</span></div>
    </div>
    ${rows ? `<div class="lt-chips">${rows}</div>` : ''}
  </div>`;
}

function ledgerEntryMatches(entry) {
  if (S_LEDGER.brand !== 'all' && entry.brandId !== S_LEDGER.brand) return false;
  if (S_LEDGER.type !== 'all' && entry.contentType !== S_LEDGER.type) return false;
  if (S_LEDGER.usage !== 'all' && entry.usageState !== S_LEDGER.usage) return false;
  const q = S_LEDGER.query.trim().toLowerCase();
  if (!q) return true;
  return [entry.title, entry.brandName, entry.formatLabel, ...(entry.cost?.modelNames || [])]
    .join(' ').toLowerCase().includes(q);
}

function ledgerModelDetails(cost) {
  const details = costModelDetails(cost);
  if (!details) return '';
  return `<details class="cost-details ledger-details"><summary>模型与计费明细</summary>
    <div class="cost-detail-list">${details}</div>
    ${cost?.note ? `<p>${esc(cost.note)}</p>` : ''}
  </details>`;
}

function ledgerEntryCard(entry) {
  const cost = entry.cost || {};
  const recorded = entry.usageState === 'recorded';
  const amountValue = cost.apiEquivalentCny ?? cost.estimatedCny;
  const amount = amountValue === null || amountValue === undefined
    ? '未估价'
    : `¥${Number(amountValue).toFixed(2)}`;
  const date = String(entry.at || '').slice(0, 16).replace('T', ' ');
  return el(`<article class="ledger-entry">
    <div class="ledger-entry-main">
      <div class="ledger-entry-meta"><span>${esc(entry.brandName)}</span><i>${esc(entry.contentTypeLabel)}</i><time>${esc(date)}</time></div>
      <h3>${esc(entry.title)}</h3>
      <p>${esc(entry.formatLabel)}${entry.itemCount > 1 ? ` · ${entry.itemCount} 个交付物` : ''}</p>
      <div class="model-chips">${costModelChips(cost)}</div>
      ${ledgerModelDetails(cost)}
    </div>
    <div class="ledger-entry-usage ${recorded ? '' : 'missing'}">
      <span>${recorded ? '专属 Token' : '历史用量'}</span>
      <b>${recorded ? compactTokens(cost.dedicatedWorkerTokens ?? cost.totalTokens) : '未记录'}</b>
      <small>${recorded ? amount : '模型可确认 · 不补猜'}</small>
    </div>
  </article>`);
}

function paintLedgerResults(body) {
  const entries = S_LEDGER.data?.entries || [];
  const filtered = entries.filter(ledgerEntryMatches);
  $('#ledgerResultCount', body).textContent = `${filtered.length} 条结果`;
  const list = $('#ledgerList', body);
  list.innerHTML = filtered.length ? '' : emptyHtml('▤', '没有符合当前筛选的账本记录。');
  const groups = new Map();
  filtered.forEach((entry) => {
    const key = entry.taskId || entry.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  groups.forEach((entries) => {
    const first = entries[0];
    const section = el(`<section class="ledger-task-group">
      <header><span>${esc(first.taskLabel || first.title || 'one 内容任务')}</span>
        ${first.taskId ? '<button class="btn btn-ghost btn-sm" data-open-task>查看任务</button>' : ''}</header>
      <div class="ledger-task-entries"></div></section>`);
    const open = $('[data-open-task]', section);
    if (open) open.onclick = () => openContentTask(first.taskId, 'ledger');
    const entriesWrap = $('.ledger-task-entries', section);
    entries.forEach((entry) => entriesWrap.appendChild(ledgerEntryCard(entry)));
    list.appendChild(section);
  });
}

function paintLedger(body) {
  const data = S_LEDGER.data;
  const entries = data?.entries || [];
  const brands = [...new Map(entries.map((entry) => [entry.brandId, entry.brandName])).entries()];
  const types = [['video', '视频'], ['text', '文字'], ['image', '图片'], ['plan', '方案']]
    .filter(([id]) => entries.some((entry) => entry.contentType === id));

  body.innerHTML = `${ledgerTodayHtml(data.today)}${ledgerSummaryHtml(data.summary)}
    <div class="ledger-coverage">共 ${data.summary.contentCount} 条内容；${data.summary.recordedCount} 条有真实 Token，${data.summary.missingUsageCount} 条历史内容仅保留可确认模型。金额为上游 API 参考价换算（设置页可改单价），flatkey 实扣以控制台为准。</div>
    <div class="ledger-toolbar">
      <input class="input" id="ledgerQuery" placeholder="搜索标题、品牌或模型" value="${esc(S_LEDGER.query)}"/>
      <select class="select" id="ledgerBrand"><option value="all">全部品牌</option>${brands.map(([id, name]) => `<option value="${esc(id)}" ${S_LEDGER.brand === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>
      <select class="select" id="ledgerType"><option value="all">全部类型</option>${types.map(([id, name]) => `<option value="${id}" ${S_LEDGER.type === id ? 'selected' : ''}>${name}</option>`).join('')}</select>
      <select class="select" id="ledgerUsage"><option value="all">全部用量状态</option><option value="recorded" ${S_LEDGER.usage === 'recorded' ? 'selected' : ''}>Token 已记录</option><option value="missing" ${S_LEDGER.usage === 'missing' ? 'selected' : ''}>历史未记录</option></select>
    </div>
    <div class="ledger-result-head"><span id="ledgerResultCount"></span><small>人民币金额仅展示有可靠依据的 API 等价，套餐实际扣款不强行分摊。</small></div>
    <div class="ledger-list" id="ledgerList"></div>`;

  $('#ledgerQuery', body).oninput = (event) => { S_LEDGER.query = event.target.value; paintLedgerResults(body); };
  $('#ledgerBrand', body).onchange = (event) => { S_LEDGER.brand = event.target.value; paintLedgerResults(body); };
  $('#ledgerType', body).onchange = (event) => { S_LEDGER.type = event.target.value; paintLedgerResults(body); };
  $('#ledgerUsage', body).onchange = (event) => { S_LEDGER.usage = event.target.value; paintLedgerResults(body); };
  paintLedgerResults(body);
}

async function retryJob(jobId) {
  try {
    await api.post(`/api/jobs/${jobId}/retry`);
    toast('已重新提交生产任务', 'ok');
    refreshJobs($('#view'));
  } catch (e) { toast(e.message, 'err'); }
}

async function resumeJob(jobId) {
  try {
    await api.post(`/api/jobs/${jobId}/resume`);
    toast('已恢复生产任务', 'ok');
    refreshJobs($('#view'));
  } catch (e) { toast(e.message, 'err'); }
}

function renderAcctBadges(root, jobs) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const runningByBrand = {}, newByBrand = {};
  jobs.forEach((j) => {
    if (!j.brandId) return;
    if (j.status === 'running') runningByBrand[j.brandId] = (runningByBrand[j.brandId] || 0) + 1;
    if (j.status === 'done' && (j.doneAt || '').slice(0, 10) === todayStr) newByBrand[j.brandId] = (newByBrand[j.brandId] || 0) + 1;
  });
  $$('.acct-card[data-brand]', root).forEach((card) => {
    const box = $('[data-badges]', card);
    if (!box) return;
    const id = card.dataset.brand;
    const r = runningByBrand[id] || 0, n = newByBrand[id] || 0;
    box.innerHTML = `${r ? `<span class="badge-running">⚙ ${r} 条生产中</span>` : ''}${n ? `<span class="badge-new" data-goworks>🎬 ${n} 条新片</span>` : ''}`;
    const go = $('[data-goworks]', box);
    // 新出的片还没收录，去草稿箱验收
    if (go) go.onclick = () => navGo('draftbox', '工作台', () => switchView('home'));
  });
}

// =========================================================
//  选题路由：这个想法该发哪个号
// =========================================================
async function doRoute(auto = false) {
  const c = S.create;
  if (!c.idea.trim()) return toast('先写下想法再让我选号', 'err');
  const panel = $('#routePanel');
  if (!panel) return;
  panel.innerHTML = `<div class="rc-thinking" style="padding:10px 0"><span class="spin"></span> 总编 agent 正在判断该发哪个号…</div>`;
  try {
    const r = await api.post('/api/route', { idea: c.idea });
    if (r.noBrands) {
      panel.innerHTML = '';
      panel.appendChild(renderRecoveryCard({
        icon: '🧭',
        title: '还没有品牌，先给你两条路',
        desc: '可以先按「无品牌」通用调性继续；想要以后选题能被自动路由到，30 秒 AI 帮你填一个号。',
        actions: [
          { label: '先按无品牌继续', primary: true, onClick: () => { c.brandId = 'none'; render(); toast('已切到「无品牌」，选好形态后点生成', 'ok'); } },
          { label: '30秒建个号（AI帮你填）', onClick: () => brandModal(null, { focusAI: true }) },
        ],
      }));
      return;
    }
    const V = { fit: ['✅ 适合', 'fit'], weak: ['🤔 勉强', 'weak'], reject: ['🚫 不发', 'reject'] };
    panel.innerHTML = `<div class="route-grid">${r.decisions
      .map((dec) => {
        const b = brandById(dec.brandId);
        const v = V[dec.verdict];
        return `<div class="route-card ${v[1]} ${r.best === dec.brandId ? 'best' : ''}" data-id="${dec.brandId}">
          <div class="route-head"><b>${esc(b.name)}</b><span class="route-verdict">${v[0]}</span></div>
          <div class="route-reason">${esc(dec.reason)}</div>
          ${dec.angle ? `<div class="route-angle">💡 ${esc(dec.angle)}</div>` : ''}
          ${dec.verdict !== 'reject' ? `<button class="btn ${r.best === dec.brandId ? 'btn-accent' : 'btn-ghost'} btn-sm" data-apply="${dec.brandId}" data-angle="${esc(dec.angle || '')}">${r.best === dec.brandId ? '✓ 就发这个号' : '选它'}</button>` : ''}
        </div>`;
      })
      .join('')}</div>
      ${r.best ? `<div class="hint" style="margin-top:8px">总编推荐：<b>${esc(brandById(r.best).name)}</b> — ${esc(r.bestReason)}</div>` : '<div class="hint" style="margin-top:8px">⚠️ 三个号都不合适，换个角度试试</div>'}`;
    $$('[data-apply]', panel).forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.apply;
        const acct = brandById(id);
        S.create.brandId = id;
        if (acct.defaultPack && acct.defaultPack.length && !S.create.outputs.size) S.create.outputs = new Set(acct.defaultPack);
        const angle = btn.dataset.angle;
        if (angle && !S.create.idea.includes('切入角度')) S.create.idea += `\n\n切入角度：${angle}`;
        render();
        toast(`已切到「${acct.name}」，看一眼就能生成`, 'ok');
      };
    });
  } catch (e) {
    panel.innerHTML = `<div class="rc-err">⚠️ ${esc(e.message)}</div>`;
  }
  if (auto) toast('已自动帮你判断该发哪个号', 'ok');
}

// =========================================================
//  首次引导（3 步）
// =========================================================
function maybeOnboard() {
  if (localStorage.getItem('1toall_v2_onboarded')) return;
  modal({
    title: '👋 欢迎来到 one to all',
    bodyHtml: `
      <div class="ob-step"><span class="ob-num">1</span><div><b>工作台开工</b><div class="hint">每天打开先看工作台：今日 AI 快讯、三个账号、今日排期，一屏看全「今天发什么」。</div></div></div>
      <div class="ob-step"><span class="ob-num">2</span><div><b>一句话交给 agent</b><div class="hint">创作页写一句话点「🚀 交给 agent」——自动判断发哪个号（红线自动拦，比如品牌A绝不碰 AI 客服）、自动配内容包、自动生成，你等结果就行。</div></div></div>
      <div class="ob-step"><span class="ob-num">3</span><div><b>复制即发</b><div class="hint">生成完每张卡片一键复制：视频脚本 + 封面 + 三平台文案全套。想调细节再点「专业模式」。</div></div></div>`,
    footHtml: `<button class="btn btn-accent" data-go style="width:100%">开始用 →</button>`,
    onMount: (mask, close) => {
      $('[data-go]', mask).onclick = () => { localStorage.setItem('1toall_v2_onboarded', '1'); close(); };
    },
  });
}

// =========================================================
//  创作视图（默认简单模式：一句话全自动；专业模式=完整表单）
// =========================================================
function renderCreate(root) {
  if (localStorage.getItem('1toall_mode') !== 'pro') return renderCreateSimple(root);
  renderCreatePro(root);
}

function renderCreateSimple(root) {
  const c = S.create;
  const locked = c.brandId && c.brandId !== 'none' ? brandById(c.brandId) : null;
  root.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><div class="page-title">创作</div>
        <div class="page-sub">一句话，剩下交给 agent：自动判号 → 自动配包 → 自动生成。每次生成都自动进草稿箱，不会丢。</div></div>
      <div style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" id="draftsBtn" title="每次生成都自动存一版，重新生成也不覆盖">🗂 生成历史</button>
      <button class="btn btn-ghost btn-sm" id="proMode">⚙ 专业模式</button></div>
    </div>
    <div class="simple-box">
      ${locked ? `<div class="lock-chip">📍 将发 <b>${esc(locked.name)}</b>（你指定的）<button id="unlockBrand" title="改回让 agent 判断">✕</button></div>` : ''}
      <textarea class="textarea simple-input" id="ideaInput" placeholder="想发什么？一句话就行——&#10;例如：亚马逊宠物用品差评里 40% 都在骂尺寸不准，聊聊尺码表怎么优化&#10;或者贴一条新闻、一段素材…">${esc(c.idea)}</textarea>
      <div class="mat-bar" id="matBar" hidden></div>
      <div class="simple-actions">
        <button class="btn btn-ghost" id="matBtn" title="文档 / 压缩包 / 图片都行，也可以直接拖进来或粘贴">📎 丢素材</button>
        <input type="file" id="matInput" multiple hidden accept=".txt,.md,.csv,.json,.zip,.srt,.vtt,.html,.xml,.yaml,.yml,image/*,.pdf,.docx"/>
        <button class="btn btn-ghost" id="ideateBtn">✨ 没想法？帮我想选题</button>
        <button class="btn btn-primary btn-lg" id="autoBtn" style="border-radius:999px;padding:14px 34px">🚀 交给 agent</button>
      </div>
    </div>
    <div id="autoFlow"></div>
    <div class="results" id="results" style="margin-top:18px"></div>
    <div id="heavyLine"></div>`;

  const idea = $('#ideaInput', root);
  idea.addEventListener('input', () => { c.idea = idea.value; });
  $('#proMode', root).onclick = () => { localStorage.setItem('1toall_mode', 'pro'); render(); };
  $('#draftsBtn', root).onclick = () => draftsModal();
  $('#ideateBtn', root).onclick = () => ideateModal();
  $('#autoBtn', root).onclick = () => runAuto();
  const unlock = $('#unlockBrand', root);
  if (unlock) unlock.onclick = () => { c.brandId = 'none'; c.outputs = new Set(); render(); };
  bindMaterialDrop(root, idea);
  if (c.project) renderResults(c.project);
}

// ―― 丢素材：文档/压缩包/图片，拖进来、粘贴、点按钮都行 ――
// 文本类抽正文进想法框；图片存下来当参考图（生成配图时用）
function bindMaterialDrop(root, ideaEl) {
  const c = S.create;
  c.materials = c.materials || [];
  const box = $('.simple-box', root);
  const bar = $('#matBar', root);
  const input = $('#matInput', root);
  if (!box || !bar || !input) return;

  const paint = () => {
    if (!c.materials.length) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    bar.innerHTML = c.materials.map((m, i) => `<span class="mat-chip ${m.kind === 'image' ? 'img' : ''}">
      ${m.kind === 'image' ? '🖼' : m.kind === 'file' ? '📄' : '📝'} ${esc(m.name)}
      ${m.textCount ? `<i>${m.textCount} 个文本</i>` : ''}<button data-x="${i}" title="移除">✕</button></span>`).join('');
    $$('[data-x]', bar).forEach((b) => b.onclick = () => {
      const m = c.materials[Number(b.dataset.x)];
      if (m?.kind === 'text' && m.text) {
        // 从想法框里把这段素材撤掉，别留残影
        ideaEl.value = ideaEl.value.replace(`\n\n【素材：${m.name}】\n${m.text}`, '');
        c.idea = ideaEl.value;
      }
      c.materials.splice(Number(b.dataset.x), 1);
      paint();
    });
  };

  const take = async (files) => {
    for (const f of [...files].slice(0, 8)) {
      const chip = { name: f.name || '素材', kind: 'loading' };
      c.materials.push(chip); paint();
      try {
        const dataUrl = await new Promise((res, rej) => {
          const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(f);
        });
        const r = await api.post('/api/create/material', { name: f.name, dataUrl });
        Object.assign(chip, r);
        if (r.kind === 'text' && r.text) {
          ideaEl.value += `\n\n【素材：${r.name}】\n${r.text}`;
          c.idea = ideaEl.value;
          ideaEl.scrollTop = ideaEl.scrollHeight;
        } else if (r.kind === 'note') {
          toast(r.text, 'warn');
        } else if (r.kind === 'image') {
          c.options = c.options || {};
          c.options.refImages = [...(c.options.refImages || []), r.url];
        }
        // 压缩包里的图片也当参考图收下
        if ((r.images || []).length) {
          c.options = c.options || {};
          c.options.refImages = [...(c.options.refImages || []), ...r.images.map((i) => i.url)];
        }
        paint();
      } catch (e) {
        c.materials.splice(c.materials.indexOf(chip), 1); paint();
        toast(`${f.name}：${e.message}`, 'err');
      }
    }
  };

  $('#matBtn', root).onclick = () => input.click();
  input.onchange = () => { if (input.files?.length) take(input.files); input.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('drop-on'); }));
  ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && box.contains(e.relatedTarget)) return; box.classList.remove('drop-on'); }));
  box.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) take(e.dataTransfer.files); });
  ideaEl.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); take(files); }
  });
  paint();
}

// 全自动流：判号 → 配包 → 生成。opts.skipRoute=true 时跳过路由，直接按无品牌通用调性生成（无品牌恢复卡的出路之一）
async function runAuto(opts = {}) {
  const c = S.create;
  if (!c.idea.trim()) return toast('先写一句话', 'err');
  const flow = $('#autoFlow');
  const btn = $('#autoBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin" style="border-color:rgba(255,255,255,.35);border-top-color:#fff"></span> agent 工作中…';
  try {
    let acct;
    if (c.brandId && c.brandId !== 'none') {
      acct = brandById(c.brandId);
      flow.innerHTML = `<div class="auto-step done">📍 按你指定发 <b>${esc(acct.name)}</b></div>`;
    } else if (opts.skipRoute) {
      acct = NONE_BRAND;
      c.brandId = 'none';
      flow.innerHTML = `<div class="auto-step done">✅ 不指定品牌，按内容本身最佳调性直接生成</div>`;
    } else {
      flow.innerHTML = `<div class="auto-step"><span class="spin"></span> 总编 agent 正在判断该发哪个号…</div>`;
      const r = await api.post('/api/route', { idea: c.idea });
      if (r.noBrands) {
        flow.innerHTML = '';
        flow.appendChild(renderRecoveryCard({
          icon: '🧭',
          title: '还没有品牌，先给你两条路',
          desc: '不想等的话可以先用通用调性直接出内容；想要以后选题能被自动路由到，30 秒 AI 帮你填好一个号。',
          actions: [
            { label: '先用通用调性直接生成', primary: true, onClick: () => runAuto({ skipRoute: true }) },
            { label: '30秒建个号（AI帮你填）', onClick: () => brandModal(null, { focusAI: true }) },
          ],
        }));
        return;
      }
      if (!r.best) {
        const rejects = r.decisions.map((d) => `<div class="route-card reject" style="margin-top:8px"><div class="route-head"><b>${esc(brandById(d.brandId).name)}</b><span>🚫</span></div><div class="route-reason">${esc(d.reason)}</div></div>`).join('');
        flow.innerHTML = `<div class="auto-step">🤔 三个号都不合适，agent 的理由：${rejects}<div class="hint" style="margin-top:8px">换个角度再试，或点「✨ 帮我想选题」。</div></div>`;
        return;
      }
      const dec = r.decisions.find((d) => d.brandId === r.best) || {};
      acct = brandById(r.best);
      c.brandId = r.best;
      if (dec.angle && !c.idea.includes('切入角度')) { c.idea += `\n\n切入角度：${dec.angle}`; const ta = $('#ideaInput'); if (ta) ta.value = c.idea; }
      flow.innerHTML = `<div class="auto-step done">✅ 发 <b>${esc(acct.name)}</b> — ${esc(r.bestReason || dec.reason || '')}${dec.angle ? `<div class="route-angle" style="margin-top:6px">💡 ${esc(dec.angle)}</div>` : ''}</div>`;
    }
    // 配包
    if (!c.outputs.size) c.outputs = new Set(acct.defaultPack && acct.defaultPack.length ? acct.defaultPack : ['xiaohongshu', 'cover']);
    const packNames = [...c.outputs].map((id) => { const p = getPlat(id); return p ? p.emoji + p.label : id; }).join(' · ');
    flow.innerHTML += `<div class="auto-step done">📦 内容包：${esc(packNames)}</div><div class="auto-step" id="genStep"><span class="spin"></span> 正在生成（图片较慢，卡片会陆续亮起）…</div>`;
    // 生成
    const project = await api.post('/api/projects', { idea: c.idea, brandId: c.brandId, outputs: [...c.outputs], options: c.options });
    c.project = project; c.results = {};
    renderResults(project);
    await Promise.all(project.outputs.map((o) => generateOne(project.id, o.platformId)));
    const gs = $('#genStep'); if (gs) gs.innerHTML = '🎉 全部生成完成——每张卡片都能直接复制去发';
    renderHeavyLine(project);
    toast('全部生成完成 ✓', 'ok');
  } catch (e) {
    flow.innerHTML += `<div class="rc-err" style="margin-top:8px">⚠️ ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.innerHTML = '🚀 交给 agent';
  }
}

function renderCreatePro(root) {
  const c = S.create;
  root.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><div class="page-title">把一个想法，变成所有内容</div>
        <div class="page-sub">专业模式：品牌 / 形态 / 风格 / 微调全都自己拿捏。</div></div>
      <button class="btn btn-ghost btn-sm" id="simpleMode">← 回简单模式</button>
    </div>
    <div class="create-grid">
      <div>
        <div class="section-label" style="display:flex;align-items:center;justify-content:space-between">
          <span>① 你的想法</span>
          <button class="btn btn-ghost btn-sm" id="ideateBtn" style="text-transform:none;letter-spacing:0">✨ 没想法？让 agent 帮你想选题</button>
        </div>
        <div class="idea-box">
          <textarea class="textarea" id="ideaInput" placeholder="例如：我们的 AI 客服新上线了多语言自动回复，想宣传一下它怎么帮跨境卖家半夜也能接住客户…">${esc(c.idea)}</textarea>
          <span class="idea-count" id="ideaCount"></span>
        </div>
      </div>

      <div>
        <div class="section-label" style="display:flex;align-items:center;justify-content:space-between">
          <span>② 发哪个号</span>
          <button class="btn btn-ghost btn-sm" id="routeBtn" style="text-transform:none;letter-spacing:0">🎯 帮我选号（总编 agent 判断）</button>
        </div>
        <div id="routePanel" style="margin-bottom:10px"></div>
        <div class="brand-strip" id="brandStrip"></div>
      </div>

      <div>
        <div class="section-label">③ 要变成什么（可多选）</div>
        <div class="out-groups" id="outGroups"></div>
      </div>

      <div>
        <div class="section-label" style="display:flex;align-items:center;justify-content:space-between">
          <span>④ 风格（可选）— 写作风格管文字，视觉风格管图</span>
          <a class="hint" style="cursor:pointer;color:var(--accent-ink)" id="goStyles">＋ 管理风格库</a>
        </div>
        <div class="style-pick-label">✍️ 写作风格</div>
        <div class="chip-row" id="styleStrip" style="margin-bottom:12px"></div>
        <div class="style-pick-label">🎨 视觉风格（出图用）</div>
        <div class="chip-row" id="vstyleStrip"></div>
      </div>

      <div>
        <div class="section-label">⑤ 微调（可选）</div>
        <div class="opts-row" id="optsRow"></div>
      </div>

      <div class="generate-bar">
        <div class="gb-summary" id="gbSummary"></div>
        <div class="gb-actions">
          <button class="btn btn-primary btn-lg" id="genBtn">✶ 一键生成</button>
        </div>
      </div>

      <div class="results" id="results"></div>
      <div id="heavyLine"></div>
    </div>`;

  // 想法输入
  const idea = $('#ideaInput', root);
  const count = $('#ideaCount', root);
  const updCount = () => { count.textContent = `${idea.value.length} 字`; };
  idea.addEventListener('input', () => { c.idea = idea.value; updCount(); updSummary(); });
  updCount();

  // 品牌条
  const strip = $('#brandStrip', root);
  brandList().forEach((b) => {
    const pickerLogo = brandLogoUrl(b, 'compact');
    const sw = b.synthetic
      ? `<div class="brand-swatch" style="background:repeating-linear-gradient(45deg,#eee,#eee 5px,#f7f7f7 5px,#f7f7f7 10px)"></div>`
      : pickerLogo
      ? `<img class="brand-swatch" src="${esc(pickerLogo)}" alt="${esc(b.name)} Logo"/>`
      : `<div class="brand-swatch" style="background:linear-gradient(135deg,${esc(b.primaryColor || '#999')},${esc(b.accentColor || b.primaryColor || '#666')})"></div>`;
    const node = el(`<button class="brand-pick ${c.brandId === b.id ? 'sel' : ''}" data-id="${b.id}">
      ${sw}<div><div class="bp-name">${esc(b.name)}</div><div class="bp-tag">${esc((b.tagline || '').slice(0, 16))}</div></div></button>`);
    node.addEventListener('click', () => { c.brandId = b.id; $$('.brand-pick', strip).forEach((n) => n.classList.toggle('sel', n.dataset.id === b.id)); applyBrandTheme(b); updSummary(); });
    strip.appendChild(node);
  });

  // 输出类型
  const og = $('#outGroups', root);
  (S.boot.groups || []).forEach((g) => {
    const wrap = el(`<div><div class="out-group-title">${g.emoji} ${esc(g.label)}</div><div class="chip-row"></div></div>`);
    const row = $('.chip-row', wrap);
    platformsByGroup(g.id).forEach((p) => {
      const chip = el(`<button class="chip ${c.outputs.has(p.id) ? 'sel' : ''}" data-id="${p.id}">
        <span class="chip-em">${p.emoji}</span><span>${esc(p.label)}</span><span class="chip-hint">${esc(p.hint)}</span></button>`);
      chip.addEventListener('click', () => {
        if (c.outputs.has(p.id)) c.outputs.delete(p.id); else c.outputs.add(p.id);
        chip.classList.toggle('sel'); updSummary();
      });
      row.appendChild(chip);
    });
    og.appendChild(wrap);
  });

  // 微调
  const opts = $('#optsRow', root);
  opts.appendChild(seg('语气', ['默认', '专业', '活泼', '走心', '犀利'], c.options.tone || '默认', (val) => { c.options.tone = val === '默认' ? '' : val; }));
  opts.appendChild(seg('篇幅', ['短', '中', '长'], c.options.length, (val) => { c.options.length = val; }));
  const modelWrap = el(`<div class="opt-mini"><span class="lab">模型</span></div>`);
  const sel = el(`<select class="select" style="width:auto;padding:7px 10px"></select>`);
  (S.boot.models || []).forEach((m) => { const o = el(`<option value="${m.id}">${esc(m.label)}</option>`); sel.appendChild(o); });
  sel.value = c.options.model;
  sel.addEventListener('change', () => { c.options.model = sel.value; });
  modelWrap.appendChild(sel);
  opts.appendChild(modelWrap);

  // 写作风格选择器
  const writingStyles = (S.boot.styles || []).filter((s) => s.kind === 'writing');
  const visualStyles = (S.boot.styles || []).filter((s) => s.kind === 'visual');
  buildStylePicker($('#styleStrip', root), writingStyles, 'styleId', '❍');
  buildStylePicker($('#vstyleStrip', root), visualStyles, 'vstyleId', '🎨');
  $('#goStyles', root).onclick = () => switchView('styles');

  $('#genBtn', root).addEventListener('click', runGenerate);
  $('#ideateBtn', root).addEventListener('click', () => ideateModal());
  $('#routeBtn', root).addEventListener('click', () => doRoute());
  $('#simpleMode', root).onclick = () => { localStorage.setItem('1toall_mode', 'simple'); render(); };

  applyBrandTheme(brandById(c.brandId));
  updSummary();
  // 恢复已有结果
  if (c.project) renderResults(c.project);
}

// 风格 chip 选择器（单选，写 c.options[optKey]）
function buildStylePicker(strip, list, optKey, emoji) {
  const c = S.create;
  if (!list.length) { strip.innerHTML = `<span class="hint">还没有，去「风格库」加 →</span>`; return; }
  const noneChip = el(`<button class="chip ${!c.options[optKey] ? 'sel' : ''}" data-id="">无</button>`);
  noneChip.onclick = () => { c.options[optKey] = null; $$('.chip', strip).forEach((n) => n.classList.toggle('sel', n.dataset.id === '')); };
  strip.appendChild(noneChip);
  list.forEach((st) => {
    const chip = el(`<button class="chip ${c.options[optKey] === st.id ? 'sel' : ''}" data-id="${st.id}" title="${esc((st.voice || st.desc || '').slice(0, 60))}"><span class="chip-em">${emoji}</span>${esc(st.name)}</button>`);
    chip.onclick = () => { c.options[optKey] = st.id; $$('.chip', strip).forEach((n) => n.classList.toggle('sel', n.dataset.id === st.id)); };
    strip.appendChild(chip);
  });
}

function seg(label, values, current, onPick) {
  const wrap = el(`<div class="opt-mini"><span class="lab">${esc(label)}</span><div class="seg"></div></div>`);
  const segEl = $('.seg', wrap);
  values.forEach((v) => {
    const b = el(`<button class="${v === current ? 'sel' : ''}">${esc(v)}</button>`);
    b.addEventListener('click', () => { $$('button', segEl).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); onPick(v); });
    segEl.appendChild(b);
  });
  return wrap;
}

function updSummary() {
  const c = S.create;
  const sum = $('#gbSummary');
  if (!sum) return;
  const n = c.outputs.size;
  const b = brandById(c.brandId);
  sum.innerHTML = n
    ? `品牌 <b>${esc(b.name)}</b> · 生成 <b>${n}</b> 种形态 · ${esc(c.options.length)}篇幅${c.options.tone ? ' · ' + esc(c.options.tone) : ''}`
    : `还没选要生成什么 — 在上面勾选至少一种形态`;
  const btn = $('#genBtn');
  if (btn) btn.disabled = !n || !c.idea.trim();
}

async function runGenerate() {
  const c = S.create;
  if (!c.idea.trim()) return toast('先写下你的想法', 'err');
  if (!c.outputs.size) return toast('至少选一种要生成的形态', 'err');
  const btn = $('#genBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 生成中…';
  try {
    const project = await api.post('/api/projects', {
      idea: c.idea, brandId: c.brandId, outputs: [...c.outputs], options: c.options,
    });
    c.project = project; c.results = {};
    renderResults(project);
    // 并行生成每个输出，卡片独立刷新
    await Promise.all(project.outputs.map((o) => generateOne(project.id, o.platformId)));
    renderHeavyLine(project);
    toast('全部生成完成 ✓', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false; btn.innerHTML = '✶ 一键生成';
    updSummary();
  }
}

async function generateOne(projectId, platformId) {
  setCardState(platformId, { status: 'running' });
  // 图片走两步：stage 1 只出提示词（快），确认后再制作
  const isImg = (getPlat(platformId) || {}).kind === 'image';
  try {
    const out = await api.post(`/api/projects/${projectId}/generate/${platformId}`, isImg ? { mode: 'prompt' } : {});
    S.create.results[platformId] = out;
    setCardState(platformId, out);
  } catch (e) {
    setCardState(platformId, { status: 'error', error: e.message });
  }
  updateMakeAllBtn();
}

// stage 2：用（可编辑的）提示词 + 账号通用风格/所选风格渲染图片
async function makeImage(card, out, projectId) {
  const ta = card && $('.rc-prompt', card);
  const prompt = ta ? ta.value : out.imagePrompt;
  setCardState(out.platformId, { status: 'running', kind: 'image' });
  try {
    const res = await api.post(`/api/projects/${projectId || S.create.project?.id}/render/${out.platformId}`, { prompt, vstyleId: S.create.options.vstyleId });
    S.create.results[out.platformId] = res;
    setCardState(out.platformId, res);
  } catch (e) {
    setCardState(out.platformId, { status: 'error', error: e.message });
  }
  updateMakeAllBtn();
}

// 批量制作条：还有几张图待制作时显示「一键制作全部图片」
function updateMakeAllBtn() {
  const results = $('#results');
  if (!results) return;
  let bar = $('#makeAllBar');
  const pending = Object.values(S.create.results || {}).filter((o) => o.status === 'prompt');
  if (!pending.length) { if (bar) bar.remove(); return; }
  if (!bar) { bar = el('<div id="makeAllBar"></div>'); results.parentNode.insertBefore(bar, results); }
  bar.innerHTML = `<div class="make-all-bar"><span>🎨 ${pending.length} 张图待制作 · 按${S.create.options.vstyleId ? '所选风格' : '账号通用风格'}出图</span>
    <button class="btn btn-accent btn-sm" id="makeAllBtn">🎨 一键制作全部图片</button></div>`;
  $('#makeAllBtn', bar).onclick = async () => {
    const btn = $('#makeAllBtn', bar); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 制作中…';
    for (const o of pending) await makeImage($(`.result-card[data-platform="${o.platformId}"]`), o, S.create.project?.id);
  };
}

function renderResults(project) {
  const wrap = $('#results');
  if (!wrap) return;
  wrap.innerHTML = '';
  project.outputs.forEach((o) => wrap.appendChild(resultCard(o, project.id)));
}

// 轻活生成完之后，派发重型生产线（claude 引擎渠道）
function renderHeavyLine(project) {
  const wrap = $('#heavyLine');
  if (!wrap) return;
  const brand = brandById(project.brandId);
  const channels = (brand.channels || []).filter((ch) => ch.engine === 'claude');
  if (!channels.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="section-label" style="margin-top:22px">🏋️ 重型生产线</div><div class="heavy-row" id="heavyRow"></div>`;
  const row = $('#heavyRow', wrap);
  api.get('/api/cli/tokens').catch(() => []).then((machines) => {
    channels.forEach((ch) => row.appendChild(heavyCard(ch, project, machines || [])));
  });
}

function heavyCard(ch, project, machines = []) {
  const card = el(`<div class="heavy-card">
    <div class="heavy-top"><span class="heavy-em">🏋️</span>
      <div><div class="heavy-label">${esc(ch.label || ch.id)}</div>${ch.eta ? `<div class="heavy-eta">预计 ${esc(ch.eta)}</div>` : ''}</div></div>
    ${ch.notes ? `<div class="heavy-notes">${esc(ch.notes)}</div>` : ''}
    <select class="input" data-machine style="margin-bottom:8px;font-size:12.5px">
      <option value="">任意产能机（先到先领）</option>
      ${machines.map((m) => `<option value="${esc(m.label)}">${esc(m.label)}</option>`).join('')}
    </select>
    <button class="btn btn-primary btn-sm" data-dispatch>🚀 指派生产</button></div>`);
  const btn = $('[data-dispatch]', card);
  btn.onclick = async () => {
    const assignTo = $('[data-machine]', card).value;
    btn.disabled = true; btn.innerHTML = '<span class="spin" style="border-color:rgba(255,255,255,.35);border-top-color:#fff"></span> 派发中…';
    try {
      await api.post('/api/pack/run', { brandId: project.brandId, idea: project.idea, channelIds: [ch.id], assignTo });
      btn.disabled = false;
      btn.classList.remove('btn-primary'); btn.classList.add('btn-ghost');
      btn.innerHTML = '已派发 ✓ 去工作台看进度';
      btn.onclick = () => switchView('home');
      toast(assignTo ? `已指派「${assignTo}」生产「${ch.label || ch.id}」` : `「${ch.label || ch.id}」已进队列，等产能机认领`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false; btn.innerHTML = '🚀 指派生产';
    }
  };
  return card;
}

function resultCard(out, projectId) {
  const p = getPlat(out.platformId) || { emoji: '•', label: out.platformId };
  const card = el(`<div class="result-card" data-platform="${out.platformId}" data-project="${projectId || ''}">
    <div class="rc-head"><span class="rc-em">${p.emoji}</span><span class="rc-title">${esc(p.label)}</span>
      <span class="rc-badge"></span><button class="rc-zoom" title="放大查看">⤢</button></div>
    <div class="rc-body"></div>
    <div class="rc-foot"></div></div>`);
  paintCard(card, out);
  return card;
}

function setCardState(platformId, out) {
  const card = $(`.result-card[data-platform="${platformId}"]`);
  if (card) paintCard(card, { platformId, ...out });
}

function paintCard(card, out) {
  const projectId = card.dataset.project || (S.create.project && S.create.project.id) || '';
  const badge = $('.rc-badge', card);
  const body = $('.rc-body', card);
  const foot = $('.rc-foot', card);
  body.className = 'rc-body';
  foot.innerHTML = '';
  const st = out.status || 'pending';
  const badgeText = { pending: '待生成', running: '生成中', prompt: '待制作', done: '完成', error: '失败' }[st];
  badge.className = `rc-badge ${st}`; badge.textContent = badgeText;
  // 放大查看：出了东西的卡都能全屏看（文字/图片/成品文/提示词各按自己的形态铺开）
  const zoom = $('.rc-zoom', card);
  if (zoom) {
    const zoomable = st === 'done' || st === 'prompt';
    zoom.style.display = zoomable ? '' : 'none';
    zoom.onclick = zoomable ? () => expandCard(card, out, projectId) : null;
  }

  // 图片 stage 1：提示词已出、等确认制作
  if (st === 'prompt') {
    body.classList.add('is-prompt');
    body.innerHTML = `<div class="rc-prompt-label">🎨 图片提示词（可改，确认后按账号风格出图）</div>
      <textarea class="textarea rc-prompt" rows="12">${esc(out.imagePrompt || '')}</textarea>`;
    const makeBtn = el(`<button class="btn btn-accent btn-sm">🎨 制作图片</button>`);
    makeBtn.onclick = () => makeImage(card, out, projectId);
    foot.appendChild(makeBtn);
    foot.appendChild(actionBtn('⧉ 复制提示词', () => { navigator.clipboard.writeText(out.imagePrompt || ''); toast('提示词已复制', 'ok'); }));
    return;
  }

  if (st === 'pending') { body.innerHTML = `<div class="rc-skel"><div class="skel-line w90"></div><div class="skel-line"></div><div class="skel-line w70"></div></div>`; return; }
  if (st === 'running') {
    const kind = (getPlat(out.platformId) || {}).kind;
    const word = kind === 'image' ? '正在构思画面并绘制…' : kind === 'plan' ? '正在编排脚本与分镜…' : kind === 'article_layout' ? '正在写正文并排好版…' : '小克正在动笔…';
    body.innerHTML = `<div class="rc-thinking"><span class="spin"></span> ${word}</div><div class="rc-skel"><div class="skel-line w90"></div><div class="skel-line"></div><div class="skel-line w50"></div></div>`;
    return;
  }
  if (st === 'error') { body.innerHTML = `<div class="rc-err">⚠️ ${esc(out.error || '生成失败')}</div>`; foot.appendChild(retryBtn(out.platformId)); return; }

  // done
  if (out.kind === 'image') {
    body.classList.add('is-image');
    body.innerHTML = `<img src="${esc(out.imageUrl)}" alt=""/>`;
    foot.appendChild(actionBtn('↧ 下载图片', () => downloadUrl(out.imageUrl, out.platformId)));
    foot.appendChild(actionBtn('⟳ 重画', () => regen(out.platformId)));
  } else if (out.kind === 'article_layout') {
    body.classList.add('is-article');
    if (out.qc) foot.appendChild(qcChip(out.qc, card, out, projectId));
    const hasPlaceholder = /\[\[\s*配图/.test(out.content || '');
    const frameSrc = `/api/article/${projectId}/html?platformId=${out.platformId}&t=${Date.now()}`;
    body.innerHTML = `
      <div style="font-weight:700;font-size:14.5px;margin-bottom:6px;line-height:1.4">${esc(out.title || '')}</div>
      ${out.digest ? `<div style="font-size:12.5px;color:var(--ink-3);margin-bottom:10px;line-height:1.5">${esc(out.digest)}</div>` : ''}
      <div style="border:1px solid var(--hair-strong);border-radius:12px;overflow:hidden;background:#fff">
        <iframe style="width:100%;height:420px;border:0;display:block" src="${frameSrc}"></iframe>
      </div>`;
    if (out.quality) foot.appendChild(qualityChip(out.quality));
    if (hasPlaceholder) {
      const mkBtn = el(`<button class="btn btn-accent btn-sm" data-mkimg>🎨 生成配图</button>`);
      mkBtn.onclick = () => makeArticleImages(card, out, projectId, mkBtn);
      foot.appendChild(mkBtn);
    }
    foot.appendChild(actionBtn('📱 手机预览', () => previewArticleModal(out, projectId)));
    foot.appendChild(actionBtn('⧉ 复制 HTML', () => copyArticleHtml(out, projectId)));
    if ((out.images || []).length) {
      foot.appendChild(actionBtn(`↧ 下载图片（${out.images.length}张）`, () => downloadArticleImages(out)));
    }
    foot.appendChild(actionBtn('📕 改写成小红书', (e) => deriveXiaohongshu(out, projectId, e.currentTarget)));
    foot.appendChild(actionBtn('✎ 编辑', () => editText(card, out, projectId)));
    foot.appendChild(actionBtn('⟳ 重写', () => regen(out.platformId)));
  } else {
    body.innerHTML = `<div class="rc-text">${mdToHtml(out.content || '')}</div>`;
    if (out.qc) foot.appendChild(qcChip(out.qc, card, out, projectId));
    if (out.quality) foot.appendChild(qualityChip(out.quality));
    if (out.edited) foot.appendChild(el(`<span class="q-chip" style="background:var(--accent-soft);color:var(--accent-ink)">✎ 已手动编辑</span>`));
    foot.appendChild(actionBtn('✎ 编辑', () => editText(card, out, projectId)));
    foot.appendChild(actionBtn('⧉ 复制', () => { navigator.clipboard.writeText(out.content || ''); toast('已复制到剪贴板', 'ok'); }));
    foot.appendChild(actionBtn('↧ 下载', () => downloadText(out.content || '', `${out.platformId}.md`)));
    foot.appendChild(actionBtn('⟳ 重写', () => regen(out.platformId)));
  }
}

// 放大查看：把卡片内容铺到大窗里看全（提示词可改，关窗回填卡片，别让人在小框里改长提示词）
function expandCard(card, out, projectId) {
  const p = getPlat(out.platformId) || { emoji: '•', label: out.platformId };
  const st = out.status || 'done';
  let bodyHtml;
  if (st === 'prompt') {
    const cur = (card && $('.rc-prompt', card)?.value) || out.imagePrompt || '';
    bodyHtml = `<div class="rc-prompt-label">🎨 图片提示词（可改，关窗自动回填卡片）</div>
      <textarea class="textarea zoom-prompt" rows="20">${esc(cur)}</textarea>`;
  } else if (out.kind === 'image') {
    bodyHtml = `<div class="zoom-img"><img src="${esc(out.imageUrl)}" alt="${esc(p.label)}"/></div>`;
  } else if (out.kind === 'article_layout') {
    bodyHtml = `<div class="zoom-article-title">${esc(out.title || '')}</div>
      ${out.digest ? `<div class="hint" style="margin-bottom:12px">${esc(out.digest)}</div>` : ''}
      <iframe class="zoom-frame" src="/api/article/${projectId}/html?platformId=${out.platformId}&t=${Date.now()}"></iframe>`;
  } else {
    bodyHtml = `<div class="rc-text zoom-text">${mdToHtml(out.content || '')}</div>`;
  }
  const copyPayload = () => (st === 'prompt'
    ? ($('.zoom-prompt', mask)?.value || '')
    : out.kind === 'image' ? (location.origin + out.imageUrl) : (out.content || ''));
  const { mask, close } = modal({
    title: `${p.emoji} ${p.label}`,
    bodyHtml,
    footHtml: `<button class="btn btn-ghost" data-copy>⧉ 复制</button><button class="btn btn-accent" data-close>关闭</button>`,
    onMount: (m, closeFn) => {
      m.querySelector('.modal').classList.add('modal-zoom');
      $('[data-copy]', m).onclick = () => { navigator.clipboard.writeText(copyPayload()); toast('已复制', 'ok'); };
      const done = () => {
        // 提示词改动回填卡片，制作图片时用的就是改过的这版
        const big = $('.zoom-prompt', m);
        const small = card && $('.rc-prompt', card);
        if (big && small) small.value = big.value;
        closeFn();
      };
      $('[data-close]', m).onclick = done;
      m.addEventListener('click', (e) => { if (e.target === m) done(); });
    },
  });
  return { mask, close };
}

// 质检徽章：分数+结论，点开问题清单与曝光预测；不过关可一键按意见重写
function qcChip(qc, card, out, projectId) {
  const cls = qc.verdict === 'pass' ? 'ok' : qc.verdict === 'warn' ? 'warn' : 'fail';
  const label = { pass: '质检通过', warn: '质检提醒', fail: '质检不过' }[qc.verdict] || '质检';
  const chip = el(`<button class="qc-chip qc-${cls}" title="点开看问题清单与曝光预测">🩺 ${label} ${qc.score}</button>`);
  chip.onclick = () => qcModal(qc, out, projectId);
  return chip;
}

function qcModal(qc, out, projectId) {
  const p = getPlat(out.platformId) || { label: out.platformId };
  const dimRow = (label, v) => `<div class="qc-dim"><span>${label}</span><b>${v}</b><i>/25</i></div>`;
  const issues = (qc.issues || []).map((i) => `<div class="qc-issue qc-sev-${i.severity}">
    <div class="qi-head"><span class="qi-dim">${esc({ typo: '错别字', voice: '口吻', redline: '红线', structure: '结构' }[i.dim] || i.dim)}</span><span class="qi-sev">${{ low: '轻', mid: '中', high: '重' }[i.severity] || ''}</span></div>
    ${i.quote ? `<blockquote>${esc(i.quote)}</blockquote>` : ''}
    <p>${esc(i.why)}${i.fix ? ` → <b>${esc(i.fix)}</b>` : ''}</p></div>`).join('');
  const ex = qc.exposure;
  const exHtml = ex ? `<div class="section-label" style="margin-top:14px">📈 发布前曝光预测</div>
    <div class="qc-exposure"><div class="qe-score">${ex.score}<small>/100</small></div>
      <div class="qe-main"><b>预计播放 ${fmtNum(ex.range?.[0])} – ${fmtNum(ex.range?.[1])}</b>
        <div class="hint">${{ high: '依据充分', mid: '依据一般', low: '冷启动预估，仅供参考' }[ex.confidence] || ''} · 账号基础 ${ex.factors?.account} · 内容力 ${ex.factors?.content} · 账号势能 ${ex.factors?.momentum}</div>
        <div class="hint">最弱一环：${{ account: '账号基础（先把号养起来）', content: '内容力（换个更狠的标题/钩子）', momentum: '账号势能（保持更新频率）' }[ex.weakest] || '—'}</div></div></div>` : '';
  modal({
    title: `🩺 质检 · ${p.label} · ${qc.score} 分`,
    bodyHtml: `
      <div class="qc-dims">${dimRow('错别字', qc.dims?.typo)}${dimRow('口吻', qc.dims?.voice)}${dimRow('红线', qc.dims?.redline)}${dimRow('结构', qc.dims?.structure)}</div>
      ${issues ? `<div class="section-label" style="margin-top:12px">问题清单</div>${issues}` : '<div class="hint" style="padding:8px 0">没发现具体问题。</div>'}
      ${(qc.suggestions || []).length ? `<div class="hint" style="margin-top:8px">建议：${qc.suggestions.map(esc).join('；')}</div>` : ''}
      ${exHtml}`,
    footHtml: `${qc.verdict !== 'pass' ? '<button class="btn btn-primary" data-fix>✎ 按质检意见重写</button>' : ''}<button class="btn btn-ghost" data-requeue>⟳ 重新质检</button><button class="btn btn-accent" data-x>关闭</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $('[data-requeue]', mask).onclick = async (ev) => {
        ev.target.disabled = true; ev.target.innerHTML = '<span class="spin"></span> 质检中…';
        try { const r = await api.post(`/api/qc/${projectId}/${out.platformId}`); toast(`复检完成：${r.score} 分`, 'ok'); close(); setCardState(out.platformId, { ...out, qc: r }); }
        catch (e) { toast(e.message, 'err'); ev.target.disabled = false; ev.target.textContent = '⟳ 重新质检'; }
      };
      const fixBtn = $('[data-fix]', mask);
      if (fixBtn) fixBtn.onclick = async (ev) => {
        ev.target.disabled = true; ev.target.innerHTML = '<span class="spin"></span> 重写中…';
        const fixNote = (qc.issues || []).map((i) => `- ${i.quote ? `「${i.quote}」` : i.dim}：${i.fix || i.why}`).join('\n');
        try {
          setCardState(out.platformId, { platformId: out.platformId, status: 'running' });
          close();
          const r = await api.post(`/api/projects/${projectId}/generate/${out.platformId}`, { idea: null, qcFix: fixNote });
          setCardState(out.platformId, r);
          toast('已按质检意见重写，稍后自动复检', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      };
    },
  });
}

// 卡片内直接改文字
function editText(card, out, projectId) {
  const body = $('.rc-body', card);
  const foot = $('.rc-foot', card);
  body.className = 'rc-body';
  body.innerHTML = `<textarea class="textarea rc-edit" style="width:100%;min-height:300px;border:none;font-size:13.5px;line-height:1.7">${esc(out.content || '')}</textarea>`;
  foot.innerHTML = '';
  const ta = $('.rc-edit', body);
  ta.focus();
  foot.appendChild(actionBtn('✗ 取消', () => paintCard(card, out)));
  const saveBtn = el(`<button class="btn btn-accent btn-sm">✓ 保存</button>`);
  saveBtn.onclick = async () => {
    const content = ta.value;
    saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    try {
      if (projectId) await api.put(`/api/projects/${projectId}/output/${out.platformId}`, { content });
      out.content = content; out.edited = true;
      if (S.create.results[out.platformId]) S.create.results[out.platformId].content = content;
      paintCard(card, out);
      toast('已保存修改 ✓', 'ok');
    } catch (e) { toast(e.message, 'err'); saveBtn.disabled = false; saveBtn.textContent = '✓ 保存'; }
  };
  foot.appendChild(saveBtn);
}

// ---------- 公众号成品文卡片的专属操作 ----------

// 两步创作第二步：给正文里剩下的 [[配图: ...]] 占位符补图（可重复点，只处理还没解析的占位符）
async function makeArticleImages(card, out, projectId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 配图生成中…'; }
  try {
    const updated = await api.post(`/api/article/${projectId}/images`, { platformId: out.platformId });
    S.create.results[out.platformId] = updated;
    paintCard(card, updated);
    toast('配图已生成 ✓', 'ok');
  } catch (e) {
    toast(e.message, 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = '🎨 生成配图'; }
  }
}

// 手机宽度（375px）弹窗预览，最接近真实公众号阅读体验
function previewArticleModal(out, projectId) {
  const src = `/api/article/${projectId}/html?platformId=${out.platformId}&t=${Date.now()}`;
  modal({
    title: `📱 手机预览 · ${out.title || ''}`,
    bodyHtml: `<div style="display:flex;justify-content:center;background:#f0f0f0;padding:16px;border-radius:12px">
      <iframe style="width:375px;max-width:100%;height:70vh;border:1px solid var(--hair-strong);border-radius:20px;background:#fff" src="${src}"></iframe>
    </div>`,
    footHtml: `<button class="btn btn-ghost" data-x>关闭</button>`,
    onMount: (mask, close) => { $('[data-x]', mask).onclick = close; },
  });
}

// 复制微信可直接粘贴的内联样式 HTML（和预览用的是同一个端点，所见即所得）
async function copyArticleHtml(out, projectId) {
  try {
    const html = await fetch(`/api/article/${projectId}/html?platformId=${out.platformId}`).then((r) => {
      if (!r.ok) throw new Error(`导出失败 ${r.status}`);
      return r.text();
    });
    await navigator.clipboard.writeText(html);
    toast('HTML 已复制，去公众号后台粘贴 ✓', 'ok');
  } catch (e) {
    toast('复制失败：' + e.message, 'err');
  }
}

// 图片包下载 v1：逐张触发下载（没有 zip 依赖，错峰点击避免浏览器拦截多文件下载）
function downloadArticleImages(out) {
  const images = (out.images || []).filter((img) => img.url);
  if (!images.length) return toast('还没有配图', 'err');
  images.forEach((img, i) => {
    setTimeout(() => downloadUrl(img.url, `${out.platformId}-${img.role || 'img'}-${i + 1}`), i * 260);
  });
  toast(`开始下载 ${images.length} 张图片`, 'ok');
}

// 一键派生：把公众号成品文正文喂给 xiaohongshu 形态改写版式（复用现成生成链路，不重新造）
async function deriveXiaohongshu(out, projectId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 改写中…'; }
  try {
    const idea = `${out.title ? '标题：' + out.title + '\n\n' : ''}${out.content || ''}`;
    const derived = await api.post(`/api/projects/${projectId}/generate/xiaohongshu`, { idea });
    S.create.results.xiaohongshu = derived;
    let target = $('.result-card[data-platform="xiaohongshu"]');
    if (target) paintCard(target, derived);
    else { target = resultCard(derived, projectId); $('#results').appendChild(target); }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('已改写成小红书图文 ✓', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '📕 改写成小红书'; }
  }
}

function qualityChip(q) {
  if (q.passed) return el(`<span class="q-chip ok" title="没扫到 AI 套话 / 禁用词">✓ 已过质检</span>`);
  const detail = (q.flags || []).map((f) => `${f.term}×${f.count}`).join('、');
  const chip = el(`<span class="q-chip warn">⚠ ${q.flags.length} 处待看</span>`);
  chip.title = '命中：' + detail;
  return chip;
}

function actionBtn(label, fn) { const b = el(`<button class="btn btn-ghost btn-sm">${esc(label)}</button>`); b.addEventListener('click', fn); return b; }
function retryBtn(platformId) { return actionBtn('⟳ 重试', () => regen(platformId)); }
function regen(platformId) { if (S.create.project) generateOne(S.create.project.id, platformId); }

function downloadText(text, name) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadUrl(url, name) { const a = document.createElement('a'); a.href = url; a.download = `${name}-${Date.now()}.png`; a.click(); }

// 选题 agent 弹窗：给方向 → agent 出 5 个可勾选选题（可带运营玩法 / 预填方向，如今日新闻）
function ideateModal(play, presetDirection) {
  const c = S.create;
  const b = brandById(c.brandId);
  modal({
    title: '✨ 让 agent 帮你想选题',
    bodyHtml: `
      <div class="hint" style="margin-bottom:8px">给个大致方向或一句话素材，agent 会按品牌「${esc(b.name)}」的受众和调性${play ? `、用「${esc(play.name)}」玩法` : ''}，帮你想 5 个能发的选题。</div>
      ${play ? `<div class="ec-tag" style="margin-bottom:8px;color:var(--accent-ink)">⋄ 玩法：${esc(play.play)}</div>` : ''}
      <textarea class="textarea" id="ideateDir" rows="${presetDirection ? 6 : 3}" placeholder="例如：想围绕『AI 客服怎么帮卖家省钱』做一个系列；或：最近旺季快到了，想发点备战内容…">${esc(presetDirection || c.idea || '')}</textarea>
      <div style="margin-top:10px"><button class="btn btn-accent" id="ideateRun">✨ 生成选题</button></div>
      <div id="ideateResults" style="margin-top:6px"></div>`,
    footHtml: `<button class="btn btn-ghost" data-x>关闭</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      const run = $('#ideateRun', mask);
      const results = $('#ideateResults', mask);
      run.onclick = async () => {
        const direction = $('#ideateDir', mask).value.trim();
        if (!direction) return toast('先给个方向', 'err');
        run.disabled = true; run.innerHTML = '<span class="spin"></span> agent 思考中…';
        results.innerHTML = '';
        try {
          const { topics } = await api.post('/api/ideate', { direction, brandId: c.brandId, play: play ? `${play.name}：${play.play}` : null });
          results.innerHTML = `<div class="section-label" style="margin:14px 0 8px">挑一个，点「采用」自动填好</div>`;
          topics.forEach((t) => {
            const pills = (t.outputs || []).map((id) => { const p = getPlat(id); return `<span class="pill">${p ? p.emoji + ' ' + esc(p.label) : esc(id)}</span>`; }).join('');
            const row = el(`<div class="entity-card" style="padding:14px;margin-bottom:10px">
              <div style="font-weight:700;font-size:14.5px">${esc(t.title)}</div>
              <div style="font-size:12.5px;color:var(--ink-3);margin:5px 0 8px">${esc(t.angle)}${t.reason ? ' · ' + esc(t.reason) : ''}</div>
              <div class="lr-pills" style="margin-bottom:10px">${pills}</div>
              <button class="btn btn-primary btn-sm" data-use>采用这个</button></div>`);
            $('[data-use]', row).onclick = () => {
              c.idea = t.angle ? `${t.title}\n\n切入角度：${t.angle}` : t.title;
              if (t.outputs && t.outputs.length) c.outputs = new Set(t.outputs);
              c.project = null; c.results = {};
              close(); render(); toast('已填好，看一眼就能生成', 'ok');
            };
            results.appendChild(row);
          });
        } catch (e) {
          results.innerHTML = `<div class="rc-err" style="margin-top:12px">⚠️ ${esc(e.message)}</div>`;
        } finally {
          run.disabled = false; run.innerHTML = '✨ 重新生成选题';
        }
      };
    },
  });
}

// =========================================================
//  灵感雷达（Podcast / YouTube / X → Taste 打分 → 一键转创作）
// =========================================================
const S_NEWS = { data: null, loading: false };

async function renderNews(root) {
  root.innerHTML = `<div class="page-head"><div class="page-title">灵感雷达</div>
    <div class="page-sub">Podcast、YouTube、X 每日采集；先按 Hunter 的 Taste 打分，再把值得写的素材送进创作。</div></div>
    <div id="newsBody"></div>`;
  const body = $('#newsBody', root);
  if (S_NEWS.data) return paintInspiration(body, S_NEWS.data);
  loadNews(body, false);
}

async function loadNews(body, refresh) {
  if (S_NEWS.loading) return;
  S_NEWS.loading = true;
  body.innerHTML = `<div class="empty"><div class="em-glyph"><span class="spin"></span></div>
    <div class="em-text">正在采集 Podcast、YouTube 与 X，并按 Taste 评分…<br>第一次加载约需 1 分钟，之后 6 小时内秒开。</div></div>`;
  try {
    S_NEWS.data = await api.get('/api/inspiration' + (refresh ? '?refresh=1' : ''));
    paintInspiration(body, S_NEWS.data);
  } catch (e) {
    body.innerHTML = `<div class="rc-err">⚠️ ${esc(e.message)}</div>
      <div style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="newsRetry">⟳ 重试</button></div>`;
    $('#newsRetry', body).onclick = () => loadNews(body, refresh);
  } finally {
    S_NEWS.loading = false;
  }
}

function paintInspiration(body, d) {
  const all = d.cards || [];
  const srcLabel = { podcast: '🎧 Podcast', youtube: '▶ YouTube', x: '𝕏 X' };
  const tierLabel = { must: '必写', strong: '值得写', watch: '观察', skip: '跳过' };
  const srcCounts = {
    podcast: all.filter((x) => x.source === 'podcast').length,
    youtube: all.filter((x) => x.source === 'youtube').length,
    x: all.filter((x) => x.source === 'x').length,
  };
  const TYPES = [['podcast', '🎙️', '播客'], ['youtube', '▶️', 'YouTube'], ['x', '🐦', 'X'], ['blog', '📝', '博客'], ['media', '📰', '媒体']];
  const typeCount = (t) => all.filter((x) => x.source === t).length;
  const builtAgo = d.builtAt ? relTime(d.builtAt) : '';
  // 打分依据悬停卡：reason + 四维分解 + 信号
  const scoreTip = (c) => {
    const dim = c.dimensions || {};
    const row = (label, v, max) => v == null ? '' : `<div class="st-dim"><span>${label}</span><b>${esc(String(v))}</b><i>/${max}</i></div>`;
    // 信源权威度加权说清楚：分数不是凭空的，官方/创始人加分、builder 降权
    const authRow = c.authorityLabel
      ? `<div class="st-auth"><span>信源 <b>${esc(c.authorityLabel)}</b></span>${c.authorityBonus ? `<i class="${c.authorityBonus > 0 ? 'up' : 'down'}">${c.authorityBonus > 0 ? '+' : ''}${c.authorityBonus} 权威加权</i>` : ''}${c.rawScore != null && c.authorityBonus ? `<i>原始 ${c.rawScore}</i>` : ''}</div>`
      : '';
    return `<div class="score-tip"><div class="st-reason">${esc(c.reason || '')}</div>
      <div class="st-dims">${row('相关', dim.relevance, 35)}${row('新意', dim.novelty, 25)}${row('证据', dim.evidence, 20)}${row('故事', dim.story, 20)}</div>
      ${authRow}
      ${(c.signals || []).length ? `<div class="st-signals">${(c.signals || []).map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}</div>`;
  };
  body.innerHTML = `<div class="radar-toolbar">
    <div><b>${all.length}</b> 条素材${builtAgo ? ` · 采集于 ${esc(builtAgo)}` : ''}</div>
    <div class="radar-actions"><button class="btn btn-ghost btn-sm" data-filter="all">全部分</button><button class="btn btn-ghost btn-sm" data-filter="70">70+</button><button class="btn btn-accent btn-sm" id="newsRefresh">⟳ 重新采集评分</button></div>
  </div>
  <div class="chip-row radar-src-filter" style="margin-bottom:8px">
    <button class="chip sel" data-src="all"><span class="chip-em">✦</span>全部 <span class="chip-hint">${all.length}</span></button>
    ${TYPES.filter(([t]) => typeCount(t) > 0).map(([t, em, label]) => `<button class="chip" data-src="${t}"><span class="chip-em">${em}</span>${label} <span class="chip-hint">${typeCount(t)}</span></button>`).join('')}
  </div>
  <div class="chip-row radar-age-filter" style="margin-bottom:16px">
    <button class="chip sel" data-age="1"><span class="chip-em">🕘</span>今天</button>
    <button class="chip" data-age="2">48小时</button>
    <button class="chip" data-age="7">本周</button>
  </div>
  <div class="radar-grid" id="radarGrid"></div>`;
  const grid = $('#radarGrid', body);
  // 默认只看今天（477 定）；最宽也就本周 7 天。没日期的素材只在「本周」档露出。
  let curMin = 0, curSrc = 'all', curAge = '1';
  const inAge = (x) => {
    if (!x.publishedAt) return curAge === '7';
    return Date.now() - new Date(x.publishedAt).getTime() <= Number(curAge) * 86400000;
  };
  const draw = () => {
    grid.innerHTML = '';
    const shown = all.filter((x) => x.score >= curMin && (curSrc === 'all' || x.source === curSrc) && inAge(x));
    if (!shown.length) { grid.innerHTML = '<div class="hint" style="padding:14px 4px">这个筛选下没有素材——放宽时间或来源试试。</div>'; return; }
    shown.forEach((card) => {
      const when = card.publishedAt ? relTime(card.publishedAt) : '时间未知';
      const whenFull = card.publishedAt ? new Date(card.publishedAt).toLocaleString('zh-CN', { hour12: false }) : '';
      // 顺序：中文总结（标题位）→ 原帖内容（原文标题+摘要引用块）→ 作者 → 建议切口 → 标签
      const headline = card.zhSummary || card.title;
      const originTitle = card.zhSummary ? card.title : '';
      const originText = String(card.summary || '');
      const showOrigin = originTitle || (originText && originText !== headline);
      const node = el(`<article class="radar-card tier-${esc(card.tier)}">
        <div class="radar-card-top"><span class="radar-source">${srcLabel[card.source] || esc(card.source)}</span>
          <span class="radar-date" title="${esc(whenFull)}">${esc(when)}</span>
          <span class="score-wrap"><span class="radar-score">${esc(String(card.score))}</span>${scoreTip(card)}</span></div>
        <div class="radar-signals top">${(card.signals || []).map((s) => `<span>${esc(s)}</span>`).join('')}</div>
        <h3>${esc(headline)}</h3>
        <div class="radar-meta">${esc(card.sourceName || '')} · ${tierLabel[card.tier] || ''}</div>
        ${showOrigin ? `<div class="radar-origin">${originTitle ? `<b>${esc(String(originTitle).slice(0, 90))}</b>` : ''}${originText ? `<p>${esc(originText.slice(0, 150))}${originText.length > 150 ? '…' : ''}</p>` : ''}</div>` : ''}
        <div class="radar-author">👤 <b>${esc(card.author || card.sourceName || '来源未署名')}</b>${card.authorBio ? ` — ${esc(card.authorBio)}` : ''}</div>
        <div class="radar-angle${card.hook ? ' has-hook' : ''}"><b>建议切口${card.hook ? '<i class="hook-cue">✍️ 悬停看首段钩子</i>' : ''}</b>${esc(card.angle || '')}
          ${card.hook ? `<span class="hook-tip"><b>公众号首段钩子</b><p>${esc(card.hook)}</p></span>` : ''}</div>
        <footer><a class="btn btn-ghost btn-sm" href="${esc(safeHref(card.url))}" target="_blank" rel="noopener">查看来源</a><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-wx>📰 写公众号</button><button class="btn btn-accent btn-sm" data-use>✶ 用它创作</button></span></footer>
      </article>`);
      // 钩子/打分依据：悬停浮出，点一下钉住（同时只钉一个，方便对着念稿）
      $$('.radar-angle.has-hook, .score-wrap', node).forEach((el2) => el2.onclick = (ev) => {
        ev.stopPropagation();
        const on = el2.classList.contains('pinned');
        $$('.pinned').forEach((p) => p.classList.remove('pinned'));
        if (!on) el2.classList.add('pinned');
      });
      $('[data-wx]', node).onclick = () => wechatWizard(card);
      $('[data-use]', node).onclick = () => newsToCreate({ text: `${card.title}\n\n切入角度：${card.angle}${card.hook ? `\n首段钩子：${card.hook}` : ''}\nTaste：${card.score}/100（${card.reason || ''}）`, url: card.url });
      grid.appendChild(node);
    });
  };
  draw();
  $$('[data-filter]', body).forEach((b) => b.onclick = () => { curMin = b.dataset.filter === 'all' ? 0 : Number(b.dataset.filter); draw(); });
  $$('[data-src]', body).forEach((c) => c.onclick = () => {
    curSrc = c.dataset.src;
    $$('[data-src]', body).forEach((x) => x.classList.toggle('sel', x === c));
    draw();
  });
  $$('[data-age]', body).forEach((c) => c.onclick = () => {
    curAge = c.dataset.age;
    $$('[data-age]', body).forEach((x) => x.classList.toggle('sel', x === c));
    draw();
  });
  $('#newsRefresh', body).onclick = () => { S_NEWS.data = null; loadNews(body, true); };
}

// ―― 公众号向导：从灵感素材一步一页发起一篇公众号 ――
// 流程：确认切口/钩子 → 选账号+笔法 → 标题三选一 → gongzhonghao_pub 管线成文（自动进草稿箱）
// 向导统一用宽窗，长文本框随内容自动长高——别让人在小框里读半截钩子
function wxWide(mask) {
  mask.querySelector('.modal')?.classList.add('modal-wide');
  $$('.wx-grow', mask).forEach((ta) => {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 360)}px`; };
    ta.addEventListener('input', fit);
    fit();
  });
}

function wechatWizard(card) {
  const realBrands = (S.boot?.brands || []); // 「无品牌」不算，公众号总得挂在某个号下
  // 默认笔法 = 从 Hunter 实文蒸馏的公众号文风（存在时）
  const wxDefaultStyle = (S.boot?.styles || []).find((s) => s.kind === 'writing' && /公众号文风/.test(s.name || ''));
  const wx = {
    angle: card.angle || '', hook: card.hook || '',
    brandId: (realBrands[0] || {}).id || 'none', styleId: wxDefaultStyle?.id || '',
    title: '', digest: '', titles: [],
  };
  step1();

  function step1() {
    modal({
      title: '写公众号 1/4 · 确认素材与切口',
      bodyHtml: `
        <div class="wx-src"><b>${esc(card.zhSummary || card.title)}</b>
          <p>${esc(String(card.summary || card.title).slice(0, 320))}</p>
          <span>👤 ${esc(card.author || card.sourceName || '来源未署名')}</span></div>
        <label class="field"><span class="lab">切入角度（站在账号风格上）</span><textarea class="textarea wx-grow" id="wx_angle" rows="3">${esc(wx.angle)}</textarea></label>
        <label class="field"><span class="lab">首段钩子（成文第一段的底子，可改）</span><textarea class="textarea wx-grow" id="wx_hook" rows="6">${esc(wx.hook)}</textarea></label>`,
      footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-next>下一步：选账号 →</button>`,
      onMount: (mask, close) => {
        wxWide(mask);
        $('[data-x]', mask).onclick = close;
        $('[data-next]', mask).onclick = () => {
          wx.angle = $('#wx_angle', mask).value.trim();
          wx.hook = $('#wx_hook', mask).value.trim();
          close(); step2();
        };
      },
    });
  }

  function step2() {
    const bs = realBrands;
    const ws = (S.boot.styles || []).filter((s) => s.kind === 'writing');
    const onlyOne = bs.length <= 1;
    const soleName = bs[0]?.name || '无品牌';
    modal({
      title: '写公众号 2/4 · 用哪个账号、什么笔法',
      bodyHtml: `
        ${onlyOne
          ? `<label class="field"><span class="lab">账号</span><div class="wx-sole">${esc(soleName)}<i>唯一账号，已自动选中</i></div></label>`
          : `<label class="field"><span class="lab">账号</span><select class="input" id="wx_brand">${bs.map((b) => `<option value="${b.id}" ${b.id === wx.brandId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>`}
        <label class="field"><span class="lab">写作风格${ws.length ? '' : '（风格库还没有写作风格，可先跟账号默认走）'}</span>
          <select class="input" id="wx_style"><option value="">跟账号默认走</option>${ws.map((s) => `<option value="${s.id}" ${s.id === wx.styleId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`,
      footHtml: `<button class="btn btn-ghost" data-back>← 上一步</button><button class="btn btn-accent" data-next>${onlyOne && !ws.length ? '确认，去出标题 →' : '下一步：出标题 →'}</button>`,
      onMount: (mask, close) => {
        wxWide(mask);
        $('[data-back]', mask).onclick = () => { close(); step1(); };
        $('[data-next]', mask).onclick = async () => {
          wx.brandId = onlyOne ? wx.brandId : $('#wx_brand', mask).value;
          wx.styleId = $('#wx_style', mask).value;
          const btn = $('[data-next]', mask);
          btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 标题生成中…';
          try {
            const material = `${card.title}\n${card.zhSummary || ''}\n切入角度：${wx.angle}\n首段钩子：${wx.hook}`;
            const r = await api.post('/api/wechat/titles', { material, brandId: wx.brandId, styleId: wx.styleId });
            wx.titles = r.titles; wx.digest = r.digest || wx.digest;
            close(); step3();
          } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '下一步：出标题 →'; }
        };
      },
    });
  }

  function step3() {
    modal({
      title: '写公众号 3/4 · 选标题',
      bodyHtml: `
        <div class="wx-titles">${wx.titles.map((t, i) => `<label class="wx-title-opt"><input type="radio" name="wxt" value="${i}" ${i === 0 ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>
        <label class="field"><span class="lab">或自己写一个</span><input class="input" id="wx_custom" placeholder="留空则用上面选中的"></label>
        <label class="field"><span class="lab">摘要（公众号卡片 digest）</span><input class="input" id="wx_digest" value="${esc(wx.digest)}"></label>`,
      footHtml: `<button class="btn btn-ghost" data-back>← 上一步</button><button class="btn btn-accent" data-go>生成全文 →</button>`,
      onMount: (mask, close) => {
        wxWide(mask);
        $('[data-back]', mask).onclick = () => { close(); step2(); };
        $('[data-go]', mask).onclick = () => {
          const custom = $('#wx_custom', mask).value.trim();
          const picked = mask.querySelector('input[name="wxt"]:checked');
          wx.title = custom || wx.titles[Number(picked?.value || 0)] || wx.titles[0] || card.title;
          wx.digest = $('#wx_digest', mask).value.trim();
          close(); step4();
        };
      },
    });
  }

  async function step4() {
    const { mask, close } = modal({
      title: '写公众号 4/4 · 成文',
      bodyHtml: `<div class="hint" id="wx_state" style="padding:20px;text-align:center"><span class="spin"></span> 正在按「${esc(wx.title)}」写全文…（约 1 分钟，写完自动进草稿箱）</div><div id="wx_result"></div>`,
      footHtml: `<button class="btn btn-ghost" data-x>关掉（后台继续写，结果在草稿箱）</button>`,
      onMount: (m) => { wxWide(m); $('[data-x]', m).onclick = () => m.remove(); },
    });
    try {
      const idea = `${card.title}\n\n${card.zhSummary || ''}\n原文摘录：${String(card.summary || '').slice(0, 300)}\n来源：${card.url || ''}（${card.author || card.sourceName || ''}）\n\n标题（已定稿，直接用）：${wx.title}\n摘要 digest（直接用）：${wx.digest}\n切入角度：${wx.angle}\n首段钩子（用它开第一段，可微调衔接）：${wx.hook}`;
      const project = await api.post('/api/projects', { idea, brandId: wx.brandId, outputs: ['gongzhonghao_pub'], options: wx.styleId ? { styleId: wx.styleId } : {} });
      const out = await api.post(`/api/projects/${project.id}/generate/gongzhonghao_pub`, {});
      if (!document.body.contains(mask)) { toast('公众号全文已生成并存草稿 ✓', 'ok'); return; }
      const st = $('#wx_state', mask); if (st) st.remove();
      $('#wx_result', mask).innerHTML = `
        <div class="wx-done"><b>${esc(out.title || wx.title)}</b><p class="hint">${esc(out.digest || wx.digest)}</p>
        <pre class="wx-md">${esc(String(out.content || '').slice(0, 1200))}${String(out.content || '').length > 1200 ? '\n…' : ''}</pre>
        <div class="hint">✓ 已自动存草稿箱 · 完整项目在「任务」里</div></div>`;
      const foot = mask.querySelector('.modal-foot');
      foot.innerHTML = `<button class="btn btn-ghost" data-copy>复制全文</button><a class="btn btn-ghost" href="/api/article/${project.id}/html?platformId=gongzhonghao_pub" target="_blank" rel="noopener">预览成品排版</a><button class="btn btn-accent" data-ok>完成</button>`;
      $('[data-copy]', mask).onclick = () => { navigator.clipboard.writeText(String(out.content || '')); toast('已复制', 'ok'); };
      $('[data-ok]', mask).onclick = close;
      toast('公众号全文已生成并存草稿 ✓', 'ok');
    } catch (e) {
      if (!document.body.contains(mask)) { toast(`公众号生成失败：${e.message}`, 'err'); return; }
      const st = $('#wx_state', mask);
      if (st) st.innerHTML = `⚠️ ${esc(e.message)} <button class="btn btn-ghost btn-sm" id="wx_retry">重试</button>`;
      const rb = $('#wx_retry', mask); if (rb) rb.onclick = () => { close(); step4(); };
    }
  }
}

// 相对时间：给素材卡/工具条用
function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '时间未知';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const dDays = Math.floor(h / 24);
  if (dDays === 1) return '昨天';
  if (dDays < 14) return `${dDays} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

function paintNews(body, d) {
  const kw = (d.keywords || [])
    .map((k) => `<button class="chip" title="${esc(k.why || '')}"><span class="chip-em">📌</span>${esc(k.word)}<span class="chip-hint">${esc(k.why || '')}</span></button>`)
    .join('');
  // 过期自检：不光看 stale 标志，直接按日期算——超 2 天就醒目报警（防之前那种静默卡 15 天）
  let daysOld = 0;
  if (d.date) { const dt = new Date(d.date + 'T00:00:00'); if (!isNaN(dt)) daysOld = Math.floor((Date.now() - dt) / 86400000); }
  const staleWarn = d.stale || daysOld >= 2;
  body.innerHTML = `
    ${staleWarn ? `<div class="news-stale"><span>⚠️ 新闻数据停在 <b>${esc(d.date || '?')}</b>（${daysOld} 天前）${d.stale ? '，上游/网络没拉通' : ''} — 建议重新蒸馏拉最新</span><button class="btn btn-accent btn-sm" id="newsStaleRefresh">⟳ 立即重新蒸馏</button></div>` : ''}
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap">
      <span class="hint">📅 ${esc(d.date || '')} · 快讯 ${(d.flashes || []).length} 条${staleWarn ? '' : ' · 已是最新'}</span>
      <button class="btn btn-ghost btn-sm" id="newsIdeate">✨ 从今天的新闻想选题</button>
      <button class="btn btn-ghost btn-sm" id="newsRefresh" title="重新蒸馏一遍今天的素材">⟳ 重新蒸馏</button>
    </div>
    ${kw ? `<div class="section-label">🔑 今日关键词</div><div class="chip-row" style="margin-bottom:22px">${kw}</div>` : ''}
    <div class="section-label">⚡ AI 快讯 · 一句话版</div>
    <div class="list" id="flashList" style="margin-bottom:26px"></div>
    ${(d.products || []).length ? '<div class="section-label">🚀 新产品雷达</div><div class="card-grid" id="prodGrid"></div>' : ''}`;

  const list = $('#flashList', body);
  (d.flashes || []).forEach((f, i) => {
    let host = '';
    try { host = new URL(f.url).hostname.replace('www.', ''); } catch {}
    const row = el(`<div class="list-row">
      <div style="font-family:var(--mono);font-size:12px;color:var(--ink-3);width:26px;flex-shrink:0">${String(i + 1).padStart(2, '0')}</div>
      <div class="lr-main"><div class="lr-title" style="font-weight:500">${esc(f.text)}</div>
        <div class="lr-sub"><a href="${esc(f.url)}" target="_blank" rel="noopener">来源 · ${esc(host || '链接')}</a></div></div>
      <div class="lr-actions"><button class="btn btn-accent btn-sm" data-use>✶ 用这条创作</button></div></div>`);
    $('[data-use]', row).onclick = () => newsToCreate(f);
    list.appendChild(row);
  });

  const grid = $('#prodGrid', body);
  if (grid) (d.products || []).forEach((p) => {
    const card = el(`<div class="entity-card">
      <div class="ec-top"><div class="ec-mono" style="background:linear-gradient(135deg,#f59e0b,#ef4444)">🚀</div>
        <div><div class="ec-name">${esc(p.name)}</div><div class="ec-tag">${esc(p.by || '')}</div></div></div>
      <div class="ec-tag" style="margin:6px 0">⭐ ${esc(p.rating || '评分待收集')}</div>
      <div class="ec-meta" style="max-height:none">${esc(p.review || '')}</div>
      <div class="ec-actions">
        ${p.tryUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(p.tryUrl)}" target="_blank" rel="noopener">🔗 体验</a>` : ''}
        ${p.sourceUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(p.sourceUrl)}" target="_blank" rel="noopener">💬 来源</a>` : ''}
        <button class="btn btn-accent btn-sm" data-use>✶ 用它创作</button></div></div>`);
    $('[data-use]', card).onclick = () =>
      newsToCreate({ text: `${p.name}${p.by ? '（' + p.by + '）' : ''}发布：${p.review || ''}`, url: p.sourceUrl || p.tryUrl || '' });
    grid.appendChild(card);
  });

  const doRefresh = () => { S_NEWS.data = null; loadNews(body, true); };
  $('#newsRefresh', body).onclick = doRefresh;
  const staleBtn = $('#newsStaleRefresh', body); if (staleBtn) staleBtn.onclick = doRefresh;
  $('#newsIdeate', body).onclick = () => {
    const top = (d.flashes || []).slice(0, 8).map((f) => `- ${f.text}`).join('\n');
    switchView('create');
    setTimeout(() => ideateModal(null, `从今天这些 AI 新闻里找能做的选题：\n${top}`), 60);
  };
}

// 一条新闻 → 填进创作区当想法
function newsToCreate(f) {
  const c = S.create;
  c.idea = f.url ? `${f.text}\n\n来源：${f.url}` : f.text;
  c.project = null;
  c.results = {};
  switchView('create');
  toast('新闻已填入创作区，选品牌和形态就能生成', 'ok');
}

// =========================================================
//  草稿箱 / 作品库：以「收录到账号」为分界线
//   草稿箱 = 在做的 + 做完待验收的（未收录）+ Pass 箱
//   作品库 = 已收录到账号的，按账号分组，管理 OK 就发布
// =========================================================
const S_WORKS = { data: null, filter: 'all', box: 'active', pooled: null, jobs: null };

async function loadWorksData(body, loadingText) {
  body.innerHTML = `<div class="empty"><div class="em-glyph"><span class="spin"></span></div><div class="em-text">${esc(loadingText)}</div></div>`;
  const [tasks, pooled, jobs, accts] = await Promise.all([
    api.get('/api/tasks').catch(() => []),
    api.get('/api/works/pooled').catch(() => ({})),
    api.get('/api/jobs').catch(() => []),
    api.get('/api/accounts/pool-summary').catch(() => []),
  ]);
  S_WORKS.data = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
  S_WORKS.pooled = pooled || {};
  S_WORKS.jobs = Array.isArray(jobs) ? jobs : (jobs.jobs || []);
  S.poolAccounts = Array.isArray(accts) ? accts : [];
}

// ―― 草稿箱：还没进账号的东西都在这 ――
async function renderDraftbox(root) {
  root.innerHTML = `<div class="page-head"><div class="page-title">草稿箱</div>
    <div class="page-sub">正在做的、做完等你验收的、以及 Pass 掉的，都在这。验收 OK 就「收录到账号」，它会进作品库等发布。</div></div>
    <div id="worksBody"></div>`;
  const body = $('#worksBody', root);
  try {
    await loadWorksData(body, '正在加载草稿箱…');
    paintDraftbox(body);
  } catch (e) { body.innerHTML = `<div class="rc-err">⚠️ ${esc(e.message)}</div>`; }
}

function paintDraftbox(body) {
  const pooled = S_WORKS.pooled || {};
  const jobs = (S_WORKS.jobs || []).filter((j) => j.status !== 'done');
  const box = S_WORKS.box === 'passed' ? 'passed' : 'todo';
  // 未收录 = 还在草稿箱；已收录的归作品库
  const tasks = (S_WORKS.data || []).map((t) => {
    const works = (t.works || []).filter((w) => (box === 'passed' ? w.passed : !w.passed && !(pooled[w.id] || []).length));
    return { ...t, works, workCount: works.length, contentCount: works.reduce((s, w) => s + (w.items || []).length, 0) };
  }).filter((t) => t.works.length);
  const todoCount = (S_WORKS.data || []).reduce((n, t) => n + (t.works || []).filter((w) => !w.passed && !(pooled[w.id] || []).length).length, 0);
  const passedCount = (S_WORKS.data || []).reduce((n, t) => n + (t.works || []).filter((w) => w.passed).length, 0);

  const jobRow = (j) => {
    const st = { running: ['生产中', 'running'], claimed: ['产能机生产中', 'running'], queued: ['排队中', 'pending'],
      waiting_external: ['等待确认', 'pending'], failed: ['失败', 'error'] }[j.status] || [j.status, 'pending'];
    return `<div class="list-row">
      <div class="lr-main"><div class="lr-title">${esc(j.channelLabel || '任务')} · ${esc(String(j.idea || '').slice(0, 30))}</div>
        <div class="lr-sub">${esc(j.brandName || '')}${j.logTail ? ` · ${esc(String(j.logTail).slice(0, 50))}` : ''}</div></div>
      <span class="rc-badge ${st[1]}" style="align-self:center">${st[0]}</span></div>`;
  };

  // 顶部按账号筛（渠道体现在作品自身的类型标签上）
  const acctCounts = {};
  tasks.forEach((t) => t.works.forEach((w) => { const k = w.brandName || '无品牌'; acctCounts[k] = (acctCounts[k] || 0) + 1; }));
  const acctSel = S_WORKS.acct || 'all';
  const shown = acctSel === 'all' ? tasks : tasks.map((t) => {
    const works = t.works.filter((w) => (w.brandName || '无品牌') === acctSel);
    return { ...t, works, workCount: works.length };
  }).filter((t) => t.works.length);
  const acctChips = [['all', `✦ 全部账号 (${Object.values(acctCounts).reduce((a, b) => a + b, 0)})`],
    ...Object.entries(acctCounts).map(([k, n]) => [k, `${k} (${n})`])];

  body.innerHTML = `
    ${jobs.length ? `<div class="section-label">🔄 正在做（${jobs.length}）<span class="hint">产能机在跑，做完自动进下面的待验收</span></div>
      <div class="list" style="margin-bottom:22px">${jobs.map(jobRow).join('')}</div>` : ''}
    <div class="tabs works-box-tabs">
      <button class="tab ${box === 'todo' ? 'sel' : ''}" data-works-box="active">📝 待验收 (${todoCount})</button>
      <button class="tab ${box === 'passed' ? 'sel' : ''}" data-works-box="passed">✓ Pass箱 (${passedCount})</button>
    </div>
    ${acctChips.length > 2 ? `<div class="chip-row" id="dbAcct" style="margin-bottom:12px">${acctChips.map(([id, name]) =>
      `<button class="chip ${acctSel === id ? 'sel' : ''}" data-acct="${esc(id)}">${esc(name)}</button>`).join('')}</div>` : ''}
    ${box === 'todo' ? '<div class="hint" style="margin:-6px 0 14px">看过没问题 → 打开作品点「＋ 收录」选账号，它就进作品库排队发布。</div>' : ''}
    ${shown.length ? '<div class="works-task-list" id="worksTaskList"></div>'
      : emptyHtml(box === 'passed' ? '✓' : '📝', box === 'passed' ? 'Pass箱是空的。' : '没有待验收的东西——做完的都收录进作品库了。')}`;

  $$('[data-works-box]', body).forEach((tab) => {
    tab.onclick = () => { S_WORKS.box = tab.dataset.worksBox === 'passed' ? 'passed' : 'active'; paintDraftbox(body); };
  });
  $$('[data-acct]', body).forEach((c) => c.onclick = () => { S_WORKS.acct = c.dataset.acct; paintDraftbox(body); });
  const wrap = $('#worksTaskList', body);
  if (!wrap) return;
  shown.forEach((task) => {
    const section = el(`<section class="content-task-group">
      <header class="content-task-head"><div><h2>${esc(task.label)}</h2>
        <p>${task.workCount} 个作品 · ${task.contentCount} 个内容文件</p></div>
        <button class="btn btn-ghost btn-sm" data-open-task>查看全部</button></header>
      <div class="works-task-grid"></div>
    </section>`);
    $('[data-open-task]', section).onclick = () => openContentTask(task.id, 'works', S_WORKS.box);
    const grid = $('.works-task-grid', section);
    task.works.forEach((work) => grid.appendChild(workCard(work)));
    wrap.appendChild(section);
  });
}

async function renderWorks(root) {
  root.innerHTML = `<div class="page-head"><div class="page-title">作品库</div>
    <div class="page-sub">已收录到账号的成品，按账号分组。检查没问题就发布；发布后回填数据。</div></div>
    <div id="worksBody"></div>`;
  const body = $('#worksBody', root);
  try {
    await loadWorksData(body, '正在加载作品库…');
    paintWorksLibrary(body);
  } catch (e) { body.innerHTML = `<div class="rc-err">⚠️ ${esc(e.message)}</div>`; }
}

// 作品库 = 分账号：每个账号下的已收录作品，直接管理与发布
function paintWorksLibrary(body) {
  const pooled = S_WORKS.pooled || {};
  const workById = {};
  (S_WORKS.data || []).forEach((t) => (t.works || []).forEach((w) => { workById[w.id] = { ...w, taskLabel: t.label }; }));

  const byAccount = {};
  Object.entries(pooled).forEach(([workId, entries]) => {
    const w = workById[workId];
    if (!w || w.passed) return;
    entries.forEach((e) => {
      const key = e.accountId || 'unknown';
      (byAccount[key] = byAccount[key] || { entries: [], published: 0 }).entries.push({ ...e, work: w });
      if (e.status === 'published') byAccount[key].published += 1;
    });
  });
  const accounts = S.poolAccounts || [];
  const nameOf = (id) => accounts.find((a) => a.id === id) || { name: '未归类账号', platform: '' };
  const groups = Object.entries(byAccount).sort((a, b) => b[1].entries.length - a[1].entries.length);
  const total = groups.reduce((n, [, g]) => n + g.entries.length, 0);
  const pubTotal = groups.reduce((n, [, g]) => n + g.published, 0);

  if (!groups.length) {
    body.innerHTML = emptyHtml('📦', '作品库还是空的。去草稿箱验收作品，点「＋ 收录」选账号，收录后就出现在这里。');
    return;
  }
  // 顶部按平台筛：一次只看一个渠道下的账号
  const platCounts = {};
  groups.forEach(([accId, g]) => { const p = nameOf(accId).platform || '其它'; platCounts[p] = (platCounts[p] || 0) + g.entries.length; });
  const platSel = S_WORKS.plat || 'all';
  const visible = platSel === 'all' ? groups : groups.filter(([accId]) => (nameOf(accId).platform || '其它') === platSel);
  const platChips = [['all', `✦ 全部平台 (${total})`], ...Object.entries(platCounts).map(([p, n]) => [p, `${p} (${n})`])];

  body.innerHTML = `<div class="ab-meta">${groups.length} 个账号 · ${total} 条已收录 · ${pubTotal} 条已发布</div>
    ${platChips.length > 2 ? `<div class="chip-row" style="margin-bottom:14px">${platChips.map(([id, name]) =>
      `<button class="chip ${platSel === id ? 'sel' : ''}" data-plat-f="${esc(id)}">${esc(name)}</button>`).join('')}</div>` : ''}
    <div id="libList"></div>`;
  $$('[data-plat-f]', body).forEach((c) => c.onclick = () => { S_WORKS.plat = c.dataset.platF; paintWorksLibrary(body); });
  const wrap = $('#libList', body);
  visible.forEach(([accId, g]) => {
    const a = nameOf(accId);
    const section = el(`<section class="content-task-group">
      <header class="content-task-head"><div><h2>${esc(a.platform ? `${a.platform} · ${a.name}` : a.name)}</h2>
        <p>${g.entries.length} 条已收录 · ${g.published} 条已发布 · ${g.entries.length - g.published} 条待发</p></div>
        <button class="btn btn-ghost btn-sm" data-open-acct>进账号管理 →</button></header>
      <div class="works-task-grid"></div>
    </section>`);
    $('[data-open-acct]', section).onclick = () => switchView('pool');
    const grid = $('.works-task-grid', section);
    g.entries.sort((x, y) => (x.status === 'published' ? 1 : 0) - (y.status === 'published' ? 1 : 0));
    g.entries.forEach((e) => {
      const card = workCard(e.work);
      const flag = el(`<div class="lib-flag ${e.status === 'published' ? 'pub' : ''}">${e.status === 'published' ? '✓ 已发布' : '待发布'}</div>`);
      card.appendChild(flag);
      grid.appendChild(card);
    });
    wrap.appendChild(section);
  });
}

function paintWorks(body, all) {
  const passedCount = all.reduce((sum, task) => sum + (task.works || []).filter((work) => work.passed).length, 0);
  const activeCount = all.reduce((sum, task) => sum + (task.works || []).filter((work) => !work.passed).length, 0);
  const showPassed = S_WORKS.box === 'passed';
  const boxTasks = all.map((task) => {
    const works = (task.works || []).filter((work) => !!work.passed === showPassed);
    return {
      ...task,
      works,
      workCount: works.length,
      contentCount: works.reduce((sum, work) => sum + (work.items || []).length, 0),
    };
  }).filter((task) => task.works.length);
  const counts = {};
  boxTasks.forEach((task) => { const k = task.brandId || 'none'; counts[k] = (counts[k] || 0) + 1; });
  const sel = S_WORKS.filter;
  // 内容视角：按内容类型再筛一层（竖屏视频/横屏视频/图文/纯文章）
  const typeSel = S_WORKS.type || 'all';
  const typeOf = (w) => workTypeInfo(w).label;
  const typeCounts = {};
  boxTasks.forEach((t) => t.works.forEach((w) => { const k = typeOf(w); typeCounts[k] = (typeCounts[k] || 0) + 1; }));
  let list = sel === 'all' ? boxTasks : boxTasks.filter((task) => (task.brandId || 'none') === sel);
  if (typeSel !== 'all') {
    list = list.map((t) => {
      const works = t.works.filter((w) => typeOf(w) === typeSel);
      return { ...t, works, workCount: works.length, contentCount: works.reduce((s, w) => s + (w.items || []).length, 0) };
    }).filter((t) => t.works.length);
  }
  const chips = [{ id: 'all', name: `全部 (${boxTasks.length})` }, ...brandList().filter((b) => counts[b.id]).map((b) => ({ id: b.id, name: `${b.name} (${counts[b.id]})` }))];

  body.innerHTML = `${S.passReady ? `<div class="tabs works-box-tabs">
      <button class="tab ${showPassed ? '' : 'sel'}" data-works-box="active">作品 (${activeCount})</button>
      <button class="tab ${showPassed ? 'sel' : ''}" data-works-box="passed">Pass箱 (${passedCount})</button>
    </div>` : ''}
    <div class="chip-row" id="worksFilter" style="margin-bottom:8px"></div>
    <div class="chip-row" id="worksTypeFilter" style="margin-bottom:18px"></div>
    ${list.length ? '<div class="works-task-list" id="worksTaskList"></div>' : emptyHtml(showPassed ? 'P' : '📦', showPassed ? 'Pass箱还是空的。' : '这个筛选下还没有作品。')}`;

  $$('[data-works-box]', body).forEach((tab) => {
    tab.onclick = () => { S_WORKS.box = tab.dataset.worksBox; S_WORKS.filter = 'all'; S_WORKS.type = 'all'; paintWorks(body, all); };
  });

  const filter = $('#worksFilter', body);
  chips.forEach((c) => {
    const chip = el(`<button class="chip ${sel === c.id ? 'sel' : ''}">${esc(c.name)}</button>`);
    chip.onclick = () => { S_WORKS.filter = c.id; paintWorks(body, all); };
    filter.appendChild(chip);
  });
  const typeFilter = $('#worksTypeFilter', body);
  [['all', `✦ 全部类型`], ...Object.entries(typeCounts).map(([k, n]) => [k, `${k} (${n})`])].forEach(([id, name]) => {
    const chip = el(`<button class="chip ${typeSel === id ? 'sel' : ''}">${esc(name)}</button>`);
    chip.onclick = () => { S_WORKS.type = id; paintWorks(body, all); };
    typeFilter.appendChild(chip);
  });
  if (!list.length) return;
  const wrap = $('#worksTaskList', body);
  list.forEach((task) => {
    const section = el(`<section class="content-task-group">
      <header class="content-task-head"><div><h2>${esc(task.label)}</h2>
        <p>${task.workCount} 个作品 · ${task.contentCount} 个内容文件</p></div>
        <button class="btn btn-ghost btn-sm" data-open-task>查看全部</button></header>
      <div class="works-task-grid"></div>
    </section>`);
    $('[data-open-task]', section).onclick = () => openContentTask(task.id, 'works', S_WORKS.box);
    const grid = $('.works-task-grid', section);
    (task.works || []).forEach((work) => grid.appendChild(workCard(work)));
    wrap.appendChild(section);
  });
}

function workTypeInfo(w) {
  const items = w.items || [];
  const hasVideo = items.some((item) => item.type === 'video');
  const hasImage = items.some((item) => item.type === 'image');
  if (hasVideo) {
    const source = [w.title, ...items.flatMap((item) => [item.label, item.url])].join(' ');
    if (/竖屏|vertical|9[:x]16|shorts|tiktok|douyin/i.test(source)) {
      return { label: '竖屏视频', className: 'vertical' };
    }
    return { label: '横屏视频', className: 'horizontal' };
  }
  if (hasImage) return { label: '图文', className: 'mixed' };
  return { label: '纯文章', className: 'text' };
}

function workItemCounts(w) {
  const counts = (w.items || []).reduce((result, item) => {
    result[item.type] = (result[item.type] || 0) + 1;
    return result;
  }, {});
  return [
    counts.video ? `${counts.video} 视频` : '',
    counts.image ? `${counts.image} 图片` : '',
    counts.text ? `${counts.text} 文案` : '',
  ].filter(Boolean).join(' · ');
}

function workPreviewHtml(w) {
  const items = w.items || [];
  const imageItem = items.find((item) => item.type === 'image' && item.url);
  const videoItem = items.find((item) => item.type === 'video' && item.url);
  const textItem = items.find((item) => item.type === 'text' && item.content);
  if (imageItem) return `<img src="${esc(imageItem.url)}" alt="" loading="lazy"/>`;
  if (videoItem) return `<video muted playsinline preload="metadata" src="${esc(videoItem.url)}#t=0.1"></video><span class="wk-play">▶</span>`;
  const text = String(textItem?.content || '暂无预览')
    .replace(/[#*_`>|[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return `<div class="wk-preview-text">${esc(text)}</div>`;
}

// ―― 调整成片：点按钮选常见改法 + 一句话补充，派成返工任务给产能机 ――
const TWEAKS = [
  ['配音', '换一条配音重新合成，语速与情绪按下面的要求来'],
  ['节奏', '重新剪辑节奏：该快的地方加快、废话删掉，整体更紧凑'],
  ['背景音乐', '换背景音乐：情绪与音量按下面要求，人声要压得住'],
  ['字幕', '字幕重新对齐与断句，错字修掉，样式按渠道规范'],
  ['封面', '重做封面：标题更抓人，构图按账号封面规范'],
  ['开头三秒', '重做开头三秒钩子，前 3 秒必须抓住人'],
  ['时长', '压到更短或补到更长，具体见下面要求'],
];
function tweakWorkModal(w) {
  const picked = new Set();
  const brand = brandById(w.brandId) || {};
  const chans = (brand.channels || []).filter((c) => c.engine === 'claude');
  modal({
    title: `🎚 调整成片 · ${w.title || ''}`,
    bodyHtml: `
      <p class="ask-msg">选要改哪几处，再用一句话说清怎么改。系统会带着原片和你的要求，派一条返工任务给产能机。</p>
      <div class="chip-row" id="tw_chips" style="margin-bottom:12px">${TWEAKS.map(([k]) =>
        `<button type="button" class="chip" data-tw="${esc(k)}">${esc(k)}</button>`).join('')}</div>
      <label class="field"><span class="lab">具体怎么改</span>
        <textarea class="textarea" id="tw_note" rows="4" placeholder="例如：配音语速放慢一点，结尾那句别赶；BGM 换成更安静的垫子，别盖住人声"></textarea></label>
      ${chans.length ? `<label class="field"><span class="lab">按哪个渠道规范返工</span>
        <select class="input" id="tw_ch">${chans.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('')}</select></label>`
        : '<div class="rc-err" style="padding:8px 10px">这个品牌没有重型生产渠道，改不了成片</div>'}
      <div class="hint">原片：${esc((w.items || []).filter((i) => i.type === 'video').map((i) => i.label).join('、') || '—')}</div>`,
    footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-go>派返工任务 →</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $$('[data-tw]', mask).forEach((c) => c.onclick = () => {
        const k = c.dataset.tw;
        picked.has(k) ? picked.delete(k) : picked.add(k);
        c.classList.toggle('sel');
      });
      $('[data-go]', mask).onclick = async (ev) => {
        const note = $('#tw_note', mask).value.trim();
        if (!picked.size && !note) return toast('选一处要改的，或写清怎么改', 'err');
        const btn = ev.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 派活中…';
        const parts = [...picked].map((k) => `【${k}】${(TWEAKS.find(([n]) => n === k) || [])[1] || ''}`);
        const channelId = $('#tw_ch', mask)?.value;
        if (!channelId) { btn.disabled = false; btn.textContent = '派返工任务 →'; return toast('没有可用的重型渠道', 'err'); }
        const idea = `返工：${w.title || ''}\n\n要改的地方：\n${parts.join('\n') || '（见下方要求）'}\n\n具体要求：${note || '（按上面默认改法）'}\n\n原片作品 ID：${w.id}\n注意：在原片基础上改，别推翻重做；改完仍按渠道规范自检。`;
        try {
          await api.post('/api/jobs', { brandId: w.brandId, channelId, idea });
          toast('返工任务已派出，产能机接活后开始改 ✓', 'ok');
          close();
          if (S.view === 'home') renderHome($('#view'));
        } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '派返工任务 →'; }
      };
    },
  });
}

// 内容标签：类型（视频/图文/文章）+ 时长；一眼看出这是什么、多长
function fmtDur(s) {
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return '';
  return n < 60 ? `${Math.round(n)}秒` : `${Math.floor(n / 60)}分${String(Math.round(n % 60)).padStart(2, '0')}秒`;
}
function workTagsHtml(w) {
  const type = workTypeInfo(w);
  const items = w.items || [];
  const longest = items.filter((i) => i.type === 'video').reduce((m, i) => Math.max(m, Number(i.seconds) || 0), 0);
  const dur = fmtDur(longest);
  const counts = { video: 0, image: 0, text: 0 };
  items.forEach((i) => { if (counts[i.type] != null) counts[i.type] += 1; });
  const extra = [
    counts.video > 1 ? `${counts.video} 视频` : '',
    counts.image ? `${counts.image} 图` : '',
    counts.text ? `${counts.text} 文案` : '',
  ].filter(Boolean).slice(0, 2);
  return `<span class="wk-tag type">${esc(type.label)}</span>${dur ? `<span class="wk-tag dur">⏱ ${dur}</span>` : ''}${extra.map((t) => `<span class="wk-tag">${esc(t)}</span>`).join('')}`;
}

function workCard(w) {
  const date = (w.at || '').slice(0, 10);
  const type = workTypeInfo(w);
  const card = el(`<article class="work-card ${w.passed ? 'is-passed' : ''}" tabindex="0" role="button" aria-label="查看作品：${esc(w.title || '未命名')}">
    <div class="wk-preview ${type.className}">
      ${workPreviewHtml(w)}
      <div class="wk-preview-shade"></div>
      <div class="wk-preview-foot"><span>${esc(workItemCounts(w) || type.label)}</span><b>查看全部</b></div>
    </div>
    <div class="wk-card-body">
      <div class="wk-head">
        <span class="wk-account">${esc(w.brandName || '无品牌')}</span>
        <span class="wk-tags">${workTagsHtml(w)}</span>
      </div>
      <div class="wk-title">${esc(w.title || '未命名')}</div>
      <div class="wk-card-meta"><time>${esc(date)}</time>${w.passed ? '<span class="wk-passed">Pass</span>' : (w.published ? '<span class="wk-published">✓ 已发布</span>' : '')}</div>
    </div>
  </article>`);
  const open = () => workDetailModal(w);
  card.onclick = open;
  card.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  return card;
}

function downloadWork(w) {
  const a = document.createElement('a');
  a.href = `/api/works/${w.id}/bundle`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('开始打包下载', 'ok');
}

async function revealWork(w, button) {
  button.disabled = true;
  try {
    const result = await api.post(`/api/works/${w.id}/reveal`);
    try { await navigator.clipboard.writeText(result.folder); } catch {}
    toast('已在访达打开，路径已复制', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    button.disabled = false;
  }
}
// 只复制本地路径（不打开访达）
async function copyWorkPath(w, button) {
  if (button) button.disabled = true;
  try {
    const { folder } = await api.get(`/api/works/${w.id}/folder`);
    try { await navigator.clipboard.writeText(folder); toast('本地地址已复制 ✓', 'ok'); }
    catch { await askText({ title: '本地地址', msg: '自动复制被浏览器拦了，手动复制：', fields: [{ key: 'p', label: '路径', value: folder }] }); }
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    if (button) button.disabled = false;
  }
}

function workDetailModal(w) {
  const type = workTypeInfo(w);
  const date = (w.at || '').slice(0, 16).replace('T', ' ');
  const mask = el(`<div class="modal-mask work-detail-mask">
    <section class="work-detail-modal" role="dialog" aria-modal="true" aria-label="${esc(w.title || '作品详情')}">
      <header class="work-detail-head">
        <div class="work-detail-title">
          <div><span>${esc(w.brandName || '无品牌')}</span><i>${esc(type.label)}</i><time>${esc(date)}</time></div>
          ${w.taskLabel ? `<small class="work-detail-task">${esc(w.taskLabel)}</small>` : ''}
          <h2>${esc(w.title || '未命名')}</h2>
        </div>
        <div class="work-detail-actions">
          ${w.passed ? '<button class="btn btn-primary btn-sm" data-restore>↩ 恢复作品</button>' : '<button class="btn btn-primary btn-sm" data-pool>＋ 收录</button>'}
          ${(w.items || []).some((i) => i.type === 'video') ? '<button class="btn btn-accent btn-sm" data-tweak>🎚 调整成片</button>' : ''}
          <button class="btn btn-ghost btn-sm" data-download>↓ 下载</button>
          <button class="btn btn-ghost btn-sm" data-folder>□ 文件夹</button>
          <button class="btn btn-ghost btn-sm" data-copypath>⧉ 复制地址</button>
          <button class="btn btn-ghost btn-sm" data-deliver>📦 整理交付包</button>
          <button class="btn btn-ghost btn-sm" data-published>${w.published ? '✕ 取消已发' : '✓ 标为已发'}</button>
          <button class="work-detail-close" data-close title="关闭" aria-label="关闭">×</button>
        </div>
      </header>
      <div class="work-detail-layout">
        <section class="work-detail-media"><div class="work-detail-label">媒体</div><div data-media></div></section>
        <section class="work-detail-copy">
          <div class="work-detail-label">完整内容</div>
          <div class="work-detail-facts">
            <span>${esc(workItemCounts(w) || type.label)}</span>
            ${w.cost?.totalTokens ? `<span>${compactTokens(w.cost.dedicatedWorkerTokens || w.cost.totalTokens)} Token</span>` : ''}
            ${w.cost?.totalTokens ? `<span>API 等价 ¥${Number(w.cost.apiEquivalentCny ?? w.cost.estimatedCny ?? 0).toFixed(2)}</span>` : ''}
          </div>
          ${w.cost?.modelStack?.length ? `<div class="model-chips">${costModelChips(w.cost)}</div>` : ''}
          <div data-copy></div>
        </section>
      </div>
    </section>
  </div>`);
  const mediaWrap = $('[data-media]', mask);
  const copyWrap = $('[data-copy]', mask);
  const mediaItems = (w.items || []).filter((item) => item.type === 'video' || item.type === 'image');
  const textItems = (w.items || []).filter((item) => item.type === 'text');
  if (mediaItems.length) mediaItems.forEach((item) => mediaWrap.appendChild(workItem(item)));
  else mediaWrap.innerHTML = `<div class="work-detail-empty">这条作品没有独立媒体文件</div>`;
  if (textItems.length) textItems.forEach((item) => copyWrap.appendChild(workItem(item)));
  else copyWrap.innerHTML = `<div class="work-detail-empty">这条作品没有文字内容</div>`;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    mask.remove();
    const body = $('#worksBody');
    if (body && S_WORKS.data) paintWorks(body, S_WORKS.data);
  };
  const onKey = (event) => {
    const masks = $$('.modal-mask');
    if (event.key === 'Escape' && masks.at(-1) === mask) close();
  };
  mask.onclick = (event) => { if (event.target === mask) close(); };
  $('[data-close]', mask).onclick = close;
  const poolButton = $('[data-pool]', mask);
  if (poolButton) poolButton.onclick = () => poolModal(w);
  const restoreButton = $('[data-restore]', mask);
  if (restoreButton) restoreButton.onclick = async () => {
    restoreButton.disabled = true;
    try {
      await api.post(`/api/works/${w.id}/pass`, { passed: false });
      S_WORKS.data = null;
      close();
      toast('已恢复到作品库 ✓', 'ok');
      if (S.view === 'works') renderWorks($('#view'));
    } catch (error) {
      toast(error.message, 'err');
      restoreButton.disabled = false;
    }
  };
  const tweakBtn = $('[data-tweak]', mask);
  if (tweakBtn) tweakBtn.onclick = () => tweakWorkModal(w);
  $('[data-download]', mask).onclick = () => downloadWork(w);
  $('[data-folder]', mask).onclick = (event) => revealWork(w, event.currentTarget);
  $('[data-copypath]', mask)?.addEventListener('click', (event) => copyWorkPath(w, event.currentTarget));
  freezeIfRemote($('[data-folder]', mask));
  freezeIfRemote($('[data-copypath]', mask));
  $('[data-deliver]', mask)?.addEventListener('click', async (event) => {
    const btn = event.currentTarget; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 整理中';
    try {
      const r = await api.post(`/api/works/${w.id}/deliver`, {});
      try { await navigator.clipboard.writeText(r.dir); } catch {}
      const miss = (r.missing || []).length ? `（缺 ${r.missing.join('/')}）` : '齐全';
      toast(`交付包已整理：视频${r.counts.视频}/图片${r.counts.图片}/文案${r.counts.文案} · ${miss}，路径已复制`, r.missing?.length ? 'warn' : 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = '📦 整理交付包'; }
  });
  $('[data-published]', mask).onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api.post(`/api/works/${w.id}/published`, { published: !w.published });
      w.published = !w.published;
      button.textContent = w.published ? '✕ 取消已发' : '✓ 标为已发';
      toast(w.published ? '已标为已发布 ✓' : '已取消发布标记', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      button.disabled = false;
    }
  };
  document.addEventListener('keydown', onKey);
  $('#modalRoot').appendChild(mask);
}

const KNOWN_PLATS = ['抖音', '小红书', '视频号', 'YouTube', '公众号', 'X', 'B站'];
// 从作品的文案里推断它带哪些平台（有对应文案的平台优先）
function workPlatforms(w) {
  const ti = (w.items || []).find((it) => it.type === 'text' && it.content);
  const secs = ti ? splitCopySections(ti.content) : [];
  const found = secs.map((s) => KNOWN_PLATS.find((k) => s.title.includes(k) || k.includes(s.title))).filter(Boolean);
  const uniq = [...new Set(found)];
  return uniq.length ? uniq : KNOWN_PLATS.slice(0, 4);
}

function poolModal(w, onComplete) {
  const plats = workPlatforms(w);
  const boxes = plats.map((p) => `<label class="pool-plat"><input type="checkbox" value="${esc(p)}" checked/> <span>${esc(p)}</span></label>`).join('');
  modal({
    title: `收录到账号库 · ${w.brandName || '无品牌'}`,
    bodyHtml: `<div class="hint" style="margin-bottom:10px">选择要收录到哪些平台账号（没有的账号会自动创建）：</div>
      <div class="pool-plats">${boxes}</div>`,
    footHtml: `${S.passReady ? '<button class="btn btn-ghost btn-pass" data-pass>Pass</button><span class="modal-foot-spacer"></span>' : ''}<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-ok>收录</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      const passButton = $('[data-pass]', mask);
      if (passButton) passButton.onclick = async () => {
        if (!(await askConfirm('Pass 这条作品', '这条内容将移入作品库的 Pass箱，不再进入发布流程。'))) return;
        try {
          await api.post(`/api/works/${w.id}/pass`, { passed: true });
          close();
          toast('已移入作品 Pass箱', 'ok');
          if (onComplete) onComplete({ passed: true });
        } catch (error) { toast(error.message, 'err'); }
      };
      $('[data-ok]', mask).onclick = async () => {
        const platforms = $$('.pool-plat input:checked', mask).map((c) => c.value);
        if (!platforms.length) return toast('至少选一个平台', 'err');
        try {
          const r = await api.post(`/api/works/${w.id}/pool`, { platforms });
          close();
          toast(`已收录到 ${platforms.length} 个账号内容池 ✓`, 'ok');
          if (onComplete) onComplete(r);
        } catch (e) { toast(e.message, 'err'); }
      };
    },
  });
}

// =========================================================
//  账号数据看板（数据源：钉钉「运营账号数据管理系统」）
// =========================================================
const PLAT_EMOJI = { '抖音': '🎵', '小红书': '📕', '视频号': '📺', 'B站': '📺', '哔哩哔哩': '📺', 'YouTube': '▶️', 'TikTok': '🎵', '微博': '🅦' };
const fmtNum = (n) => n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1) + 'w' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0);
// 运营人归属 + 平台归一（把 TikTok 归到抖音系、YouTube Shorts 归到 YouTube、B站/bilibili 统一）
const ownerOfBrand = (n) => /shulex|某公司/i.test(n || '') ? '团队B' : '用户';
const normPlat = (p) => String(p || '').toLowerCase().replace(/\s+/g, '')
  .replace(/bilibili|哔哩哔哩/g, 'b站').replace(/youtubeshorts|shorts/g, 'youtube').replace(/tiktok|tk/g, '抖音');

// 社媒平台注册表：账号页矩阵 + 添加账号时按平台出凭证字段（配齐 = 该平台能自动发布）
const SOCIAL_PLATFORMS = [
  { id: '小红书', emoji: '📕', pub: 'VMOS 云手机自动发布', fields: [['vmosDevice', 'VMOS 设备号'], ['homeUrl', '主页链接']] },
  { id: '抖音', emoji: '🎵', pub: 'VMOS 云手机自动发布', fields: [['vmosDevice', 'VMOS 设备号'], ['homeUrl', '主页链接']] },
  { id: '视频号', emoji: '📺', pub: 'VMOS 云手机自动发布', fields: [['vmosDevice', 'VMOS 设备号'], ['homeUrl', '主页链接']] },
  { id: 'TikTok', emoji: '🎶', pub: 'VMOS 云手机自动发布（海外机型）', fields: [['vmosDevice', 'VMOS 设备号'], ['homeUrl', '主页链接']] },
  { id: 'YouTube', emoji: '▶️', pub: 'YouTube Data API 直传', fields: [['channelId', '频道 ID'], ['oauthClientId', 'OAuth Client ID'], ['oauthClientSecret', 'OAuth Client Secret'], ['refreshToken', 'Refresh Token（带 youtube.upload 权限）']] },
  { id: 'B站', emoji: '📀', pub: 'Cookie 投稿', fields: [['sessdata', 'Cookie SESSDATA'], ['biliJct', 'Cookie bili_jct'], ['homeUrl', '主页链接']] },
  { id: '公众号', emoji: '📰', pub: '公众号开放平台 API', fields: [['appId', 'AppID'], ['appSecret', 'AppSecret']] },
  { id: 'X', emoji: '🐦', pub: 'X API 发推', fields: [['apiKey', 'API Key'], ['apiSecret', 'API Secret'], ['accessToken', 'Access Token'], ['accessSecret', 'Access Token Secret']] },
];
const socialPlat = (name) => SOCIAL_PLATFORMS.find((p) => normPlat(p.id) === normPlat(name)) || null;

// 账号页 = 只放账号数据看板，卡片可点进「该账号的内容页」
async function renderContentLibrary(root) {
  root.innerHTML = `<div class="page-head"><div><div class="page-title">账号</div>
    <div class="page-sub">系统自己的账号后台。点卡片进内容页；点 ✎ 改数据。发布连接器上线后数据自动回流，现在手动维护。</div></div>
    <div style="display:flex;gap:8px"><button class="btn btn-accent btn-sm" id="boardAdd">＋ 添加账号</button>
    <button class="btn btn-ghost btn-sm" id="boardRefresh">↻ 刷新</button></div></div>
    <div id="accountBoardWrap"><div class="hint" style="padding:8px 2px">加载账号数据…</div></div>`;
  // 预加载已收录内容（供匹配 + 钻入），存模块态
  try {
    const accounts = (await api.get('/api/accounts/pool-summary')).filter((a) => (a.count || 0) > 0);
    S.poolGroups = await Promise.all(accounts.map(async (account) => ({
      account, entries: await api.get(`/api/pool?accountId=${account.id}`).catch(() => []),
    })));
  } catch { S.poolGroups = []; }
  await loadAccountBoard(root);
  $('#boardRefresh', root).onclick = () => loadAccountBoard(root, true);
  $('#boardAdd', root).onclick = () => boardAcctModal(null, () => loadAccountBoard(root, true));
}

// 账号卡（账号总览 + 平台视图共用）
const matchGroupsFor = (r, groupsAll) => (groupsAll || []).filter((g) =>
  ownerOfBrand(g.account.brandName) === (r.owner || r.belong) && normPlat(g.account.platform) === normPlat(r.platform));
function acctCardHtml(r, groups) {
  const idle = r.idleDays > 3 ? `<span class="ab-idle warn">断更${r.idleDays}天</span>` : r.idleDays > 0 ? `<span class="ab-idle">断更${r.idleDays}天</span>` : `<span class="ab-idle ok">在更</span>`;
  const metric = (label, val) => `<div class="ab-metric"><b>${fmtNum(val)}</b><span>${label}</span></div>`;
  const cnt = (groups || []).reduce((n, g) => n + (g.entries?.length || 0), 0);
  const sp = socialPlat(r.platform);
  const pubChip = (r.credsCount || 0) > 0
    ? `<span class="ab-pub ok" title="${esc(sp ? sp.pub : '')}">🔗 可自动发布</span>`
    : sp ? `<span class="ab-pub" title="点 ✎ 补发布凭证（${esc(sp.pub)}）">未配发布凭证</span>` : '';
  return `<button class="ab-card" data-plat="${esc(r.platform)}" data-owner="${esc(r.owner || r.belong || '')}" data-name="${esc(r.name || '')}">
    <div class="ab-head"><span class="ab-plat">${PLAT_EMOJI[r.platform] || '📱'} ${esc(r.platform)}</span><span style="display:flex;gap:6px;align-items:center">${idle}<span class="ab-edit" data-edit="${esc(r.id || '')}" title="编辑账号数据" style="cursor:pointer;opacity:.55">✎</span></span></div>
    <div class="ab-name">${esc(r.name || '未命名')}</div>
    <div class="ab-fans"><b>${fmtNum(r.fans)}</b> 粉丝 ${r.net30 ? `<span class="ab-delta ${r.net30 > 0 ? 'up' : 'down'}">${r.net30 > 0 ? '+' : ''}${fmtNum(r.net30)}/30天</span>` : ''}</div>
    <div class="ab-metrics">${metric('播放', r.views30)}${metric('点赞', r.likes30)}${metric('评论', r.comments30)}${metric('发布', r.posts30)}</div>
    <div class="ab-foot"><span class="ab-content-badge">${cnt ? `📥 ${cnt} 条收录内容` : '暂无收录内容'}</span>${pubChip}<span class="ab-enter">进入 →</span></div>
  </button>`;
}

// 平台视图：这个平台下的每个账号 + 平台级汇总
function openPlatformView(platform, rows, boardRoot) {
  const sp = socialPlat(platform);
  const mine = rows.filter((r) => normPlat(r.platform) === normPlat(platform));
  const groupsAll = S.poolGroups || [];
  S.nav.stack.push({ label: '账号', restore: () => switchView('pool') });
  S.view = 'pool';
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === 'pool'));
  renderBackBar();
  const sum = (k) => mine.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const ready = mine.filter((r) => (r.credsCount || 0) > 0).length;
  const v = $('#view');
  v.innerHTML = `<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><div class="page-title">${sp ? sp.emoji : '📱'} ${esc(platform)}</div>
        <div class="page-sub">${mine.length} 个账号 · 粉丝合计 ${fmtNum(sum('fans'))} · 近30天播放 ${fmtNum(sum('views30'))}${ready ? ` · ${ready} 个可自动发布` : ''}${sp ? ` · 发布通道：${esc(sp.pub)}` : ''}</div></div>
      <button class="btn btn-accent btn-sm" id="platAdd">＋ 在${esc(platform)}加一个号</button></div>
    <div class="ab-grid" id="platGrid">${mine.map((r) => acctCardHtml(r, matchGroupsFor(r, groupsAll))).join('')}</div>`;
  $('#platAdd', v).onclick = () => boardAcctModal({ platform }, () => { switchView('pool'); });
  $$('.ab-edit', v).forEach((e) => e.onclick = (ev) => {
    ev.stopPropagation();
    const r = mine.find((x) => x.id === e.dataset.edit);
    if (r) boardAcctModal(r, () => openPlatformView(platform, rows, boardRoot));
  });
  $$('.ab-card', v).forEach((c) => c.onclick = () => {
    const r = mine.find((x) => (x.name || '') === c.dataset.name);
    if (!r) return;
    openAccountContent({ name: `${r.platform} · ${r.name}`, sub: `${r.owner || ''} · 粉丝 ${fmtNum(r.fans)} · 近30天播放 ${fmtNum(r.views30)}` }, matchGroupsFor(r, groupsAll), r,
      { label: platform, restore: () => openPlatformView(platform, rows, boardRoot) });
  });
}

async function loadAccountBoard(root, refresh) {
  const wrap = $('#accountBoardWrap', root);
  if (!wrap) return;
  if (refresh) wrap.innerHTML = `<div class="hint" style="padding:8px 2px">正在刷新…</div>`;
  let data;
  try { data = await api.get('/api/accounts/board' + (refresh ? '?refresh=1' : '')); }
  catch (e) { wrap.innerHTML = `<div class="rc-err" style="padding:10px 12px">账号数据读取失败：${esc(e.message)}</div>`; return; }
  const rows = data.rows || [];
  // 全平台矩阵：每个社媒平台一格——有号显示数量，没号一键在该平台开户
  const platRow = SOCIAL_PLATFORMS.map((p) => {
    const n = rows.filter((r) => normPlat(r.platform) === normPlat(p.id)).length;
    const ready = rows.filter((r) => normPlat(r.platform) === normPlat(p.id) && (r.credsCount || 0) > 0).length;
    return `<button class="plat-tile ${n ? 'has' : ''}" data-plat-add="${esc(p.id)}" title="${n ? `进入 ${p.id} 平台视图 · ${p.pub}` : `在 ${p.id} 开第一个号 · ${p.pub}`}">
      <span class="pt-em">${p.emoji}</span><span class="pt-name">${esc(p.id)}</span>
      <span class="pt-sub">${n ? `${n} 个号${ready ? ` · ${ready} 可自动发` : ''}` : '＋ 添加'}</span></button>`;
  }).join('');
  const platMatrix = `<div class="plat-matrix">${platRow}</div>`;
  if (!rows.length) { wrap.innerHTML = platMatrix + `<div class="hint" style="padding:10px 2px">还没有账号。点上面任意平台开户，或右上「＋ 添加账号」。</div>`; bindPlatMatrix(); return; }
  // 平台格子：有号 → 进平台视图看该平台下的每个号；没号 → 直接在这个平台开户
  function bindPlatMatrix() {
    $$('[data-plat-add]', wrap).forEach((t) => t.onclick = () => {
      const plat = t.dataset.platAdd;
      const mine = rows.filter((r) => normPlat(r.platform) === normPlat(plat));
      if (mine.length) openPlatformView(plat, rows, root);
      else boardAcctModal({ platform: plat }, () => loadAccountBoard(root, true));
    });
  }
  const groupsAll = S.poolGroups || [];
  const matchGroups = (r) => matchGroupsFor(r, groupsAll);
  const byOwner = {};
  rows.forEach((r) => { const k = r.owner || r.belong || '未分组'; (byOwner[k] = byOwner[k] || []).push(r); });
  const asOf = rows.map((r) => r.asOf).filter(Boolean).sort().pop() || '';
  const card = (r) => acctCardHtml(r, matchGroups(r));
  // 匹配不到任何账号卡的收录内容（如 B站），每个运营人兜底一张「其他收录」卡
  const matchedIds = new Set();
  rows.forEach((r) => matchGroups(r).forEach((g) => matchedIds.add(g.account.id)));
  const otherByOwner = {};
  groupsAll.forEach((g) => { if (!matchedIds.has(g.account.id)) { const o = ownerOfBrand(g.account.brandName); (otherByOwner[o] = otherByOwner[o] || []).push(g); } });

  wrap.innerHTML = platMatrix + `<div class="ab-meta">近30天数据 · 数据截止 ${esc(asOf || '—')} · 手动维护中（发布连接器上线后自动回流）</div>` +
    Object.entries(byOwner).map(([owner, list]) => {
      const other = otherByOwner[owner] || [];
      const otherCnt = other.reduce((n, g) => n + (g.entries?.length || 0), 0);
      const otherCard = otherCnt ? `<button class="ab-card ab-card-other" data-other="${esc(owner)}">
        <div class="ab-head"><span class="ab-plat">📦 其他收录</span></div>
        <div class="ab-name">未归类到具体账号</div>
        <div class="ab-foot"><span class="ab-content-badge">📥 ${otherCnt} 条（如 B站/其它平台）</span><span class="ab-enter">进入 →</span></div>
      </button>` : '';
      return `<div class="ab-owner-label">${esc(owner)} · ${list.length} 个号</div><div class="ab-grid">${list.map(card).join('')}${otherCard}</div>`;
    }).join('');

  bindPlatMatrix();
  // ✎ → 编辑账号数据（阻断卡片钻入）
  $$('.ab-edit', wrap).forEach((e) => e.onclick = (ev) => {
    ev.stopPropagation();
    const r = rows.find((x) => x.id === e.dataset.edit);
    if (r) boardAcctModal(r, () => loadAccountBoard(root, true));
  });
  // 卡片点击 → 钻入该账号的内容页
  $$('.ab-card', wrap).forEach((c) => c.onclick = () => {
    if (c.dataset.other) {
      openAccountContent({ name: `${c.dataset.other} · 其他收录内容`, sub: '未归类到具体账号的作品' }, otherByOwner[c.dataset.other] || []);
    } else {
      const r = rows.find((x) => x.platform === c.dataset.plat && (x.owner || x.belong) === c.dataset.owner && (x.name || '') === c.dataset.name);
      openAccountContent({ name: `${r.platform} · ${r.name}`, sub: `${r.owner || ''} · 粉丝 ${fmtNum(r.fans)} · 近30天播放 ${fmtNum(r.views30)}` }, matchGroups(r), r);
    }
  });
}

// 账号后台：新建 / 编辑账号（基础信息 + 数据 + 按平台的发布凭证——配齐就能自动发布）
function boardAcctModal(row, onDone) {
  const r = row || {};
  const isNew = !r.id;
  let plat = socialPlat(r.platform)?.id || r.platform || SOCIAL_PLATFORMS[0].id;
  const credsMask = r.credsMask || {};
  const inp = (id, label, value, ph) => `<label class="field"><span class="lab">${label}</span><input class="input" id="${id}" value="${esc(value ?? '')}" placeholder="${esc(ph || '')}"></label>`;
  const credsHtml = () => {
    const sp = socialPlat(plat);
    if (!sp) return '<div class="hint">自定义平台：先把账号建上，发布凭证等连接器支持</div>';
    return `<div class="hint" style="margin-bottom:8px">发布通道：${esc(sp.pub)} · 配齐下面字段，这个号就能自动发布</div>` +
      sp.fields.map(([k, label]) => inp(`cr_${k}`, label + (credsMask[k] ? `（已存 ${esc(credsMask[k])}）` : ''), '', credsMask[k] ? '留空不改，填 - 清除' : '')).join('');
  };
  modal({
    title: isNew ? `＋ 添加账号` : `✎ 编辑 · ${r.name || ''}`,
    bodyHtml: `
      <label class="field"><span class="lab">平台</span></label>
      <div class="chip-row" id="b_plat" style="margin-bottom:12px">${SOCIAL_PLATFORMS.map((p) => `<button type="button" class="chip ${p.id === plat ? 'sel' : ''}" data-p="${esc(p.id)}"><span class="chip-em">${p.emoji}</span>${esc(p.id)}</button>`).join('')}</div>
      <div class="grid-2">
        ${inp('b_name', '账号名', r.name)}
        ${inp('b_owner', '运营人', r.owner)}
      </div>
      <div class="section-label" style="margin-top:14px">🔗 发布凭证</div>
      <div id="b_creds">${credsHtml()}</div>
      <div class="section-label" style="margin-top:14px">📊 账号数据（手动维护，连接器上线后自动回流）</div>
      <div class="grid-2">
        ${inp('b_fans', '粉丝数', r.fans ?? '')}
        ${inp('b_net30', '近30天净增粉', r.net30 ?? '')}
        ${inp('b_posts30', '近30天发布数', r.posts30 ?? '')}
        ${inp('b_views30', '近30天播放', r.views30 ?? '')}
        ${inp('b_asOf', '数据截止日（YYYY-MM-DD）', r.asOf)}
        ${inp('b_lastPost', '最近发布日（YYYY-MM-DD）', r.lastPost)}
      </div>
      <label class="field"><span class="lab">数据备注</span><textarea class="textarea" id="b_note" rows="2">${esc(r.note || '')}</textarea></label>
      <label class="field"><span class="lab">打法思路</span><textarea class="textarea" id="b_idea" rows="2">${esc(r.idea || '')}</textarea></label>`,
    footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-ok>${isNew ? '创建' : '保存'}</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $$('#b_plat .chip', mask).forEach((ch) => ch.onclick = () => {
        plat = ch.dataset.p;
        $$('#b_plat .chip', mask).forEach((x) => x.classList.toggle('sel', x === ch));
        $('#b_creds', mask).innerHTML = credsHtml();
      });
      $('[data-ok]', mask).onclick = async () => {
        const val = (id) => $(`#${id}`, mask)?.value?.trim() ?? '';
        const name = val('b_name');
        if (!name) return toast('账号名不能为空', 'err');
        const num = (v) => (v === '' ? null : Number(v) || 0);
        const creds = {};
        (socialPlat(plat)?.fields || []).forEach(([k]) => { const v = $(`#cr_${k}`, mask)?.value?.trim(); if (v) creds[k] = v; });
        const doc = {
          name, platform: plat, owner: val('b_owner'), belong: r.belong || val('b_owner'),
          fans: num(val('b_fans')), net30: num(val('b_net30')), posts30: num(val('b_posts30')), views30: num(val('b_views30')),
          asOf: val('b_asOf'), lastPost: val('b_lastPost'), note: $('#b_note', mask).value.trim(), idea: $('#b_idea', mask).value.trim(),
          creds,
        };
        try {
          if (isNew) await api.post('/api/accounts/board', doc);
          else await api.put(`/api/accounts/board/${r.id}`, doc);
          toast('账号已保存 ✓', 'ok');
          close(); onDone?.();
        } catch (e) { toast(e.message, 'err'); }
      };
    },
  });
}

// 内容页（钻入）：某账号收录的作品 + 发布操作
function openAccountContent(acct, groups, boardRow, backEntry) {
  // backEntry：从平台视图钻进来时，返回该回平台视图而不是账号总览
  S.nav.stack.push(backEntry || { label: '账号', restore: () => switchView('pool') });
  S.view = 'pool';
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === 'pool'));
  renderBackBar();
  const v = $('#view');
  v.innerHTML = `<div class="page-head"><div><div class="page-title">${esc(acct.name)}</div>
    <div class="page-sub">${esc(acct.sub || '这个账号收录的作品，可在这里发布 / 标记 / 回填数据')}</div></div></div>
    <div id="acctDash"></div>
    <div id="poolBody"></div>`;
  // 看板数据大，列表不带——进页再按需拉全量
  if (boardRow?.hasDashboard || boardRow?.dashboard) {
    const paint = (row) => { const box = $('#acctDash', v); if (box && row?.dashboard) renderAcctDashboard(box, row); };
    if (boardRow.dashboard) paint(boardRow);
    else api.get(`/api/accounts/board/${boardRow.id}`).then(paint).catch(() => {});
  }
  renderPoolSections($('#poolBody', v), groups);
}

// ―― 账号数据看板：近30天汇总 + 趋势 + 整体账号数据 + 发布了什么（封面/链接/结果）――
const S_DASH = { expanded: false };
function renderAcctDashboard(box, row) {
  const d = row.dashboard;
  const s = d.summary || {};
  // 互动率：赞/评一个都没有时不显示（平台没导出 ≠ 互动率为 0）
  const engRate = s.views30 && (s.likes30 != null || s.comments30 != null)
    ? (((s.likes30 || 0) + (s.comments30 || 0)) / s.views30 * 100) : null;
  const tile = (label, val, sub) => val == null ? '' : `<div class="dash-tile"><b>${fmtNum(val)}</b><span>${label}</span>${sub ? `<i>${sub}</i>` : ''}</div>`;

  // 涨粉趋势：有 total 画总量线，只有 delta 画净增柱
  const trend = (d.fansTrend || []).filter((t) => t.date);
  let chart = '';
  if (trend.length >= 2) {
    const W = 560, H = 120, P = 6;
    const hasTotal = trend.some((t) => t.total != null);
    const vals = trend.map((t) => hasTotal ? (t.total ?? null) : (t.delta ?? 0));
    const nums = vals.filter((x) => x != null);
    const min = Math.min(...nums), max = Math.max(...nums);
    const span = (max - min) || 1;
    const x = (i) => P + i * (W - 2 * P) / (trend.length - 1);
    const y = (val) => H - P - (val - min) / span * (H - 2 * P);
    if (hasTotal) {
      let path = '', prev = null;
      vals.forEach((val, i) => { if (val == null) return; path += `${prev == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(val).toFixed(1)} `; prev = val; });
      chart = `<svg viewBox="0 0 ${W} ${H}" class="dash-svg" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>`;
    } else {
      const bw = Math.max(2, (W - 2 * P) / trend.length - 2);
      const zero = y(Math.max(0, min));
      chart = `<svg viewBox="0 0 ${W} ${H}" class="dash-svg" preserveAspectRatio="none">${vals.map((val, i) =>
        `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${Math.min(y(val), zero).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y(val) - zero)).toFixed(1)}" fill="${val >= 0 ? 'var(--accent)' : 'var(--err)'}" opacity=".85"><title>${esc(trend[i].date)} ${val >= 0 ? '+' : ''}${val}</title></rect>`).join('')}</svg>`;
    }
    const first = trend[0], last = trend[trend.length - 1];
    chart = `<div class="dash-chart"><div class="dash-chart-head"><b>${hasTotal ? '粉丝总量' : '每日净增'}</b><span>${esc(first.date.slice(5))} → ${esc(last.date.slice(5))}</span></div>${chart}</div>`;
  }

  // 周趋势（钉钉历史）：周播放柱状，悬停带净增/发布
  let history = '';
  const hp = (d.history?.points || []).filter((p) => p.date && p.views != null);
  if (hp.length >= 2) {
    const W = 560, H = 110, P = 6;
    const max = Math.max(...hp.map((p) => p.views)) || 1;
    const bw = Math.max(4, (W - 2 * P) / hp.length - 4);
    const bars = hp.map((p, i) => {
      const bh = Math.max(2, p.views / max * (H - 2 * P));
      const bx = P + i * (W - 2 * P) / hp.length + 2;
      return `<rect x="${bx.toFixed(1)}" y="${(H - P - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="var(--accent)" opacity=".8"><title>${esc(p.date)} 周播放 ${fmtNum(p.views)}${p.net != null ? ` · 涨粉 ${p.net >= 0 ? '+' : ''}${p.net}` : ''}${p.posts != null ? ` · 发布 ${p.posts}` : ''}</title></rect>`;
    }).join('');
    history = `<div class="dash-chart"><div class="dash-chart-head"><b>周播放趋势（${esc(d.history.source || '历史')} · ${hp.length} 周）</b><span>${esc(hp[0].date.slice(5))} → ${esc(hp[hp.length - 1].date.slice(5))}</span></div>
      <svg viewBox="0 0 ${W} ${H}" class="dash-svg" preserveAspectRatio="none">${bars}</svg></div>`;
  }

  // ―― 整体账号数据：从全量内容里算出的账号盘子（不止近30天）――
  const all = d.contents || [];
  const viewsArr = all.map((c) => Number(c.views) || 0).filter((v) => v > 0).sort((a, b) => b - a);
  const totalViews = viewsArr.reduce((s, v) => s + v, 0);
  const median = viewsArr.length ? viewsArr[Math.floor(viewsArr.length / 2)] : null;
  const dates = all.map((c) => c.publishedAt).filter(Boolean).sort();
  const best = all.find((c) => (Number(c.views) || 0) === viewsArr[0]);
  const over1k = viewsArr.filter((v) => v >= 1000).length;
  const overallTile = (label, val, sub) => val == null ? '' : `<div class="dash-tile sm"><b>${typeof val === 'string' ? esc(val) : fmtNum(val)}</b><span>${label}</span>${sub ? `<i>${esc(sub)}</i>` : ''}</div>`;
  const overall = all.length ? `<div class="dash-sub">📦 整体账号数据（全部 ${all.length} 条内容）</div>
    <div class="dash-tiles">
      ${overallTile('内容总数', all.length, dates.length ? `${dates[0].slice(5)} 起` : '')}
      ${overallTile('累计播放', totalViews)}
      ${overallTile('平均播放', Math.round(totalViews / all.length))}
      ${overallTile('播放中位数', median)}
      ${overallTile('最高播放', viewsArr[0], best ? String(best.title || '').slice(0, 12) : '')}
      ${overallTile('破千条数', over1k, all.length ? `占 ${(over1k / all.length * 100).toFixed(0)}%` : '')}
    </div>` : '';

  // ―― 发布了什么：封面 + 标题 + 链接 + 发布结果，全部内容按播放降序 ――
  const shown = all.slice(0, S_DASH.expanded ? all.length : 12);
  const metric = (label, v) => v == null ? '' : `<span><i>${label}</i>${fmtNum(v)}</span>`;
  const pubCards = shown.map((c, i) => {
    const cover = c.coverUrl
      ? `<img class="pc-cover" src="${esc(c.coverUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'pc-cover pc-ph',textContent:'${esc(String(c.type || '内容').slice(0, 2))}'}))"/>`
      : `<div class="pc-cover pc-ph">${esc(String(c.type || '内容').slice(0, 2))}</div>`;
    const link = c.url ? `<a class="pc-open" href="${esc(safeHref(c.url))}" target="_blank" rel="noopener" title="打开原帖">↗</a>` : '';
    // 发布结果：平台给什么就显示什么（完播/封面点击率/跳出率这些是判断内容好坏的真信号）
    const ex = c.extra || {};
    // 平台导出的率有两种口径：0.387（小数）和 38.7（百分数），统一显示成百分比
    const pct = (v) => {
      const n = Number(String(v).replace(/%$/, ''));
      if (!isFinite(n)) return String(v);
      return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
    };
    const sec = (v) => `${Number(v).toFixed(1)}s`;
    const extraBits = [
      c.completionRate != null ? `完播 ${pct(c.completionRate)}` : '',
      ex['5s完播率'] != null ? `5s完播 ${pct(ex['5s完播率'])}` : '',
      ex['封面点击率'] != null ? `封面点击 ${pct(ex['封面点击率'])}` : (ex['封面点击率(%)'] != null ? `封面点击 ${pct(ex['封面点击率(%)'])}` : ''),
      ex['2s跳出率'] != null ? `2s跳出 ${pct(ex['2s跳出率'])}` : '',
      c.avgWatchSec != null ? `均看 ${sec(c.avgWatchSec)}` : '',
      c.followersGained ? `涨粉 +${c.followersGained}` : '',
      c.homepageVisits != null ? `主页访问 ${c.homepageVisits}` : '',
      ex['曝光'] != null ? `曝光 ${fmtNum(ex['曝光'])}` : '',
      c.duration != null ? `${c.duration}s` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="pub-card">
      <div class="pc-rank">${i + 1}</div>
      ${cover}
      <div class="pc-main">
        <div class="pc-title" title="${esc(c.title || '')}">${esc(String(c.title || '未命名').slice(0, 46))}</div>
        <div class="pc-meta">${esc((c.publishedAt || '').slice(0, 10) || '日期未知')}${c.type ? ` · ${esc(c.type)}` : ''}${extraBits ? ` · ${esc(extraBits)}` : ''}</div>
        <div class="pc-stats">${metric('播放', c.views)}${metric('赞', c.likes)}${metric('评', c.comments)}${metric('转', c.shares)}${metric('藏', c.favorites)}</div>
      </div>${link}</div>`;
  }).join('');
  const noLink = all.length && !all.some((c) => c.url);
  const noCover = all.length && !all.some((c) => c.coverUrl);
  const lackNote = [noCover ? '封面' : '', noLink ? '原帖链接' : ''].filter(Boolean).join('与');
  const pubBlock = all.length ? `<div class="dash-sub">🚀 发布了什么 · 发布结果<span class="hint">按播放降序${all.length > 12 && !S_DASH.expanded ? ` · 显示前 12/${all.length}` : ''}${lackNote ? ` · 平台导出未含${lackNote}` : ''}</span></div>
    <div class="pub-grid">${pubCards}</div>
    ${all.length > 12 ? `<button class="btn btn-ghost btn-sm" id="dashMore" style="margin-top:10px">${S_DASH.expanded ? '收起' : `展开全部 ${all.length} 条`}</button>` : ''}` : '';

  const extras = Object.entries(d.extras || {}).filter(([, v]) => v != null && v !== '').slice(0, 12);

  box.innerHTML = `<div class="dash-card">
    <div class="dash-head"><span>📊 数据看板</span><span class="hint">数据截止 ${esc(d.asOf || '—')} · 导入于 ${esc((d.importedAt || '').slice(5, 16).replace('T', ' '))}</span></div>
    <div class="dash-tiles">
      ${tile('粉丝', s.fans, s.fansDelta30 != null ? `${s.fansDelta30 >= 0 ? '+' : ''}${fmtNum(s.fansDelta30)}/30天` : '')}
      ${tile('播放/浏览 30天', s.views30)}
      ${tile('点赞 30天', s.likes30)}
      ${tile('评论 30天', s.comments30)}
      ${tile('分享 30天', s.shares30)}
      ${tile('收藏 30天', s.favorites30)}
      ${tile('发布 30天', s.posts30)}
      ${engRate != null ? `<div class="dash-tile"><b>${engRate.toFixed(2)}%</b><span>互动率</span><i>(赞+评)/播放</i></div>` : ''}
    </div>
    ${chart}
    ${history}
    ${overall}
    ${pubBlock}
    ${extras.length ? `<div class="dash-sub">🔎 平台特有指标</div><div class="dash-extras">${extras.map(([k, v]) => `<span class="dash-extra"><i>${esc(k)}</i>${esc(String(v))}</span>`).join('')}</div>` : ''}
  </div>`;

  const moreBtn = $('#dashMore', box);
  if (moreBtn) moreBtn.onclick = () => { S_DASH.expanded = !S_DASH.expanded; renderAcctDashboard(box, row); };
}

// 把「按账号分组的收录内容」渲染成分区（账号页钻入 + 复用）
function renderPoolSections(body, groups) {
  const real = (groups || []).filter((g) => (g.entries?.length || 0) > 0);
  if (!real.length) { body.innerHTML = emptyHtml('📥', '这个账号还没有收录内容。去草稿箱打开作品，点右上「＋ 收录」到这个账号。'); return; }
  body.innerHTML = `<div class="account-library" id="accountLibrary"></div>`;
  const library = $('#accountLibrary', body);
  real.forEach(({ account, entries }) => {
    const section = el(`<section class="account-section">
      <header class="account-section-head">
        <div class="account-identity">
          <span class="account-dot" style="background:${esc(account.primaryColor || '#1a1a1e')}"></span>
          <div><h2>${esc(account.platform)}</h2><p>${esc(account.brandName || account.name || '未命名账号')}</p></div>
        </div>
        <div class="account-progress"><b>${account.published || 0}/${account.count || 0}</b><span>已发布 / 已收录</span></div>
      </header>
      <div class="account-task-list"></div>
    </section>`);
    const taskList = $('.account-task-list', section);
    // 账号视角两段式：待发布验收（干活区）在前，已发布简览（数据区）在后
    const drafts = entries.filter((e) => e.status !== 'published');
    const published = entries.filter((e) => e.status === 'published');
    if (drafts.length) {
      taskList.appendChild(el(`<div class="acct-stage-label">📦 发布验收 · ${drafts.length} 条待发</div>`));
      const taskGroups = new Map();
      drafts.forEach((entry) => {
        const key = entry.taskId || entry.id;
        if (!taskGroups.has(key)) taskGroups.set(key, []);
        taskGroups.get(key).push(entry);
      });
      taskGroups.forEach((taskEntries) => {
        const first = taskEntries[0];
        const group = el(`<div class="account-task-group">
          <div class="account-task-head"><span>${esc(first.taskLabel || first.title || 'one 内容任务')}</span>
            ${first.taskId ? '<button class="btn btn-ghost btn-sm" data-open-task>查看任务</button>' : ''}</div>
          <div class="account-work-grid"></div></div>`);
        const open = $('[data-open-task]', group);
        if (open) open.onclick = () => openContentTask(first.taskId, 'pool');
        const grid = $('.account-work-grid', group);
        taskEntries.forEach((entry) => grid.appendChild(poolEntryCard(entry, account)));
        taskList.appendChild(group);
      });
    }
    if (published.length) {
      taskList.appendChild(el(`<div class="acct-stage-label">✅ 已发布简览 · ${published.length} 条${published.some((e) => !e.stats) ? ' · 有数据待回填' : ''}</div>`));
      const listEl = el('<div class="pub-list"></div>');
      published
        .sort((a, b) => new Date(b.publishedAt || b.addedAt || 0) - new Date(a.publishedAt || a.addedAt || 0))
        .forEach((e) => {
          const s = e.stats || {};
          const row = el(`<button class="pub-row">
            <span class="pub-date">${esc(String(e.publishedAt || '').slice(5, 10) || '—')}</span>
            <span class="pub-title">${esc(e.copyTitle || e.title || '未命名')}</span>
            <span class="pub-stats">${s.views != null ? `▶ ${fmtNum(s.views)} · 👍 ${fmtNum(s.likes || 0)} · 💬 ${fmtNum(s.comments || 0)}` : '<i>数据待回填</i>'}</span>
            ${e.publishedUrl ? '<span class="pub-link">🔗</span>' : ''}</button>`);
          row.onclick = () => poolEntryDetailModal(e, account);
          listEl.appendChild(row);
        });
      taskList.appendChild(listEl);
    }
    library.appendChild(section);
  });
}

function poolEntryTypeInfo(entry) {
  if (entry.videoUrl) {
    const mediaSource = [entry.title, entry.videoUrl, entry.coverUrl].join(' ');
    if (/竖屏|vertical|9[:x]16|shorts/i.test(mediaSource)) return { label: '竖屏视频', className: 'vertical' };
    if (/横屏|wide|16[:x]9|youtube|b站|bilibili/i.test(mediaSource)) return { label: '横屏视频', className: 'horizontal' };
    if (/shorts|tiktok|抖音|小红书|视频号/i.test(entry.platform || '')) return { label: '竖屏视频', className: 'vertical' };
    return { label: '横屏视频', className: 'horizontal' };
  }
  if (entry.coverUrl) return { label: '图文', className: 'mixed' };
  return { label: '纯文章', className: 'text' };
}

function poolEntrySummary(entry) {
  return [
    entry.videoUrl ? '1 视频' : '',
    entry.coverUrl ? '1 图片' : '',
    entry.copy ? '1 文案' : '',
  ].filter(Boolean).join(' · ');
}

function poolEntryPreviewHtml(entry) {
  if (entry.coverUrl) return `<img src="${esc(entry.coverUrl)}" alt="" loading="lazy"/>`;
  if (entry.videoUrl) return `<video muted playsinline preload="metadata" src="${esc(entry.videoUrl)}#t=0.1"></video><span class="wk-play">▶</span>`;
  const text = String(entry.copyBody || entry.copy || '暂无预览').replace(/\s+/g, ' ').trim().slice(0, 180);
  return `<div class="wk-preview-text">${esc(text)}</div>`;
}

function poolEntryCard(entry, account) {
  const type = poolEntryTypeInfo(entry);
  const date = String(entry.createdAt || '').slice(0, 10);
  const card = el(`<article class="work-card account-work-card ${entry.status === 'published' ? 'is-published' : ''}" tabindex="0" role="button">
    <div class="wk-preview ${type.className}">
      ${poolEntryPreviewHtml(entry)}
      <div class="wk-preview-shade"></div>
      <div class="wk-preview-foot"><span>${esc(poolEntrySummary(entry) || type.label)}</span><b>查看全部</b></div>
    </div>
    <div class="wk-card-body">
      <div class="wk-head"><span class="wk-account">${esc(account.platform)}</span><span class="wk-type">${esc(type.label)}</span></div>
      <div class="wk-title">${esc(entry.copyTitle || entry.title || '未命名内容')}</div>
      <div class="wk-card-meta"><time>${esc(date)}</time>${entry.status === 'published' ? '<span class="wk-published">✓ 已发布</span>' : '<span class="account-draft">待发布</span>'}</div>
    </div>
  </article>`);
  const open = () => poolEntryDetailModal(entry, account);
  card.onclick = open;
  card.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  return card;
}

function poolEntryDetailModal(entry, account, onRefresh) {
  const type = poolEntryTypeInfo(entry);
  const date = String(entry.createdAt || '').slice(0, 16).replace('T', ' ');
  const canPublishYoutube = entry.workExists && entry.videoUrl && /youtube/i.test(entry.platform || '');
  const canPublishTiktok = entry.workExists && entry.videoUrl && /tiktok|tk/i.test(entry.platform || '');
  const mask = el(`<div class="modal-mask work-detail-mask account-detail-mask">
    <section class="work-detail-modal" role="dialog" aria-modal="true">
      <header class="work-detail-head">
        <div class="work-detail-title">
          <div><span>${esc(account.platform)}</span><i>${esc(type.label)}</i><time>${esc(date)}</time></div>
          ${entry.taskLabel ? `<small class="work-detail-task">${esc(entry.taskLabel)}</small>` : ''}
          <h2>${esc(entry.copyTitle || entry.title || '未命名内容')}</h2>
        </div>
        <div class="work-detail-actions">
          ${canPublishYoutube ? '<button class="btn btn-primary btn-sm" data-youtube>▶ 发布 YouTube</button>' : ''}
          ${canPublishTiktok ? '<button class="btn btn-primary btn-sm" data-tiktok>▶ 发布 TikTok</button>' : ''}
          ${entry.workExists ? '<button class="btn btn-ghost btn-sm" data-download>↓ 下载</button><button class="btn btn-ghost btn-sm" data-folder>□ 文件夹</button><button class="btn btn-ghost btn-sm" data-copypath>⧉ 复制地址</button>' : ''}
          <button class="btn btn-ghost btn-sm" data-published>${entry.status === 'published' ? '✕ 取消已发' : '✓ 标为已发'}</button>
          ${entry.status === 'published' ? '<button class="btn btn-ghost btn-sm" data-stats>数据</button>' : ''}
          ${entry.status === 'published' && /youtube/i.test(entry.platform || '') && /[?&]v=/.test(entry.publishedUrl || '') ? '<button class="btn btn-ghost btn-sm" data-ytstats>📊 抓 YouTube 数据</button>' : ''}
          <button class="btn btn-ghost btn-sm" data-remove>移除</button>
          <button class="work-detail-close" data-close title="关闭" aria-label="关闭">×</button>
        </div>
      </header>
      <div class="work-detail-layout">
        <section class="work-detail-media"><div class="work-detail-label">媒体</div><div data-media></div></section>
        <section class="work-detail-copy">
          <div class="work-detail-label">发布内容</div>
          <div class="work-detail-facts">
            <span>${esc(account.brandName || account.name || '')}</span>
            <span>${esc(entry.platform)}</span>
            <span>${entry.status === 'published' ? '已发布' : '待发布'}</span>
          </div>
          ${entry.publishedUrl ? `<div class="pc-url"><a href="${esc(entry.publishedUrl)}" target="_blank" rel="noopener">${esc(entry.publishedUrl)}</a></div>` : ''}
          ${entry.stats && (entry.stats.views || entry.stats.likes || entry.stats.comments) ? `<div class="pc-stats">播放 ${esc(String(entry.stats.views ?? '-'))} · 赞 ${esc(String(entry.stats.likes ?? '-'))} · 评 ${esc(String(entry.stats.comments ?? '-'))}</div>` : ''}
          <div class="account-copy-sheet">
            ${entry.copyTitle ? `<h3>${esc(entry.copyTitle)}</h3>` : ''}
            ${entry.copyBody || entry.copy ? `<div class="account-copy-body">${esc(entry.copyBody || entry.copy)}</div>` : '<div class="work-detail-empty">这条内容没有文字文案</div>'}
            ${entry.copyTags ? `<div class="account-copy-tags">${esc(entry.copyTags)}</div>` : ''}
            ${entry.copy ? `<div class="pc-copy-btns">
              ${entry.copyTitle ? '<button class="btn btn-ghost btn-sm" data-copy-title>⧉ 标题</button>' : ''}
              ${entry.copyBody ? '<button class="btn btn-ghost btn-sm" data-copy-body>⧉ 正文</button>' : ''}
              ${entry.copyTags ? '<button class="btn btn-ghost btn-sm" data-copy-tags>⧉ Tags</button>' : ''}
              <button class="btn btn-ghost btn-sm" data-copy-all>⧉ 全部</button>
            </div>` : ''}
          </div>
        </section>
      </div>
    </section>
  </div>`);
  const mediaWrap = $('[data-media]', mask);
  if (entry.videoUrl) mediaWrap.appendChild(workItem({ type: 'video', url: entry.videoUrl, label: entry.platform }));
  if (entry.coverUrl) mediaWrap.appendChild(workItem({ type: 'image', url: entry.coverUrl, label: '封面' }));
  if (!entry.videoUrl && !entry.coverUrl) mediaWrap.innerHTML = `<div class="work-detail-empty">这条内容没有媒体文件</div>`;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    mask.remove();
  };
  const refresh = () => {
    close();
    if (onRefresh) onRefresh();
    else renderContentLibrary($('#view'));
  };
  const onKey = (event) => {
    const masks = $$('.modal-mask');
    if (event.key === 'Escape' && masks.at(-1) === mask) close();
  };
  mask.onclick = (event) => { if (event.target === mask) close(); };
  $('[data-close]', mask).onclick = close;
  const download = $('[data-download]', mask);
  if (download) download.onclick = () => downloadWork({ id: entry.workId });
  const folder = $('[data-folder]', mask);
  if (folder) folder.onclick = (event) => revealWork({ id: entry.workId }, event.currentTarget);
  freezeIfRemote(folder);
  const copyPath = $('[data-copypath]', mask);
  if (copyPath) copyPath.onclick = (event) => copyWorkPath({ id: entry.workId }, event.currentTarget);
  freezeIfRemote(copyPath);
  const youtube = $('[data-youtube]', mask);
  if (youtube) youtube.onclick = async () => {
    const fullDesc = [entry.copyBody, entry.copyTags].filter(Boolean).join('\n\n'); // 简介带上正文 + 全部标签
    const res = await askText({
      title: '上传到 YouTube', okText: '确认上传',
      msg: '标题 / 简介 / 标签全部带上，可改。可见性默认公开。',
      fields: [
        { key: 'title', label: '标题', value: entry.copyTitle || entry.title || '' },
        { key: 'description', label: '简介（含正文 + 标签）', type: 'textarea', rows: 8, value: fullDesc },
        { key: 'tags', label: 'YouTube 标签（空格分隔）', value: entry.copyTags || '' },
        { key: 'privacy', label: '可见性', type: 'select', value: 'public', options: [
          { value: 'public', label: '公开' }, { value: 'unlisted', label: '不公开（仅链接可见）' }, { value: 'private', label: '私有' },
        ] },
      ],
    });
    if (res === null) return;
    youtube.disabled = true;
    youtube.innerHTML = '<span class="spin"></span> 上传中';
    try {
      const result = await api.post(`/api/pool/${entry.id}/publish-youtube`, res);
      try { await navigator.clipboard.writeText(result.url); } catch {}
      toast(`已上传（${result.privacy}）✓${result.coverMsg || ''}`, result.thumbnailError ? 'warn' : 'ok');
      refresh();
    } catch (error) {
      toast(error.message, 'err');
      youtube.disabled = false;
      youtube.textContent = '▶ 发布 YouTube';
    }
  };
  const tiktok = $('[data-tiktok]', mask);
  if (tiktok) tiktok.onclick = async () => {
    const defaultCaption = [entry.copyBody || entry.copyTitle || entry.title, entry.copyTags]
      .filter(Boolean).join('\n\n');
    const res = await askText({
      title: '发布到 TikTok', okText: '确认发布',
      msg: '下面是要发到 TikTok 的完整文案（含 tag），可以直接改。视频用这条内容的成片。',
      fields: [{ key: 'caption', label: '文案 + 标签', type: 'textarea', rows: 8, value: defaultCaption }],
    });
    if (res === null) return;
    tiktok.disabled = true;
    tiktok.innerHTML = '<span class="spin"></span> 发布中';
    try {
      const result = await api.post(`/api/pool/${entry.id}/publish-tiktok`, { caption: res.caption });
      toast(result.message || '已提交 TikTok 发布 ✓', 'ok');
      refresh();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      tiktok.disabled = false;
      tiktok.textContent = '▶ 发布 TikTok';
    }
  };
  $('[data-published]', mask).onclick = async () => {
    try {
      if (entry.status !== 'published') {
        const res = await askText({ title: '标为已发', fields: [{ key: 'url', label: '发布链接（可留空）', value: entry.publishedUrl || '', placeholder: 'https://…' }] });
        if (res === null) return;
        await api.post(`/api/pool/${entry.id}/published`, { published: true, url: res.url });
        toast('已标为已发布 ✓', 'ok');
      } else {
        await api.post(`/api/pool/${entry.id}/published`, { published: false });
        toast('已取消发布标记', 'ok');
      }
      refresh();
    } catch (error) {
      toast(error.message, 'err');
    }
  };
  const stats = $('[data-stats]', mask);
  if (stats) stats.onclick = () => fillPoolStats(entry, refresh);
  const ytstats = $('[data-ytstats]', mask);
  if (ytstats) ytstats.onclick = async () => {
    ytstats.disabled = true; ytstats.innerHTML = '<span class="spin"></span> 抓取中';
    try {
      const r = await api.post(`/api/pool/${entry.id}/youtube-stats`, {});
      toast(`已抓 YouTube 数据：播放${r.stats.views} 赞${r.stats.likes} 评${r.stats.comments} ✓`, 'ok');
      refresh();
    } catch (e) { toast(e.message, 'err'); }
    finally { ytstats.disabled = false; ytstats.textContent = '📊 抓 YouTube 数据'; }
  };
  $('[data-remove]', mask).onclick = async () => {
    if (!(await askConfirm('从账号移除', '从这个账号移除该内容？'))) return;
    try {
      await api.del(`/api/pool/${entry.id}`);
      toast('已从账号移除', 'ok');
      refresh();
    } catch (error) {
      toast(error.message, 'err');
    }
  };
  const copies = {
    '[data-copy-title]': [entry.copyTitle, '标题'],
    '[data-copy-body]': [entry.copyBody, '正文'],
    '[data-copy-tags]': [entry.copyTags, 'Tags'],
    '[data-copy-all]': [entry.copy, '全部文案'],
  };
  Object.entries(copies).forEach(([selector, [value, label]]) => {
    const button = $(selector, mask);
    if (button) button.onclick = () => { navigator.clipboard.writeText(value || ''); toast(`已复制${label}`, 'ok'); };
  });
  document.addEventListener('keydown', onKey);
  $('#modalRoot').appendChild(mask);
}

async function fillPoolStats(entry, onComplete) {
  const res = await askText({
    title: `填数据 · ${entry.platform || ''}`, okText: '记录',
    fields: [
      { key: 'views', label: '播放量', value: entry.stats?.views ?? '', type: 'number' },
      { key: 'likes', label: '点赞', value: entry.stats?.likes ?? '', type: 'number' },
      { key: 'comments', label: '评论', value: entry.stats?.comments ?? '', type: 'number' },
    ],
  });
  if (res === null) return;
  try {
    await api.put(`/api/pool/${entry.id}/stats`, res);
    toast('数据已记录 ✓', 'ok');
    if (onComplete) onComplete();
  } catch (error) {
    toast(error.message, 'err');
  }
}

function workItem(it) {
  if (it.type === 'video') {
    return el(`<div class="wk-item">
      <video controls preload="metadata" src="${esc(it.url)}"></video>
      ${it.label ? `<div class="wk-item-label">▶ ${esc(it.label)}</div>` : ''}</div>`);
  }
  if (it.type === 'image') {
    const wrap = el(`<div class="wk-item">
      <img src="${esc(it.url)}" alt="" title="点击查看大图"/>
      ${it.label ? `<div class="wk-item-label">🖼 ${esc(it.label)}</div>` : ''}</div>`);
    $('img', wrap).onclick = () => window.open(it.url, '_blank', 'noopener');
    return wrap;
  }
  // text — 按平台（# 标题）拆分，每块可读全文 + 单独复制
  const text = it.content || '';
  const sections = splitCopySections(text);
  const wrap = el(`<div class="wk-item wk-item-text">
    ${it.label ? `<div class="wk-item-label">📝 ${esc(it.label)}</div>` : ''}
    <div class="wk-copy-sections"></div></div>`);
  const sw = $('.wk-copy-sections', wrap);
  if (sections.length <= 1) {
    const body = sections[0]?.body || text;
    const block = el(`<div class="wk-copy-sec">
      <div class="wk-copy-sec-head"><span>${esc(sections[0]?.title || '文案')}</span><button class="btn btn-ghost btn-sm" data-c>⧉ 复制</button></div>
      <div class="wk-copy-body">${esc(body)}</div></div>`);
    $('[data-c]', block).onclick = () => { navigator.clipboard.writeText(body); toast('已复制到剪贴板', 'ok'); };
    sw.appendChild(block);
  } else {
    sections.forEach((s) => {
      const block = el(`<div class="wk-copy-sec">
        <div class="wk-copy-sec-head"><span>${esc(s.title)}</span><button class="btn btn-ghost btn-sm" data-c>⧉ 复制</button></div>
        <div class="wk-copy-body">${esc(s.body)}</div></div>`);
      $('[data-c]', block).onclick = () => { navigator.clipboard.writeText(s.body); toast(`已复制「${s.title}」`, 'ok'); };
      sw.appendChild(block);
    });
    const all = el(`<button class="btn btn-ghost btn-sm wk-copy-all" data-all>⧉ 复制全部平台</button>`);
    all.onclick = () => { navigator.clipboard.writeText(text); toast('已复制全部文案', 'ok'); };
    sw.appendChild(all);
  }
  return wrap;
}

// 把 publish_copy.md 按「# 平台名」拆成多块，各含该平台完整文案（标题+正文+tag）
function splitCopySections(text) {
  const lines = String(text || '').split('\n');
  const top = [];
  let topCur = null;
  for (const ln of lines) {
    const m = /^#(?!#)\s+(.+?)\s*$/.exec(ln);
    if (m) { topCur = { title: m[1].trim(), body: [] }; top.push(topCur); }
    else if (topCur) { if (ln.trim() === '---') continue; topCur.body.push(ln); }
  }
  const topSections = top
    .map((s) => ({ title: s.title, body: s.body.join('\n').trim() }))
    .filter((s) => s.body);
  const platformRe = /抖音|小红书|视频号|youtube(?:\s+shorts)?|tiktok|b站|bilibili|公众号|twitter|^x$/i;
  if (topSections.some((s) => platformRe.test(s.title))) return topSections;

  const secs = [];
  let cur = null;
  for (const ln of lines) {
    const m = /^#{1,2}\s+(.+?)\s*$/.exec(ln);
    if (m) { cur = { title: m[1].trim(), body: [] }; secs.push(cur); }
    else if (cur) { if (ln.trim() === '---') continue; cur.body.push(ln); }
  }
  return secs.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })).filter((s) => s.body);
}

// =========================================================
//  品牌库
// =========================================================
async function renderBrands(root) {
  const list = S.boot.brands || [];
  root.innerHTML = `<div class="page-head"><div class="page-title">品牌 & IP 库</div>
    <div class="page-sub">每个品牌或 IP 都带着 logo、主色、语气、受众和旗下账号。点「□ 品牌/IP 空间」看对话窗/生产线为它写的所有文件。</div></div>
    <div class="brand-board-list" id="brandGrid"></div>
    <div id="hqOrphans" style="margin-top:22px"></div>`;
  const grid = $('#brandGrid', root);
  let accounts = [];
  if (list.length) { try { accounts = await api.get('/api/accounts'); } catch { accounts = []; } }
  if (!list.length) {
    grid.before(renderRecoveryCard({
      icon: '🚀',
      title: '还没有品牌，30 秒建一个',
      desc: '写一句话，AI 帮你把定位、语气、受众、内容红线全填好，你再改改就行——建好后选题才能自动路由到它。',
      actions: [{ label: '+ 建个号（AI帮你填）', primary: true, onClick: () => brandModal(null, { focusAI: true }) }],
    }));
  }
  list.forEach((b) => grid.appendChild(brandCard(b, accounts)));
  const add = el(`<button class="add-card">＋ 新建品牌</button>`);
  add.addEventListener('click', () => brandModal(null));
  grid.appendChild(add);
  // BrandHQ 里存在、但还没登记成品牌的目录（对话窗新建的品牌先出现在这）
  api.get('/api/brandhq/dirs').then((dirs) => {
    const orphans = dirs.filter((d) => !d.brandId);
    if (!orphans.length) return;
    const box = $('#hqOrphans', root);
    if (!box) return;
    box.innerHTML = `<div class="section-label">📂 BrandHQ 里的新目录（还没登记成品牌）</div><div class="chip-row" id="orphanRow"></div>`;
    const row = $('#orphanRow', box);
    orphans.forEach((o) => {
      const chip = el(`<button class="chip"><span class="chip-em">📂</span>${esc(o.dir)}<span class="chip-hint">点开看文件</span></button>`);
      chip.onclick = () => openBrandSpace(o.dir, null);
      row.appendChild(chip);
    });
  }).catch(() => {});
}

// 品牌空间 = 品牌知识库：浏览/编辑/新建/URL导入四件套/AI整理/双链（11ag project-knowledge 移植）
async function openBrandSpace(dir, brand) {
  const root = $('#view');
  if (!dir && brand) {
    try {
      const dirs = await api.get('/api/brandhq/dirs');
      dir = (dirs.find((d) => d.brandId === brand.id) || {}).dir || brand.name;
    } catch { dir = brand.name; }
  }
  try { localStorage.setItem('ag_last_view', 'space:' + dir); } catch {} // 刷新仍回这个空间
  const kindWord = brandTypeLabel(brand);
  root.innerHTML = `<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
      <div><button class="btn btn-ghost btn-sm" id="bsBack" style="margin-bottom:12px">← 品牌 & IP 库</button>
        <div class="page-title">📂 ${esc(dir)}</div>
        <div class="page-sub">${kindWord}知识库 · 对话窗和生产线写的文件都在这，支持编辑 / 双链 / AI 整理</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="bsNew">＋ 新建文档</button>
        <button class="btn btn-ghost btn-sm" id="bsImport">🧲 导入官网/文章</button>
        <button class="btn btn-ghost btn-sm" id="bsOrganize">🧹 AI 整理</button>
        ${brand ? '' : `<button class="btn btn-accent btn-sm" id="bsRegister">＋ 登记成品牌</button>`}
        <button class="btn btn-ghost btn-sm" id="bsReveal">访达</button>
      </div></div>
    <div class="bs-cols">
      <div class="bs-list" id="bsList"><div class="hint" style="padding:12px">加载中…</div></div>
      <div class="bs-preview" id="bsPreview"><div class="empty"><div class="em-glyph">📄</div><div class="em-text">点左侧文件预览</div></div></div>
    </div>`;
  $('#bsBack', root).onclick = () => switchView('brands');
  $('#bsReveal', root).onclick = async () => { try { const r = await api.post('/api/brandhq/reveal', { dir }); try { await navigator.clipboard.writeText(r.folder); } catch {} toast('已在访达打开', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  freezeIfRemote($('#bsReveal', root));
  const reg = $('#bsRegister', root);
  if (reg) reg.onclick = () => brandModal({ name: dir });

  let files = [];
  let kb = [];
  let ov = null;
  const refresh = () => openBrandSpace(dir, brand);
  try {
    [files, kb, ov] = await Promise.all([
      api.get(`/api/brandhq/files?dir=${encodeURIComponent(dir)}`),
      api.get(`/api/brandhq/kb?dir=${encodeURIComponent(dir)}`).catch(() => []),
      api.get(`/api/brandhq/overview?dir=${encodeURIComponent(dir)}`).catch(() => null),
    ]);
  } catch (e) { $('#bsList', root).innerHTML = `<div class="rc-err" style="padding:12px">${esc(e.message)}</div>`; return; }

  // ―― 品牌全景（默认页）：排期 / 作品 / 发布 / 创作 全串起来 ――
  const renderOverview = () => {
    $$('.bs-file.sel', listEl).forEach((x) => x.classList.remove('sel'));
    $('.bs-ov-btn', listEl)?.classList.add('sel');
    const pv = $('#bsPreview', root);
    if (!ov || !ov.brandId) {
      pv.innerHTML = `<div class="empty"><div class="em-glyph">🧭</div><div class="em-text">这个目录还没登记成品牌——登记后这里会显示排期 / 作品 / 发布全景</div></div>`;
      return;
    }
    const stLabel = { scheduled: '待生成', running: '生成中', done: '已生成', partial: '部分', error: '失败', draft: '待发', published: '已发' };
    const up = ov.upcoming.length
      ? ov.upcoming.map((e) => `<div class="mini-row"><span class="mono-time">${esc(e.date.slice(5))} ${esc(e.time || '')}</span><span class="mini-title">${esc(e.idea.slice(0, 20))}</span><span class="pill">${esc(stLabel[e.status] || e.status)}</span></div>`).join('')
      : '<div class="hint">没有未来排期 · 去「日历」加</div>';
    const wk = ov.works.length
      ? `<div class="ov-works">${ov.works.map((w) => `<div class="ov-work" title="${esc(w.title)}">${w.cover ? `<img src="${esc(w.cover)}"/>` : '<div class="ov-work-ph">🎬</div>'}<span>${esc(w.title.slice(0, 14))}</span></div>`).join('')}</div>`
      : '<div class="hint">还没有成片作品 · 工作台「一键内容包」开工</div>';
    const pl = ov.pool.length
      ? ov.pool.map((p) => `<div class="mini-row"><span class="pill">${esc(p.platform)}</span><span class="mini-title">${esc((p.title || '').slice(0, 16))}</span><span class="${p.status === 'published' ? 'ov-pub' : 'hint'}">${esc(stLabel[p.status] || p.status)}</span>${p.stats && p.stats.views ? `<span class="hint">▶${esc(String(p.stats.views))}</span>` : ''}${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">🔗</a>` : ''}</div>`).join('')
      : '<div class="hint">还没有收录到账号库</div>';
    const pj = ov.projects.length
      ? ov.projects.map((p) => `<div class="mini-row"><span class="mini-title">${esc((p.title || '').slice(0, 18))}</span><span class="hint">${p.done}/${p.total}</span><span class="hint">${esc((p.createdAt || '').slice(5, 10))}</span></div>`).join('')
      : '<div class="hint">还没有轻创作记录</div>';
    pv.innerHTML = `<div class="ov-grid">
      <div class="ov-card"><div class="hc-head"><span>📅 未来排期</span><a class="hc-link" data-go="calendar">日历 →</a></div>${up}</div>
      <div class="ov-card"><div class="hc-head"><span>📥 发布状态</span><a class="hc-link" data-go="pool">账号库 →</a></div>${pl}</div>
      <div class="ov-card" style="grid-column:1/-1"><div class="hc-head"><span>🎬 最近作品</span><a class="hc-link" data-go="works">作品库 →</a></div>${wk}</div>
      <div class="ov-card" style="grid-column:1/-1"><div class="hc-head"><span>✍️ 最近创作</span><a class="hc-link" data-go="history">任务 →</a></div>${pj}</div>
    </div>`;
    const backToSpace = () => {
      S.view = 'brands';
      $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === 'brands'));
      renderBackBar();
      openBrandSpace(dir, brand);
    };
    $$('[data-go]', pv).forEach((a) => a.onclick = () => navGo(a.dataset.go, '品牌空间', backToSpace));
  };
  const kbByRel = Object.fromEntries(kb.map((d) => [d.rel, d]));
  const kbByName = {};
  kb.forEach((d) => { kbByName[d.title] = d; kbByName[d.rel.split('/').pop().replace(/\.md$/, '')] = d; });

  // ―― 顶部动作 ――
  $('#bsNew', root).onclick = async () => {
    const res = await askText({ title: '新建文档', fields: [{ key: 'name', label: '文档名', placeholder: '如：选题库' }] });
    if (res === null || !res.name.trim()) return;
    const name = res.name.trim();
    const rel = `${dir}/${name.replace(/\.md$/, '')}.md`;
    api.post('/api/brandhq/write', { path: rel, content: `# ${name}\n\n` }).then(refresh).catch((e) => toast(e.message, 'err'));
  };
  $('#bsImport', root).onclick = () => {
    modal({
      title: '🧲 导入官网 / 文章 → 品牌知识四件套',
      bodyHtml: `<div class="hint" style="margin-bottom:8px">贴品牌官网或一篇长文，AI 蒸馏成：业务档案 / 品牌规范 / 市场调研 / 内容策略，写进「知识库/」目录。</div>
        <label class="field"><span class="lab">网址</span><input class="input" id="imp_url" placeholder="https://…（和正文二选一）"/></label>
        <label class="field"><span class="lab">或直接贴正文</span><textarea class="textarea" id="imp_text" rows="5" placeholder="抓不到的页面就把内容粘到这"></textarea></label>`,
      footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-ok>开始蒸馏</button>`,
      onMount: (mask, close) => {
        $('[data-x]', mask).onclick = close;
        $('[data-ok]', mask).onclick = async () => {
          const url = $('#imp_url', mask).value.trim();
          const text = $('#imp_text', mask).value.trim();
          if (!url && !text) return toast('给个网址或正文', 'err');
          const btn = $('[data-ok]', mask);
          btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 蒸馏中（约1分钟）…';
          try { const r = await api.post('/api/brandhq/import', { dir, url, text }); toast(`已写入 ${r.written.length} 份文档 ✓`, 'ok'); close(); refresh(); }
          catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.innerHTML = '开始蒸馏'; }
        };
      },
    });
  };
  $('#bsOrganize', root).onclick = async () => {
    if (!(await askConfirm('AI 整理知识库', '归类松散文件 / 合并重复 / 补双链 / 生成目录 index.md，约 5-15 分钟后台跑。'))) return;
    try { await api.post('/api/brandhq/organize', { dir }); toast('整理任务已派出，去「作品库」看进度，完成后回来刷新', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };

  // ―― 文件列表 ――
  const listEl = $('#bsList', root);
  listEl.innerHTML = '';
  const ovBtn = el(`<button class="bs-file bs-ov-btn sel"><span>🧭 品牌全景</span></button>`);
  ovBtn.onclick = renderOverview;
  listEl.appendChild(ovBtn);
  if (!files.length) { listEl.appendChild(el('<div class="hint" style="padding:12px">目录还是空的——点「🧲 导入」用官网一键长出知识库，或去对话窗让小克写</div>')); renderOverview(); return; }
  const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n > 1024 ? Math.round(n / 1024) + 'KB' : n + 'B';
  const icon = (ext) => ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? '🖼' : ['.mp4', '.mov', '.webm'].includes(ext) ? '🎬' : ['.mp3', '.wav', '.m4a'].includes(ext) ? '🎧' : ext === '.md' ? '📝' : '📄';

  // md 渲染 + [[双链]] 变可点
  const renderDoc = (text) => {
    let html = mdToHtml(text);
    html = html.replace(/\[\[([^\]|#]+?)\]\]/g, (m, name) => kbByName[name.trim()]
      ? `<a class="bs-wiki" data-wiki="${esc(name.trim())}">${esc(name.trim())}</a>`
      : `<span class="bs-wiki dead" title="还没有这篇">${esc(name.trim())}</span>`);
    return html;
  };

  const openFile = async (f, rowEl) => {
    $$('.bs-file.sel', listEl).forEach((x) => x.classList.remove('sel'));
    if (rowEl) rowEl.classList.add('sel');
    const pv = $('#bsPreview', root);
    pv.innerHTML = '<div class="hint" style="padding:14px">加载中…</div>';
    try {
      const d = await api.get(`/api/brandhq/file?path=${encodeURIComponent(dir + '/' + f.rel)}`);
      // .html：直接渲染（走 /media 真实地址，相对图片/样式也能加载），而不是只显示源码
      if (d.kind === 'text' && f.ext === '.html') {
        const showFrame = () => {
          pv.innerHTML = `<div class="bs-doc-bar"><span class="hint">${esc(f.rel)}</span>
            <span><button class="btn btn-ghost btn-sm" data-src>&lt;/&gt; 源码</button> <a class="btn btn-ghost btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener">↗ 新标签</a></span></div>
            <iframe class="bs-frame" src="${esc(d.url)}" sandbox="allow-scripts allow-same-origin"></iframe>`;
          $('[data-src]', pv).onclick = showSource;
        };
        const showSource = () => {
          pv.innerHTML = `<div class="bs-doc-bar"><span class="hint">${esc(f.rel)}</span>
            <span><button class="btn btn-ghost btn-sm" data-render>▶ 渲染</button> <button class="btn btn-ghost btn-sm" data-edit>✎ 编辑</button></span></div>
            <div class="bs-doc rc-text"><pre style="white-space:pre-wrap">${esc(d.content)}</pre></div>`;
          $('[data-render]', pv).onclick = showFrame;
          $('[data-edit]', pv).onclick = editText;
        };
        const editText = () => {
          pv.innerHTML = `<div class="bs-doc-bar"><span class="hint">✎ ${esc(f.rel)}</span>
            <span><button class="btn btn-ghost btn-sm" data-cancel>取消</button> <button class="btn btn-accent btn-sm" data-save>保存</button></span></div>
            <textarea class="textarea bs-editor" id="bsEditor"></textarea>`;
          $('#bsEditor', pv).value = d.content;
          $('[data-cancel]', pv).onclick = () => openFile(f, rowEl);
          $('[data-save]', pv).onclick = async () => {
            try { await api.post('/api/brandhq/write', { path: dir + '/' + f.rel, content: $('#bsEditor', pv).value }); toast('已保存 ✓', 'ok'); openFile(f, rowEl); }
            catch (e) { toast(e.message, 'err'); }
          };
        };
        showFrame();
        return;
      }
      if (d.kind === 'text') {
        const meta = kbByRel[f.rel];
        const backlinks = meta && meta.backlinks && meta.backlinks.length
          ? `<div class="bs-backlinks">↩ 反链：${meta.backlinks.map((r) => `<a class="bs-wiki" data-openrel="${esc(r)}">${esc((kbByRel[r] || {}).title || r)}</a>`).join(' · ')}</div>` : '';
        pv.innerHTML = `<div class="bs-doc-bar"><span class="hint">${esc(f.rel)}</span><button class="btn btn-ghost btn-sm" data-edit>✎ 编辑</button></div>
          <div class="bs-doc rc-text">${f.ext === '.md' ? renderDoc(d.content) : `<pre style="white-space:pre-wrap">${esc(d.content)}</pre>`}</div>${backlinks}`;
        $('[data-edit]', pv).onclick = () => {
          pv.innerHTML = `<div class="bs-doc-bar"><span class="hint">✎ ${esc(f.rel)}</span>
            <span><button class="btn btn-ghost btn-sm" data-cancel>取消</button> <button class="btn btn-accent btn-sm" data-save>保存</button></span></div>
            <textarea class="textarea bs-editor" id="bsEditor"></textarea>`;
          $('#bsEditor', pv).value = d.content;
          $('[data-cancel]', pv).onclick = () => openFile(f, rowEl);
          $('[data-save]', pv).onclick = async () => {
            try { await api.post('/api/brandhq/write', { path: dir + '/' + f.rel, content: $('#bsEditor', pv).value }); toast('已保存 ✓', 'ok'); openFile(f, rowEl); }
            catch (e) { toast(e.message, 'err'); }
          };
        };
        // 双链 / 反链点击跳转
        $$('.bs-wiki[data-wiki]', pv).forEach((a) => a.onclick = () => { const t = kbByName[a.dataset.wiki]; if (t) { const row = $$('.bs-file', listEl).find((x) => x.dataset.rel === t.rel); openFile({ rel: t.rel, ext: '.md' }, row); } });
        $$('.bs-wiki[data-openrel]', pv).forEach((a) => a.onclick = () => { const row = $$('.bs-file', listEl).find((x) => x.dataset.rel === a.dataset.openrel); openFile({ rel: a.dataset.openrel, ext: '.md' }, row); });
      }
      else if (d.kind === 'image') pv.innerHTML = `<img src="${esc(d.url)}" style="max-width:100%;border-radius:12px"/>`;
      else if (d.kind === 'video') pv.innerHTML = `<video controls src="${esc(d.url)}" style="max-width:100%;border-radius:12px"></video>`;
      else if (d.kind === 'audio') pv.innerHTML = `<audio controls src="${esc(d.url)}" style="width:100%"></audio>`;
      else pv.innerHTML = `<div class="empty"><div class="em-text">这个格式不能预览 · <a href="${esc(d.url)}" download>下载</a></div></div>`;
    } catch (e) { pv.innerHTML = `<div class="rc-err" style="padding:14px">${esc(e.message)}</div>`; }
  };

  // ―― 按「用途」把 392 个文件分类，而不是平铺 ――
  const BRAIN_NAMES = ['业务档案', '品牌规范', '内容策略', '市场调研', '_运营台账', 'index'];
  const catOf = (f) => {
    const ext = f.ext, name = f.name.replace(/\.md$/, '');
    if (/(^|\/)知识库\//.test(f.rel) || (ext === '.md' && BRAIN_NAMES.includes(name))) return 'brain';
    if (['.mp4', '.mov', '.webm'].includes(ext)) return 'video';
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) return 'image';
    if (['.mp3', '.wav', '.m4a', '.aac'].includes(ext)) return 'audio';
    if (['.py', '.sh', '.js', '.mjs', '.ts', '.css', '.html'].includes(ext)) return 'code';
    if (['.md', '.txt'].includes(ext)) return 'copy'; // 真正能读的文案/脚本
    return 'asset'; // json / csv / srt / vtt / log / yaml 等中间产物
  };
  // 顺序即「流转」：大脑 → 文案 → 成片/图/配音 → 素材 → 代码；前两类默认展开
  const CATS = [
    { k: 'brain', label: '🧠 品牌大脑', open: true },
    { k: 'copy', label: '✍️ 文案 · 脚本', open: true },
    { k: 'video', label: '🎬 成片', open: false },
    { k: 'image', label: '🖼 封面 · 图', open: false },
    { k: 'audio', label: '🎧 配音', open: false },
    { k: 'asset', label: '🧩 素材 · 中间产物', open: false },
    { k: 'code', label: '⚙️ 脚本代码', open: false },
  ];
  const buckets = {}; CATS.forEach((c) => buckets[c.k] = []);
  files.forEach((f) => buckets[catOf(f)].push(f)); // files 已按 mtime 倒序

  // 顶部：搜索过滤（392 文件里秒找）
  const search = el(`<div class="bs-search"><input id="bsSearch" type="search" placeholder="🔎 搜文件名 / 文档标题…"/></div>`);
  listEl.appendChild(search);

  const rowFor = (f) => {
    const meta = kbByRel[f.rel];
    const bl = meta && meta.backlinks && meta.backlinks.length ? ` <span class="bs-bl">↩${meta.backlinks.length}</span>` : '';
    const title = (meta || {}).title || f.name;
    const row = el(`<button class="bs-file" data-rel="${esc(f.rel)}" data-find="${esc((title + ' ' + f.rel).toLowerCase())}"><span>${icon(f.ext)} ${esc(title)}${bl}</span><span class="hint">${fmtSize(f.size)}</span></button>`);
    row.onclick = () => openFile(f, row);
    return row;
  };

  CATS.forEach((c) => {
    const list = buckets[c.k];
    if (!list.length) return;
    const det = el(`<details class="bs-cat"${c.open ? ' open' : ''}><summary><span class="bs-cat-label">${c.label}</span><span class="bs-cat-count">${list.length}</span></summary><div class="bs-cat-body"></div></details>`);
    const body = $('.bs-cat-body', det);
    // 类目内再按来源子文件夹分组（多文件夹时才显示文件夹名，单一来源不啰嗦）
    const byFolder = {};
    list.forEach((f) => { const folder = f.rel.includes('/') ? f.rel.split('/').slice(0, -1).join('/') : ''; (byFolder[folder] = byFolder[folder] || []).push(f); });
    const folders = Object.keys(byFolder);
    const showFolders = folders.length > 1;
    folders.forEach((fld) => {
      if (showFolders && fld) body.appendChild(el(`<div class="bs-subfolder">📁 ${esc(fld.split('/').pop())}</div>`));
      byFolder[fld].forEach((f) => body.appendChild(rowFor(f)));
    });
    listEl.appendChild(det);
  });

  // 搜索：命中就展开所有类目并只显示匹配行
  $('#bsSearch', listEl).oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('.bs-cat', listEl).forEach((det) => {
      let hit = 0;
      $$('.bs-file', det).forEach((row) => {
        const show = !q || (row.dataset.find || '').includes(q);
        row.style.display = show ? '' : 'none';
        if (show) hit++;
      });
      $$('.bs-subfolder', det).forEach((s) => s.style.display = q ? 'none' : '');
      det.open = q ? hit > 0 : det.hasAttribute('data-defopen') ? true : det.open;
      det.style.display = (q && !hit) ? 'none' : '';
    });
  };
  $$('.bs-cat', listEl).forEach((det) => { if (det.open) det.setAttribute('data-defopen', '1'); });
  renderOverview();
}

function normalizedHex(value, fallback = '#1A1A1A') {
  const raw = String(value || '').trim();
  const short = /^#([0-9a-f]{3})$/i.exec(raw);
  if (short) return `#${short[1].split('').map((char) => char + char).join('')}`.toUpperCase();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : fallback;
}

function hexRgb(value) {
  const hex = normalizedHex(value).slice(1);
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

function mixBrandColor(from, to, ratio) {
  const a = hexRgb(from);
  const b = hexRgb(to);
  const hex = a.map((value, index) => Math.round(value + (b[index] - value) * ratio)
    .toString(16).padStart(2, '0')).join('');
  return `#${hex}`.toUpperCase();
}

function brandColorLuminance(value) {
  const channels = hexRgb(value).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function brandColorText(value) {
  return brandColorLuminance(value) > 0.46 ? '#111114' : '#FFFFFF';
}

function brandColorSpec(label, color) {
  const hex = normalizedHex(color);
  const shades = [
    mixBrandColor(hex, '#000000', 0.78),
    mixBrandColor(hex, '#000000', 0.62),
    mixBrandColor(hex, '#000000', 0.46),
    mixBrandColor(hex, '#000000', 0.28),
    hex,
    mixBrandColor(hex, '#FFFFFF', 0.24),
    mixBrandColor(hex, '#FFFFFF', 0.48),
    mixBrandColor(hex, '#FFFFFF', 0.72),
    mixBrandColor(hex, '#FFFFFF', 0.88),
  ];
  return `<div class="brand-color-spec">
    <div class="brand-color-main" style="background:${hex};color:${brandColorText(hex)}"><span>${label}</span><b>${hex}</b></div>
    <div class="brand-shades">${shades.map((shade) => `<i style="background:${shade}"></i>`).join('')}</div>
  </div>`;
}

function brandTagHtml(value, limit = 6) {
  return String(value || '').split(/[、,，/；;]+/).map((item) => item.trim()).filter(Boolean).slice(0, limit)
    .map((item) => `<span>${esc(item)}</span>`).join('');
}

const BRAND_LOGO_SLOTS = [
  { id: 'wide', label: '标准横版', usage: '横屏封面 / 片尾 / 文档', shape: 'wide' },
  { id: 'compact', label: '紧凑版', usage: '品牌卡 / 标题栏 / 小尺寸', shape: 'compact' },
  { id: 'mark', label: '方形标记', usage: '头像 / 角标 / 极小尺寸', shape: 'square' },
];

function brandLogoVariants(brand) {
  const configured = Array.isArray(brand?.logos)
    ? brand.logos.filter((item) => item && typeof item === 'object' && item.url)
    : [];
  if (configured.length) return configured;
  return brand?.logo
    ? [{ ...BRAND_LOGO_SLOTS[0], url: brand.logo }]
    : [];
}

function brandLogoUrl(brand, context = 'wide') {
  const variants = brandLogoVariants(brand);
  const order = context === 'compact' ? ['mark', 'compact', 'wide'] : ['wide', 'compact', 'mark'];
  return order.map((id) => variants.find((item) => item.id === id)?.url).find(Boolean) || variants[0]?.url || brand?.logo || '';
}

function brandLogoSystemHtml(brand) {
  const variants = brandLogoVariants(brand);
  if (!variants.length) return '';
  return `<div class="brand-logo-system" aria-label="${esc(brand.name)} Logo 资产">
    ${variants.slice(0, 3).map((item) => {
      const slot = BRAND_LOGO_SLOTS.find((candidate) => candidate.id === item.id) || {};
      const label = item.label || slot.label || 'Logo';
      const usage = item.usage || slot.usage || '品牌场景';
      const shape = item.shape || slot.shape || 'wide';
      return `<div class="brand-logo-variant ${esc(shape)}">
        <div class="brand-logo-preview"><img src="${esc(item.url)}" alt="${esc(label)}"/></div>
        <div><strong>${esc(label)}</strong><span>${esc(usage)}</span></div>
      </div>`;
    }).join('')}
  </div>`;
}

// 平台一览：固定 9 个平台 + 宽松匹配（大小写不敏感、包含关系即可）。p 传入已 lower+trim 的账号平台串
const PLATFORM_OVERVIEW = [
  { key: '视频号', emoji: '📺', test: (p) => /视频号|shipinhao|wechat\s*channel/.test(p) },
  { key: '抖音',   emoji: '🎵', test: (p) => /抖音|douyin/.test(p) },
  { key: '小红书', emoji: '📕', test: (p) => /小红书|xiaohongshu|xhs|rednote/.test(p) },
  { key: 'B站',    emoji: '📀', test: (p) => /b站|bilibili|哔哩/.test(p) },
  { key: '公众号', emoji: '📰', test: (p) => /公众号|gongzhonghao/.test(p) },
  { key: 'YouTube', emoji: '▶️', test: (p) => /youtube/.test(p) && !/shorts/.test(p) },
  { key: 'Shorts', emoji: '🎬', test: (p) => /shorts/.test(p) },
  { key: 'TikTok', emoji: '🎶', test: (p) => /tiktok/.test(p) },
  { key: 'X',      emoji: '🐦', test: (p) => /(^|[^a-z])x([^a-z]|$)/.test(p) || /twitter|推特/.test(p) },
];
const brandTypeLabel = (b) => (b && b.type === 'ip' ? 'IP' : '品牌');

function brandCard(b, accounts = []) {
  const primary = normalizedHex(b.primaryColor, '#1A1A1E');
  const secondary = normalizedHex(b.accentColor, mixBrandColor(primary, '#FFFFFF', 0.32));
  const tertiary = normalizedHex(b.bgColor, mixBrandColor(primary, '#FFFFFF', 0.88));
  const neutral = normalizedHex(b.darkColor, '#1A1A1E');
  const dark = brandColorLuminance(tertiary) < 0.16;
  const boardBg = dark ? mixBrandColor(tertiary, '#000000', 0.12) : mixBrandColor(tertiary, '#E4E3E8', 0.42);
  const panel = dark ? mixBrandColor(boardBg, '#FFFFFF', 0.07) : mixBrandColor(tertiary, '#FFFFFF', 0.68);
  const text = dark ? '#F4F4F5' : neutral;
  const muted = dark ? mixBrandColor(text, boardBg, 0.52) : mixBrandColor(text, tertiary, 0.52);
  const fixedCharacter = b.fixedCharacter && typeof b.fixedCharacter === 'object' ? b.fixedCharacter : null;
  const fixedExpressions = Array.isArray(fixedCharacter?.expressions) ? fixedCharacter.expressions.filter((item) => item?.image) : [];
  const fixedExpressionsHtml = fixedExpressions.length
    ? `<div class="brand-character-system"><strong>固定人物表情</strong><div class="brand-character-expressions">${fixedExpressions.slice(0, 4).map((item, index) => `
          <button data-character-preview="${index}" aria-label="放大查看 ${esc(item.label || '人物表情')}">
            <img src="${esc(item.image)}" alt="${esc(item.label || '人物表情')}"/><span>${esc(item.label || '表情')}</span>
          </button>`).join('')}</div></div>`
    : '';
  const fixedCharacterHtml = fixedCharacter?.image
    ? `<div class="brand-fixed-character"><img src="${esc(fixedCharacter.image)}" alt="${esc(fixedCharacter.name || '固定人物')}"/>
        <div><span>固定人物</span><strong>${esc(fixedCharacter.name || '品牌角色')}</strong><small>${esc(fixedCharacter.rule || '人物身份已锁定')}</small></div></div>`
    : '<div class="brand-visual-sample"><i></i><i></i><i></i></div>';
  const primaryLogo = brandLogoUrl(b, 'wide');
  const logo = primaryLogo
    ? `<img src="${esc(primaryLogo)}" alt="${esc(b.name)} Logo"/>`
    : `<span style="background:${primary};color:${brandColorText(primary)}">${esc((b.name || '?')[0])}</span>`;
  // 类型徽标 + 空间按钮文字 + 旗下账号 + 平台一览
  const isIp = b.type === 'ip';
  const kindWord = isIp ? 'IP' : '品牌';
  const typeBadge = `<span class="brand-type-badge ${isIp ? 'ip' : 'brand'}">${kindWord}</span>`;
  const brandAccounts = (accounts || []).filter((a) => a.brandId === b.id);
  const acctListHtml = brandAccounts.length
    ? brandAccounts.map((a) => `<div class="bba-item"><b>${esc(a.platform || '账号')}</b><span>${esc(a.name || '')}</span></div>`).join('')
    : '<div class="bba-empty">还没有账号 · 去「账号」页开通</div>';
  const platRow = PLATFORM_OVERVIEW.map((pl) => ({
    ...pl,
    has: brandAccounts.some((a) => pl.test(String(a.platform || '').toLowerCase().trim())),
  }));
  const platOverviewHtml = `<div class="brand-platform-overview">
    <span class="bpo-label">平台一览</span>
    <div class="bpo-chips">${platRow.map((pl, i) => `<span class="bpo-chip ${pl.has ? 'on' : 'off'}" ${pl.has ? `data-plat="${i}" title="已开通 · 点击去账号页"` : 'title="未开通"'}>${pl.emoji}<i>${esc(pl.key)}</i></span>`).join('')}</div>
  </div>`;
  const card = el(`<section class="brand-board ${dark ? 'dark' : 'light'}" style="
      --bb-primary:${primary};--bb-secondary:${secondary};--bb-tertiary:${tertiary};--bb-neutral:${neutral};
      --bb-bg:${boardBg};--bb-panel:${panel};--bb-text:${text};--bb-muted:${muted};--bb-on-primary:${brandColorText(primary)}">
    <header class="brand-board-head">
      <div class="brand-board-identity"><div class="brand-board-logo ${primaryLogo ? 'has-image' : 'fallback'}">${logo}</div>
        <div><h2>${esc(b.name)}${typeBadge}</h2><p>${esc(b.tagline || b.positioning || '品牌视觉规范')}</p></div></div>
      <div class="brand-board-actions">
        <button data-space>□ ${kindWord}空间</button><button data-edit>✎ 编辑</button><button data-delete title="删除${kindWord}">⌫</button>
      </div>
    </header>
    ${brandLogoSystemHtml(b)}
    ${fixedExpressionsHtml}
    <div class="brand-board-canvas">
      <div class="brand-palette">
        ${brandColorSpec('Primary', primary)}
        ${brandColorSpec('Secondary', secondary)}
        ${brandColorSpec('Tertiary', tertiary)}
        ${brandColorSpec('Neutral', neutral)}
      </div>
      <div class="brand-content-grid">
        <article class="brand-content-tile span-2 brand-position-tile">
          <header>品牌定位</header><h3>${esc(b.tagline || b.positioning || '尚未设置品牌定位')}</h3>
          <p>${esc(b.positioning || b.goal || '编辑品牌后补充账号定位与最终目标。')}</p>
        </article>
        <article class="brand-content-tile">
          <header>人设与受众</header><h3>${esc(b.persona || '品牌官方账号')}</h3>
          <p>${esc(b.audience || '尚未设置目标受众')}</p>
        </article>
        <article class="brand-content-tile span-2 brand-writing-tile">
          <header>文风</header><h3>${esc(b.voice || '尚未设置语气调性')}</h3>
          <p>${esc(b.writingStyle || '编辑品牌后补充具体句式、证据标准与写作方法。')}</p>
          ${b.catchphrases ? `<div class="brand-content-tags">${brandTagHtml(b.catchphrases, 5)}</div>` : ''}
        </article>
        <article class="brand-content-tile brand-visual-tile">
          <header>图风</header>
          ${fixedCharacterHtml}
          <p>${esc(b.visualStyle || '尚未设置视觉风格')}</p>
        </article>
        <article class="brand-content-tile">
          <header>内容支柱</header><p class="brand-content-strong">${esc(b.pillars || '尚未设置内容支柱')}</p>
        </article>
        <article class="brand-content-tile">
          <header>平台与节奏</header><p class="brand-content-strong">${esc(b.platformPlan || '尚未设置平台分工')}</p>
          ${b.cadence ? `<small>${esc(b.cadence)}</small>` : ''}
        </article>
        <article class="brand-content-tile brand-redline-tile">
          <header>内容禁区</header><p>${esc(b.redLines || b.taboos || '尚未设置内容禁区')}</p>
          ${b.bannedWords ? `<div class="brand-content-tags danger">${brandTagHtml(b.bannedWords, 6)}</div>` : ''}
        </article>
      </div>
    </div>
    <div class="brand-board-accounts">
      <div class="bba-label">旗下账号 <span>${brandAccounts.length}</span></div>
      <div class="bba-list">${acctListHtml}</div>
    </div>
    ${(b.channels || []).length ? `<div class="brand-board-accounts">
      <div class="bba-label">生产渠道 <span>${(b.channels || []).length}</span> <span class="hint" style="font-weight:400">· 每条=一份生产规格书（画幅/时长/skill/交付物），执行靠绑了 CLI 的产能机</span></div>
      <div class="bba-list">${(b.channels || []).map((c, i) => `<button class="bba-item" data-chan="${i}" style="cursor:pointer"><b>${esc(c.label || c.id)}</b><span>${esc(c.eta || '')}${c.timeoutMin ? ` · 超时 ${c.timeoutMin}min` : ''}</span></button>`).join('')}</div>
    </div>` : ''}
    ${platOverviewHtml}
  </section>`);
  $$('[data-chan]', card).forEach((el2) => { el2.onclick = () => channelSpecModal(b, (b.channels || [])[Number(el2.dataset.chan)]); });
  $$('.bpo-chip.on', card).forEach((chip) => { chip.onclick = () => switchView('pool'); });
  $('[data-space]', card).onclick = () => openBrandSpace(null, b);
  $('[data-edit]', card).onclick = () => brandModal(b);
  $$('[data-character-preview]', card).forEach((button) => {
    const expression = fixedExpressions[Number(button.dataset.characterPreview)];
    button.onclick = () => imagePreviewModal({
      title: `${fixedCharacter.name || '固定人物'} · ${expression.label || '表情'}`,
      image: expression.image,
      description: fixedCharacter.rule || '',
      meta: expression.usage ? `适合：${expression.usage}` : '',
    });
  });
  $('[data-delete]', card).onclick = async () => {
    if (!(await askConfirm('删除品牌', `删除品牌「${b.name}」？`))) return;
    await api.del(`/api/brands/${b.id}`); S.boot.brands = await api.get('/api/brands'); render();
  };
  return card;
}

// AI 一句话帮填 → 表单字段 id 映射（纯文本/textarea 字段；defaultPack 和色值另外单独处理）
const BRAND_AI_TEXT_FIELDS = [
  'name', 'tagline', 'positioning', 'persona', 'voice', 'writingStyle', 'catchphrases', 'audience',
  'taboos', 'bannedWords', 'pillars', 'cadence', 'benchmarks', 'platformPlan', 'goal', 'visualStyle',
  'topicScope', 'redLines', 'routingHints',
];

function brandModal(b, opts = {}) {
  const isNew = !b;
  b = b || {};
  const isIp = b.type === 'ip';
  const logoVariants = brandLogoVariants(b);
  const logoFields = BRAND_LOGO_SLOTS.map((slot) => {
    const current = logoVariants.find((item) => item.id === slot.id)?.url || (slot.id === 'wide' ? b.logo || '' : '');
    return `<label class="field brand-logo-field"><span class="lab">${esc(slot.label)} <small>${esc(slot.usage)}</small></span>
      <div class="brand-logo-input-row">
        <input class="input" id="b_logo_${slot.id}" value="${esc(current)}" placeholder="粘贴图片地址，或上传"/>
        <button class="btn btn-ghost btn-sm" type="button" data-logo-upload="${slot.id}">上传</button>
        <input type="file" data-logo-file="${slot.id}" accept="image/*" hidden/>
      </div>
    </label>`;
  }).join('');
  const platformIdHint = (S.boot?.platforms || []).map((p) => p.id).join(' / ') || 'article / gongzhonghao / xiaohongshu / douyin / shipinhao / twitter / peitu / cover / changtu / video_plan / bilibili / youtube_long / shorts_en';
  modal({
    title: isNew ? '新建品牌' : `编辑品牌 · ${b.name}`,
    bodyHtml: `
      <div style="display:flex;gap:12px;align-items:flex-end">
        <label class="field" style="flex:1;min-width:0"><span class="lab">品牌名 *</span><input class="input" id="b_name" value="${esc(b.name || '')}"/></label>
        <label class="field" style="flex:0 0 auto"><span class="lab">类型</span>
          <div class="brand-type-seg" id="b_type_seg">
            <button type="button" class="bts-opt ${isIp ? '' : 'sel'}" data-type="brand">品牌</button>
            <button type="button" class="bts-opt ${isIp ? 'sel' : ''}" data-type="ip">IP</button>
          </div>
        </label>
      </div>
      <label class="field"><span class="lab">一句话定位 / Slogan</span><input class="input" id="b_tagline" value="${esc(b.tagline || '')}"/></label>

      <div style="margin:4px 0 20px;padding:12px 14px;border-radius:var(--radius-sm);background:var(--accent-soft);border:1px dashed var(--accent)">
        <span class="lab" style="display:block;margin-bottom:8px">✨ 一句话，AI 帮我填</span>
        <div style="display:flex;gap:8px">
          <input class="input" id="b_aiDesc" style="flex:1;min-width:0" placeholder="例如：Agent101，把硅谷 AI 进展翻译成创业者能落地的动作"/>
          <button class="btn btn-accent btn-sm" type="button" id="b_aiDraftBtn">✨ AI 帮我填</button>
        </div>
        <div class="hint" id="b_aiDraftHint" style="margin-top:6px"></div>
      </div>

      <details id="b_advanced" style="border-top:1px solid var(--hair);margin-top:6px;padding-top:8px">
        <summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--ink-2);padding:6px 2px;user-select:none">⚙ 高级设置 · 视觉 / 写作风格 / 受众&禁忌 / 账号规划 / 路由与红线（约 25 项，默认折叠，不填也能先建号）</summary>
        <div style="padding-top:6px">

          <div class="section-label" style="margin:18px 0 10px">🎨 品牌视觉 · 色系 / Logo / 出图风格</div>
          <div class="grid-2">
            ${colorField('主色调', 'b_primaryColor', b.primaryColor || '#1a1a1e')}
            ${colorField('辅色', 'b_accentColor', b.accentColor || '#06b6d4')}
            ${colorField('深色', 'b_darkColor', b.darkColor || '#111827')}
            ${colorField('背景', 'b_bgColor', b.bgColor || '#f5f6fb')}
          </div>
          <label class="field"><span class="lab">视觉风格（影响出图）</span><textarea class="textarea" id="b_visualStyle" rows="2" placeholder="例如：浅蓝玻璃风、半透明卡片、柔和明亮">${esc(b.visualStyle || '')}</textarea></label>
          <label class="field"><span class="lab">🔒 IP 人物参考图 <small>（可选：传一张人物定妆图，生封面/配图会锁定这张脸——走 Nano 参考图通道）</small></span>
            <div class="brand-logo-input-row">
              <input class="input" id="b_ipImage" value="${esc(b.ipImage || '')}" placeholder="上传后自动填入地址；留空则用普通文生图"/>
              <button class="btn btn-ghost btn-sm" type="button" data-ip-upload>上传</button>
              <input type="file" data-ip-file accept="image/png,image/jpeg,image/webp" hidden/>
            </div>
            <div id="b_ipPreview">${b.ipImage ? `<img class="brand-ip-preview" src="${esc(b.ipImage)}" alt="IP 参考图"/>` : ''}</div>
          </label>
          <div class="brand-logo-fields">${logoFields}</div>

          <div class="section-label" style="margin:18px 0 10px">✍️ 写作风格 · 文案怎么写</div>
          <label class="field"><span class="lab">语气调性</span><textarea class="textarea" id="b_voice" rows="2" placeholder="例如：专业、明亮、可信赖；说人话不堆术语">${esc(b.voice || '')}</textarea></label>
          <label class="field"><span class="lab">写作风格</span><textarea class="textarea" id="b_writingStyle" rows="2" placeholder="例如：短句、口语化、先讲故事再给方法；多用第二人称">${esc(b.writingStyle || '')}</textarea></label>
          <label class="field"><span class="lab">口头禅 / 高频词（可自然带入）</span><input class="input" id="b_catchphrases" value="${esc(b.catchphrases || '')}" placeholder="例如：懂电商、省心、靠谱"/></label>

          <div class="section-label" style="margin:18px 0 10px">🎯 受众 & 禁忌</div>
          <label class="field"><span class="lab">目标受众</span><input class="input" id="b_audience" value="${esc(b.audience || '')}"/></label>
          <label class="field"><span class="lab">务必避免</span><input class="input" id="b_taboos" value="${esc(b.taboos || '')}" placeholder="例如：不夸大承诺、不贬低同行"/></label>
          <label class="field"><span class="lab">禁用词（绝对不出现，逗号分隔）</span><input class="input" id="b_bannedWords" value="${esc(b.bannedWords || '')}" placeholder="例如：赋能、抓手、全网最低"/></label>

          <div class="section-label" style="margin:18px 0 10px">📍 账号规划 · 这个号怎么做（会注入到选题和创作）</div>
          <label class="field"><span class="lab">账号定位</span><input class="input" id="b_positioning" value="${esc(b.positioning || '')}" placeholder="一句话：这个号是谁、给谁、解决什么独特价值"/></label>
          <label class="field"><span class="lab">人设标签 / 气质</span><input class="input" id="b_persona" value="${esc(b.persona || '')}" placeholder="例如：懂电商的资深客服顾问，专业又接地气"/></label>
          <label class="field"><span class="lab">内容支柱（带占比）</span><input class="input" id="b_pillars" value="${esc(b.pillars || '')}" placeholder="例如：客户案例40% / 行业干货30% / 产品20% / 团队10%"/></label>
          <div class="grid-2">
            <label class="field"><span class="lab">发布节奏</span><input class="input" id="b_cadence" value="${esc(b.cadence || '')}" placeholder="每周 2-3 篇，工作日上午"/></label>
            <label class="field"><span class="lab">对标账号</span><input class="input" id="b_benchmarks" value="${esc(b.benchmarks || '')}" placeholder="2-3 个同赛道标杆"/></label>
          </div>
          <label class="field"><span class="lab">多平台分工</span><input class="input" id="b_platformPlan" value="${esc(b.platformPlan || '')}" placeholder="公众号沉淀 / 小红书种草 / 视频号传播"/></label>
          <label class="field"><span class="lab">终极目的</span><input class="input" id="b_goal" value="${esc(b.goal || '')}" placeholder="账号最终要导向的结果，反推内容取舍"/></label>

          <div class="section-label" style="margin:18px 0 10px">🧭 路由与红线 · 决定选题能不能被自动派给这个号</div>
          <label class="field"><span class="lab">选题范围</span><textarea class="textarea" id="b_topicScope" rows="2" placeholder="这个号能讲什么话题、边界在哪">${esc(b.topicScope || '')}</textarea></label>
          <label class="field"><span class="lab">内容红线（绝对不做）</span><textarea class="textarea" id="b_redLines" rows="2" placeholder="例如：必须有真实来源或亲测证据，不凭空虚构">${esc(b.redLines || '')}</textarea></label>
          <label class="field"><span class="lab">路由判定规则 <small>（给"选题该派给哪个号"的总编 agent 用，没填时会退化成用账号定位兜底判断）</small></span><textarea class="textarea" id="b_routingHints" rows="2" placeholder="例如：有真实来源的AI技术选题→适合；纯广告角度→拒">${esc(b.routingHints || '')}</textarea></label>
          <label class="field"><span class="lab">默认内容包 <small>（逗号分隔，从形态 id 中选 2-4 个：${esc(platformIdHint)}）</small></span><input class="input" id="b_defaultPack" value="${esc((Array.isArray(b.defaultPack) ? b.defaultPack : []).join(', '))}" placeholder="例如：video_plan, cover, xiaohongshu"/></label>

        </div>
      </details>`,
    footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-ok>${isNew ? '创建' : '保存'}</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      if (opts.focusAI) setTimeout(() => $('#b_aiDesc', mask)?.focus(), 60);
      $$('#b_type_seg .bts-opt', mask).forEach((btn) => btn.onclick = () => {
        $$('#b_type_seg .bts-opt', mask).forEach((x) => x.classList.toggle('sel', x === btn));
      });
      mask.querySelectorAll('[data-logo-upload]').forEach((button) => {
        const slotId = button.dataset.logoUpload;
        const file = mask.querySelector(`[data-logo-file="${slotId}"]`);
        button.onclick = () => file.click();
        file.onchange = () => {
          const selected = file.files[0]; if (!selected) return;
          const rd = new FileReader();
          rd.onload = async () => {
            try {
              const brandName = $('#b_name', mask).value || 'brand';
              const { url } = await api.post('/api/brands/logo', { dataUrl: rd.result, name: `${brandName}-${slotId}` });
              $(`#b_logo_${slotId}`, mask).value = url;
              toast(`${BRAND_LOGO_SLOTS.find((item) => item.id === slotId)?.label || 'Logo'} 已上传`, 'ok');
            } catch (e) { toast(e.message, 'err'); }
          };
          rd.readAsDataURL(selected);
        };
      });
      // IP 人物参考图上传
      const ipBtn = $('[data-ip-upload]', mask), ipFile = $('[data-ip-file]', mask);
      if (ipBtn && ipFile) {
        ipBtn.onclick = () => ipFile.click();
        ipFile.onchange = () => {
          const selected = ipFile.files[0]; if (!selected) return;
          const rd = new FileReader();
          rd.onload = async () => {
            try {
              const brandName = $('#b_name', mask).value || 'brand';
              const { url } = await api.post('/api/brands/ip-image', { dataUrl: rd.result, name: brandName });
              $('#b_ipImage', mask).value = url;
              $('#b_ipPreview', mask).innerHTML = `<img class="brand-ip-preview" src="${esc(url)}" alt="IP 参考图"/>`;
              toast('IP 参考图已上传 ✓', 'ok');
            } catch (e) { toast(e.message, 'err'); }
          };
          rd.readAsDataURL(selected);
        };
      }
      // ✨ 一句话，AI 帮我填：调 /api/brands/draft，把返回对象预填进上面所有字段
      const aiBtn = $('#b_aiDraftBtn', mask), aiHint = $('#b_aiDraftHint', mask);
      if (aiBtn) {
        aiBtn.onclick = async () => {
          const desc = ($('#b_aiDesc', mask).value || '').trim();
          if (!desc) { toast('先写一句话描述这个号', 'err'); return; }
          aiBtn.disabled = true;
          const original = aiBtn.innerHTML;
          aiBtn.innerHTML = '<span class="spin"></span> AI 填写中…';
          aiHint.textContent = '';
          try {
            const draft = await api.post('/api/brands/draft', { description: desc });
            BRAND_AI_TEXT_FIELDS.forEach((key) => {
              const field = $(`#b_${key}`, mask);
              if (field && draft[key]) field.value = draft[key];
            });
            ['primaryColor', 'accentColor', 'darkColor', 'bgColor'].forEach((key) => {
              if (!draft[key]) return;
              const textInput = $(`#b_${key}`, mask);
              if (!textInput) return;
              textInput.value = draft[key];
              const colorInput = textInput.previousElementSibling;
              if (colorInput && colorInput.type === 'color') colorInput.value = draft[key];
            });
            if (Array.isArray(draft.defaultPack) && draft.defaultPack.length) {
              const dp = $('#b_defaultPack', mask); if (dp) dp.value = draft.defaultPack.join(', ');
            }
            const advanced = $('#b_advanced', mask);
            if (advanced) advanced.open = true; // 展开高级设置，让 477 看到 AI 填了什么、方便改
            toast('AI 已帮你填好，改改再保存 ✓', 'ok');
          } catch (e) {
            aiHint.textContent = `⚠️ ${e.message}`;
            toast(e.message, 'err');
          } finally {
            aiBtn.disabled = false; aiBtn.innerHTML = original;
          }
        };
      }
      $('[data-ok]', mask).onclick = async () => {
        const payload = {};
        ['name', 'tagline', 'primaryColor', 'accentColor', 'darkColor', 'bgColor', 'voice', 'writingStyle', 'catchphrases', 'audience', 'taboos', 'bannedWords', 'visualStyle', 'ipImage',
         'positioning', 'persona', 'pillars', 'cadence', 'benchmarks', 'platformPlan', 'goal', 'topicScope', 'redLines', 'routingHints']
          .forEach((k) => (payload[k] = $(`#b_${k}`, mask).value.trim()));
        payload.type = ($('#b_type_seg .bts-opt.sel', mask)?.dataset.type) === 'ip' ? 'ip' : 'brand';
        payload.defaultPack = ($(`#b_defaultPack`, mask).value || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
        payload.logos = BRAND_LOGO_SLOTS.map((slot) => ({
          ...slot,
          url: $(`#b_logo_${slot.id}`, mask).value.trim(),
        })).filter((item) => item.url);
        payload.logo = payload.logos.find((item) => item.id === 'wide')?.url || payload.logos[0]?.url || '';
        if (!payload.name) return toast('品牌名必填', 'err');
        if (isNew) await api.post('/api/brands', payload); else await api.put(`/api/brands/${b.id}`, payload);
        S.boot.brands = await api.get('/api/brands');
        close(); render(); toast('已保存 ✓', 'ok');
      };
    },
  });
}
function colorField(label, id, val) {
  return `<label class="field"><span class="lab">${esc(label)}</span><div class="color-field">
    <input type="color" value="${esc(val)}" oninput="this.nextElementSibling.value=this.value"/>
    <input class="input" id="${id}" value="${esc(val)}" oninput="this.previousElementSibling.value=this.value"/></div></label>`;
}

// =========================================================
//  运营玩法库（来自运营 skill）
// =========================================================
function renderPlays(root) {
  const list = S.boot.plays || [];
  root.innerHTML = `<div class="page-head"><div class="page-title">运营玩法</div>
    <div class="page-sub">你的运营 skill 沉淀成可调用的玩法。挑一个「用它想选题」，agent 会按这套打法帮你出方向。</div></div>
    ${list.length ? '<div class="card-grid" id="playGrid"></div>' : emptyHtml('⋄', '还没有玩法。')}`;
  if (!list.length) return;
  const grid = $('#playGrid', root);
  list.forEach((p) => {
    const card = el(`<div class="entity-card">
      <div class="ec-top"><div class="ec-mono" style="background:linear-gradient(135deg,#3a3a42,#101013)">⋄</div>
        <div><div class="ec-name">${esc(p.name)}</div><div class="ec-tag">${esc(p.source || '')}</div></div></div>
      <div class="ec-meta" style="max-height:none">${esc(p.play)}</div>
      <div class="ec-tag" style="margin-top:8px">适用：${esc(p.useFor || '')}</div>
      <div class="ec-actions"><button class="btn btn-accent btn-sm" data-use>✨ 用这个玩法想选题</button></div></div>`);
    $('[data-use]', card).onclick = () => { switchView('create'); setTimeout(() => ideateModal(p), 60); };
    grid.appendChild(card);
  });
}

// =========================================================
//  风格库（写作 + 视觉 + 声音，统一沉淀品牌表达资产）
// =========================================================
const S_STYLE = { tab: 'writing' };
function renderStyles(root) {
  const list = S.boot.styles || [];
  const cur = list.filter((s) => (s.kind || 'writing') === S_STYLE.tab);
  const isVoice = S_STYLE.tab === 'voice';
  const isBgm = S_STYLE.tab === 'bgm';
  const cnt = (k) => list.filter((s) => (s.kind || 'writing') === k).length;
  root.innerHTML = `<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><div class="page-title">风格库</div>
        <div class="page-sub">全站风格的总仓库：写作、图片、视频、声音。品牌的生产渠道从这里引用风格——先在这开风格，渠道再挂上去。</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="styleAi">✨ AI 开风格</button>
        <button class="btn btn-accent" id="styleAdd">${isVoice ? '＋ 添加声线' : isBgm ? '＋ 添加音乐' : '＋ 新建风格'}</button></div></div>
    <div class="tabs">
      <button class="tab ${S_STYLE.tab === 'writing' ? 'sel' : ''}" data-tab="writing">✍️ 写作 (${cnt('writing')})</button>
      <button class="tab ${S_STYLE.tab === 'visual' ? 'sel' : ''}" data-tab="visual">🎨 图片 (${cnt('visual')})</button>
      <button class="tab ${S_STYLE.tab === 'video' ? 'sel' : ''}" data-tab="video">🎬 视频 (${cnt('video')})</button>
      <button class="tab ${isVoice ? 'sel' : ''}" data-tab="voice">🎧 配音声线 (${cnt('voice')})</button>
      <button class="tab ${S_STYLE.tab === 'bgm' ? 'sel' : ''}" data-tab="bgm">🎵 背景音乐 (${cnt('bgm')})</button>
    </div>
    <div id="styleGrid"></div>`;
  $$('.tab', root).forEach((t) => t.onclick = () => { S_STYLE.tab = t.dataset.tab; render(); });
  $('#styleAdd', root).onclick = () => styleModal(null, S_STYLE.tab);
  $('#styleAi', root).onclick = () => aiStyleModal(S_STYLE.tab);
  const grid = $('#styleGrid', root);
  if (!cur.length) {
    grid.innerHTML = emptyHtml(isVoice || isBgm ? '♪' : '❍',
      isVoice ? '还没有声线。点右上「＋ 添加声线」上传样音，或让 agent 把生产用过的声线导进来。'
      : isBgm ? '还没有背景音乐。点右上「＋ 添加音乐」上传，上传后可直接试听、在渠道里选用。'
      : '这个分类还没有风格。「✨ AI 开风格」一句话就能开一个。');
    return;
  }
  if (isBgm) {
    // 背景音乐：一行一首，直接播
    grid.innerHTML = `<div class="list" id="bgmList"></div>`;
    const wrap = $('#bgmList', grid);
    cur.forEach((st) => {
      const row = el(`<div class="list-row">
        <div class="lr-main"><div class="lr-title">🎵 ${esc(st.name)}${st.seconds ? ` <span class="hint">${fmtDur(st.seconds)}</span>` : ''}</div>
          <div class="lr-sub">${esc(st.mood || st.tone || '')}${st.source ? ` · 来源 ${esc(st.source)}` : ''}${st.usedIn ? ` · 用过：${esc(String(st.usedIn).slice(0, 40))}` : ''}</div>
          ${st.audioUrl ? `<audio controls preload="none" src="${esc(st.audioUrl)}" style="width:100%;max-width:420px;margin-top:8px;height:32px"></audio>` : '<div class="lr-sub" style="color:var(--warn)">没有可播文件</div>'}</div>
        <div class="lr-actions"><button class="btn btn-ghost btn-sm" data-edit>编辑</button><button class="btn btn-ghost btn-sm" data-del>删除</button></div></div>`);
      $('[data-edit]', row).onclick = () => styleModal(st, 'bgm');
      $('[data-del]', row).onclick = async () => {
        if (!(await askConfirm('删除音乐', `删除「${st.name}」？`))) return;
        await api.del(`/api/styles/${st.id}`); await boot(); render();
      };
      wrap.appendChild(row);
    });
    return;
  }
  if (isVoice) {
    grid.className = 'voice-library';
    const active = cur.filter((st) => st.status !== 'rejected');
    const rejected = cur.filter((st) => st.status === 'rejected');
    appendVoiceGroup(grid, '可选声音', active, '上传新样音后，可试听并设为品牌当前声音');
    appendVoiceGroup(grid, '未采用样音', rejected, '保留试听记录，但不会进入视频任务');
  } else {
    // 使用中 / 其他 两组：没选中使用的都进「其他」
    grid.className = '';
    const inUse = cur.filter((st) => st.inUse !== false);
    const others = cur.filter((st) => st.inUse === false);
    const cardOf = (st) => st.kind === 'visual' ? visualStyleCard(st) : st.kind === 'video' ? videoStyleCard(st) : writingStyleCard(st);
    const group = (title, items, note) => {
      if (!items.length) return;
      const sec = el(`<section class="style-group"><div class="voice-group-head"><div><h2>${title}</h2><p>${note}</p></div><span>${items.length}</span></div><div class="card-grid" data-grid></div></section>`);
      items.forEach((st) => $('[data-grid]', sec).appendChild(cardOf(st)));
      grid.appendChild(sec);
    };
    group('使用中', inUse, '生成链路会用到的风格');
    group('其他', others, '暂不使用，保留配方；点「启用」随时回来');
  }
}

function appendVoiceGroup(root, title, items, note) {
  if (!items.length && title === '未采用样音') return;
  const section = el(`<section class="voice-group">
    <div class="voice-group-head"><div><h2>${esc(title)}</h2><p>${esc(note)}</p></div><span>${items.length}</span></div>
    ${items.length ? '<div class="voice-grid" data-grid></div>' : '<div class="voice-empty">等待上传新的声音样音</div>'}
  </section>`);
  const grid = $('[data-grid]', section);
  if (grid) items
    .sort((a, b) => Number(brandById(b.brandId).voiceStyleId === b.id) - Number(brandById(a.brandId).voiceStyleId === a.id))
    .forEach((st) => grid.appendChild(voiceStyleCard(st)));
  root.appendChild(section);
}

function voiceStyleCard(st) {
  const brand = brandById(st.brandId);
  const hasBrand = brand && !brand.synthetic;
  const selected = hasBrand && brand.voiceStyleId === st.id;
  const rejected = st.status === 'rejected';
  const status = selected ? '当前声音' : rejected ? '未采用' : '待选择';
  const card = el(`<article class="voice-card ${selected ? 'is-selected' : ''} ${rejected ? 'is-rejected' : ''}">
    <button class="voice-delete" data-delete title="删除声音" aria-label="删除 ${esc(st.name)}">✕</button>
    <div class="voice-card-head">
      <div class="voice-mark" aria-hidden="true">♪</div>
      <div class="voice-title"><h3>${esc(st.name || '未命名声音')}</h3><p>${esc(hasBrand ? brand.name : '未归档品牌')} · ${esc(st.provider || 'Keke Voice')}</p></div>
      <span class="voice-status ${selected ? 'selected' : rejected ? 'rejected' : ''}">${status}</span>
    </div>
    <div class="voice-tags"><span>${esc(st.language || '中文')}</span><span>${esc(st.gender || '女声')}</span><span>${esc(st.modelId || '本地声音')}</span></div>
    <p class="voice-tone">${esc(st.tone || '暂无声音描述')}</p>
    ${st.sampleAudio ? `<audio class="voice-player" controls preload="metadata" src="${esc(st.sampleAudio)}">浏览器不支持音频播放</audio>` : '<div class="voice-no-audio">尚未上传样音</div>'}
    <div class="voice-source">${esc(st.source || '平台声音库')}</div>
    <div class="voice-actions">
      ${!rejected && hasBrand ? `<button class="btn ${selected ? 'btn-ghost' : 'btn-primary'} btn-sm" data-select>${selected ? '取消选用' : '设为当前声音'}</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-edit>编辑</button>
    </div>
  </article>`);
  const player = $('.voice-player', card);
  if (player) player.addEventListener('play', () => {
    $$('.voice-player').forEach((audio) => { if (audio !== player) audio.pause(); });
  });
  const select = $('[data-select]', card);
  if (select) select.onclick = async () => {
    try {
      await api.put(`/api/brands/${brand.id}`, { voiceStyleId: selected ? null : st.id });
      S.boot.brands = await api.get('/api/brands');
      render();
      toast(selected ? '已取消当前声音' : `已将「${st.name}」设为 ${brand.name} 当前声音`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('[data-edit]', card).onclick = () => styleModal(st, 'voice');
  $('[data-delete]', card).onclick = async () => {
    if (!(await askConfirm('删除声音', `删除「${st.name}」？${selected ? '\n品牌当前声音也会同步取消。' : ''}`))) return;
    await api.del(`/api/styles/${st.id}`);
    [S.boot.styles, S.boot.brands] = await Promise.all([api.get('/api/styles'), api.get('/api/brands')]);
    render();
  };
  return card;
}

// 使用/停用开关：不用的风格挪去「其他」组，不删配方
function useToggleBtn(st) {
  const on = st.inUse !== false;
  const b = el(`<button class="btn btn-ghost btn-sm" title="${on ? '停用后挪到「其他」组' : '启用后回到「使用中」'}">${on ? '⏸ 停用' : '▶ 启用'}</button>`);
  b.onclick = async () => {
    await api.put(`/api/styles/${st.id}`, { inUse: !on });
    S.boot.styles = await api.get('/api/styles');
    render(); toast(on ? '已挪到「其他」' : '已启用', 'ok');
  };
  return b;
}

function writingStyleCard(st) {
  const card = el(`<div class="entity-card">
    <button class="ec-del" title="删除">✕</button>
    <div class="ec-top"><div class="ec-mono" style="background:linear-gradient(135deg,#3a3a42,#101013)">${esc((st.name || '?')[0])}</div>
      <div><div class="ec-name">${esc(st.name || '未命名')}</div><div class="ec-tag">${esc(st.source || '')}</div></div></div>
    <div class="ec-meta">${esc((st.voice || '').slice(0, 80))}</div>
    <div class="ec-actions"><button class="btn btn-primary btn-sm" data-case>📄 看案例</button><button class="btn btn-ghost btn-sm" data-edit>编辑</button></div></div>`);
  $('.ec-actions', card).appendChild(useToggleBtn(st));
  $('[data-case]', card).onclick = () => caseModal(st);
  $('[data-edit]', card).onclick = () => styleModal(st, 'writing');
  $('.ec-del', card).onclick = async () => { if (!(await askConfirm('删除风格', `删除「${st.name}」？`))) return; await api.del(`/api/styles/${st.id}`); S.boot.styles = await api.get('/api/styles'); render(); };
  return card;
}

// 视频风格卡：画面语言 + 适配市场——渠道规格书从这里挂
function videoStyleCard(st) {
  const card = el(`<div class="entity-card">
    <button class="ec-del" title="删除">✕</button>
    <div class="ec-top"><div class="ec-mono" style="background:linear-gradient(135deg,#5a2020,#1a0c0c)">🎬</div>
      <div><div class="ec-name">${esc(st.name || '未命名')}</div><div class="ec-tag">${esc(st.market || '')}</div></div></div>
    <div class="ec-meta">${esc((st.desc || '').slice(0, 90))}</div>
    ${st.refLinks ? `<div class="ec-tag" style="margin-top:6px">参考：${esc(String(st.refLinks).slice(0, 50))}</div>` : ''}
    <div class="ec-actions"><button class="btn btn-ghost btn-sm" data-edit>编辑</button></div></div>`);
  $('.ec-actions', card).appendChild(useToggleBtn(st));
  $('[data-edit]', card).onclick = () => styleModal(st, 'video');
  $('.ec-del', card).onclick = async () => { if (!(await askConfirm('删除风格', `删除「${st.name}」？`))) return; await api.del(`/api/styles/${st.id}`); S.boot.styles = await api.get('/api/styles'); render(); };
  return card;
}

function visualStyleCard(st) {
  const thumb = st.sampleImage
    ? `<img src="${esc(st.sampleImage)}" class="vstyle-thumb" alt="${esc(st.name)} 风格样图"/>`
    : `<div class="vstyle-thumb" style="background:linear-gradient(135deg,#3a3a42,#101013);display:grid;place-items:center;color:#fff;font-size:24px">🎨</div>`;
  const card = el(`<div class="entity-card" style="padding:0;overflow:hidden">
    <button class="ec-del" title="删除" style="top:10px;right:10px;z-index:2;background:rgba(255,255,255,.8);border-radius:6px;width:22px;height:22px">✕</button>
    <button class="vstyle-preview-button" data-preview aria-label="放大查看 ${esc(st.name)} 风格样图">
      ${thumb}<span class="vstyle-zoom" aria-hidden="true">⌕</span>
    </button>
    <div style="padding:14px"><div class="ec-name">${esc(st.name)}</div>
      <div class="ec-meta" style="margin-top:6px">${esc((st.desc || '').slice(0, 70))}</div>
      <div class="ec-tag" style="margin-top:6px">适合：${esc(st.usage || '')}</div>
      <div class="ec-actions"><button class="btn btn-primary btn-sm" data-preview-text>查看大图</button><button class="btn btn-ghost btn-sm" data-edit>编辑</button></div></div></div>`);
  $('.ec-actions', card).appendChild(useToggleBtn(st));
  $('[data-preview]', card).onclick = () => visualCaseModal(st);
  $('[data-preview-text]', card).onclick = () => visualCaseModal(st);
  $('[data-edit]', card).onclick = () => styleModal(st, 'visual');
  $('.ec-del', card).onclick = async () => { if (!(await askConfirm('删除风格', `删除「${st.name}」？`))) return; await api.del(`/api/styles/${st.id}`); S.boot.styles = await api.get('/api/styles'); render(); };
  return card;
}

function visualCaseModal(st) {
  imagePreviewModal({
    title: st.name || '视觉风格',
    image: st.sampleImage,
    description: st.desc || '',
    meta: st.usage ? `适合：${st.usage}` : '',
  });
}

function imagePreviewModal({ title, image, description = '', meta = '' }) {
  const preview = image
    ? `<img src="${esc(image)}" alt="${esc(title)} 大图"/>`
    : '<div class="visual-preview-empty">还没有预览图</div>';
  const result = modal({
    title,
    bodyHtml: `<div class="visual-preview-stage">${preview}</div>
      <div class="visual-preview-copy">
        ${description ? `<p>${esc(description)}</p>` : ''}
        ${meta ? `<span>${esc(meta)}</span>` : ''}
      </div>`,
    footHtml: '<button class="btn btn-ghost" data-x>关闭</button>',
    onMount: (mask, close) => { $('[data-x]', mask).onclick = close; },
  });
  $('.modal', result.mask).classList.add('visual-preview-modal');
}

// 看案例：写作风格的范文 / 视觉风格的大图
function caseModal(st) {
  modal({
    title: `案例 · ${st.name}`,
    bodyHtml: `<div class="hint" style="margin-bottom:10px">语气：${esc(st.voice || '')}</div>
      <div class="rc-text" style="background:var(--surface-2);padding:16px;border-radius:12px;max-height:50vh;overflow:auto">${esc(st.example || '（这个风格还没填范文）').replace(/\n/g, '<br>')}</div>`,
    footHtml: `<button class="btn btn-ghost" data-x>关闭</button><button class="btn btn-accent" data-use>用这个风格去创作</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $('[data-use]', mask).onclick = () => { S.create.options.styleId = st.id; close(); switchView('create'); toast(`已选用「${st.name}」`, 'ok'); };
    },
  });
}

// AI 开风格：一句话（或贴样本/参考链接）→ 模型出配方 → 预填表单，477 过目改两笔就能存
function aiStyleModal(kind) {
  if (kind === 'voice') return styleModal(null, 'voice'); // 声音要传样音文件，不走 AI 起草
  const kindLabel = { writing: '写作', visual: '图片', video: '视频' }[kind] || '写作';
  modal({
    title: `✨ AI 开${kindLabel}风格`,
    bodyHtml: `
      <label class="field"><span class="lab">想要什么风格？一句话说</span><textarea class="textarea" id="ai_brief" rows="2" placeholder="${kind === 'video' ? '例如：学老高与小茉的悬念叙事，适配 B站知识区' : kind === 'visual' ? '例如：新华社风黑金大字报，适合宏观财经封面' : '例如：半佛仙人式暴躁但有干货的杂文'}"></textarea></label>
      <label class="field"><span class="lab">参考样本（可选：贴一段范文 / 图片描述 / 对标视频链接）</span><textarea class="textarea" id="ai_sample" rows="4" placeholder="有样本蒸馏得更准，没有就纯靠描述"></textarea></label>
      <div class="hint">也可以在电脑上对绑定的 CLI 说「学习 XX 的风格并写进 1toall 风格库」，让它抓完素材直接建。</div>`,
    footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-go>生成配方 →</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $('[data-go]', mask).onclick = async (ev) => {
        const brief = $('#ai_brief', mask).value.trim();
        if (!brief) return toast('先说一句想要什么风格', 'err');
        ev.target.disabled = true; ev.target.innerHTML = '<span class="spin"></span> 生成中…';
        try {
          const draft = await api.post('/api/styles/draft', { kind, brief, sample: $('#ai_sample', mask).value.trim() });
          close();
          styleModal({ ...draft, kind }, kind); // 无 id → 仍按新建走，477 过目后保存
        } catch (e) { toast(e.message, 'err'); ev.target.disabled = false; ev.target.textContent = '生成配方 →'; }
      };
    },
  });
}

function styleModal(st, kind) {
  const isNew = !st || !st.id; kind = (st && st.kind) || kind || 'writing'; st = st || {};
  const writingBody = `
      <label class="field"><span class="lab">风格名 *</span><input class="input" id="s_name" value="${esc(st.name || '')}" placeholder="例如：卡兹克 AI 杂文 / 财经深度调查"/></label>
      <label class="field"><span class="lab">语气 / 调性</span><textarea class="textarea" id="s_voice" rows="2" placeholder="例如：犀利、有观点、不端着">${esc(st.voice || '')}</textarea></label>
      <label class="field"><span class="lab">句式 / 节奏</span><textarea class="textarea" id="s_sentence" rows="2" placeholder="短句为主；一句一行；多反问">${esc(st.sentence || '')}</textarea></label>
      <label class="field"><span class="lab">常用手法</span><textarea class="textarea" id="s_devices" rows="2" placeholder="开头抛反常识；中间类比；结尾留钩子">${esc(st.devices || '')}</textarea></label>
      <label class="field"><span class="lab">务必避开</span><input class="input" id="s_banned" value="${esc(st.banned || '')}" placeholder="温吞、抒情排比、口号式总结"/></label>
      <label class="field"><span class="lab">参考范文（案例展示，学风格不抄内容）</span><textarea class="textarea" id="s_example" rows="5" placeholder="贴一段你欣赏的范文">${esc(st.example || '')}</textarea></label>`;
  const visualBody = `
      <label class="field"><span class="lab">风格名 *</span><input class="input" id="s_name" value="${esc(st.name || '')}" placeholder="例如：克克白底手绘 / SaaS 科技扁平"/></label>
      <label class="field"><span class="lab">视觉描述（喂给出图）</span><textarea class="textarea" id="s_desc" rows="3" placeholder="配色、线条、质感、氛围…越具体出图越准">${esc(st.desc || '')}</textarea></label>
      <label class="field"><span class="lab">适合场景</span><input class="input" id="s_usage" value="${esc(st.usage || '')}" placeholder="配图 / 封面 / 海报 / 卡片"/></label>
      <label class="field"><span class="lab">样图地址（案例展示）</span><input class="input" id="s_sampleImage" value="${esc(st.sampleImage || '')}" placeholder="/assets/styles/xxx.png 或图片 URL"/></label>`;
  const voiceBrands = (S.boot.brands || []).map((brand) => `<option value="${esc(brand.id)}" ${brand.id === (st.brandId || 'brand_shulex') ? 'selected' : ''}>${esc(brand.name)}</option>`).join('');
  const voiceBody = `
      <div class="voice-form-grid">
        <label class="field"><span class="lab">声音名 *</span><input class="input" id="s_name" value="${esc(st.name || '')}" placeholder="例如：品牌B 小舒 · 清晰亲和"/></label>
        <label class="field"><span class="lab">所属品牌 *</span><select class="select" id="s_brandId">${voiceBrands}</select></label>
        <label class="field"><span class="lab">声音引擎</span><input class="input" id="s_provider" value="${esc(st.provider || 'Keke Voice')}"/></label>
        <label class="field"><span class="lab">模型</span><input class="input" id="s_modelId" value="${esc(st.modelId || 'chatterbox-multilingual')}"/></label>
        <label class="field"><span class="lab">语言</span><input class="input" id="s_language" value="${esc(st.language || '中文')}"/></label>
        <label class="field"><span class="lab">声音类型</span><input class="input" id="s_gender" value="${esc(st.gender || '女声')}"/></label>
      </div>
      <label class="field"><span class="lab">声音描述</span><textarea class="textarea" id="s_tone" rows="2" placeholder="例如：清晰、有温度、专业但不播音腔">${esc(st.tone || '')}</textarea></label>
      <label class="field"><span class="lab">样音文件 *</span>
        <div class="voice-upload-row"><button class="btn btn-primary" type="button" data-audio-upload>选择音频</button><span data-audio-state>${st.sampleAudio ? '已上传，可直接试听' : '支持 WAV / MP3 / M4A，建议 10-30 秒'}</span></div>
        <input type="file" data-audio-file accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/aiff,audio/x-aiff,audio/aac,audio/ogg,audio/webm" hidden/>
        <input type="hidden" id="s_sampleAudio" value="${esc(st.sampleAudio || '')}"/>
        <input type="hidden" id="s_refPath" value="${esc(st.refPath || '')}"/>
      </label>
      ${st.sampleAudio ? `<audio class="voice-form-preview" controls preload="metadata" src="${esc(st.sampleAudio)}"></audio>` : '<audio class="voice-form-preview" controls preload="metadata" hidden></audio>'}
      <label class="field"><span class="lab">记录状态</span><select class="select" id="s_status">
        <option value="candidate" ${st.status !== 'rejected' ? 'selected' : ''}>可选择</option>
        <option value="rejected" ${st.status === 'rejected' ? 'selected' : ''}>未采用</option>
      </select></label>
      <label class="field"><span class="lab">来源备注</span><input class="input" id="s_source" value="${esc(st.source || '')}" placeholder="例如：7月17日 品牌B 自制样音"/></label>`;
  const videoBody = `
      <label class="field"><span class="lab">风格名 *</span><input class="input" id="s_name" value="${esc(st.name || '')}" placeholder="例如：中文竖屏快剪 / 英文讲师横屏"/></label>
      <label class="field"><span class="lab">画面语言（喂给视频管线）</span><textarea class="textarea" id="s_desc" rows="3" placeholder="节奏、运镜、字幕样式、封面感、BGM 情绪…越具体越好">${esc(st.desc || '')}</textarea></label>
      <label class="field"><span class="lab">适配市场 / 平台</span><input class="input" id="s_market" value="${esc(st.market || '')}" placeholder="抖音+视频号 / TikTok 欧美 / B站知识区"/></label>
      <label class="field"><span class="lab">参考片链接（学画面）</span><input class="input" id="s_refLinks" value="${esc(st.refLinks || '')}" placeholder="贴 1-3 条对标视频链接，逗号分隔"/></label>
      <label class="field"><span class="lab">适合场景</span><input class="input" id="s_usage" value="${esc(st.usage || '')}" placeholder="口播短视频 / 长视频 / 信息流投放"/></label>`;
  const bgmBody = `
      <label class="field"><span class="lab">曲名 *</span><input class="input" id="s_name" value="${esc(st.name || '')}" placeholder="例如：48秒环境垫 / 纪录片底"/></label>
      <label class="field"><span class="lab">情绪 / 用法</span><input class="input" id="s_mood" value="${esc(st.mood || '')}" placeholder="无鼓点氛围垫，垫在口播下面 / 沉稳纪录片底"/></label>
      <label class="field"><span class="lab">时长（秒）</span><input class="input" id="s_seconds" value="${esc(st.seconds ?? '')}" placeholder="上传后自动填"/></label>
      <label class="field"><span class="lab">音乐文件</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="button" class="btn btn-ghost btn-sm" data-audio-upload>上传 mp3/wav</button>
          <span class="hint" data-audio-state>${st.audioUrl ? '已有音乐' : '还没上传'}</span>
        </div>
        <input type="file" accept="audio/*" hidden data-audio-file/>
        <input class="input" id="s_audioUrl" value="${esc(st.audioUrl || '')}" placeholder="/assets/bgm/… 或直接贴地址" style="margin-top:8px"/>
        ${st.audioUrl ? `<audio controls preload="none" src="${esc(st.audioUrl)}" style="width:100%;margin-top:8px;height:32px"></audio>` : ''}</label>
      <label class="field"><span class="lab">来源</span><input class="input" id="s_source" value="${esc(st.source || '')}" placeholder="ACE-Step 本地生成 / 素材库 / …"/></label>
      <label class="field"><span class="lab">用在哪</span><input class="input" id="s_usedIn" value="${esc(st.usedIn || '')}" placeholder="Hunter 中文竖屏短视频"/></label>`;
  const bodyByKind = { writing: writingBody, visual: visualBody, voice: voiceBody, video: videoBody, bgm: bgmBody };
  const titleByKind = { writing: '写作风格', visual: '图片风格', voice: '配音声线', video: '视频风格', bgm: '背景音乐' };
  modal({
    title: isNew ? `新建${titleByKind[kind]}` : `编辑 · ${st.name}`,
    bodyHtml: bodyByKind[kind] || writingBody,
    footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-ok>${isNew ? '创建' : '保存'}</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      if (kind === 'voice' || kind === 'bgm') {
        const upload = $('[data-audio-upload]', mask);
        const file = $('[data-audio-file]', mask);
        upload.onclick = () => file.click();
        file.onchange = () => {
          const selected = file.files[0]; if (!selected) return;
          const cap = kind === 'bgm' ? 20 : 8;
          if (selected.size > cap * 1024 * 1024) return toast(`音频请控制在 ${cap}MB 以内`, 'err');
          const state = $('[data-audio-state]', mask);
          state.textContent = '正在上传…'; upload.disabled = true;
          const rd = new FileReader();
          rd.onload = async () => {
            try {
              const result = await api.post('/api/styles/audio', { dataUrl: rd.result, name: $('#s_name', mask).value || selected.name, kind });
              if (kind === 'bgm') {
                $('#s_audioUrl', mask).value = result.url;
                if (result.seconds) $('#s_seconds', mask).value = result.seconds;
                state.textContent = `已上传${result.seconds ? ` · ${result.seconds}s` : ''}`;
                upload.disabled = false;
                return;
              }
              $('#s_sampleAudio', mask).value = result.url;
              $('#s_refPath', mask).value = result.path;
              const preview = $('.voice-form-preview', mask);
              preview.src = result.url; preview.hidden = false; preview.load();
              state.textContent = `${selected.name} · 上传完成`;
              toast('样音已上传', 'ok');
            } catch (e) { state.textContent = '上传失败，请重试'; toast(e.message, 'err'); }
            finally { upload.disabled = false; }
          };
          rd.readAsDataURL(selected);
        };
      }
      $('[data-ok]', mask).onclick = async () => {
        const fields = kind === 'visual'
          ? ['name', 'desc', 'usage', 'sampleImage']
          : kind === 'video'
            ? ['name', 'desc', 'market', 'refLinks', 'usage']
            : kind === 'voice'
              ? ['name', 'brandId', 'provider', 'modelId', 'language', 'gender', 'tone', 'sampleAudio', 'refPath', 'status', 'source']
              : kind === 'bgm'
                ? ['name', 'mood', 'seconds', 'audioUrl', 'source', 'usedIn']
                : ['name', 'voice', 'sentence', 'devices', 'banned', 'example'];
        const payload = { kind };
        fields.forEach((k) => (payload[k] = $(`#s_${k}`, mask).value.trim()));
        if (!payload.name) return toast('风格名必填', 'err');
        if (kind === 'voice' && !payload.sampleAudio) return toast('请先上传样音', 'err');
        if (kind === 'bgm') {
          if (!payload.audioUrl) return toast('请先上传音乐文件', 'err');
          payload.seconds = payload.seconds ? Number(payload.seconds) : null;
        }
        if (isNew) await api.post('/api/styles', payload); else await api.put(`/api/styles/${st.id}`, payload);
        if (kind === 'voice' && !isNew && payload.status === 'rejected') {
          const selectedBrand = (S.boot.brands || []).find((brand) => brand.voiceStyleId === st.id);
          if (selectedBrand) await api.put(`/api/brands/${selectedBrand.id}`, { voiceStyleId: null });
        }
        [S.boot.styles, S.boot.brands] = await Promise.all([api.get('/api/styles'), api.get('/api/brands')]);
        close(); render(); toast('已保存 ✓', 'ok');
      };
    },
  });
}

// =========================================================
//  任务
// =========================================================
// 生命周期节点：生产 → 收录 → 发布 → 数据
const NODE_CLS = { done: 'nd-done', passed: 'nd-passed', pending: 'nd-pending', wait: 'nd-wait', partial: 'nd-partial', running: 'nd-running', queued: 'nd-running', claimed: 'nd-running', waiting_external: 'nd-wait', failed: 'nd-fail', warn: 'nd-partial' };
const NODE_ICON = { done: '✓', passed: 'P', pending: '待', wait: '·', partial: '◐', running: '●', queued: '●', claimed: '●', waiting_external: '⏳', failed: '✕', warn: '!' };
const S_TASK_CLOCK = { timer: null };

function stopTaskClock() {
  if (S_TASK_CLOCK.timer) { clearInterval(S_TASK_CLOCK.timer); S_TASK_CLOCK.timer = null; }
}

function etaMinuteRange(value) {
  const values = String(value || '').match(/\d+/g)?.map(Number).filter(Number.isFinite) || [];
  if (!values.length) return null;
  return { min: values[0], max: values[1] || values[0] };
}

function taskRuntimeText({ status, startedAt, createdAt, eta }, now = Date.now()) {
  const base = new Date(startedAt || createdAt || now).getTime();
  const elapsed = Math.max(0, Math.floor((now - base) / 60000));
  const range = etaMinuteRange(eta);
  if (status === 'queued') return `已排队 ${elapsed} 分钟${range ? ` · 开始后约 ${range.min}–${range.max} 分钟完成` : ''}`;
  if (status !== 'running') return '';
  if (!range) return `已进行 ${elapsed} 分钟`;
  if (elapsed > range.max) return `已进行 ${elapsed} 分钟 · 已超预计 ${elapsed - range.max} 分钟，正在继续`;
  const minLeft = Math.max(0, range.min - elapsed);
  const maxLeft = Math.max(0, range.max - elapsed);
  if (minLeft === 0) return `已进行 ${elapsed} 分钟 · 预计 ${maxLeft} 分钟内完成`;
  return `已进行 ${elapsed} 分钟 · 预计还需 ${minLeft}–${maxLeft} 分钟`;
}

function updateTaskClocks(root) {
  $$('[data-task-runtime]', root).forEach((item) => {
    item.textContent = taskRuntimeText({
      status: item.dataset.status,
      startedAt: item.dataset.startedAt,
      createdAt: item.dataset.createdAt,
      eta: item.dataset.eta,
    });
  });
}

function startTaskClock(root) {
  stopTaskClock();
  updateTaskClocks(root);
  S_TASK_CLOCK.timer = setInterval(() => {
    if (S.view !== 'history') { stopTaskClock(); return; }
    updateTaskClocks(root);
  }, 30000);
}

const TASK_ACTION_LABEL = { '生产': '重跑', '收录': '收录', '发布': '去发布', '数据': '填数据' };

function refreshTaskCenter(close) {
  if (close) close();
  if (S.view === 'history') renderHistory($('#view'));
}

async function taskCollectNode(task, root) {
  const detail = await api.get(`/api/tasks/${encodeURIComponent(task.id)}`);
  const works = detail.works || [];
  if (!works.length) return toast('这个任务还没有可收录的作品', 'err');
  if (works.length === 1) return poolModal(works[0], () => refreshTaskCenter());

  modal({
    title: `收录任务内容 · ${task.brandName || ''}`,
    bodyHtml: `<div class="hint" style="margin-bottom:10px">确认每条作品要进入的平台账号，已收录的内容不会重复创建。</div>
      <div class="task-node-list">${works.map((work) => `<section class="task-node-work" data-work-id="${esc(work.id)}">
        <div class="task-node-work-head"><div><b>${esc(work.title || '未命名作品')}</b><span>${esc(workItemCounts(work) || workTypeInfo(work).label)}</span></div>${S.passReady ? '<button class="btn btn-ghost btn-sm btn-pass" data-pass-work>Pass</button>' : ''}</div>
        <div class="pool-plats">${workPlatforms(work).map((platform) => `<label class="pool-plat"><input type="checkbox" value="${esc(platform)}" checked/> <span>${esc(platform)}</span></label>`).join('')}</div>
      </section>`).join('')}</div>`,
    footHtml: '<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-ok>全部收录</button>',
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $$('[data-pass-work]', mask).forEach((passButton) => {
        passButton.onclick = async () => {
          const row = passButton.closest('.task-node-work');
          if (!(await askConfirm('Pass 这条作品', '这条内容将移入作品库的 Pass箱，不再进入发布流程。'))) return;
          passButton.disabled = true;
          try {
            await api.post(`/api/works/${row.dataset.workId}/pass`, { passed: true });
            row.dataset.passed = 'true';
            row.classList.add('is-passed');
            $$('input', row).forEach((input) => { input.checked = false; input.disabled = true; });
            passButton.textContent = '已 Pass';
            toast('已移入作品 Pass箱', 'ok');
          } catch (error) {
            toast(error.message, 'err');
            passButton.disabled = false;
          }
        };
      });
      $('[data-ok]', mask).onclick = async (event) => {
        const button = event.currentTarget;
        const requests = $$('.task-node-work', mask).filter((row) => row.dataset.passed !== 'true').map((row) => ({
          workId: row.dataset.workId,
          platforms: $$('input:checked', row).map((input) => input.value),
        })).filter((item) => item.platforms.length);
        if (!requests.length) return toast('至少选择一个平台', 'err');
        button.disabled = true;
        button.innerHTML = '<span class="spin"></span> 收录中';
        try {
          await Promise.all(requests.map((item) => api.post(`/api/works/${item.workId}/pool`, { platforms: item.platforms })));
          toast(`已收录 ${requests.length} 条作品 ✓`, 'ok');
          refreshTaskCenter(close);
        } catch (error) {
          toast(error.message, 'err');
          button.disabled = false;
          button.textContent = '全部收录';
        }
      };
    },
  });
}

async function taskPoolNode(task, node, root) {
  const [detail, entries, accounts] = await Promise.all([
    api.get(`/api/tasks/${encodeURIComponent(task.id)}`),
    api.get('/api/pool'),
    api.get('/api/accounts/pool-summary'),
  ]);
  const workIds = new Set((detail.works || []).map((work) => work.id));
  let targets = entries.filter((entry) => entry.taskId === task.id || workIds.has(entry.workId));
  if (node === '发布') targets = targets.filter((entry) => entry.status !== 'published');
  else targets = targets.filter((entry) => entry.status === 'published' && !(entry.stats && (entry.stats.views != null || entry.stats.likes != null)));
  if (!targets.length) {
    toast(node === '发布' ? '没有待发布的账号内容' : '没有待回填的数据', 'ok');
    return refreshTaskCenter();
  }
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const openEntry = (entry, parentClose) => {
    const account = accountById.get(entry.accountId) || { platform: entry.platform, brandName: entry.brandName };
    poolEntryDetailModal(entry, account, () => refreshTaskCenter(parentClose));
  };
  if (targets.length === 1) {
    if (node === '数据') return fillPoolStats(targets[0], () => refreshTaskCenter());
    return openEntry(targets[0]);
  }

  modal({
    title: `${node === '发布' ? '待发布内容' : '待回填数据'} · ${task.brandName || ''}`,
    bodyHtml: `<div class="task-node-list">${targets.map((entry) => `<div class="task-node-entry" data-entry-id="${esc(entry.id)}">
      <div><b>${esc(entry.copyTitle || entry.title || '未命名内容')}</b><span>${esc(entry.platform || '')}${entry.publishedUrl ? ' · 已有发布链接' : ''}</span></div>
      <button class="btn btn-primary btn-sm" data-handle>${node === '数据' ? '填数据' : '处理发布'}</button>
    </div>`).join('')}</div>`,
    footHtml: '<button class="btn btn-ghost" data-x>关闭</button>',
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $$('[data-handle]', mask).forEach((button) => {
        button.onclick = () => {
          const entry = targets.find((item) => item.id === button.closest('[data-entry-id]').dataset.entryId);
          if (node === '数据') fillPoolStats(entry, () => refreshTaskCenter(close));
          else openEntry(entry, close);
        };
      });
    },
  });
}

async function handleTaskNode(task, root, button) {
  const node = task.reminder?.node;
  if (!node) return;
  button.disabled = true;
  try {
    if (node === '生产') {
      const jobId = (task.jobIds || []).at(-1);
      if (!jobId) throw new Error('找不到对应生产任务');
      const path = task.nodes?.produce === 'waiting_external' ? 'resume' : 'retry';
      await api.post(`/api/jobs/${jobId}/${path}`);
      toast(path === 'resume' ? '已继续生产' : '已重新提交生产任务', 'ok');
      return refreshTaskCenter();
    }
    if (node === '收录') return taskCollectNode(task, root);
    return taskPoolNode(task, node, root);
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    button.disabled = false;
  }
}

const NODE_KEYS = [['生产', 'produce'], ['质检', 'qc'], ['收录', 'collect'], ['发布', 'publish'], ['数据', 'data']];
function nodeBar(nodes, taskId) {
  return `<div class="task-nodes">` + NODE_KEYS.map(([label, key], i) => {
    const st = nodes[key];
    return `${i ? '<span class="nd-line"></span>' : ''}<span class="nd ${NODE_CLS[st] || 'nd-wait'}${taskId ? ' nd-click' : ''}"${taskId ? ` data-node="${key}" data-node-task="${esc(taskId)}" title="点这个节点处理／补材料／跳过"` : ''}><i>${NODE_ICON[st] || '·'}</i>${label}</span>`;
  }).join('') + `</div>`;
}

// 点节点：看清这一步卡在哪、直接去处理、补材料、或跳过
function nodeActionModal(task, key) {
  const label = (NODE_KEYS.find(([, k]) => k === key) || ['节点'])[0];
  const st = task.nodes?.[key] || 'wait';
  const stText = { done: '已完成', passed: 'Pass', pending: '待处理', wait: '还没轮到', running: '进行中',
    queued: '排队中', claimed: '产能机生产中', partial: '部分完成', failed: '失败', warn: '有警告' }[st] || st;
  const how = {
    produce: '内容由 agent 或产能机生成。失败可以重跑；也可以补一段素材/要求再生成。',
    qc: '生成完自动按账号规范审稿打分。不过关会列出问题清单，可一键按意见重写。',
    collect: '把作品收录到某个账号，它才会进作品库排队发布。',
    publish: '发布到平台。配了发布凭证的账号可以自动发；没配的手动发完标记一下。',
    data: '发布 24 小时后回填播放/点赞等数据，用来校准曝光预测。',
  }[key];
  modal({
    title: `${label} · ${stText}`,
    bodyHtml: `<div class="wx-src"><b>${esc(task.keyword || task.label || '')}</b><p>${esc(how)}</p>
        <span>${esc(task.brandName || '')}${task.reminder ? ` · 当前提醒：${esc(task.reminder.text)}` : ''}</span></div>
      <label class="field"><span class="lab">补充材料 / 说明（可留空）</span>
        <textarea class="textarea" id="nd_note" rows="3" placeholder="例如：这条配音节奏太快，重做时放慢一点；或贴一段补充资料"></textarea></label>`,
    footHtml: `<button class="btn btn-ghost" data-skip>跳过这一步</button>
      <button class="btn btn-ghost" data-note>只记录说明</button>
      <button class="btn btn-accent" data-go>去处理 →</button>`,
    onMount: (mask, close) => {
      const noteOf = () => $('#nd_note', mask).value.trim();
      $('[data-go]', mask).onclick = async () => {
        const note = noteOf();
        if (note) { try { await api.post(`/api/tasks/${task.id}/note`, { node: key, note }); } catch {} }
        close();
        if (key === 'produce') return openContentTask(task.id, 'history');
        if (key === 'qc') return openContentTask(task.id, 'history');
        if (key === 'collect') return openContentTask(task.id, 'history');
        if (key === 'publish') return switchView('works');
        return switchView('pool');
      };
      $('[data-note]', mask).onclick = async () => {
        const note = noteOf();
        if (!note) return toast('写点什么再记录', 'err');
        try { await api.post(`/api/tasks/${task.id}/note`, { node: key, note }); toast('已记录 ✓', 'ok'); close(); }
        catch (e) { toast(e.message, 'err'); }
      };
      $('[data-skip]', mask).onclick = async () => {
        if (!(await askConfirm('跳过这一步', `「${label}」标记为跳过后不再提醒，链路继续往下走。确定？`))) return;
        try {
          await api.post(`/api/tasks/${task.id}/skip`, { node: key, note: noteOf() });
          toast(`已跳过${label} ✓`, 'ok'); close();
          if (S.view === 'history') renderHistory($('#view'));
        } catch (e) { toast(e.message, 'err'); }
      };
    },
  });
}

async function renderHistory(root) {
  stopTaskClock();
  root.innerHTML = `<div class="page-head"><div class="page-title">任务中心</div><div class="page-sub">加载中…</div></div>`;
  let board = { tasks: [], reminders: [], attention: 0 };
  let jobs = [];
  const [boardResult, jobsResult] = await Promise.all([
    api.get('/api/tasks/board').catch(() => null),
    api.get('/api/jobs').catch(() => []),
  ]);
  if (boardResult) board = boardResult;
  jobs = Array.isArray(jobsResult) ? jobsResult : (jobsResult.jobs || []);
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  updateTaskBadge(board.attention);
  const tasks = board.tasks || [];
  const counts = {};
  tasks.forEach((t) => { const k = t.brandId || 'none'; counts[k] = (counts[k] || 0) + 1; });
  const sel = S.histBrand || 'all';
  const list = sel === 'all' ? tasks : tasks.filter((t) => (t.brandId || 'none') === sel);
  const options = [{ id: 'all', name: `全部账号（${tasks.length}）` }, ...brandList()
    .filter((brand) => counts[brand.id]).map((brand) => ({ id: brand.id, name: `${brand.name}（${counts[brand.id]}）` }))];

  const rem = board.reminders || [];
  const remHtml = rem.length
    ? `<div class="task-reminders"><div class="tr-head">📣 待处理 · ${board.attention} 个节点需要你推进</div>
        ${rem.map((r) => `<div class="tr-item tr-${r.level}">
          <button class="tr-open" data-goto="${esc(r.taskId)}">
            <span class="tr-node">${esc(r.node)}</span>
            <span class="tr-text"><b>${esc(r.brandName)} · ${esc(r.keyword)}</b>｜${esc(r.text)}</span>
          </button>
          <button class="btn btn-primary btn-sm tr-action" data-task-action="${esc(r.taskId)}">${esc(TASK_ACTION_LABEL[r.node] || '处理')}</button>
        </div>`).join('')}</div>`
    : `<div class="task-reminders ok">✅ 没有卡住的节点，都在正常推进</div>`;

  root.innerHTML = `<div class="page-head"><div class="page-title">任务中心</div>
    <div class="page-sub">每条内容从「生产 → 收录 → 发布 → 数据」的进度都在这，卡住的节点会提醒。</div></div>
    ${remHtml}
    <div class="history-toolbar"><label>账号<select class="select" id="histAccount">${options.map((option) => `<option value="${esc(option.id)}" ${option.id === sel ? 'selected' : ''}>${esc(option.name)}</option>`).join('')}</select></label></div>
    ${tasks.length ? '<div class="list" id="histList"></div>' : emptyHtml('↻', '还没有任务。去「创作」产出第一批内容。')}`;

  $$('[data-goto]', root).forEach((b) => b.onclick = () => openContentTask(b.dataset.goto, 'history'));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  $$('[data-task-action]', root).forEach((button) => {
    button.onclick = () => handleTaskNode(taskById.get(button.dataset.taskAction), root, button);
  });
  $('#histAccount', root).onchange = (event) => { S.histBrand = event.target.value; renderHistory(root); };
  if (!tasks.length) return;
  const wrap = $('#histList', root);
  list.forEach((t) => {
    const badge = t.reminder ? `<span class="task-flag task-flag-${t.reminder.level}">● ${esc(t.reminder.node)}待办</span>` : '<span class="task-flag task-flag-ok">推进中</span>';
    const taskJobs = (t.jobIds || []).map((id) => jobById.get(id)).filter(Boolean);
    const activeJob = taskJobs.find((job) => job.status === 'running') || taskJobs.find((job) => job.status === 'queued');
    const runtime = activeJob ? `<div class="task-runtime" data-task-runtime data-status="${esc(activeJob.status)}" data-started-at="${esc(activeJob.startedAt || '')}" data-created-at="${esc(activeJob.createdAt || '')}" data-eta="${esc(activeJob.eta || '')}"></div>` : '';
    const row = el(`<div class="list-row task-row">
      <div class="lr-main">
        <div class="lr-title">${esc(t.keyword || '内容任务')} <span class="task-brand">${esc(t.brandName || '')}</span> ${badge}</div>
        ${nodeBar(t.nodes, t.id)}
        ${runtime}
        <div class="lr-sub">收录 ${t.counts.entries} · 已发 ${t.counts.published}${t.ageDays ? ` · ${t.ageDays}天前` : ' · 今天'}</div>
      </div>
      <div class="lr-actions"><button class="btn btn-primary btn-sm" data-open>查看全部</button>${t.projectId ? '<button class="btn btn-ghost btn-sm" data-del>删除</button>' : ''}</div></div>`);
    $('[data-open]', row).onclick = () => openContentTask(t.id, 'history');
    $$('[data-node]', row).forEach((n) => n.onclick = (ev) => { ev.stopPropagation(); nodeActionModal(t, n.dataset.node); });
    const del = $('[data-del]', row);
    if (del) del.onclick = async () => {
      if (!(await askConfirm('删除任务记录', '删除这个任务记录？'))) return;
      await api.del(`/api/projects/${t.projectId}`);
      S_WORKS.data = null;
      renderHistory(root);
    };
    wrap.appendChild(row);
  });
  startTaskClock(root);
}

// 任务导航角标：待处理节点数
function updateTaskBadge(n) {
  const nav = document.querySelector('.nav-item[data-view="history"]');
  if (!nav) return;
  let b = nav.querySelector('.nav-badge');
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = el('<span class="nav-badge"></span>'); nav.appendChild(b); }
  b.textContent = n > 99 ? '99+' : String(n);
}

function openProject(id) {
  return openContentTask(`project:${id}`, 'history');
}

async function openContentTask(id, backView = 'history', worksBox = null) {
  let task;
  try { task = await api.get(`/api/tasks/${encodeURIComponent(id)}`); } catch (e) { return toast(e.message, 'err'); }
  if (backView === 'works' && worksBox) {
    const showPassed = worksBox === 'passed';
    const filteredWorks = (task.works || []).filter((work) => !!work.passed === showPassed);
    task = {
      ...task,
      works: filteredWorks,
      workCount: filteredWorks.length,
      contentCount: filteredWorks.reduce((sum, work) => sum + (work.items || []).length, 0),
    };
  }
  const root = $('#view');
  const backLabel = { works: '作品库', pool: '账号库', ledger: '账本', history: '任务' }[backView] || '任务';
  root.innerHTML = `<div class="page-head">
      <button class="btn btn-ghost btn-sm" id="backBtn" style="margin-bottom:14px">← 返回${backLabel}</button>
      <div class="page-title task-page-title">${esc(task.label)}</div>
      <div class="page-sub">${task.statusLabel ? `${esc(task.statusLabel)} · ` : ''}${task.workCount} 个作品 · ${task.contentCount} 个内容文件</div></div>
    ${task.waitReason ? `<div class="task-idea"><div class="section-label">当前卡点</div><div>${esc(task.waitReason)}</div></div>` : ''}
    <div class="task-idea"><div class="section-label">原始任务</div><div>${esc(task.idea || '未记录原始任务')}</div></div>
    <div id="taskContents"></div>`;
  $('#backBtn').onclick = () => switchView(backView);
  const contents = $('#taskContents');
  if (task.projectId) {
    let project;
    try { project = await api.get(`/api/projects/${task.projectId}`); } catch (e) { contents.innerHTML = emptyHtml('⚠️', e.message); return; }
    const reopen = el(`<button class="btn btn-accent btn-sm task-reopen">↺ 在创作区重开</button>`);
    reopen.onclick = () => {
      const c = S.create;
      c.idea = project.idea; c.brandId = project.brandId || 'none'; c.outputs = new Set((project.outputs || []).map((output) => output.platformId));
      c.options = { ...c.options, ...(project.options || {}) }; c.project = null; c.results = {};
      switchView('create');
    };
    contents.appendChild(reopen);
    const results = el(`<div class="results"></div>`);
    (project.outputs || []).forEach((output) => results.appendChild(resultCard(output, project.id)));
    contents.appendChild(results);
  } else {
    const grid = el(`<div class="works-task-grid task-page-grid"></div>`);
    (task.works || []).forEach((work) => grid.appendChild(workCard(work)));
    contents.appendChild(grid);
  }
}

// =========================================================
//  日历（真月历视图 + 排期 + 一键跑 + 自动运行）
// =========================================================
const CAL_STATUS = { scheduled: ['待生成', 'pending'], running: ['生成中', 'running'], done: ['完成', 'done'], partial: ['部分完成', 'running'], error: ['失败', 'error'], auto: ['待采集', 'pending'] };
const S_CAL = { ym: null }; // {y, m} 当前显示月

function ymKey(y, m) { return `${y}-${String(m + 1).padStart(2, '0')}`; }
function todayParts() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }; }

async function renderCalendar(root) {
  if (!S_CAL.ym) { const t = todayParts(); S_CAL.ym = { y: t.y, m: t.m }; }
  root.innerHTML = `<div class="page-head"><div class="page-title">日历</div><div class="page-sub">加载中…</div></div>`;
  let list = [];
  try { list = await api.get('/api/calendar'); } catch (e) { /* ignore */ }
  // 排期跑出来的内容现在走到哪一步了：日历上直接显示任务节点 + 一句描述
  try {
    const b = await api.get('/api/tasks/board');
    S_CAL.boardById = Object.fromEntries((b.tasks || []).map((t) => [t.id, t]));
  } catch { S_CAL.boardById = {}; }
  const pending = list.filter((e) => e.status === 'scheduled').length;
  const ymLabel = `${S_CAL.ym.y} 年 ${S_CAL.ym.m + 1} 月`;
  root.innerHTML = `<div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end">
      <div><div class="page-title">内容日历</div>
        <div class="page-sub">点格子加排期；到点自动生成。运营当总编，agent 当执行官。</div></div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" id="calAdd">＋ 新增排期</button>
        <button class="btn btn-primary" id="calRunAll" ${pending ? '' : 'disabled'}>▶ 一键跑全部待生成${pending ? ` (${pending})` : ''}</button>
      </div></div>
    <div class="hint" style="margin:-12px 0 14px">⏰ 服务开着时，到点的排期每分钟自动检查并生成（无需守着）。</div>
    <div id="autoRunLog"></div>
    <div class="cal-toolbar">
      <button class="btn btn-ghost btn-sm" id="calPrev">‹</button>
      <div class="cal-month-label">${ymLabel}</div>
      <button class="btn btn-ghost btn-sm" id="calNext">›</button>
      <button class="btn btn-ghost btn-sm" id="calToday" style="margin-left:auto">今天</button>
    </div>
    <div class="cal-grid" id="calGrid"></div>
    <div id="calDayPanel" style="margin-top:18px"></div>`;

  // 最近自动运行记录：采集 + 排期生成，失败标红带原因，成功可点进对应页面看详情
  const ran = list.filter((e) => e.ranAt).sort((a, b) => new Date(b.ranAt) - new Date(a.ranAt)).slice(0, 8);
  if (ran.length) {
    const runRow = (e) => {
      const isRadar = e.kind === 'radar';
      const okish = e.status === 'done';
      const icon = okish ? '✓' : e.status === 'partial' ? '◐' : '✕';
      const cls = okish ? 'ok' : e.status === 'partial' ? 'part' : 'err';
      const what = isRadar ? `⚡ 灵感采集${e.summary ? ` · ${esc(e.summary)}` : ''}` : `✍️ ${esc(String(e.idea || '').slice(0, 22))}`;
      const detail = !okish && e.errorMsg ? `<i class="arl-err" title="${esc(e.errorMsg)}">${esc(String(e.errorMsg).slice(0, 40))}…</i>` : '';
      return `<button class="arl-row arl-${cls}" data-run-id="${esc(e.id)}" title="${okish || e.status === 'partial' ? '点击查看详情' : esc(e.errorMsg || '运行失败')}">
        <span class="arl-time">${esc(String(e.ranAt).slice(5, 16).replace('T', ' '))}</span>
        <span class="arl-ic">${icon}</span><span class="arl-what">${what}</span>${detail}</button>`;
    };
    $('#autoRunLog', root).innerHTML = `<div class="arl"><div class="arl-head">⚙️ 最近自动运行</div>${ran.map(runRow).join('')}</div>`;
    $$('[data-run-id]', root).forEach((b) => b.onclick = () => {
      const e = list.find((x) => x.id === b.dataset.runId);
      if (!e) return;
      if (e.kind === 'radar') return switchView('news');
      if (e.projectId) return openProject(e.projectId);
      toast(e.errorMsg || '这条没有产出可看', e.errorMsg ? 'err' : 'ok');
    });
  }

  $('#calAdd', root).onclick = () => calEntryModal();
  $('#calPrev', root).onclick = () => { let { y, m } = S_CAL.ym; m--; if (m < 0) { m = 11; y--; } S_CAL.ym = { y, m }; renderCalendar(root); };
  $('#calNext', root).onclick = () => { let { y, m } = S_CAL.ym; m++; if (m > 11) { m = 0; y++; } S_CAL.ym = { y, m }; renderCalendar(root); };
  $('#calToday', root).onclick = () => { const t = todayParts(); S_CAL.ym = { y: t.y, m: t.m }; renderCalendar(root); };
  $('#calRunAll', root).onclick = async (ev) => {
    if (!pending) return;
    ev.target.disabled = true; ev.target.innerHTML = '<span class="spin"></span> 全部生成中…';
    try { const r = await api.post('/api/calendar/run-all'); toast(`已生成 ${r.ran} 条`, 'ok'); } catch (err) { toast(err.message, 'err'); }
    renderCalendar(root);
  };

  buildMonthGrid(root, list);
}

function buildMonthGrid(root, list) {
  const grid = $('#calGrid', root);
  const { y, m } = S_CAL.ym;
  const today = todayParts();
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // 周一开头：周一=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // 把排期按日期分桶
  const byDate = {};
  list.forEach((e) => { (byDate[e.date] = byDate[e.date] || []).push(e); });

  let html = ['一', '二', '三', '四', '五', '六', '日'].map((d) => `<div class="cal-dow">${d}</div>`).join('');
  // 前置空格
  for (let i = 0; i < startOffset; i++) html += `<div class="cal-cell muted"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const entries = byDate[dateStr] || [];
    const isToday = today.y === y && today.m === m && today.d === d;
    // 内容排期的点排前面，灵感采集的点靠后——一眼分得清「今天有活」和「系统在采集」
    const sorted = [...entries].sort((a, b) => (a.kind === 'radar' ? 1 : 0) - (b.kind === 'radar' ? 1 : 0));
    const dots = sorted.slice(0, 4).map((e) => {
      const s = e.kind === 'radar' ? `radar ${e.status || 'auto'}` : (e.status || 'scheduled');
      const tip = e.kind === 'radar' ? `${e.time} 灵感采集${e.summary ? ' · ' + e.summary : ''}` : `${esc(e.idea.slice(0, 30))} · ${e.brandName || ''}`;
      return `<span class="cal-dot ${s}" title="${esc(tip)}"></span>`;
    }).join('');
    const more = entries.length > 4 ? `<span class="cal-more">+${entries.length - 4}</span>` : '';
    html += `<div class="cal-cell ${isToday ? 'today' : ''} ${entries.length ? 'has' : ''}" data-date="${dateStr}">
      <div class="cal-day">${d}</div>
      <div class="cal-dots">${dots}${more}</div>
    </div>`;
  }
  grid.innerHTML = html;

  $$('.cal-cell[data-date]', grid).forEach((cell) => {
    cell.onclick = () => {
      const date = cell.dataset.date;
      grid.querySelectorAll('.cal-cell.focused').forEach((c) => c.classList.remove('focused'));
      cell.classList.add('focused');
      renderDayPanel(root, date, byDate[date] || []);
    };
  });
  // 默认聚焦今天（若在本月）/ 否则 1 号
  const focusDate = today.y === y && today.m === m ? `${y}-${String(m + 1).padStart(2, '0')}-${String(today.d).padStart(2, '0')}` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const focusCell = grid.querySelector(`.cal-cell[data-date="${focusDate}"]`);
  if (focusCell) { focusCell.classList.add('focused'); renderDayPanel(root, focusDate, byDate[focusDate] || []); }
}

function renderDayPanel(root, date, entries) {
  const panel = $('#calDayPanel', root);
  if (!entries.length) {
    panel.innerHTML = `<div class="entity-card" style="text-align:center;color:var(--ink-3);padding:24px"><b>${esc(date)}</b> 没有排期 · <a style="cursor:pointer;color:var(--accent-ink)" id="addOnDate">＋ 在这一天加一条</a></div>`;
    $('#addOnDate', panel).onclick = () => calEntryModal(date);
    return;
  }
  // 灵感采集是系统节奏，不算内容排期——标题分开数，别让 4 条采集显示成「4 条排期」
  const radarCount = entries.filter((e) => e.kind === 'radar').length;
  const contentCount = entries.length - radarCount;
  const countLabel = [contentCount ? `${contentCount} 条排期` : '没有内容排期', radarCount ? `${radarCount} 次灵感采集` : ''].filter(Boolean).join(' · ');
  panel.innerHTML = `<div class="section-label" style="display:flex;justify-content:space-between"><span>${esc(date)} · ${countLabel}</span><a style="cursor:pointer;color:var(--accent-ink)" id="addOnDate">＋ 加一条</a></div><div class="list" id="dayList"></div>`;
  $('#addOnDate', panel).onclick = () => calEntryModal(date);
  const wrap = $('#dayList', panel);
  const todayStr = new Date().toISOString().slice(0, 10);
  entries.forEach((e) => {
    // 灵感雷达采集记录：系统节奏卡，不是内容排期——只展示状态与统计，入口去灵感页
    if (e.kind === 'radar') {
      const [rl, rc] = e.status === 'done' ? ['已采集', 'done']
        : e.status === 'error' ? ['采集失败', 'error']
        : date < todayStr ? ['未采集', 'error'] : ['待采集', 'pending'];
      const row = el(`<div class="list-row radar-slot">
        <div style="font-family:var(--mono);font-size:12px;color:var(--ink-3);width:56px;flex-shrink:0">${esc(e.time || '')}</div>
        <div class="lr-main"><div class="lr-title">⚡ 灵感雷达自动采集</div>
          <div class="lr-sub">${e.summary ? esc(e.summary) : '到点自动抓取 Podcast / YouTube / X / 博客 / 媒体'}</div></div>
        <span class="rc-badge ${rc}" style="align-self:center">${rl}</span>
        <div class="lr-actions"><button class="btn btn-ghost btn-sm" data-radar>去灵感页</button><button class="btn btn-ghost btn-sm" data-del>删除</button></div></div>`);
      $('[data-radar]', row).onclick = () => switchView('news');
      $('[data-del]', row).onclick = async () => { await api.del(`/api/calendar/${e.id}`); renderCalendar(root); };
      wrap.appendChild(row);
      return;
    }
    const [label, cls] = CAL_STATUS[e.status] || ['待生成', 'pending'];
    const pills = (e.outputs || []).map((id) => { const p = getPlat(id); return `<span class="pill">${p ? p.emoji + ' ' + esc(p.label) : esc(id)}</span>`; }).join('');
    const row = el(`<div class="list-row">
      <div style="font-family:var(--mono);font-size:12px;color:var(--ink-3);width:56px;flex-shrink:0">${esc(e.time || '09:00')}</div>
      <div class="lr-main"><div class="lr-title">${esc(e.idea.slice(0, 40))}</div>
        <div class="lr-sub">${esc(e.brandName || '无品牌')} · ${e.auto === false ? '手动' : '自动'}${e.ranAt ? ` · 跑于 ${esc(String(e.ranAt).slice(5, 16).replace('T', ' '))}` : ''}</div>
        ${e.errorMsg ? `<div class="lr-sub" style="color:var(--err)">⚠ ${esc(e.errorMsg)}</div>` : ''}
        ${e.projectId && S_CAL.boardById?.[`project:${e.projectId}`]
          ? `<div class="cal-node-wrap">${nodeBar(S_CAL.boardById[`project:${e.projectId}`].nodes)}
             <div class="lr-sub">${esc(S_CAL.boardById[`project:${e.projectId}`].reminder?.text || '链路已走完')}</div></div>` : ''}
        <div class="lr-pills" style="margin-top:6px">${pills}</div></div>
      <span class="rc-badge ${cls}" style="align-self:center">${label}</span>
      <div class="lr-actions">
        ${e.status === 'scheduled' || e.status === 'error' ? '<button class="btn btn-accent btn-sm" data-run>▶ 立即跑</button>' : ''}
        ${e.projectId ? '<button class="btn btn-ghost btn-sm" data-open>查看</button>' : ''}
        <button class="btn btn-ghost btn-sm" data-del>删除</button></div></div>`);
    const runBtn = $('[data-run]', row);
    if (runBtn) runBtn.onclick = async () => {
      runBtn.disabled = true; runBtn.innerHTML = '<span class="spin"></span> 生成中…';
      try { await api.post(`/api/calendar/${e.id}/run`); toast('已生成', 'ok'); } catch (err) { toast(err.message, 'err'); }
      renderCalendar(root);
    };
    const openBtn = $('[data-open]', row);
    if (openBtn) openBtn.onclick = () => openProject(e.projectId);
    $('[data-del]', row).onclick = async () => { await api.del(`/api/calendar/${e.id}`); renderCalendar(root); };
    wrap.appendChild(row);
  });
}

function calEntryModal(prefilledDate) {
  const picked = new Set();
  const today = prefilledDate || new Date().toISOString().slice(0, 10);
  const brandOpts = brandList().map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  const chipsHtml = (S.boot.platforms || []).map((p) => `<button type="button" class="chip" data-id="${p.id}"><span class="chip-em">${p.emoji}</span>${esc(p.label)}</button>`).join('');
  modal({
    title: '新增排期',
    bodyHtml: `
      <div class="chip-row" id="c_kind" style="margin-bottom:14px">
        <button type="button" class="chip sel" data-kind="content"><span class="chip-em">✍️</span>内容排期</button>
        <button type="button" class="chip" data-kind="radar"><span class="chip-em">⚡</span>灵感采集</button>
      </div>
      <div class="grid-2">
        <label class="field"><span class="lab">日期</span><input class="input" type="date" id="c_date" value="${today}"/></label>
        <label class="field"><span class="lab">时间</span><input class="input" type="time" id="c_time" value="09:00"/></label>
      </div>
      <div id="c_contentFields">
        <label class="field"><span class="lab">品牌</span><select class="select" id="c_brand">${brandOpts}</select></label>
        <label class="field"><span class="lab">想法 / 选题</span><textarea class="textarea" id="c_idea" rows="2" placeholder="这条要讲什么…"></textarea></label>
        <label class="field"><span class="lab">生成哪些形态</span><div class="chip-row" id="c_outs">${chipsHtml}</div></label>
        <label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="c_auto" checked/> <span>到点自动生成（取消勾选则只能手动「立即跑」）</span></label>
      </div>
      <div id="c_radarNote" class="hint" style="display:none;padding:10px 12px;background:var(--wash);border-radius:10px;line-height:1.6">
        到点自动跑一轮灵感雷达：抓 Podcast / YouTube / X / 博客 / 媒体 → 去重 → 按账号风格打分出卡。<br>系统默认每天 08:00 / 12:00 / 16:00 / 20:00 各一次，这里可以再加任意时间点。
      </div>`,
    footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-ok>加入日历</button>`,
    onMount: (mask, close) => {
      let kind = 'content';
      $('[data-x]', mask).onclick = close;
      $$('#c_kind .chip', mask).forEach((ch) => ch.onclick = () => {
        kind = ch.dataset.kind;
        $$('#c_kind .chip', mask).forEach((x) => x.classList.toggle('sel', x === ch));
        $('#c_contentFields', mask).style.display = kind === 'radar' ? 'none' : '';
        $('#c_radarNote', mask).style.display = kind === 'radar' ? '' : 'none';
      });
      $$('#c_outs .chip', mask).forEach((ch) => ch.onclick = () => { const id = ch.dataset.id; if (picked.has(id)) picked.delete(id); else picked.add(id); ch.classList.toggle('sel'); });
      $('[data-ok]', mask).onclick = async () => {
        const date = $('#c_date', mask).value;
        const time = $('#c_time', mask).value;
        if (kind === 'radar') {
          await api.post('/api/calendar', { kind: 'radar', date, time });
          close(); renderCalendar($('#view')); toast('灵感采集已排进日历 ✓', 'ok');
          return;
        }
        const idea = $('#c_idea', mask).value.trim();
        if (!idea) return toast('写一下想法', 'err');
        if (!picked.size) return toast('至少选一种形态', 'err');
        await api.post('/api/calendar', {
          date, time, brandId: $('#c_brand', mask).value, idea, outputs: [...picked], auto: $('#c_auto', mask).checked,
        });
        close(); renderCalendar($('#view')); toast('已加入日历 ✓', 'ok');
      };
    },
  });
}

// =========================================================
//  设置（模型透明 + 账号最小版）
// =========================================================
async function renderSettings(root) {
  let accts = [];
  try { accts = await api.get('/api/accounts'); } catch (e) { /* ignore */ }
  let cliTokens = [];
  try { cliTokens = await api.get('/api/cli/tokens'); } catch (e) { /* ignore */ }
  let catalog = [];
  try { catalog = await api.get('/api/models/catalog'); } catch (e) { /* ignore */ }
  let modelCfg = { prefs: {}, defaults: {} };
  try { modelCfg = await api.get('/api/settings/models'); } catch (e) { /* ignore */ }
  const models = S.boot.models || [];
  root.innerHTML = `<div class="page-head"><div class="page-title">设置</div>
    <div class="page-sub">看清每一步用什么模型、调谁的额度；登记你的发布账号。</div></div>

    <div class="set-card">
    <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
      <span>🧠 模型全家桶（flatkey 全部模型可选 · 保存即全系统生效）</span>
      <button class="btn btn-accent btn-sm" id="modelSave">保存模型配置</button></div>
    <div class="hint" style="margin-bottom:10px">${S.boot.keyOk ? '✅ flatkey key 已就绪（本地=钥匙串 / 线上=服务器环境配置）' : '❌ flatkey key 缺失'} · 目录共 ${catalog.length} 个模型，10 分钟刷新一次</div>
    <div class="list">
      ${[
        { key: 'text', label: '✍️ 文字 / 文案 / 建号 / 路由', note: '🟢 线上原生 · 保存即生效' },
        { key: 'topic', label: '✨ 选题 agent', note: '🟢 线上原生 · 保存即生效（快模型省额度）' },
        { key: 'imageDesign', label: '🎨 出图前的提示词设计', note: '🟢 线上原生 · 保存即生效' },
        { key: 'image', label: '🖼 出图模型（封面/配图本体）', note: '🟢 线上原生 · 保存即生效 · 中文文字渲染 gpt-image-2 最稳', filter: /image|banana|flux|seedream|dall|recraft/i },
        { key: 'worker', label: '🎬 视频产能机模型', note: '🟠 产能机执行 · 新派的任务生效 · 哪台绑了 CLI 的电脑接活就在哪跑（claude / codex 都行，不挑）' },
        { key: 'qc', label: '🩺 质检模型（发布前审稿打分）', note: '🟢 线上原生 · 保存即生效 · 跑量大，默认便宜模型就够' },
      ].map((row) => `<div class="list-row"><div class="lr-main">
          <div class="lr-title">${row.label}</div>
          <div class="lr-sub">${row.note} · 当前默认 <b>${esc(modelCfg.defaults[row.key] || '')}</b></div></div>
        <div class="lr-actions"><select class="input" data-mpref="${row.key}" style="min-width:230px">
          <option value="">默认（${esc(modelCfg.defaults[row.key] || '')}）</option>
          ${(row.filter ? catalog.filter((id) => row.filter.test(id)) : catalog).map((id) => `<option value="${esc(id)}" ${modelCfg.prefs[row.key] === id ? 'selected' : ''}>${esc(id)}</option>`).join('')}
        </select></div></div>`).join('')}
      <div class="list-row"><div class="lr-main">
        <div class="lr-title">🎙 配音引擎</div>
        <div class="lr-sub">ElevenLabs · 走 flatkey 一个 key（Qwen 已全线退役）。具体声线在「风格库」的声音风格里选，或在渠道配置里定；没选时用渠道默认声线。</div></div></div>
    </div>
    </div>

    <div class="set-card">
    <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
      <span class="fold-head" id="priceFold" role="button" tabindex="0"><span class="fold-caret">▸</span>💰 模型单价表（账本按这个算钱）</span>
      <button class="btn btn-accent btn-sm" id="priceSave" hidden>保存单价</button></div>
    <div id="priceBox" hidden>
      <div class="hint" style="margin-bottom:10px">上游 API 参考价（USD），flatkey 实扣以其控制台为准、通常更低——账本里的金额都标「非实扣」。按模型 id 子串匹配，改完保存即全站生效。</div>
      <div class="list" id="priceList"><div class="hint">加载价格表…</div></div>
    </div>
    </div>

    <div class="set-card">
    <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
      <span>🔌 CLI 产能机接入（Claude Code / Codex）</span><button class="btn btn-accent btn-sm" id="cliMint">＋ 生成接入令牌</button></div>
    <div class="hint" style="margin-bottom:10px">把你电脑上的 Claude Code 或 Codex 绑上系统——绑定后那台电脑就是一台产能机：能读品牌大脑、领视频任务书、装齐环境后直接产片交付。谁的电脑都行，一人一令牌。<a style="cursor:pointer;color:var(--accent-ink)" id="cliDocLink">看完整说明书 →</a></div>
    ${cliTokens.length ? '<div class="list" id="cliTokList"></div>' : '<div class="hint">还没有令牌。点「＋ 生成接入令牌」，按弹窗三步把 CLI 绑上来。</div>'}
    </div>

    <div class="set-card">
    <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
      <span>👤 发布账号</span><button class="btn btn-ghost btn-sm" id="acctAdd">＋ 登记账号</button></div>
    <div class="hint" style="margin-bottom:14px">⚠️ 目前是手动登记（账号 + 主页链接 + 备注），方便统一管理。<b>浏览器一键抓取账号数据</b>是下一步——它有封号/限流风险（老系统就栽在这），想清楚再上。</div>
    ${accts.length ? '<div class="list" id="acctList"></div>' : emptyHtml('👤', '还没有登记账号。点「＋ 登记账号」加一个。')}
    </div>`;

  // 单价表默认收起：十几行输入框平时不用看
  const priceFold = $('#priceFold', root);
  if (priceFold) priceFold.onclick = () => {
    const box = $('#priceBox', root);
    const open = box.hasAttribute('hidden');
    box.toggleAttribute('hidden', !open);
    $('#priceSave', root).toggleAttribute('hidden', !open);
    $('.fold-caret', priceFold).classList.toggle('open', open);
  };
  $('#modelSave', root).onclick = async () => {
    const modelsPayload = {};
    $$('[data-mpref]', root).forEach((sel) => { modelsPayload[sel.dataset.mpref] = sel.value; });
    try {
      await api.put('/api/settings/models', { models: modelsPayload });
      toast('模型配置已保存，全系统即时生效', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  // 单价表：拉取 → 逐行可编辑 → 保存回 wsSettings.pricing
  api.get('/api/pricing').catch(() => []).then((prices) => {
    const wrap = $('#priceList', root);
    if (!wrap) return;
    const inp = (row, key, ph) => `<input class="input" style="width:88px;font-family:var(--mono);font-size:12px" data-p="${esc(row.match)}:${key}" value="${row[key] || ''}" placeholder="${ph}">`;
    wrap.innerHTML = (prices || []).map((p) => `<div class="list-row">
      <div class="lr-main"><div class="lr-title" style="font-family:var(--mono);font-size:13px">${esc(p.match)}</div>
        <div class="lr-sub">${p.type === 'token' ? '按 token（USD/百万）' : p.type === 'image' ? '按张（USD/张）' : '按字符（USD/百万字符）'} · ${esc(p.note || '')}</div></div>
      <div class="lr-actions" style="gap:6px">
        ${p.type === 'token' ? `${inp(p, 'usdInPerM', '输入')}${inp(p, 'usdOutPerM', '输出')}` : p.type === 'image' ? inp(p, 'usdPerImage', '每张') : inp(p, 'usdPerMChars', '每M字符')}
      </div></div>`).join('');
    S._pricingRows = prices;
  });
  $('#priceSave', root).onclick = async () => {
    const rows = (S._pricingRows || []).map((p) => ({ ...p }));
    $$('[data-p]', root).forEach((el2) => {
      const [match, key] = el2.dataset.p.split(':');
      const row = rows.find((r) => r.match === match);
      if (row) row[key] = Number(el2.value) || 0;
    });
    try { await api.put('/api/pricing', { pricing: rows }); toast('单价已保存，账本即刻按新价算', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const docLink = $('#cliDocLink', root);
  if (docLink) docLink.onclick = () => switchView('cli-doc');
  $('#cliMint', root).onclick = async () => {
    const a = await askText({ title: '生成 CLI 接入令牌', msg: '这个令牌给谁的电脑用？绑定后那台机器就能领活产片。', fields: [{ key: 'label', label: '备注', placeholder: '477 的 Mac / Hunter 的电脑 / 服务器' }] });
    if (!a) return;
    try {
      const r = await api.post('/api/cli/tokens', { label: a.label || 'CLI' });
      cliBindModal(r.token, a.label || 'CLI');
    } catch (e) { toast(e.message, 'err'); }
  };
  if (cliTokens.length) {
    const wrap = $('#cliTokList', root);
    cliTokens.forEach((t) => {
      const row = el(`<div class="list-row">
        <div class="lr-main"><div class="lr-title">🔑 ${esc(t.label)} <span class="hint">…${esc(t.tail || '')}</span></div>
          <div class="lr-sub">建于 ${esc((t.createdAt || '').slice(0, 10))}${t.lastUsedAt ? ' · 最近使用 ' + esc(t.lastUsedAt.slice(0, 16).replace('T', ' ')) : ' · 还没用过'}</div></div>
        <div class="lr-actions"><button class="btn btn-ghost btn-sm" data-revoke>吊销</button></div></div>`);
      $('[data-revoke]', row).onclick = async () => {
        if (!(await askConfirm('吊销令牌', `吊销「${t.label}」后，那台机器的 CLI 立即断开。确定？`))) return;
        await api.del(`/api/cli/tokens/${t.id}`);
        renderSettings(root);
      };
      wrap.appendChild(row);
    });
  }
  $('#acctAdd', root).onclick = () => acctModal();
  if (accts.length) {
    const wrap = $('#acctList', root);
    accts.forEach((a) => {
      const row = el(`<div class="list-row">
        <div class="lr-main"><div class="lr-title">${esc(a.platform || '平台')} · ${esc(a.handle || '')}</div>
          <div class="lr-sub">${a.url ? `<a href="${esc(a.url)}" target="_blank">${esc(a.url)}</a>` : ''}${a.note ? ' · ' + esc(a.note) : ''}</div></div>
        <div class="lr-actions"><button class="btn btn-ghost btn-sm" data-del>删除</button></div></div>`);
      $('[data-del]', row).onclick = async () => { await api.del(`/api/accounts/${a.id}`); renderSettings(root); };
      wrap.appendChild(row);
    });
  }
}

// 渠道规格书详情：渠道≠skill——渠道是「给产能机的任务规格」，skill 是产能机电脑上的制作方法论
function channelSpecModal(brand, ch) {
  if (!ch) return;
  // 渠道从风格库挂风格：视频风格（使用中的 kind=video）下拉，存 channel.videoStyleId
  const videoStyles = (S.boot.styles || []).filter((s) => s.kind === 'video' && s.inUse !== false);
  const linked = videoStyles.find((s) => s.id === ch.videoStyleId) || null;
  modal({
    title: `🎬 ${ch.label || ch.id}`,
    bodyHtml: `
      <div class="hint" style="margin-bottom:10px">渠道 = 生产规格书：定画幅/时长/交付物，并指定调用产能机上的哪个 skill。画面/声音风格从「风格库」挂——风格库是总仓库，渠道只是引用。</div>
      <div class="list">
        <div class="list-row"><div class="lr-main"><div class="lr-title">调用 skill</div><div class="lr-sub">${esc(ch.skill || '（模板内指定）')}</div></div></div>
        <div class="list-row"><div class="lr-main"><div class="lr-title">预计耗时 / 超时</div><div class="lr-sub">${esc(ch.eta || '—')} · 超时 ${esc(String(ch.timeoutMin || 90))} 分钟</div></div></div>
        <div class="list-row"><div class="lr-main"><div class="lr-title">配音</div><div class="lr-sub">${esc(ch.voice?.name || '按渠道模板')}</div></div></div>
        <div class="list-row"><div class="lr-main"><div class="lr-title">视频风格（风格库）</div><div class="lr-sub" style="display:flex;gap:8px;align-items:center">
          <select class="select" id="chVideoStyle" style="min-width:200px"><option value="">按渠道模板默认</option>${videoStyles.map((s) => `<option value="${s.id}" ${s.id === ch.videoStyleId ? 'selected' : ''}>${esc(s.name)}${s.market ? `（${esc(s.market)}）` : ''}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" id="chStyleSave">保存</button></div></div></div>
        <div class="list-row"><div class="lr-main"><div class="lr-title">交付物</div><div class="lr-sub">${(ch.expectedProducts || []).map(esc).join(' · ') || '按模板'}</div></div></div>
      </div>
      ${linked ? `<div class="hint" style="margin:8px 0">当前画面语言：${esc((linked.desc || '').slice(0, 100))}</div>` : ''}
      <div class="section-label" style="margin:12px 0 8px">规格书全文（派单时 {{idea}} 换成选题）</div>
      <pre style="white-space:pre-wrap;word-break:break-all;background:var(--paper);border:1px solid var(--hair);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.55;max-height:300px;overflow:auto">${esc(ch.promptTemplate || '（空）')}</pre>`,
    footHtml: `<button class="btn btn-accent" data-x>关闭</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $('#chStyleSave', mask).onclick = async (ev) => {
        ev.target.disabled = true;
        try {
          const channels = (brand.channels || []).map((c) => (c.id === ch.id ? { ...c, videoStyleId: $('#chVideoStyle', mask).value || null } : c));
          await api.put(`/api/brands/${brand.id}`, { channels });
          S.boot.brands = await api.get('/api/brands');
          toast('渠道已挂上该视频风格，之后派的活按它拍', 'ok');
          close();
        } catch (e) { toast(e.message, 'err'); ev.target.disabled = false; }
      };
    },
  });
}

// 🗂 草稿箱：追加式生成历史（重新生成被顶掉的旧版也在），只有点删除才消失
async function draftsModal() {
  let list = [];
  try { list = await api.get('/api/drafts'); } catch (e) { return toast(e.message, 'err'); }
  const kindEm = (k) => k === 'image' ? '🖼' : k === 'plan' ? '🎬' : k === 'article_layout' ? '📰' : '✍️';
  modal({
    title: `🗂 草稿箱 · ${list.length} 条`,
    bodyHtml: `<div class="hint" style="margin-bottom:10px">每次生成都自动存这（含被重新生成顶掉的旧版）。只有删除才会消失。</div>
      <div class="list" id="draftList" style="max-height:56vh;overflow:auto">${list.length ? '' : '<div class="hint" style="padding:10px">还没有草稿——去创作页生成点什么。</div>'}</div>`,
    footHtml: `<button class="btn btn-accent" data-x>关闭</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      const wrap = $('#draftList', mask);
      list.forEach((d) => {
        const p = getPlat(d.platformId) || { label: d.platformId };
        const row = el(`<div class="list-row"><div class="lr-main">
            <div class="lr-title">${kindEm(d.kind)} ${esc(p.label || d.platformId)} <span class="hint">· ${esc(relTime(d.createdAt))}</span></div>
            <div class="lr-sub">${esc(String(d.title || d.idea || d.content || '').slice(0, 60))}</div></div>
          <div class="lr-actions">
            ${d.content || d.imageUrl ? '<button class="btn btn-ghost btn-sm" data-view>查看</button>' : ''}
            ${d.content ? '<button class="btn btn-ghost btn-sm" data-copy>复制</button>' : ''}
            <button class="btn btn-ghost btn-sm" data-del title="删除后不可恢复">⌫</button>
          </div></div>`);
        $('[data-view]', row) && ($('[data-view]', row).onclick = () => {
          modal({
            title: `${kindEm(d.kind)} ${esc(p.label || d.platformId)} · ${esc(relTime(d.createdAt))}`,
            bodyHtml: d.imageUrl ? `<img src="${esc(d.imageUrl)}" style="max-width:100%;border-radius:10px"/>`
              : `<pre style="white-space:pre-wrap;word-break:break-word;background:var(--paper);border:1px solid var(--hair);border-radius:10px;padding:12px;font-size:13px;line-height:1.65;max-height:60vh;overflow:auto">${esc(d.content || '')}</pre>`,
            footHtml: `<button class="btn btn-accent" data-x>关闭</button>`,
            onMount: (m2, c2) => { $('[data-x]', m2).onclick = c2; },
          });
        });
        $('[data-copy]', row) && ($('[data-copy]', row).onclick = async () => { try { await navigator.clipboard.writeText(d.content); toast('已复制', 'ok'); } catch {} });
        $('[data-del]', row).onclick = async () => {
          if (!(await askConfirm('删除草稿', '删除后不可恢复，确定？'))) return;
          await api.del(`/api/drafts/${d.id}`); row.remove(); toast('已删除', 'ok');
        };
        wrap.appendChild(row);
      });
    },
  });
}

function cliBindModal(token, label) {
  const base = location.origin;
  const claudeCmd = `claude mcp add --transport http 1toall ${base}/api/cli/mcp --header "Authorization: Bearer ${token}"`;
  const codexCmd = `codex mcp add 1toall -- npx -y mcp-remote ${base}/api/cli/mcp --header "Authorization: Bearer ${token}"`;
  const block = (id, cmd) => `<div style="position:relative;margin:6px 0 14px"><pre style="white-space:pre-wrap;word-break:break-all;background:var(--paper);border:1px solid var(--hair);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.5">${esc(cmd)}</pre><button class="btn btn-ghost btn-sm" data-copy="${id}" style="position:absolute;top:6px;right:6px">复制</button></div>`;
  modal({
    title: `🔑 令牌已生成 · ${label}`,
    bodyHtml: `
      <p class="ask-msg">⚠️ <b>这串令牌只显示这一次</b>，关掉就再也看不到。下面的命令里已经带好了它，<b>先复制、贴到终端跑完再关</b>。丢了也不要紧——回设置页吊销旧的、重发一个即可。</p>
      <div class="section-label">① 复制下面这条，贴进电脑终端回车</div>
      <div class="hint">如果你电脑上装的是 <b>Claude Code</b>：</div>${block('c1', claudeCmd)}
      <div class="hint">如果装的是 <b>Codex</b>：</div>${block('c2', codexCmd)}
      <div class="hint">两个二选一，跑完没报错就是接上了。</div>
      <div class="section-label" style="margin-top:14px">② 让它自己把做视频的环境装齐</div>
      <p class="ask-msg">对 CLI 说这句话就行：</p>
      <div class="doc-say">调 1toall 的 get_setup_guide，带我把做视频的环境装齐</div>
      <p class="ask-msg hint">它会自检 ffmpeg、python、语音转写、中文字体、flatkey key，缺什么装什么。已经跑过视频的电脑一般直接就是满配。</p>
      <div class="section-label" style="margin-top:14px">③ 开工</div>
      <p class="ask-msg">以后在网页右下角的小狗那里派活，这台电脑就会自动来领；也可以直接对 CLI 说「<b>用 1toall 领活</b>」。</p>`,
    footHtml: `<button class="btn btn-ghost" data-doc>看完整说明书</button><button class="btn btn-accent" data-x>命令已复制，关闭</button>`,
    onMount: (mask, close) => {
      $('[data-copy="c1"]', mask).onclick = async () => { try { await navigator.clipboard.writeText(claudeCmd); toast('已复制 Claude 命令', 'ok'); } catch {} };
      $('[data-copy="c2"]', mask).onclick = async () => { try { await navigator.clipboard.writeText(codexCmd); toast('已复制 Codex 命令', 'ok'); } catch {} };
      $('[data-doc]', mask).onclick = () => { close(); switchView('cli-doc'); };
      $('[data-x]', mask).onclick = () => { close(); if (S.view === 'settings') switchView('settings'); };
    },
  });
}

function acctModal() {
  modal({
    title: '登记发布账号',
    bodyHtml: `
      <label class="field"><span class="lab">平台</span><input class="input" id="a_platform" placeholder="小红书 / 抖音 / 公众号 / X"/></label>
      <label class="field"><span class="lab">账号名 / handle</span><input class="input" id="a_handle" placeholder="@你的账号"/></label>
      <label class="field"><span class="lab">主页链接</span><input class="input" id="a_url" placeholder="https://…"/></label>
      <label class="field"><span class="lab">备注</span><input class="input" id="a_note" placeholder="例如：主号 / 测试号 / 粉丝数"/></label>`,
    footHtml: `<button class="btn btn-ghost" data-x>取消</button><button class="btn btn-accent" data-ok>保存</button>`,
    onMount: (mask, close) => {
      $('[data-x]', mask).onclick = close;
      $('[data-ok]', mask).onclick = async () => {
        const platform = $('#a_platform', mask).value.trim();
        if (!platform) return toast('填一下平台', 'err');
        await api.post('/api/accounts', { platform, handle: $('#a_handle', mask).value.trim(), url: $('#a_url', mask).value.trim(), note: $('#a_note', mask).value.trim() });
        close(); renderSettings($('#view')); toast('已登记 ✓', 'ok');
      };
    },
  });
}

function emptyHtml(glyph, text) { return `<div class="empty"><div class="em-glyph">${glyph}</div><div class="em-text">${esc(text)}</div></div>`; }

// ═══ 对话窗口：本地 Claude（fk-cc，模型可切）═══
const CHAT = { models: [], model: localStorage.getItem('1toall_chat_model') || '', chatId: localStorage.getItem('1toall_chat_id') || '', busy: false, attachments: [] };

function chatEls() {
  return { panel: $('#chatPanel'), fab: $('#chatFab'), msgs: $('#chatMsgs'), input: $('#chatInput'), send: $('#chatSendBtn'), model: $('#chatModel'), history: $('#chatHistory') };
}
function chatScroll() { const m = $('#chatMsgs'); m.scrollTop = m.scrollHeight; }
function chatBubble(role, html) {
  const b = el(`<div class="chat-msg ${role}">${html}</div>`);
  $('#chatMsgs').appendChild(b); chatScroll();
  return b;
}
function chatEmptyHint() {
  $('#chatMsgs').innerHTML = `<div class="chat-empty">✳ 这里直接连着你电脑上的 Claude<br/>问问题、查文件、派活都行<br/><span style="font-size:11px">例：「作品库最新那条视频讲了什么」</span></div>`;
}

async function chatLoadModels() {
  try {
    const d = await api.get('/api/chat/models');
    CHAT.models = d.models || [];
    if (!CHAT.models.some((m) => m.id === CHAT.model)) CHAT.model = d.default;
    const sel = $('#chatModel');
    sel.innerHTML = CHAT.models.map((m) => `<option value="${esc(m.id)}" ${m.id === CHAT.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  } catch {}
}

async function chatLoadSession() {
  const { msgs } = chatEls();
  msgs.innerHTML = '';
  if (!CHAT.chatId) return chatEmptyHint();
  try {
    const c = await api.get(`/api/chat/${CHAT.chatId}`);
    if (!(c.messages || []).length) return chatEmptyHint();
    for (const m of c.messages) {
      if (m.role === 'user') chatBubble('user', esc(m.text));
      else if (m.error) chatBubble('ai err', esc(m.error));
      else {
        if ((m.tools || []).length) $('#chatMsgs').appendChild(el(`<div class="chat-meta">${m.tools.map((t) => `<span class="chat-tool-chip">⚙ ${esc(t)}</span>`).join('')}</div>`));
        if ((m.asks || []).length) renderAskCard(m.asks, true);
        if (m.text) chatBubble('ai', mdToHtml(m.text));
      }
    }
  } catch { CHAT.chatId = ''; localStorage.removeItem('1toall_chat_id'); chatEmptyHint(); }
}

async function chatCreateSession() {
  const c = await api.post('/api/chat', { model: CHAT.model });
  CHAT.chatId = c.id; localStorage.setItem('1toall_chat_id', c.id);
  return c;
}
async function chatNew() {
  await chatCreateSession();
  $('#chatHistory').hidden = true;
  chatEmptyHint();
}

async function chatToggleHistory() {
  const h = $('#chatHistory');
  if (!h.hidden) { h.hidden = true; return; }
  const list = await api.get('/api/chat');
  h.innerHTML = list.length ? '' : '<div class="chat-history-item"><span class="t" style="color:var(--ink-4)">还没有历史对话</span></div>';
  for (const c of list) {
    const row = el(`<div class="chat-history-item"><span class="t">${esc(c.title || '新对话')}</span><span class="n">${c.count} 条</span><button class="del" title="删除">✕</button></div>`);
    row.onclick = async () => { CHAT.chatId = c.id; localStorage.setItem('1toall_chat_id', c.id); h.hidden = true; await chatLoadSession(); };
    $('.del', row).onclick = async (e) => { e.stopPropagation(); await api.del(`/api/chat/${c.id}`); if (CHAT.chatId === c.id) { CHAT.chatId = ''; localStorage.removeItem('1toall_chat_id'); chatEmptyHint(); } chatToggleHistory().then(() => chatToggleHistory()); };
    h.appendChild(row);
  }
  h.hidden = false;
}

async function chatSend() {
  const { input, send } = chatEls();
  let text = input.value.trim();
  const atts = [...CHAT.attachments];
  if ((!text && !atts.length) || CHAT.busy) return;
  if (!CHAT.chatId) await chatCreateSession();
  if ($('.chat-empty')) $('#chatMsgs').innerHTML = '';
  CHAT.busy = true; send.disabled = true; input.value = '';
  // 附件：路径附进消息（本地 Claude 用 Read 看），气泡里显示缩略图/文件名
  let userHtml = esc(text);
  if (atts.length) {
    text = `${text}\n\n[附件]（用 Read 工具查看）\n${atts.map((a) => `- ${a.path}`).join('\n')}`.trim();
    userHtml += `<div class="chat-att-row">${atts.map((a) => a.isImage ? `<img src="${esc(a.url)}" alt=""/>` : `<span class="chat-att-file">📄 ${esc(a.name)}</span>`).join('')}</div>`;
    CHAT.attachments = [];
    renderAttachBar();
  }
  chatBubble('user', userHtml);
  const meta = el('<div class="chat-meta"></div>');
  $('#chatMsgs').appendChild(meta);
  const bubble = chatBubble('ai', '<span class="chat-typing"><i></i><i></i><i></i></span>');
  let acc = '';
  const seenTools = new Set();
  try {
    const doSend = () => fetch(`/api/chat/${CHAT.chatId}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model: CHAT.model }),
    });
    let r = await doSend();
    if (r.status === 404) { // 本地存的会话已被删（换机器/清库）→ 自动新建一个重发
      await chatCreateSession();
      r = await doSend();
    }
    if (!r.ok || !r.body) throw new Error(`请求失败 ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let finalText = '', errText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const p of parts) {
        const line = p.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === 'delta') { acc += ev.text; bubble.innerHTML = mdToHtml(acc); chatScroll(); }
        else if (ev.type === 'tool' && !seenTools.has(ev.name)) { seenTools.add(ev.name); meta.appendChild(el(`<span class="chat-tool-chip">⚙ ${esc(ev.name)}</span>`)); chatScroll(); }
        else if (ev.type === 'ask') renderAskCard(ev.questions);
        else if (ev.type === 'done') finalText = ev.text || acc;
        else if (ev.type === 'error') errText = ev.error || '出错了';
      }
    }
    if (errText) { bubble.classList.add('err'); bubble.innerHTML = esc(errText); }
    else bubble.innerHTML = mdToHtml(finalText || acc || '（空回复）');
  } catch (e) {
    // 连接被掐（长任务/网络抖动）：后端还在跑并会把结果落库 → 轮询会话把完整回复接回来
    await chatRecover(bubble, meta, seenTools, acc, e);
  }
  if (!seenTools.size) meta.remove();
  chatScroll();
  CHAT.busy = false; send.disabled = false; input.focus();
}

// AskUserQuestion → 可点选项卡。单选点击即回答；多选勾选后点确认。answered=历史静态展示
function renderAskCard(questions, answered = false) {
  for (const q of questions || []) {
    const card = el(`<div class="chat-ask ${answered ? 'answered' : ''}">
      ${q.header ? `<span class="ask-header">${esc(q.header)}</span>` : ''}
      <div class="ask-q">${esc(q.question || '')}</div>
      <div class="ask-opts"></div>
      ${q.multiSelect && !answered ? '<button class="btn btn-primary btn-sm ask-confirm" style="margin-top:8px">✓ 确认选择</button>' : ''}
    </div>`);
    const optsEl = $('.ask-opts', card);
    const chosen = new Set();
    (q.options || []).forEach((o) => {
      const label = typeof o === 'string' ? o : o.label || '';
      const desc = typeof o === 'string' ? '' : o.description || '';
      const b = el(`<button class="ask-opt"><b>${esc(label)}</b>${desc ? `<span>${esc(desc)}</span>` : ''}</button>`);
      b.onclick = () => {
        if (card.classList.contains('answered')) return;
        if (q.multiSelect) {
          b.classList.toggle('sel');
          if (chosen.has(label)) chosen.delete(label); else chosen.add(label);
        } else {
          b.classList.add('sel'); card.classList.add('answered');
          chatAnswer([label]);
        }
      };
      optsEl.appendChild(b);
    });
    const confirm = $('.ask-confirm', card);
    if (confirm) confirm.onclick = () => {
      if (card.classList.contains('answered')) return;
      if (!chosen.size) return toast('至少选一项', 'err');
      card.classList.add('answered');
      confirm.remove();
      chatAnswer([...chosen]);
    };
    $('#chatMsgs').appendChild(card);
  }
  chatScroll();
}

// 把点选的选项当作回答发回去（等当前流结束再发，会话续着它记得自己问了啥）
function chatAnswer(labels) {
  const text = labels.join('、');
  const tryEnqueue = () => {
    if (CHAT.busy) return setTimeout(tryEnqueue, 800);
    const { input } = chatEls();
    input.value = text;
    chatSend();
  };
  tryEnqueue();
}

// 断流自愈：SSE 断了不代表任务死了——chatTurn 跑完会把 assistant 消息落库，轮询等它
async function chatRecover(bubble, meta, seenTools, acc, err) {
  bubble.innerHTML = (acc ? mdToHtml(acc) : '') + '<div class="hint" style="margin-top:6px">⏳ 连接断了，后台还在跑，等结果中…</div>';
  chatScroll();
  const t0 = Date.now();
  while (Date.now() - t0 < 16 * 60e3) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const c = await api.get(`/api/chat/${CHAT.chatId}`);
      const msgs = c.messages || [];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        if (last.error) { bubble.classList.add('err'); bubble.innerHTML = esc(last.error); }
        else {
          bubble.classList.remove('err');
          bubble.innerHTML = mdToHtml(last.text || acc || '（空回复）');
          (last.tools || []).forEach((t) => {
            if (!seenTools.has(t)) { seenTools.add(t); meta.appendChild(el(`<span class="chat-tool-chip">⚙ ${esc(t)}</span>`)); }
          });
        }
        chatScroll();
        return;
      }
    } catch {}
  }
  bubble.classList.add('err');
  bubble.innerHTML = (acc ? mdToHtml(acc) + '<br>' : '') + esc('连接断开，后台也没等到结果' + (err?.message ? `（${err.message}）` : ''));
}

// 附件上传（📎 选择 / 直接粘贴图片）→ 待发 chips
async function chatUploadFiles(files) {
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name} 超过 10MB`, 'err'); continue; }
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      const up = await api.post('/api/chat/upload', { name: f.name || 'pasted.png', dataUrl });
      CHAT.attachments.push({ ...up, name: f.name || 'pasted.png' });
      renderAttachBar();
    } catch (e) { toast(`上传失败：${e.message}`, 'err'); }
  }
}
function renderAttachBar() {
  const bar = $('#chatAttach');
  if (!bar) return;
  if (!CHAT.attachments.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = '';
  CHAT.attachments.forEach((a, i) => {
    const chip = el(`<span class="att-chip">${a.isImage ? `<img src="${esc(a.url)}"/>` : '📄'} ${esc(a.name.slice(0, 18))} <button title="移除">✕</button></span>`);
    $('button', chip).onclick = () => { CHAT.attachments.splice(i, 1); renderAttachBar(); };
    bar.appendChild(chip);
  });
}

// ✳ 派活台模式：线上（服务器无本地 claude）时，浮球面板=对话式派活窗——
// 说句话就派活（服务端解析成派单动作），顶部常驻产能机名册+任务动态。
// 本地开发机（localEngine=true）保持原本地对话不变。
function chatIsDesk() { return !!(S.boot && S.boot.localEngine === false); }
const DESK = { history: [] };

async function deskStatusHtml() {
  let tokens = [], jobsList = [];
  try { tokens = await api.get('/api/cli/tokens'); } catch {}
  try { jobsList = await api.get('/api/jobs'); } catch {}
  const now = Date.now();
  const machineRow = (t) => {
    const on = t.lastUsedAt && now - new Date(t.lastUsedAt).getTime() < 15 * 60e3;
    return `<div class="dd-machine"><span class="dd-dot ${on ? 'on' : ''}"></span><b>${esc(t.label)}</b><span class="hint">${t.lastUsedAt ? relTime(t.lastUsedAt) : '还没用过'}</span></div>`;
  };
  const st = (j) => j.status === 'claimed' ? `「${esc(j.claimedBy || '')}」生产中`
    : j.status === 'queued' ? (j.assignedTo ? `指派给「${esc(j.assignedTo)}」等认领` : '排队中')
    : j.status === 'failed' ? '❌ 失败' : esc(j.status || '');
  const active = jobsList.filter((j) => j.status !== 'done').slice(0, 5);
  return `<div class="dd-status">
    <div class="dd-status-head">🖥 产能机 <button class="btn btn-ghost btn-sm" id="ddBind">＋ 绑定新机器</button></div>
    ${tokens.length ? tokens.map(machineRow).join('') : '<div class="hint">还没有产能机——绑定 CLI 即上岗</div>'}
    ${active.length ? `<div class="dd-status-head" style="margin-top:8px">⚙ 任务动态</div>${active.map((j) => `<div class="dd-job"><b>${esc(j.channelLabel || '')}</b><span>${st(j)}</span></div>`).join('')}` : ''}
  </div>`;
}

function deskBubble(role, html) {
  const b = el(`<div class="chat-msg ${role}">${html}</div>`);
  $('#chatMsgs').appendChild(b);
  const m = $('#chatMsgs'); m.scrollTop = m.scrollHeight;
  return b;
}

async function renderDispatchDesk() {
  const { panel, input } = chatEls();
  $('.chat-title', panel).textContent = '派活台';
  ['#chatModel', '#chatHistoryBtn', '#chatNewBtn', '#chatHistory', '#chatAttach', '#chatFileBtn'].forEach((s) => { const n = $(s); if (n) n.hidden = true; });
  const compose = $('.chat-compose', panel); if (compose) compose.style.display = '';
  input.placeholder = '说句话派活：如「给 Hunter 来条 B 站长视频，讲 XX，指派给 Hunter 的电脑」';
  const msgs = $('#chatMsgs');
  msgs.innerHTML = await deskStatusHtml();
  $('#ddBind', msgs).onclick = () => { panel.hidden = true; $('#chatFab').classList.remove('hidden'); switchView('settings'); };
  DESK.history.forEach((h) => deskBubble(h.role === 'user' ? 'user' : 'assistant', esc(h.text)));
  if (!DESK.history.length) deskBubble('assistant', '想生产什么？一句话告诉我渠道和选题就行，也可以点名指派哪台产能机。');
  input.focus();
}

async function deskSend() {
  const { input } = chatEls();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  deskBubble('user', esc(text));
  DESK.history.push({ role: 'user', text });
  const pending = deskBubble('assistant', '<span class="spin"></span> 想一下…');
  try {
    const r = await api.post('/api/desk/chat', { message: text, history: DESK.history.slice(0, -1) });
    pending.innerHTML = esc(r.reply || '…');
    DESK.history.push({ role: 'assistant', text: r.reply || '' });
    if (r.dispatched) {
      toast(`已派单：${r.dispatched.channel}${r.dispatched.assignTo ? ` → ${r.dispatched.assignTo}` : ''}`, 'ok');
      const status = el(await deskStatusHtml());
      $('#chatMsgs').prepend(status);
      const old = $$('.dd-status', $('#chatMsgs'));
      if (old.length > 1) old.slice(1).forEach((n) => n.remove());
      $('#ddBind', status).onclick = () => { const { panel } = chatEls(); panel.hidden = true; $('#chatFab').classList.remove('hidden'); switchView('settings'); };
    }
  } catch (e) {
    pending.innerHTML = esc(`出错了：${e.message}`);
  }
}

function initChat() {
  const { panel, fab, input, send, model } = chatEls();
  if (!fab) return;
  fab.onclick = async () => {
    panel.hidden = false; fab.classList.add('hidden');
    if (chatIsDesk()) { renderDispatchDesk(); return; }
    if (!CHAT.models.length) await chatLoadModels();
    await chatLoadSession();
    input.focus();
  };
  $('#chatCloseBtn').onclick = () => { panel.hidden = true; fab.classList.remove('hidden'); };
  $('#chatNewBtn').onclick = chatNew;
  $('#chatHistoryBtn').onclick = () => chatToggleHistory().catch((e) => toast(e.message, 'err'));
  model.onchange = () => { CHAT.model = model.value; localStorage.setItem('1toall_chat_model', CHAT.model); };
  send.onclick = () => (chatIsDesk() ? deskSend() : chatSend());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatIsDesk() ? deskSend() : chatSend(); }
  });
  // 📎 上传 + 粘贴图片
  const fileBtn = $('#chatFileBtn');
  const fileInput = $('#chatFileInput');
  if (fileBtn && fileInput) {
    fileBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => { chatUploadFiles([...fileInput.files]); fileInput.value = ''; };
  }
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); chatUploadFiles(files); }
  });
}
initChat();

boot();
