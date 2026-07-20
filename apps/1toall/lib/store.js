// 轻量 JSON 文件存储：brands / styles / projects
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from '../config.js';
import { currentWorkspace, currentActor } from './workspace-context.js';

export function workspaceDataDir() {
  return path.join(DATA_DIR, 'workspaces', currentWorkspace());
}

function file(name) {
  return path.join(workspaceDataDir(), `${name}.json`);
}

function read(name, fallback) {
  try {
    const raw = fs.readFileSync(file(name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(name, data) {
  fs.mkdirSync(workspaceDataDir(), { recursive: true });
  // 原子写：先写同目录临时文件，再 rename 覆盖。同盘 rename 是 POSIX 原子操作，
  // 读者永远读到旧的或新的完整版本，进程被 kill / 掉电也不会留下写到一半的半截 JSON。
  const target = file(name);
  const tmp = `${target}.tmp.${randomUUID()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, target);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

// ---- 通用集合操作 ----
function makeCollection(name, prefix) {
  return {
    all: () => read(name, []),
    get: (itemId) => read(name, []).find((x) => x.id === itemId) || null,
    create: (obj) => {
      const list = read(name, []);
      // createdBy 自动盖当前操作人；本地无登录时 currentActor() 返回 null，也照常写入。
      const item = { id: id(prefix), createdAt: new Date().toISOString(), createdBy: currentActor(), ...obj };
      list.unshift(item);
      write(name, list);
      return item;
    },
    update: (itemId, patch) => {
      const list = read(name, []);
      const i = list.findIndex((x) => x.id === itemId);
      if (i === -1) return null;
      // updatedBy 每次更新都盖当前操作人（放在 patch 之后确保盖住），无登录时为 null。
      list[i] = { ...list[i], ...patch, id: itemId, updatedAt: new Date().toISOString(), updatedBy: currentActor() };
      write(name, list);
      return list[i];
    },
    remove: (itemId) => {
      const list = read(name, []);
      const next = list.filter((x) => x.id !== itemId);
      write(name, next);
      return list.length !== next.length;
    },
    replace: (list) => write(name, list),
  };
}

export const brands = makeCollection('brands', 'brand');
export const styles = makeCollection('styles', 'style'); // 风格配方（kind: writing|visual|voice）
export const plays = makeCollection('plays', 'play'); // 运营玩法（来自运营 skill）
export const presets = makeCollection('presets', 'pre'); // 运营需求配方（品牌+形态+偏好）
export const projects = makeCollection('projects', 'proj');
export const calendar = makeCollection('calendar', 'cal');
export const accounts = makeCollection('accounts', 'acct');
export const jobs = makeCollection('jobs', 'job'); // 重型生产线任务（claude -p 后台）
export const cliTokens = makeCollection('cli-tokens', 'ctk'); // CLI 接入令牌（只存 sha256 哈希+尾号）

// 工作区级设置（单对象非集合）：模型偏好等
export const wsSettings = {
  get: () => read('settings', {}),
  set: (patch) => {
    const next = { ...read('settings', {}), ...patch, updatedAt: new Date().toISOString() };
    write('settings', next);
    return next;
  },
};
export const chats = makeCollection('chats', 'chat'); // 对话窗口会话（本地 claude CLI）
export const pool = makeCollection('pool', 'pool'); // 平台账号内容池（作品收录进某账号 → 在账号内容库发布）

// 一次性迁移：旧 styles.json 实际上存的是「运营需求」(品牌+形态+偏好)，搬到 presets
(function migrateLegacyStylesToPresets() {
  try {
    const legacy = styles.all();
    if (!legacy.length) return;
    // 若每条都有 outputs / brandId，明显是旧需求数据 → 迁
    const looksLikePresets = legacy.every((s) => Array.isArray(s.outputs));
    if (!looksLikePresets) return;
    if (presets.all().length) return; // 已经迁过
    presets.replace(legacy.map((s) => ({ ...s, id: 'pre_' + s.id })));
    styles.replace([]); // 清空旧的，让新风格库从零开始
    console.log(`  ⇨ 迁移 ${legacy.length} 条旧需求到 presets，styles 已清空给真风格用`);
  } catch (e) {
    console.warn('迁移 styles→presets 失败:', e.message);
  }
})();

export { read, write };
