// ═══ 钉钉多维表接入：账号运营数据看板 ═══
// 数据源 = 用户 的「运营账号数据管理系统 / 账号总览」表（粉丝 / 近30天播放·赞·评 / 断更 / 内容思路…）
// ⚠️ 走 curl 子进程做 JSON-RPC——本机全局代理会让 node fetch TLS 失败（同 tts.js 教训）；
//    凭证 URL 存 Keychain（DINGTALK_MCP_URL），任何 shell 都能 security 读，不依赖 .zshrc。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DINGTALK_ACCOUNT_BASE, DINGTALK_ACCOUNT_TABLE } from '../config.js';

const CACHE = path.join(DATA_DIR, 'accounts-board-cache.json');

function mcpUrl() {
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'DINGTALK_MCP_URL', '-w'], { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

// 单次 JSON-RPC over HTTP（curl POST，--noproxy 直连，返回体可能是 SSE 或纯 JSON）
function rpc(url, method, params, id) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} });
  const raw = execFileSync('curl', [
    '-s', '--noproxy', '*', '--max-time', '40',
    '-H', 'Content-Type: application/json',
    '-H', 'Accept: application/json, text/event-stream',
    '--data-binary', '@-', url,
  ], { input: body, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  for (const line of raw.split('\n')) {
    let s = line.trim();
    if (s.startsWith('data:')) s = s.slice(5).trim();
    if (s.startsWith('{')) { try { return JSON.parse(s); } catch { /* keep scanning */ } }
  }
  throw new Error('钉钉返回无法解析');
}

function callTool(url, name, args, id) {
  const r = rpc(url, 'tools/call', { name, arguments: args }, id);
  const c = r?.result?.content;
  if (Array.isArray(c) && c[0]?.text) { try { return JSON.parse(c[0].text); } catch { return c[0].text; } }
  return r;
}

// 字段名 → 记录 cells 的 fieldId 映射
function fieldMap(url) {
  const f = callTool(url, 'get_fields', { baseId: DINGTALK_ACCOUNT_BASE, tableId: DINGTALK_ACCOUNT_TABLE }, 2);
  const fields = f?.data?.fields || [];
  const byName = {};
  fields.forEach((x) => { byName[x.fieldName] = x.fieldId; });
  return byName;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const sel = (v) => (v && typeof v === 'object' ? v.name : v) || '';
const txt = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// 拉全部账号 → 规整成看板行
export function fetchAccountBoard() {
  const url = mcpUrl();
  if (!url) throw new Error('DINGTALK_MCP_URL 不在 Keychain');
  rpc(url, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: '1toall', version: '1' } }, 1);
  const F = fieldMap(url);
  const q = callTool(url, 'query_records', { baseId: DINGTALK_ACCOUNT_BASE, tableId: DINGTALK_ACCOUNT_TABLE, maxRecords: 100 }, 3);
  const records = q?.data?.records || [];
  const g = (cells, name) => cells[F[name]];
  const rows = records.map((rec) => {
    const c = rec.cells || {};
    return {
      id: rec.recordId,
      name: txt(g(c, '账号名')),
      platform: sel(g(c, '平台')),
      owner: sel(g(c, '运营人')),
      belong: sel(g(c, '归属')),
      bio: txt(g(c, '简介')),
      fans: num(g(c, '粉丝数')),
      likesTotal: num(g(c, '累计获赞与收藏')),
      net30: num(g(c, '近30天净涨粉')),
      posts30: num(g(c, '近30天发布数')),
      views30: num(g(c, '近30天播放观看')),
      likes30: num(g(c, '近30天点赞')),
      comments30: num(g(c, '近30天评论')),
      collects30: num(g(c, '近30天收藏')),
      shares30: num(g(c, '近30天分享')),
      finishRate: num(g(c, '完播率(%)')),
      posts7: num(g(c, '近7天发布数')),
      idleDays: num(g(c, '断更天数')),
      asOf: (txt(g(c, '数据截止')) || '').slice(0, 10),
      lastPost: (txt(g(c, '最近发布')) || '').slice(0, 10),
      note: txt(g(c, '备注')),
      idea: txt(g(c, '内容思路')),
    };
  });
  // 有粉丝或有播放的排前面；同级按粉丝降序
  rows.sort((a, b) => (b.fans + b.views30) - (a.fans + a.views30));
  return rows;
}

// 带日缓存：同一天只打一次钉钉；?refresh 强制
export function accountBoard({ refresh = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  if (!refresh) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
      if (cached.date === today && Array.isArray(cached.rows)) return { rows: cached.rows, cachedAt: cached.at, cached: true };
    } catch { /* 无缓存 */ }
  }
  const rows = fetchAccountBoard();
  const at = new Date().toISOString();
  try { fs.writeFileSync(CACHE, JSON.stringify({ date: today, at, rows }, null, 2)); } catch { /* 缓存写失败不阻塞 */ }
  return { rows, cachedAt: at, cached: false };
}
