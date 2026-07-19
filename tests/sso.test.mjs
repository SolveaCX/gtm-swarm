import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createElevenAgentsVerifier, ELEVENAGENTS_SESSION_COOKIE } from '../lib/elevenagents-sso.js';

test('shared 11agents session is verified with workspace and tenant scope then cached', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => ({
        ok: true,
        user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
        workspace: {
          id: 'project-1',
          tenant_id: '9034be95-5adb-4a36-a969-95f693196fbb',
          slug: 'flatkey',
          role: 'admin',
        },
      }),
    };
  };
  const verify = createElevenAgentsVerifier({ fetchImpl, verifyUrl: 'https://app.11agents.ai/api/auth/sso' });
  const input = {
    token: 'shared-session-token',
    workspace: 'flatkey',
    tenantId: '9034be95-5adb-4a36-a969-95f693196fbb',
  };

  const first = await verify(input);
  const second = await verify(input);

  assert.equal(first.workspace.slug, 'flatkey');
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('workspace'), 'flatkey');
  assert.equal(url.searchParams.get('tenant_id'), input.tenantId);
  assert.equal(calls[0].options.headers.Cookie, `${ELEVENAGENTS_SESSION_COOKIE}=shared-session-token`);
});

test('invalid or unauthorized shared sessions do not grant access', async () => {
  let calls = 0;
  const verify = createElevenAgentsVerifier({
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, json: async () => ({ ok: false }) };
    },
  });

  assert.equal(await verify({ token: '', workspace: 'flatkey' }), null);
  assert.equal(await verify({ token: 'bad', workspace: 'flatkey' }), null);
  assert.equal(calls, 1);
});

test('a mismatched workspace response is rejected', async () => {
  const verify = createElevenAgentsVerifier({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: true, workspace: { slug: 'voc' } }),
    }),
  });
  assert.equal(await verify({ token: 'valid', workspace: 'flatkey' }), null);
});

test('a mismatched tenant response is rejected', async () => {
  const verify = createElevenAgentsVerifier({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        user: { id: 'user-1' },
        workspace: { slug: 'flatkey', tenant_id: '00000000-0000-4000-8000-000000000000' },
      }),
    }),
  });
  assert.equal(await verify({
    token: 'valid',
    workspace: 'flatkey',
    tenantId: '9034be95-5adb-4a36-a969-95f693196fbb',
  }), null);
});

test('server prioritizes shared SSO and exposes a protected auth status endpoint', () => {
  const server = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');
  const sharedSession = server.indexOf('const sharedSession = requestCookies[ELEVENAGENTS_SESSION_COOKIE]');
  const emergencySession = server.indexOf('const session = requestCookies[SESSION_COOKIE]');
  assert.ok(sharedSession >= 0);
  assert.ok(emergencySession > sharedSession, 'local emergency auth must not mask shared SSO');
  assert.match(server, /req\.authSource = 'elevenagents'/);
  assert.match(server, /app\.get\('\/api\/auth\/status'/);
  assert.doesNotMatch(server, /api\/auth\/status[\s\S]{0,800}(SESSION_TOKEN|ELEVENAGENTS_SESSION_COOKIE)/);
});
