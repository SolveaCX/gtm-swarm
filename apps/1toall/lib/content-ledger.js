import { DEFAULT_MODEL, IMAGE_DESIGN_MODEL } from '../config.js';
import { getPlatform } from './platforms.js';

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function inferredProjectStack(project, output) {
  const model = project?.options?.model || DEFAULT_MODEL;
  if (output?.kind === 'image' || getPlatform(output?.platformId)?.kind === 'image') {
    return [
      {
        role: 'prompt_design',
        provider: 'Flatkey',
        model: IMAGE_DESIGN_MODEL,
        requestedModel: IMAGE_DESIGN_MODEL,
        billingMode: 'flatkey_quota',
        actualCny: null,
      },
      {
        role: 'visual_generation',
        provider: 'Flatkey',
        model: 'gpt-image-2',
        requestedModel: 'gpt-image-2',
        billingMode: 'flatkey_quota',
        actualCny: null,
      },
    ];
  }
  return [{
    role: output?.kind === 'plan' ? 'content_plan' : 'content_generation',
    provider: 'Flatkey',
    model,
    requestedModel: model,
    billingMode: 'flatkey_quota',
    actualCny: null,
  }];
}

function inferredProjectCost(project, output) {
  const modelStack = inferredProjectStack(project, output);
  return {
    version: 1,
    source: 'project-config-inference',
    accuracy: 'model_inferred_usage_missing',
    calculatedAt: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    dedicatedWorkerTokens: 0,
    apiEquivalentCny: null,
    actualCny: null,
    billingMode: 'flatkey_quota',
    primaryModel: modelStack[0]?.model || 'unknown',
    modelNames: [...new Set(modelStack.map((item) => item.model).filter(Boolean))],
    modelStack,
    note: '历史轻内容未保存供应商 usage；模型根据项目配置确认，Token 与金额不补猜。',
  };
}

function outputType(output) {
  const platform = getPlatform(output?.platformId);
  const kind = output?.kind || platform?.kind;
  if (kind === 'image') return { id: 'image', label: '图片' };
  if (kind === 'plan') return { id: 'plan', label: '方案' };
  return { id: 'text', label: '文字' };
}

function jobEntry(job, meta = {}) {
  const cost = job.cost || null;
  const itemCounts = (job.products || []).reduce((counts, item) => {
    counts[item.type] = (counts[item.type] || 0) + 1;
    return counts;
  }, {});
  return {
    id: job.id,
    workId: job.id,
    sourceKind: 'job',
    brandId: job.brandId || 'none',
    brandName: job.brandName || '无品牌',
    title: job.channelLabel || job.idea || '视频内容',
    formatLabel: job.channelLabel || job.channelId || '视频',
    contentType: 'video',
    contentTypeLabel: '视频',
    at: job.doneAt || job.createdAt,
    published: !!meta[job.id]?.published,
    itemCount: (job.products || []).length,
    itemCounts,
    usageState: cost?.totalTokens ? 'recorded' : 'missing',
    cost,
  };
}

function projectEntries(project, meta = {}) {
  return (project.outputs || [])
    .filter((output) => output.status === 'done' || output.status === 'edited')
    .map((output) => {
      const platform = getPlatform(output.platformId);
      const type = outputType(output);
      const cost = output.cost || inferredProjectCost(project, output);
      return {
        id: `${project.id}:${output.platformId}`,
        workId: project.id,
        sourceKind: 'project',
        brandId: project.brandId || 'none',
        brandName: project.brandName || '无品牌',
        title: project.title || project.idea?.slice(0, 30) || platform?.label || '轻内容',
        formatLabel: platform?.label || output.platformId,
        contentType: type.id,
        contentTypeLabel: type.label,
        at: output.at || project.updatedAt || project.createdAt,
        published: !!meta[project.id]?.published,
        itemCount: 1,
        itemCounts: { [type.id]: 1 },
        usageState: cost?.totalTokens ? 'recorded' : 'missing',
        cost,
      };
    });
}

export function buildContentLedger({ jobList = [], projectList = [], worksMeta = {} } = {}) {
  const entries = [
    ...jobList.filter((job) => job.status === 'done').map((job) => jobEntry(job, worksMeta)),
    ...projectList.flatMap((project) => projectEntries(project, worksMeta)),
  ].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  const sharedRuns = new Map();
  let exclusiveTokens = 0;
  let apiEquivalentCny = 0;
  let recordedCount = 0;
  // 有 token 但那个模型没价目 → 金额会偏低，得说出来而不是闷着算
  let unpricedCount = 0;
  let unpricedTokens = 0;
  const unpricedModels = new Set();

  for (const entry of entries) {
    const cost = entry.cost;
    if (!cost?.totalTokens) continue;
    recordedCount += 1;
    exclusiveTokens += number(cost.dedicatedWorkerTokens ?? cost.totalTokens);
    const cny = cost.apiEquivalentCny ?? cost.estimatedCny;
    if (cny == null) {
      unpricedCount += 1;
      unpricedTokens += number(cost.totalTokens);
      for (const name of (cost.modelNames?.length ? cost.modelNames : [cost.primaryModel])) {
        if (name) unpricedModels.add(name);
      }
    }
    apiEquivalentCny += number(cny);
    // 统筹层用量跨多条内容共享，只能算一次；CLI 自报的没有 runId，用产品+模型当去重键
    const shared = cost.sharedUsage;
    const sharedKey = shared?.productionRunId || (shared ? `${shared.product || shared.provider || ''}:${shared.model || ''}` : '');
    if (sharedKey) sharedRuns.set(sharedKey, shared);
  }

  const sharedTokens = [...sharedRuns.values()]
    .reduce((sum, shared) => sum + number(shared.usage?.totalTokens ?? shared.totalTokens), 0);
  const countsByType = entries.reduce((counts, entry) => {
    counts[entry.contentType] = (counts[entry.contentType] || 0) + 1;
    return counts;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      contentCount: entries.length,
      recordedCount,
      missingUsageCount: entries.length - recordedCount,
      coveragePct: entries.length ? Math.round(recordedCount / entries.length * 100) : 0,
      exclusiveTokens,
      sharedTokens,
      totalTokens: exclusiveTokens + sharedTokens,
      apiEquivalentCny: Number(apiEquivalentCny.toFixed(2)),
      actualCny: null,
      unpricedCount,
      unpricedTokens,
      unpricedModels: [...unpricedModels],
      countsByType,
    },
    entries,
  };
}
