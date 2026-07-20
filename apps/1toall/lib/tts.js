// ElevenLabs TTS：渠道配音试听 + 给视频管线用的底层调用
// 一 key 架构：优先 FLATKEY_API_KEY 走 flatkey 网关原生路由（/v1/text-to-speech、/v1/voices）；
// 个别机器仍有单独 ELEVENLABS_API_KEY 时兜底直连官方。key 绝不硬编码。
// ⚠️ 走 curl 子进程而非 node fetch：本机全局代理（HTTPS_PROXY），node fetch 不认代理会 TLS 失败。
import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendUsage } from './usage-log.js';

let _auth = null; // { key, base }
function keychain(service) {
  try { return execSync(`security find-generic-password -s ${service} -w`, { encoding: 'utf8' }).trim(); } catch { return ''; }
}
function auth() {
  if (_auth) return _auth;
  const fk = (process.env.FLATKEY_API_KEY || '').trim() || keychain('FLATKEY_API_KEY');
  if (fk) return (_auth = { key: fk, base: 'https://router.flatkey.ai/v1' });
  const el = (process.env.ELEVENLABS_API_KEY || '').trim() || keychain('ELEVENLABS_API_KEY');
  if (el) return (_auth = { key: el, base: 'https://api.elevenlabs.io/v1' });
  throw new Error('配音 key 没找到（FLATKEY_API_KEY 或 ELEVENLABS_API_KEY）');
}

export function elevenKeyAvailable() {
  try { return !!auth().key; } catch { return false; }
}

function headerFile({ json = false } = {}) {
  const { key } = auth();
  const file = path.join(os.tmpdir(), `11tts-headers-${process.pid}-${Date.now()}.txt`);
  const lines = [`xi-api-key: ${key}`, `Authorization: Bearer ${key}`];
  if (json) lines.push('Content-Type: application/json');
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 });
  return file;
}

// 文本 → mp3 Buffer（multilingual v2 中英文通吃）
export async function tts({ text, voiceId, modelId = 'eleven_multilingual_v2' }) {
  if (!text || !voiceId) throw new Error('tts 需要 text 和 voiceId');
  const tmp = path.join(os.tmpdir(), `11tts-${Date.now()}.mp3`);
  const headers = headerFile({ json: true });
  const body = JSON.stringify({ text, model_id: modelId });
  try {
    const status = execFileSync('curl', [
      '-sS', '--max-time', '60',
      `${auth().base}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      '-H', `@${headers}`,
      '-d', body,
      '--output', tmp,
      '--write-out', '%{http_code}',
    ], { encoding: 'utf8' }).trim();
    if (!status.startsWith('2')) {
      let detail = '';
      try {
        const errorBody = JSON.parse(fs.readFileSync(tmp, 'utf8'));
        detail = errorBody?.detail?.message || errorBody?.detail?.status || errorBody?.message || '';
      } catch {}
      throw new Error(`ElevenLabs TTS 失败（HTTP ${status}）：${detail || '请求被拒绝'}`);
    }
    const buf = fs.readFileSync(tmp);
    if (buf.length < 200) throw new Error('返回过小：' + buf.toString('utf8').slice(0, 150));
    appendUsage({ kind: 'tts', purpose: 'voice', model: modelId, chars: text.length, note: voiceId });
    return buf;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    try { fs.rmSync(headers, { force: true }); } catch {}
  }
}

export async function listVoices() {
  const headers = headerFile();
  try {
    const out = execFileSync('curl', [
      '-sf', '--max-time', '20',
      `${auth().base}/voices`,
      '-H', `@${headers}`,
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    const d = JSON.parse(out);
    return (d.voices || []).map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      lang: v.labels?.language || '',
      gender: v.labels?.gender || '',
    }));
  } finally {
    try { fs.rmSync(headers, { force: true }); } catch {}
  }
}
