import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DATA_DIR } from '../config.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'cost-settings.json');
const PRODUCTION_RUNS_FILE = path.join(DATA_DIR, 'production-runs.json');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const DEFAULT_SETTINGS = {
  version: 1,
  usdCnyRate: 6.78,
  rateAsOf: '2026-07-17',
  sourceLabel: 'Claude session JSONL',
  pricingSourceUrl: 'https://docs.z.ai/guides/overview/pricing',
  exchangeRateSourceUrl: 'https://www.xe.com/en-us/currencyconverter/convert/?Amount=1&From=USD&To=CNY',
  defaultPricing: {
    inputUsdPerM: 1,
    cacheWriteUsdPerM: 1,
    cacheReadUsdPerM: 0.2,
    outputUsdPerM: 3.2,
    basis: 'GLM-5 public API reference price; GLM-5.2/fk-cc is estimated on this basis',
  },
  pricing: {
    'glm-5.1': { inputUsdPerM: 1.4, cacheWriteUsdPerM: 1.4, cacheReadUsdPerM: 0.26, outputUsdPerM: 4.4 },
    'glm-5': { inputUsdPerM: 1, cacheWriteUsdPerM: 1, cacheReadUsdPerM: 0.2, outputUsdPerM: 3.2 },
    'glm-5-turbo': { inputUsdPerM: 1.2, cacheWriteUsdPerM: 1.2, cacheReadUsdPerM: 0.24, outputUsdPerM: 4 },
    'glm-4.7': { inputUsdPerM: 0.6, cacheWriteUsdPerM: 0.6, cacheReadUsdPerM: 0.11, outputUsdPerM: 2.2 },
  },
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

function priceFor(model, settings) {
  const raw = String(model || '').toLowerCase();
  const exact = settings.pricing?.[raw];
  if (exact) return { ...settings.defaultPricing, ...exact };
  const key = Object.keys(settings.pricing || {})
    .sort((a, b) => b.length - a.length)
    .find((candidate) => raw.includes(candidate));
  return key
    ? { ...settings.defaultPricing, ...settings.pricing[key] }
    : settings.defaultPricing;
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
