// chat.js — 对话窗口后端：把消息交给本地 claude CLI（无头 stream-json），
// 流式吐字回前端，会话用 --resume 续上。认证走 flatkey fk-cc 通道（同 dispatch）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chats } from './store.js';
import { claudeEnv, MEDIA_ROOT } from './dispatch.js';

// fk-cc 通道实测在售的可选模型（2026-07-15 /v1/models 验证）
export const CHAT_MODELS = [
  { id: 'claude-opus-4-8-fk-cc', label: 'Opus 4.8', hint: '最强 · 默认' },
  { id: 'claude-sonnet-4-6-fk-cc', label: 'Sonnet 4.6', hint: '均衡 · 更快' },
  { id: 'claude-haiku-4-5-20251001-fk-cc', label: 'Haiku 4.5', hint: '轻快 · 省钱' },
];
export const DEFAULT_CHAT_MODEL = CHAT_MODELS[0].id;
const TIMEOUT_MS = 15 * 60e3; // 单条回复 15 分钟兜底（对话里也可能跑工具）

export function validModel(m) {
  return CHAT_MODELS.some((x) => x.id === m) ? m : DEFAULT_CHAT_MODEL;
}

// 发一条消息给 claude，流式回调 onEvent：
//   {type:'delta', text}   逐字文本
//   {type:'tool', name}    开始用某个工具（给前端画状态芯片）
// resolve => { text, sessionId, tools }
export function askClaude({ text, model, resumeSessionId, onEvent }) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(MEDIA_ROOT, { recursive: true });
    const args = [
      '-p', text,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      '--model', model,
    ];
    if (resumeSessionId) args.push('--resume', resumeSessionId);

    const child = spawn('claude', args, {
      cwd: MEDIA_ROOT, // 让它写文件默认落在 BrandHQ，产物 /media/ 直接可看
      env: claudeEnv(model),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let sessionId = resumeSessionId || null;
    let finalText = '';
    let deltaText = '';
    let gotDelta = false;
    const tools = [];
    const asks = []; // AskUserQuestion 的问题（前端渲染成可点选项）
    let stderrTail = '';
    let settled = false;

    const finish = (err, out) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(out);
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish(new Error('这条回复超时（>15 分钟）已终止，可以换个问法再试'));
    }, TIMEOUT_MS);

    const handleLine = (line) => {
      let obj;
      try { obj = JSON.parse(line); } catch { return; }
      if (obj.type === 'system' && obj.subtype === 'init') {
        sessionId = obj.session_id || sessionId;
      } else if (obj.type === 'stream_event') {
        const ev = obj.event || {};
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          gotDelta = true;
          deltaText += ev.delta.text;
          onEvent?.({ type: 'delta', text: ev.delta.text });
        }
      } else if (obj.type === 'assistant') {
        for (const block of obj.message?.content || []) {
          if (block.type === 'tool_use') {
            tools.push(block.name);
            onEvent?.({ type: 'tool', name: block.name });
            // 无头模式下 AskUserQuestion 没有 UI —— 把问题原样交给前端渲染成可点选项
            if (block.name === 'AskUserQuestion' && Array.isArray(block.input?.questions)) {
              asks.push(...block.input.questions);
              onEvent?.({ type: 'ask', questions: block.input.questions });
            }
          } else if (block.type === 'text' && block.text && !gotDelta) {
            // 兜底：万一 partial 流没来（旧版 CLI），按整段吐
            deltaText += block.text;
            onEvent?.({ type: 'delta', text: block.text });
          }
        }
      } else if (obj.type === 'result') {
        sessionId = obj.session_id || sessionId;
        if (!obj.is_error && typeof obj.result === 'string') finalText = obj.result;
        if (obj.is_error) stderrTail = String(obj.result || stderrTail).slice(0, 400);
      }
    };

    let buf = '';
    child.stdout.on('data', (d) => {
      buf += String(d);
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) if (l.trim()) handleLine(l);
    });
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + String(d)).slice(-600); });

    child.on('error', (e) => finish(new Error(`claude 启动失败：${e.message}`)));
    child.on('exit', (code) => {
      if (buf.trim()) handleLine(buf);
      const text = finalText || deltaText;
      if (code === 0 && (text || asks.length)) finish(null, { text, sessionId, tools, asks });
      else finish(new Error(stderrTail.trim() || `claude 退出码 ${code}，没有拿到回复`));
    });
  });
}

// 新会话首轮注入的驻场上下文：让它知道自己长在 1toAll 里，别把「日历/作品」理解成飞书
const WORKBENCH_PREAMBLE = `[系统上下文，不用回应这段] 你是 1toAll 品牌指挥部工作台（http://localhost:4178）里的驻场助手「小克」。用户说的「日历/排期/作品/作品库/内容池/账号/派活/生产线」默认指本工作台的数据，全部走本机 API 查询和操作——速查手册先读 ~/Downloads/APP/1toAll/AGENTS.md。只有用户明确说「飞书/钉钉」才去查外部系统。回复用简洁中文口语。需要用户做选择或补信息时，必须调用 AskUserQuestion 工具提问（界面会渲染成可点按钮），选项要具体、带一句说明，可多选的问题设 multiSelect；不要在正文里写 1/2/3 列表让用户打字回答。用户消息里出现「[附件]」列出的本地文件路径时，用 Read 工具查看（图片可直接看）。

用户消息：`;

// 完整一轮：落用户消息 → 跑 claude → 落助手消息（含所用工具、模型）
export async function chatTurn({ chatId, text, model, onEvent }) {
  const chat = chats.get(chatId);
  if (!chat) throw new Error('会话不存在');
  const m = validModel(model);
  const now = () => new Date().toISOString();
  const messages = [...(chat.messages || []), { role: 'user', text, at: now() }];
  chats.update(chatId, {
    messages,
    model: m,
    title: chat.title || text.slice(0, 18),
  });
  try {
    const sendText = chat.claudeSessionId ? text : WORKBENCH_PREAMBLE + text;
    const out = await askClaude({ text: sendText, model: m, resumeSessionId: chat.claudeSessionId, onEvent });
    chats.update(chatId, {
      messages: [...messages, { role: 'assistant', text: out.text, model: m, tools: out.tools, asks: out.asks || [], at: now() }],
      claudeSessionId: out.sessionId || chat.claudeSessionId || null,
    });
    return out;
  } catch (e) {
    chats.update(chatId, {
      messages: [...messages, { role: 'assistant', text: '', error: e.message, at: now() }],
    });
    throw e;
  }
}
