import { createHash } from 'node:crypto';

export const ELEVENAGENTS_SESSION_COOKIE = 'elevenagents_session';
export const DEFAULT_SSO_URL = 'https://app.11agents.ai/api/auth/sso';

function cacheKey(token, workspace, tenantId) {
  return createHash('sha256').update(`${token}\0${workspace}\0${tenantId}`).digest('hex');
}

export function createElevenAgentsVerifier({
  fetchImpl = globalThis.fetch,
  verifyUrl = process.env.ELEVEN_AGENTS_SSO_URL || DEFAULT_SSO_URL,
  ttlMs = 30_000,
  timeoutMs = 5_000,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();

  return async function verifyElevenAgentsSession({ token, workspace, tenantId = '' } = {}) {
    if (!token || !workspace) return null;
    const key = cacheKey(token, workspace, tenantId);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;

    const url = new URL(verifyUrl);
    url.searchParams.set('workspace', workspace);
    if (tenantId) url.searchParams.set('tenant_id', tenantId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Cookie: `${ELEVENAGENTS_SESSION_COOKIE}=${encodeURIComponent(token)}`,
          'User-Agent': '1toAll-SSO/1.0',
        },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = await response.json();
      if (
        !body?.ok
        || !body.user?.id
        || body.workspace?.slug !== workspace
        || (tenantId && body.workspace?.tenant_id !== tenantId)
      ) return null;

      cache.set(key, { value: body, expiresAt: now() + ttlMs });
      if (cache.size > 1_000) {
        for (const [entryKey, entry] of cache) {
          if (entry.expiresAt <= now()) cache.delete(entryKey);
        }
      }
      return body;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

export const verifyElevenAgentsSession = createElevenAgentsVerifier();
