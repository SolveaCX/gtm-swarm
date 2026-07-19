// 1toAll 全局配置
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = __dirname;
export const PORT = process.env.PORT || 4178;

// Production points these at a shared directory outside the release tree so
// deploys never overwrite operator data, generated files, or uploaded assets.
export const DATA_DIR = process.env.ONE_TO_ALL_DATA_DIR || path.join(ROOT, 'data');
export const OUTPUT_DIR = process.env.ONE_TO_ALL_OUTPUT_DIR || path.join(ROOT, 'output');
export const ASSETS_DIR = process.env.ONE_TO_ALL_ASSETS_DIR || path.join(ROOT, 'assets');
export const MEDIA_DIR = process.env.ONE_TO_ALL_MEDIA_DIR || path.join(ROOT, 'media');
export const PUBLIC_DIR = path.join(ROOT, 'public');

// flatkey 文字模型（实测可用）。用户 指定：用 GPT，不用 Claude。
export const MODELS = [
  { id: 'gpt-5.5',      label: '标准 · GPT-5.5',      hint: '默认，质量最佳' },
  { id: 'gpt-5.4',      label: 'GPT-5.4',             hint: '稳定可靠' },
  { id: 'gpt-5.4-mini', label: '快 · GPT-5.4 mini',   hint: '最快，适合草稿' },
];
export const DEFAULT_MODEL = 'gpt-5.5';
// 图片设计步骤用快模型，省钱省时
export const IMAGE_DESIGN_MODEL = 'gpt-5.4-mini';
// 新闻板块的快讯/关键词提取是「抽取」不是「创作」，快模型足够
export const NEWS_MODEL = 'gpt-5.4-mini';

// 钉钉「运营账号数据管理系统」多维表——账号数据看板数据源
// 访问凭证 URL 存 Keychain（DINGTALK_MCP_URL），这里只放非敏感的表定位 ID
export const DINGTALK_ACCOUNT_BASE = process.env.DINGTALK_ACCOUNT_BASE || 'YOUR_DINGTALK_BASE_ID';
export const DINGTALK_ACCOUNT_TABLE = process.env.DINGTALK_ACCOUNT_TABLE || 'YOUR_DINGTALK_TABLE_ID'; // 账号总览
