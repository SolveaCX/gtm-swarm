#!/usr/bin/env node
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function usage() {
  console.log(`Usage:
  node scripts/elevenlabs_tts.mjs \
    --text-file narration.txt \
    --output sample_voice.wav \
    --voice-id VOICE_ID \
    [--model-id eleven_multilingual_v2] \
    [--chunk-chars 2400] \
    [--cache-dir .elevenlabs-cache] \
    [--manifest tts_manifest.json]

Auth: FLATKEY_API_KEY (env or macOS Keychain) → flatkey gateway native route
(one-key architecture); falls back to ELEVENLABS_API_KEY → official API.
Text is split at sentence boundaries, synthesized in
chunks, concatenated, and decoded to 48 kHz mono PCM WAV. When --cache-dir is
set, successful chunks are retained and reused on retry.`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Unknown argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

// 一 key 架构：配音走 flatkey 网关的 ElevenLabs 原生路由，用 FLATKEY_API_KEY。
// （仍兼容单独的 ELEVENLABS_API_KEY 直连官方，作为静默兜底。）
function apiKey() {
  if (process.env.FLATKEY_API_KEY?.trim()) return { key: process.env.FLATKEY_API_KEY.trim(), base: 'https://router.flatkey.ai/v1' };
  try {
    const k = execSync('security find-generic-password -s FLATKEY_API_KEY -w', { encoding: 'utf8' }).trim();
    if (k) return { key: k, base: 'https://router.flatkey.ai/v1' };
  } catch {}
  if (process.env.ELEVENLABS_API_KEY?.trim()) return { key: process.env.ELEVENLABS_API_KEY.trim(), base: 'https://api.elevenlabs.io/v1' };
  try {
    const k = execSync('security find-generic-password -s ELEVENLABS_API_KEY -w', { encoding: 'utf8' }).trim();
    if (k) return { key: k, base: 'https://api.elevenlabs.io/v1' };
  } catch {}
  throw new Error('No FLATKEY_API_KEY (preferred) or ELEVENLABS_API_KEY found in env or macOS Keychain');
}

function splitText(text, maxChars) {
  const normalized = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) throw new Error('Narration is empty');

  const sentences = normalized
    .split(/(?<=[。！？!?；;：:\.])\s+|(?<=\n)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }
    const next = current ? `${current}\n${sentence}` : sentence;
    if (next.length > maxChars) flush();
    current = current ? `${current}\n${sentence}` : sentence;
  }
  flush();
  return chunks;
}

function safeJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const textFile = args['text-file'];
  const output = args.output;
  const voiceId = args['voice-id'];
  const modelId = args['model-id'] || 'eleven_multilingual_v2';
  const maxChars = Number(args['chunk-chars'] || 2400);
  const manifestPath = args.manifest || path.join(path.dirname(output || '.'), 'tts_manifest.json');
  const cacheDir = args['cache-dir'] ? path.resolve(args['cache-dir']) : null;
  if (!textFile || !output || !voiceId) {
    usage();
    throw new Error('--text-file, --output, and --voice-id are required');
  }
  if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 4500) {
    throw new Error('--chunk-chars must be an integer between 500 and 4500');
  }

  const text = fs.readFileSync(textFile, 'utf8');
  const chunks = splitText(text, maxChars);
  const tmpDir = cacheDir || fs.mkdtempSync(path.join(os.tmpdir(), '1toall-elevenlabs-'));
  fs.mkdirSync(tmpDir, { recursive: true });
  const concatFile = path.join(tmpDir, 'concat.txt');
  const headerFile = path.join(tmpDir, 'headers.txt');
  const { key, base } = apiKey();
  fs.writeFileSync(headerFile, `xi-api-key: ${key}\nAuthorization: Bearer ${key}\nContent-Type: application/json\n`, { mode: 0o600 });

  try {
    const chunkFiles = chunks.map((chunk, index) => {
      const chunkHash = crypto.createHash('sha256')
        .update(`${voiceId}\0${modelId}\0${chunk}`)
        .digest('hex')
        .slice(0, 12);
      const chunkFile = path.join(tmpDir, `chunk-${String(index).padStart(3, '0')}-${chunkHash}.mp3`);
      if (cacheDir && fs.existsSync(chunkFile) && fs.statSync(chunkFile).size >= 1000) {
        console.error(`Reusing cached ElevenLabs chunk ${index + 1}/${chunks.length}`);
        return chunkFile;
      }
      const body = JSON.stringify({
        text: chunk,
        model_id: modelId,
        voice_settings: {
          stability: 0.52,
          similarity_boost: 0.78,
          style: 0.18,
          use_speaker_boost: true,
        },
      });
      const status = execFileSync('curl', [
        '-sS',
        '--retry', '3',
        '--retry-delay', '2',
        '--max-time', '180',
        `${base}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        '-H', `@${headerFile}`,
        '-d', body,
        '--output', chunkFile,
        '--write-out', '%{http_code}',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
      if (!status.startsWith('2')) {
        let detail = '';
        try {
          const errorBody = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));
          detail = errorBody?.detail?.message || errorBody?.detail?.status || errorBody?.message || '';
        } catch {
          detail = fs.readFileSync(chunkFile, 'utf8').slice(0, 240);
        }
        throw new Error(`ElevenLabs TTS chunk ${index + 1} failed (HTTP ${status}): ${detail || 'unknown error'}`);
      }
      if (fs.statSync(chunkFile).size < 1000) throw new Error(`TTS chunk ${index + 1} is too small`);
      return chunkFile;
    });

    fs.writeFileSync(
      concatFile,
      chunkFiles.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n',
    );
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le',
      output,
    ], { stdio: 'inherit' });

    const manifest = {
      engine: 'elevenlabs',
      voiceId,
      modelId,
      sourceTextFile: path.resolve(textFile),
      output: path.resolve(output),
      chunkChars: maxChars,
      chunkCount: chunks.length,
      characterCount: text.length,
      textSha256: crypto.createHash('sha256').update(text).digest('hex'),
      generatedAt: new Date().toISOString(),
      cacheDir,
    };
    fs.writeFileSync(manifestPath, safeJson(manifest));
    console.log(safeJson({ ok: true, ...manifest }).trim());
  } finally {
    try { fs.rmSync(headerFile, { force: true }); } catch {}
    if (!cacheDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
