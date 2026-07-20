// 中央用量日志：flatkey 每一次收费调用（文字/出图/配音）无条件落一行 JSONL，
// 不再依赖调用方自觉传 withMeta——账本「今日工作量」和平台开销都从这里出。
// 文件按工作区存：data/workspaces/<ws>/usage-log.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { currentWorkspace } from './workspace-context.js';

function logPath() {
  return path.join(DATA_DIR, 'workspaces', currentWorkspace(), 'usage-log.jsonl');
}

// entry: { kind:'chat'|'image'|'tts', purpose, requestedModel, model,
//          inputTokens, outputTokens, totalTokens, images, chars, note }
export function appendUsage(entry) {
  try {
    const row = { at: new Date().toISOString(), ...entry };
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.appendFileSync(logPath(), JSON.stringify(row) + '\n');
  } catch { /* 记账失败绝不影响业务调用 */ }
}

// 北京时间的「某一天」（477 的作息口径，不用 UTC——凌晨干的活得算今天）
export function beijingDay(ts = Date.now()) {
  return new Date(ts + 8 * 3600e3).toISOString().slice(0, 10);
}

// 读某天（默认北京时间今天）的全部用量行
export function readUsageDay(dateStr) {
  const day = dateStr || beijingDay();
  const rows = [];
  try {
    for (const line of fs.readFileSync(logPath(), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (beijingDay(new Date(r.at || 0).getTime()) === day) rows.push(r);
      } catch {}
    }
  } catch {}
  return rows;
}
