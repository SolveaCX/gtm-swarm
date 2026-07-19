// data/seed.js — 确保各数据集合文件存在，服务首次启动不崩。
//
// 原始 seed.js 未随分享包附带（server.js 第 41 行 import 它），这是兼容重建。
// 已存在的运行数据保持不动；首次启动从 data/seed/ 恢复 47 分享包内的
// Flatkey 基线数据，其余集合初始化为空数组。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from '../config.js';
import { normalizeWorkspace } from '../lib/workspace-context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, 'seed');

// 与 lib/store.js 的 makeCollection 集合一一对应。
const COLLECTIONS = [
  'brands', 'styles', 'plays', 'presets', 'projects',
  'calendar', 'accounts', 'jobs', 'chats', 'pool',
];

export function ensureSeed(workspace = 'flatkey') {
  const slug = normalizeWorkspace(workspace);
  const workspaceDir = path.join(DATA_DIR, 'workspaces', slug);
  fs.mkdirSync(workspaceDir, { recursive: true });
  for (const name of COLLECTIONS) {
    const p = path.join(workspaceDir, `${name}.json`);
    if (fs.existsSync(p)) continue;
    // One-time migration from the pre-workspace production layout.
    const legacy = path.join(DATA_DIR, `${name}.json`);
    if (slug === 'flatkey' && fs.existsSync(legacy)) {
      fs.copyFileSync(legacy, p);
      continue;
    }
    const seeded = path.join(SEED_DIR, `${name}.json`);
    if (slug === 'flatkey' && fs.existsSync(seeded)) fs.copyFileSync(seeded, p);
    else fs.writeFileSync(p, '[]\n');
  }
}

export default ensureSeed;
