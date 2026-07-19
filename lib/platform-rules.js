// 系统级「平台通用规则」——跨品牌通用，账号无关。
//   content：注入内容生成（每个平台文案/视频都遵守的格式硬规矩）
//   publish：发布环节的规则与坑（频道认定、验证要求、发布方式等），不进生成、只在发布/文档处用
// 账号专属规则写在品牌里（brand.platformRules）；这里只放「换个账号也成立」的平台规则。
// 【示例默认值：换成你自己的账号/发布规则】
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';

const FILE = path.join(DATA_DIR, 'platform-rules.json');

// 默认规则（首次加载即落盘，之后以文件为准，可在文件里改）
const DEFAULTS = {
  youtube: {
    label: 'YouTube',
    content: '标题 ≤100 字符；简介 ≤5000 字符、可含正文 + 话题标签；YouTube 标签 ≤15 个。横屏 16:9。',
    publish: '在此填你的 YouTube 发布规则（频道、可见性、封面验证要求等）。自定义封面需频道「已验证」（youtube.com/verify）。',
  },
  youtube_shorts: {
    label: 'YouTube Shorts',
    content: '竖屏 9:16，短视频。标题短、强钩子。',
    publish: '在此填你的 Shorts 发布规则。',
  },
  tiktok: {
    label: 'TikTok',
    content: '竖屏 9:16。caption = 一行钩子 + 5-8 个 hashtag。',
    publish: '在此填你的 TikTok 发布规则。',
  },
  bilibili: {
    label: 'B站',
    content: '横屏 16:9 视频。标题 ≤80 字；简介带章节时间轴 + tag。',
    publish: '在此填你的 B站 发布规则（封面尺寸等）。',
  },
  xiaohongshu: {
    label: '小红书',
    content: '标题 ≤20 字、口语化；正文口语、可分点 + emoji；10 个 tag。数字可溯源。',
    publish: '无引流话术、无绝对化词。竖版封面 3:4。',
  },
  douyin: {
    label: '抖音',
    content: '标题 ≤30 字、可带 emoji；5 个 tag。前 3 秒强钩子，口播逐字稿。',
    publish: '无引流话术、无绝对化词。竖屏 9:16。',
  },
  shipinhao: {
    label: '视频号',
    content: '标题 ≤16 字、无逗号；简短有力，适合熟人传播。',
    publish: '竖屏为主；发布靠人工。',
  },
};

// 内容生成用的平台 id → 平台规则 slug
export const GEN_TO_SLUG = {
  xiaohongshu: 'xiaohongshu',
  douyin: 'douyin',
  shipinhao: 'shipinhao',
  bilibili: 'bilibili',
  youtube_long: 'youtube',
  shorts_en: 'tiktok',
};

function load() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* 首次没有 */ }
  const merged = {};
  for (const k of new Set([...Object.keys(DEFAULTS), ...Object.keys(saved)])) {
    merged[k] = { ...(DEFAULTS[k] || {}), ...(saved[k] || {}) };
  }
  return merged;
}

let _cache = null;
export function allPlatformRules() {
  if (!_cache) {
    _cache = load();
    try { fs.writeFileSync(FILE, JSON.stringify(_cache, null, 2)); } catch { /* 落盘失败不阻塞 */ }
  }
  return _cache;
}

export function contentRuleFor(genPlatformId) {
  const slug = GEN_TO_SLUG[genPlatformId];
  if (!slug) return '';
  return allPlatformRules()[slug]?.content || '';
}

export function updatePlatformRule(slug, patch) {
  const all = allPlatformRules();
  all[slug] = { ...(all[slug] || {}), ...(patch || {}) };
  _cache = all;
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
  return all[slug];
}
