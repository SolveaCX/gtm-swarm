import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR } from '../config.js';
import { priceFor as tablePriceFor, USD_CNY } from './pricing.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'cost-settings.json');
const PRODUCTION_RUNS_FILE = path.join(DATA_DIR, 'production-runs.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const DEFAULT_SETTINGS = {
  version: 1,
  usdCnyRate: USD_CNY,
  rateAsOf: '2026-07-21',
  sourceLabel: 'Claude session JSONL',
  pricingSourceUrl: 'https://docs.z.ai/guides/overview/pricing',
  pricingCheckedAt: '2026-07-21',
  exchangeRateSourceUrl: 'https://www.xe.com/en-us/currencyconverter/convert/?Amount=1&From=USD&To=CNY',
  // 全部照厂商官方价目页填（2026-07-21 核对）。cacheRead 用官方「Cached Input」价，
  // cacheWrite 官方没有单列，按等同 input 记（z.ai 的 Cached Input Storage 目前限时免费）。
  defaultPricing: {
    inputUsdPerM: 1.4,
    cacheWriteUsdPerM: 1.4,
    cacheReadUsdPerM: 0.26,
    outputUsdPerM: 4.4,
    basis: 'GLM-5.2 official price (z.ai) — fk-cc 路由到 GLM 时按这套算',
  },
  // 单价不再在这里各填一份：统一去 lib/pricing.js 那张表取（含缓存价），设置页改完这里立刻跟着变
  pricing: {},
};

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value, digits) => Number(number(value).toFixed(digits));

export function loadCostSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      defaultPricing: { ...DEFAULT_SETTINGS.defaultPricing, ...(saved.defaultPricing || {}) },
      pricing: { ...DEFAULT_SETTINGS.pricing, ...(saved.pricing || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function loadProductionRuns() {
  try {
    const runs = JSON.parse(fs.readFileSync(PRODUCTION_RUNS_FILE, 'utf8'));
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

function productionRunForJob(jobId) {
  return loadProductionRuns().find((run) => (run.jobIds || []).includes(jobId)) || null;
}

function claudeProjectDir(outDir) {
  const encoded = String(outDir || '').replace(/[^A-Za-z0-9]/g, '-');
  const direct = path.join(CLAUDE_PROJECTS_DIR, encoded);
  return fs.existsSync(direct) ? direct : null;
}

function namedFiles(root, name, depth = 0) {
  if (!root || depth > 5) return [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) files.push(full);
    else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...namedFiles(full, name, depth + 1));
    }
  }
  return files;
}

function voiceModels(job) {
  const voice = job?.voice;
  if (!voice?.engine) return [];
  if (voice.engine === 'keke') {
    return [{
      role: 'voice',
      provider: voice.provider || 'Local Keke Voice',
      model: voice.modelId || 'chatterbox-multilingual',
      voice: voice.name || voice.voiceStyleId || 'selected brand voice',
      billingMode: 'local_compute',
      actualCny: 0,
    }];
  }
  if (voice.engine === 'qwen') {
    return [{
      role: 'voice',
      provider: 'DashScope',
      model: 'qwen3.5-omni-plus',
      voice: voice.voiceId || 'Ethan',
      billingMode: 'api_key_quota',
      actualCny: null,
    }];
  }
  if (voice.engine !== 'elevenlabs') return [];

  const modelIds = new Set();
  for (const file of namedFiles(job.outDir, 'tts_manifest.json')) {
    try {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const modelId of manifest.modelIds || []) if (modelId) modelIds.add(modelId);
      if (manifest.modelId && manifest.modelId !== 'mixed-elevenlabs') modelIds.add(manifest.modelId);
    } catch {}
  }
  if (!modelIds.size && voice.modelId) modelIds.add(voice.modelId);
  return [...modelIds].map((model) => ({
    role: 'voice',
    provider: 'ElevenLabs',
    model,
    voice: voice.name || voice.voiceId || 'configured voice',
    billingMode: 'monthly_credit_quota',
    actualCny: null,
  }));
}

function jsonlFiles(root, depth = 0) {
  if (!root || depth > 4) return [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
    else if (entry.isDirectory() && !entry.name.startsWith('.')) files.push(...jsonlFiles(full, depth + 1));
  }
  return files;
}

// 取单价：先看 cost-settings.json 里针对视频的手工覆盖，没有就用全站统一价表（lib/pricing.js）。
// 一张表一个真相——以前这里另存一份，改了那边忘了这边，同一个模型能算出两个价。
function priceFor(model, settings) {
  const raw = String(model || '').toLowerCase();
  const overrides = settings.pricing || {};
  const hit = overrides[raw] || (() => {
    const key = Object.keys(overrides).sort((a, b) => b.length - a.length).find((c) => raw.includes(c));
    return key ? overrides[key] : null;
  })();
  if (hit) return { ...settings.defaultPricing, ...hit };
  const p = tablePriceFor(model);
  if (p && p.type === 'token') {
    return {
      inputUsdPerM: p.usdInPerM || 0,
      outputUsdPerM: p.usdOutPerM || 0,
      cacheReadUsdPerM: p.usdCacheReadPerM ?? p.usdInPerM ?? 0,
      cacheWriteUsdPerM: p.usdCacheWritePerM ?? p.usdInPerM ?? 0,
    };
  }
  return settings.defaultPricing;
}

function addUsage(target, usage) {
  target.inputTokens += number(usage?.input_tokens);
  target.outputTokens += number(usage?.output_tokens);
  target.cacheCreationInputTokens += number(usage?.cache_creation_input_tokens);
  target.cacheReadInputTokens += number(usage?.cache_read_input_tokens);
}

function estimateUsd(usage, pricing) {
  return (
    usage.inputTokens * pricing.inputUsdPerM
    + usage.cacheCreationInputTokens * pricing.cacheWriteUsdPerM
    + usage.cacheReadInputTokens * pricing.cacheReadUsdPerM
    + usage.outputTokens * pricing.outputUsdPerM
  ) / 1_000_000;
}

export function calculateVideoCost(job, settings = loadCostSettings()) {
  const projectDir = claudeProjectDir(job?.outDir);
  if (!projectDir) return null;

  const started = Date.parse(job?.createdAt || '') - 5 * 60_000;
  const ended = Date.parse(job?.doneAt || '') + 15 * 60_000;
  const hasWindow = Number.isFinite(started) && Number.isFinite(ended);
  const seen = new Set();
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  const byModel = new Map();
  const sessions = new Set();

  for (const file of jsonlFiles(projectDir)) {
    let lines = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { continue; }
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const usage = record?.message?.usage;
      if (!usage || record?.message?.role !== 'assistant') continue;
      const timestamp = Date.parse(record.timestamp || '');
      if (hasWindow && Number.isFinite(timestamp) && (timestamp < started || timestamp > ended)) continue;

      const requestKey = record.requestId || record?.message?.id || record.uuid;
      if (!requestKey) continue;
      const dedupeKey = `${file}:${requestKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (record.sessionId) sessions.add(record.sessionId);

      addUsage(totals, usage);
      const model = String(record?.message?.model || 'unknown');
      if (!byModel.has(model)) {
        byModel.set(model, {
          model,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        });
      }
      addUsage(byModel.get(model), usage);
    }
  }

  const totalTokens = totals.inputTokens
    + totals.outputTokens
    + totals.cacheCreationInputTokens
    + totals.cacheReadInputTokens;
  if (!totalTokens) return null;

  const models = [...byModel.values()].filter((item) => (
    item.inputTokens + item.outputTokens + item.cacheCreationInputTokens + item.cacheReadInputTokens
  ) > 0).map((item) => {
    const pricing = priceFor(item.model, settings);
    const estimatedUsd = estimateUsd(item, pricing);
    return {
      ...item,
      totalTokens: item.inputTokens + item.outputTokens + item.cacheCreationInputTokens + item.cacheReadInputTokens,
      estimatedUsd: round(estimatedUsd, 6),
      estimatedCny: round(estimatedUsd * settings.usdCnyRate, 2),
      pricing: {
        inputUsdPerM: pricing.inputUsdPerM,
        cacheWriteUsdPerM: pricing.cacheWriteUsdPerM,
        cacheReadUsdPerM: pricing.cacheReadUsdPerM,
        outputUsdPerM: pricing.outputUsdPerM,
      },
    };
  });
  const estimatedUsd = models.reduce((sum, item) => sum + item.estimatedUsd, 0);
  const run = productionRunForJob(job.id);
  const worker = run?.worker || {
    role: 'video_worker',
    provider: 'Flatkey',
    client: 'Claude Code',
    requestedModel: 'claude-opus-4-8-fk-cc',
    resolvedModel: models[0]?.model || 'unknown',
    billingMode: 'flatkey_quota',
    actualCny: null,
  };
  const modelStack = [
    ...(run?.orchestrator ? [{
      ...run.orchestrator,
      totalTokens: run.orchestrator.usage?.totalTokens || 0,
    }] : []),
    {
      ...worker,
      model: worker.resolvedModel || models[0]?.model || 'unknown',
      tokenScope: 'exclusive_to_job',
      totalTokens,
      apiEquivalentCny: round(estimatedUsd * settings.usdCnyRate, 2),
    },
    ...(run?.visual ? [run.visual] : []),
    ...voiceModels(job),
  ];
  const modelNames = [...new Set(modelStack.map((item) => item.model).filter(Boolean))];

  return {
    version: 2,
    source: 'claude-session-jsonl',
    accuracy: 'api_equivalent_estimate',
    calculatedAt: new Date().toISOString(),
    rateAsOf: settings.rateAsOf,
    usdCnyRate: settings.usdCnyRate,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    totalTokens,
    dedicatedWorkerTokens: totalTokens,
    estimatedUsd: round(estimatedUsd, 6),
    estimatedCny: round(estimatedUsd * settings.usdCnyRate, 2),
    apiEquivalentUsd: round(estimatedUsd, 6),
    apiEquivalentCny: round(estimatedUsd * settings.usdCnyRate, 2),
    actualCny: null,
    billingMode: worker.billingMode || 'flatkey_quota',
    requestCount: seen.size,
    sessionCount: sessions.size,
    primaryModel: modelNames[0] || 'unknown',
    modelNames,
    models,
    modelStack,
    productionRunId: run?.id || null,
    sharedUsage: run?.orchestrator ? {
      productionRunId: run.id,
      label: run.label,
      provider: run.orchestrator.provider,
      product: run.orchestrator.product,
      accountPlan: run.orchestrator.accountPlan,
      model: run.orchestrator.model,
      usage: run.orchestrator.usage,
      tokenScope: run.orchestrator.tokenScope,
      billingMode: run.orchestrator.billingMode,
      actualCny: run.orchestrator.actualCny,
      note: run.orchestrator.note,
    } : null,
    pricingBasis: settings.defaultPricing.basis,
    pricingSourceUrl: settings.pricingSourceUrl,
    exchangeRateSourceUrl: settings.exchangeRateSourceUrl,
    note: '专属 Token 来自 Flatkey 后台视频 worker；GPT/Codex 统筹 Token 为整批共享，未强行分摊。人民币金额仅为 worker 的公开 API 等价估算，不是 Flatkey、OpenAI Pro、ElevenLabs 或 Qwen 套餐实际扣款。',
  };
}

/**
 * 产能机自报用量 → 账本成本。
 * 线上服务器读不到本机 ~/.claude 会话日志，只有跑活的机器知道真实 token，
 * 所以让它 complete_task / report_usage 时把用量报上来，这里用同一张价目表折算。
 */
export function costFromUsage(job, reported = {}, settings = loadCostSettings()) {
  const raw = Array.isArray(reported.models) && reported.models.length
    ? reported.models
    : [{ model: reported.model || 'unknown', ...reported }];
  const models = raw.map((item) => {
    const usage = {
      inputTokens: number(item.inputTokens),
      outputTokens: number(item.outputTokens),
      cacheCreationInputTokens: number(item.cacheCreationInputTokens),
      cacheReadInputTokens: number(item.cacheReadInputTokens),
    };
    const pricing = priceFor(item.model || 'unknown', settings);
    const estimatedUsd = estimateUsd(usage, pricing);
    return {
      model: String(item.model || 'unknown'),
      ...usage,
      totalTokens: usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens,
      estimatedUsd: round(estimatedUsd, 6),
      estimatedCny: round(estimatedUsd * settings.usdCnyRate, 2),
      pricing: {
        inputUsdPerM: pricing.inputUsdPerM,
        cacheWriteUsdPerM: pricing.cacheWriteUsdPerM,
        cacheReadUsdPerM: pricing.cacheReadUsdPerM,
        outputUsdPerM: pricing.outputUsdPerM,
      },
    };
  }).filter((item) => item.totalTokens > 0);
  if (!models.length) return null;

  const totals = models.reduce((acc, item) => ({
    inputTokens: acc.inputTokens + item.inputTokens,
    outputTokens: acc.outputTokens + item.outputTokens,
    cacheCreationInputTokens: acc.cacheCreationInputTokens + item.cacheCreationInputTokens,
    cacheReadInputTokens: acc.cacheReadInputTokens + item.cacheReadInputTokens,
  }), { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  const totalTokens = models.reduce((sum, item) => sum + item.totalTokens, 0);
  const estimatedUsd = models.reduce((sum, item) => sum + item.estimatedUsd, 0);
  const modelNames = [...new Set(models.map((item) => item.model))];
  const worker = {
    role: 'video_worker',
    provider: reported.provider || 'Flatkey',
    client: reported.client || 'CLI 产能机',
    requestedModel: reported.requestedModel || job?.runner?.requestedModel || null,
    resolvedModel: modelNames[0],
    model: modelNames[0],
    billingMode: reported.billingMode || 'flatkey_quota',
    tokenScope: 'exclusive_to_job',
    totalTokens,
    apiEquivalentCny: round(estimatedUsd * settings.usdCnyRate, 2),
    actualCny: null,
  };
  const orchestrator = reported.orchestrator ? {
    role: 'orchestrator',
    tokenScope: 'shared_across_batch',
    ...reported.orchestrator,
  } : null;

  return {
    version: 2,
    source: 'cli-reported-usage',
    accuracy: 'api_equivalent_estimate',
    calculatedAt: new Date().toISOString(),
    rateAsOf: settings.rateAsOf,
    usdCnyRate: settings.usdCnyRate,
    ...totals,
    totalTokens,
    dedicatedWorkerTokens: totalTokens,
    estimatedUsd: round(estimatedUsd, 6),
    estimatedCny: round(estimatedUsd * settings.usdCnyRate, 2),
    apiEquivalentUsd: round(estimatedUsd, 6),
    apiEquivalentCny: round(estimatedUsd * settings.usdCnyRate, 2),
    actualCny: null,
    billingMode: worker.billingMode,
    requestCount: number(reported.requestCount),
    sessionCount: number(reported.sessionCount),
    primaryModel: modelNames[0],
    modelNames,
    models,
    modelStack: [...(orchestrator ? [orchestrator] : []), worker, ...voiceModels(job)],
    productionRunId: null,
    sharedUsage: orchestrator,
    pricingBasis: settings.defaultPricing.basis,
    pricingSourceUrl: settings.pricingSourceUrl,
    exchangeRateSourceUrl: settings.exchangeRateSourceUrl,
    reportedBy: reported.reportedBy || null,
    note: reported.note || '用量由跑活的产能机自报（线上服务器读不到本机会话日志），按公开 API 价目折算等价成本，不是套餐实际扣款。',
  };
}

/**
 * 按**当前**价目表把一条已记录的成本重算一遍。
 * 存下来的 cny 是当时那张价目表的快照——改了价格表，旧记录不会自己变。
 * 原始 token 数一直都在（cost.models[]），所以重算是纯计算，不需要重跑任何模型。
 * 认不出结构或没有原始用量的，原样返回并说明原因，绝不猜。
 */
export function repriceCost(cost, settings = loadCostSettings()) {
  if (!cost) return { changed: false, reason: '没有成本记录' };
  const models = Array.isArray(cost.models) ? cost.models : [];
  if (!models.length) return { changed: false, reason: '没留下分模型用量，重算不了' };

  let usd = 0; let pricedAny = false;
  const priced = models.map((m) => {
    const usage = {
      inputTokens: number(m.inputTokens), outputTokens: number(m.outputTokens),
      cacheCreationInputTokens: number(m.cacheCreationInputTokens), cacheReadInputTokens: number(m.cacheReadInputTokens),
    };
    const hasTokens = usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens > 0;
    if (!hasTokens) return { ...m, apiEquivalentCny: m.apiEquivalentCny ?? null };
    const p = priceFor(m.model || 'unknown', settings);
    const one = estimateUsd(usage, p);
    usd += one; pricedAny = true;
    return {
      ...m,
      estimatedUsd: round(one, 6),
      estimatedCny: round(one * settings.usdCnyRate, 2),
      pricing: { inputUsdPerM: p.inputUsdPerM, cacheWriteUsdPerM: p.cacheWriteUsdPerM, cacheReadUsdPerM: p.cacheReadUsdPerM, outputUsdPerM: p.outputUsdPerM },
    };
  });
  if (!pricedAny) return { changed: false, reason: '这些模型都没有 token 用量' };

  const before = cost.apiEquivalentCny ?? cost.estimatedCny ?? null;
  const after = round(usd * settings.usdCnyRate, 2);
  return {
    changed: before == null || Math.abs(after - before) >= 0.01,
    before, after,
    cost: {
      ...cost, models: priced,
      estimatedUsd: round(usd, 6), estimatedCny: after,
      apiEquivalentUsd: round(usd, 6), apiEquivalentCny: after,
      rateAsOf: settings.rateAsOf, usdCnyRate: settings.usdCnyRate,
      repricedAt: new Date().toISOString(),
      pricingBasis: settings.defaultPricing.basis,
    },
  };
}

export function writeCostReport(job, cost) {
  if (!job?.outDir || !cost) return null;
  const reportPath = path.join(job.outDir, 'cost-report.json');
  try {
    fs.mkdirSync(job.outDir, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      jobId: job.id,
      brandId: job.brandId,
      channelId: job.channelId,
      videoDirectory: job.outDir,
      ...cost,
    }, null, 2) + '\n');
    return reportPath;
  } catch {
    return null;
  }
}

export function calculateAndWriteVideoCost(job) {
  const cost = calculateVideoCost(job);
  if (!cost) return null;
  writeCostReport(job, cost);
  return cost;
}
