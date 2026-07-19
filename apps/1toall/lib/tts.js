// ElevenLabs TTS：渠道配音试听 + 给视频管线用的底层调用
// key 在 macOS Keychain（service: ELEVENLABS_API_KEY），绝不硬编码。
// ⚠️ 走 curl 子进程而非 node fetch：本机全局代理（HTTPS_PROXY），node fetch 不认代理会 TLS 失败。
import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let _key = null;
function apiKey() {
  if (_key) return _key;
  if (process.env.ELEVENLABS_API_KEY) return (_key = process.env.ELEVENLABS_API_KEY.trim());
  try {
    _key = execSync('security find-generic-password -s ELEVENLABS_API_KEY -w', { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('ElevenLabs key 没找到（Keychain: ELEVENLABS_API_KEY）');
  }
  return _key;
}

export function elevenKeyAvailable() {
  try { return !!apiKey(); } catch { return false; }
}

function headerFile({ json = false } = {}) {
  const file = path.join(os.tmpdir(), `11tts-headers-${process.pid}-${Date.now()}.txt`);
  const lines = [`xi-api-key: ${apiKey()}`];
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
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
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
      'https://api.elevenlabs.io/v1/voices',
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
