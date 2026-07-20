import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();
// 操作人（当前请求的登录用户）上下文，与 workspace 分开一套 store，互不干扰。
const actorStorage = new AsyncLocalStorage();
const DEFAULT_WORKSPACE = 'flatkey';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeWorkspace(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) ? slug : DEFAULT_WORKSPACE;
}

export function currentWorkspace() {
  return storage.getStore() || DEFAULT_WORKSPACE;
}

export function runWithWorkspace(workspace, fn) {
  return storage.run(normalizeWorkspace(workspace), fn);
}

export function currentActor() {
  return actorStorage.getStore() ?? null;
}

export function runWithActor(actor, fn) {
  return actorStorage.run(actor ?? null, fn);
}

export function cookiesFromRequest(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((item) => {
    const [key, ...parts] = item.trim().split('=');
    let value = parts.join('=') || '';
    try { value = decodeURIComponent(value); } catch {}
    return [key, value];
  }).filter(([key]) => key));
}

export function workspaceFromRequest(req) {
  const cookies = cookiesFromRequest(req);
  return normalizeWorkspace(req.query.workspace || req.headers['x-1toall-workspace'] || cookies.one_to_all_workspace);
}

export function tenantFromRequest(req) {
  const cookies = cookiesFromRequest(req);
  const tenantId = String(req.query.tenant_id || req.headers['x-1toall-tenant'] || cookies.one_to_all_tenant || '').trim();
  return UUID_RE.test(tenantId) ? tenantId.toLowerCase() : '';
}

export { DEFAULT_WORKSPACE };
