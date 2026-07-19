// flatkey 接入层：文字（chat）+ 图片（gpt-image-2）
// key 从 macOS Keychain 读取（service: FLATKEY_API_KEY），绝不硬编码。
import { execSync } from 'node:child_process';

const BASE = 'https://router.flatkey.ai/v1';
let _key = null;

function apiKey() {
  if (_key) return _key;
  if (process.env.FLATKEY_API_KEY) return (_key = process.env.FLATKEY_API_KEY.trim());
  try {
    _key = execSync('security find-generic-password -s FLATKEY_API_KEY -w', {
      encoding: 'utf8',
    }).trim();
  } catch (e) {
    throw new Error(
      'flatkey key 没找到。请确认 Keychain 里有 FLATKEY_API_KEY，或设置环境变量 FLATKEY_API_KEY。'
    );
  }
  if (!_key) throw new Error('flatkey key 为空');
  return _key;
}

// 健康检查：key 是否可用
export function keyAvailable() {
  try {
    return !!apiKey();
  } catch {
    return false;
  }
}

async function withTimeout(promise, ms, label) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promise(ctrl.signal);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${label} 超时（>${ms / 1000}s）`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function usageFrom(data) {
  const usage = data?.usage || {};
  const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(usage.total_tokens ?? inputTokens + outputTokens),
  };
}

// 文字生成
export async function chat({ model, system, user, messages, maxTokens = 4000, temperature = 0.85, withMeta = false }) {
  const msgs = messages
    ? messages
    : [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }];

  const body = { model, messages: msgs, max_tokens: maxTokens };
  // Claude 系：必须关掉 adaptive thinking，否则 flatkey 报错
  if (model.startsWith('claude')) {
    body.reasoning_effort = 'none';
    body.temperature = temperature;
  }
  // gpt-5 系只接受默认 temperature，不传

  const data = await withTimeout(
    (signal) =>
      fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      }),
    240000,
    '文字生成'
  ).then(async (res) => {
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`flatkey 文字接口报错 ${res.status}: ${txt.slice(0, 300)}`);
    }
    return res.json();
  });

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('flatkey 没返回文字内容');
  const result = {
    content: content.trim(),
    provider: 'Flatkey',
    requestedModel: model,
    model: data?.model || model,
    requestId: data?.id || null,
    usage: usageFrom(data),
  };
  return withMeta ? result : result.content;
}

// 图片生成（gpt-image-2）→ 返回 PNG Buffer
export async function image({ prompt, size = '1024x1024', quality = 'high', withMeta = false }) {
  const data = await withTimeout(
    (signal) =>
      fetch(`${BASE}/images/generations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'gpt-image-2', prompt, size, quality, n: 1 }),
        signal,
      }),
    180000,
    '图片生成'
  ).then(async (res) => {
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`flatkey 图片接口报错 ${res.status}: ${txt.slice(0, 300)}`);
    }
    return res.json();
  });

  const item = data?.data?.[0];
  if (!item) throw new Error('flatkey 没返回图片');
  let buffer;
  if (item.b64_json) buffer = Buffer.from(item.b64_json, 'base64');
  if (item.url) {
    const r = await fetch(item.url);
    const ab = await r.arrayBuffer();
    buffer = Buffer.from(ab);
  }
  if (!buffer) throw new Error('图片响应里没有数据');
  const result = {
    buffer,
    provider: 'Flatkey',
    requestedModel: 'gpt-image-2',
    model: data?.model || 'gpt-image-2',
    requestId: data?.id || null,
    usage: usageFrom(data),
  };
  return withMeta ? result : result.buffer;
}

// 从 nano 返回体里抠出图片 base64（可能在 message.images[] 或 content 里的 data URI）
function extractNanoImage(data) {
  const msg = data?.choices?.[0]?.message || {};
  const fromImages = msg.images?.[0]?.image_url?.url || msg.images?.[0]?.url;
  const candidate = fromImages || (typeof msg.content === 'string' ? msg.content : '');
  const m = /base64,([A-Za-z0-9+/=\s]+)/.exec(candidate) || /^([A-Za-z0-9+/=]{500,})$/.exec((candidate || '').trim());
  if (!m) return null;
  return Buffer.from(m[1].replace(/\s/g, ''), 'base64');
}

// 带参考图生图（Nano Banana Pro，能"固定人物形象"）→ gpt-image-2 不支持输入图，人物锁定必须走这条
// refImages: data URL 数组（如 "data:image/png;base64,...."），会作为参考喂给模型
export async function imageWithRef({ prompt, refImages = [], withMeta = false }) {
  const content = [{ type: 'text', text: prompt }];
  for (const url of refImages) if (url) content.push({ type: 'image_url', image_url: { url } });
  const data = await withTimeout(
    (signal) =>
      fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nano-banana-pro-preview', modalities: ['image', 'text'], messages: [{ role: 'user', content }] }),
        signal,
      }),
    180000,
    '参考图生图'
  ).then(async (res) => {
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`flatkey Nano 接口报错 ${res.status}: ${txt.slice(0, 300)}`);
    }
    return res.json();
  });
  const buffer = extractNanoImage(data);
  if (!buffer) throw new Error('Nano 没返回图片');
  const result = {
    buffer,
    provider: 'Flatkey',
    requestedModel: 'nano-banana-pro-preview',
    model: data?.model || 'nano-banana-pro-preview',
    requestId: data?.id || null,
    usage: usageFrom(data),
  };
  return withMeta ? result : result.buffer;
}
