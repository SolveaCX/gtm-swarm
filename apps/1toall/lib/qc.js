// 质检环节：内容生成完自动跑——四维打分（错别字/口吻/红线/结构）+ 问题清单 + 改进建议，
// 顺带产出曝光预测所需的内容特征（同一次 LLM 调用，不多花钱）。
// 结果存 output.qc；fail 会在任务看板出「质检」红节点并拦收录（可 force）。
import { chat } from './flatkey.js';
import { extractJson } from './generate.js';
import { modelPref } from './model-prefs.js';
import { predictExposure } from './exposure.js';
import { getPlatform } from './platforms.js';

const QC_DEFAULT_MODEL = 'gpt-5.4-mini'; // 质检跑量大，默认便宜模型；设置页可换

export async function runQc({ content, title = '', platformId, brand = null, style = null }) {
  const platform = getPlatform(platformId);
  const brandBits = brand ? [
    brand.persona ? `人设：${brand.persona}` : '',
    brand.voice ? `语气：${brand.voice}` : '',
    brand.redLines ? `红线（碰了直接 fail）：${brand.redLines}` : '',
    brand.bannedWords ? `禁用词：${brand.bannedWords}` : '',
  ].filter(Boolean).join('\n') : '';
  const styleBits = style ? `写作风格要求：${style.voice || ''}${style.banned ? `；务必避开：${style.banned}` : ''}` : '';

  const system = '你是内容质检员。只输出 JSON，别的什么都不说。评分要严格、问题要具体到引用原文。';
  const user = `对下面这篇「${platform?.label || platformId}」内容做发布前质检，四个维度各 0-25 分：
1. typo：错别字/语病/标点
2. voice：口吻是否贴账号人设与风格
3. redline：是否踩红线/禁用词/违规风险（发现 high 级问题该维度给 0）
4. structure：结构完整度（钩子/递进/收尾，按该内容形态的要求）

${brandBits ? `【账号规范】\n${brandBits}\n` : ''}${styleBits ? `【风格】\n${styleBits}\n` : ''}
另外给曝光预测特征（都是 0-10）：hook=开头钩子强度，heat=话题热度（当下讨论度），fit=长度与结构对该平台的贴合度。

严格输出：
{"typo":25,"voice":22,"redline":25,"structure":20,"issues":[{"dim":"voice","severity":"low|mid|high","quote":"原文引用","why":"为什么是问题","fix":"怎么改"}],"suggestions":["一句话建议"],"hook":8,"heat":6,"fit":7}

【标题】${title}
【正文】
${String(content || '').slice(0, 6000)}`;

  const raw = await chat({ model: modelPref('qc', QC_DEFAULT_MODEL), system, user, maxTokens: 1200, purpose: 'qc' });
  const p = extractJson(raw);
  const dim = (v) => Math.max(0, Math.min(25, Number(v) || 0));
  const dims = { typo: dim(p.typo), voice: dim(p.voice), redline: dim(p.redline), structure: dim(p.structure) };
  const issues = (Array.isArray(p.issues) ? p.issues : []).slice(0, 8).map((i) => ({
    dim: String(i.dim || ''), severity: ['low', 'mid', 'high'].includes(i.severity) ? i.severity : 'mid',
    quote: String(i.quote || '').slice(0, 120), why: String(i.why || '').slice(0, 120), fix: String(i.fix || '').slice(0, 160),
  }));
  const redlineHigh = issues.some((i) => i.dim === 'redline' && i.severity === 'high');
  let score = dims.typo + dims.voice + dims.redline + dims.structure;
  if (redlineHigh) score = Math.min(score, 45); // 红线 high 一票不过
  const verdict = score >= 80 ? 'pass' : score >= 60 ? 'warn' : 'fail';
  return {
    score, verdict, dims, issues,
    suggestions: (Array.isArray(p.suggestions) ? p.suggestions : []).slice(0, 4).map((s) => String(s).slice(0, 120)),
    features: { hook: Number(p.hook) || 0, heat: Number(p.heat) || 0, fit: Number(p.fit) || 0 },
    model: modelPref('qc', QC_DEFAULT_MODEL),
    at: new Date().toISOString(),
  };
}

// 质检 + 曝光预测一条龙（曝光挂在 qc.exposure）
export async function qcWithExposure({ content, title, platformId, brand, style, brandName }) {
  const qc = await runQc({ content, title, platformId, brand, style });
  try {
    qc.exposure = predictExposure({ brandName: brandName || brand?.name || '', platform: platformLabelFor(platformId), features: qc.features });
  } catch { qc.exposure = null; }
  return qc;
}

function platformLabelFor(platformId) {
  const map = { gongzhonghao: '公众号', gongzhonghao_pub: '公众号', xiaohongshu: '小红书', douyin: '抖音', shipinhao: '视频号', bilibili: 'B站', youtube_long: 'youtube', shorts_en: 'tiktok', twitter: 'x', article: '公众号' };
  return map[platformId] || platformId;
}
