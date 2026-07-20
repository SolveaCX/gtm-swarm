import assert from 'node:assert/strict';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:4178';
const auth = process.env.ONE_TO_ALL_AUTH_USER && process.env.ONE_TO_ALL_AUTH_PASSWORD
  ? `Basic ${Buffer.from(`${process.env.ONE_TO_ALL_AUTH_USER}:${process.env.ONE_TO_ALL_AUTH_PASSWORD}`).toString('base64')}`
  : '';

const health = await fetch(`${base}/api/health`);
assert.equal(health.status, 200);
const body = await health.json();
assert.equal(body.ok, true);
assert.equal(body.service, '1toall');

if (auth) {
  const protectedPage = await fetch(`${base}/?workspace=flatkey`, {
    redirect: 'manual',
    headers: { Accept: 'text/html' },
  });
  assert.equal(protectedPage.status, 302);
  assert.match(protectedPage.headers.get('location') || '', /^\/login\?/);

  const [username, password] = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(/:(.*)/s, 2);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  const cookie = String(login.headers.get('set-cookie') || '').split(';', 1)[0];
  assert.match(cookie, /^one_to_all_session=/);
  const page = await fetch(`${base}/?workspace=flatkey`, { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>one/);
}

const page = await fetch(`${base}/?workspace=flatkey`, { headers: auth ? { Authorization: auth } : {} });
assert.equal(page.status, 200);
assert.match(await page.text(), /<title>one/);

const authStatus = await fetch(`${base}/api/auth/status?workspace=flatkey`, { headers: auth ? { Authorization: auth } : {} });
assert.equal(authStatus.status, 200);
const authBody = await authStatus.json();
assert.equal(authBody.ok, true);
assert.equal(authBody.workspace.slug, 'flatkey');
if (auth) assert.equal(authBody.source, 'basic');

const bootstrap = await fetch(`${base}/api/bootstrap?workspace=flatkey`, { headers: auth ? { Authorization: auth } : {} });
assert.equal(bootstrap.status, 200);
const boot = await bootstrap.json();
assert.equal(boot.ok, true);
assert.ok(Array.isArray(boot.data.brands));
assert.equal(boot.data.workspace, 'flatkey');

console.log(JSON.stringify({ ok: true, base, brands: boot.data.brands.length }));
