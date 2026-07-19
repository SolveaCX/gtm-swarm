import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('tracked seed payloads are valid JSON arrays', () => {
  for (const name of ['brands', 'plays', 'styles']) {
    const file = path.join(process.cwd(), 'data', 'seed', `${name}.json`);
    assert.equal(fs.existsSync(file), true, `${name} seed is missing`);
    assert.equal(Array.isArray(JSON.parse(fs.readFileSync(file, 'utf8'))), true);
  }
});

test('production data directory can live outside the release tree', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '1toall-data-'));
  process.env.ONE_TO_ALL_DATA_DIR = dir;
  const config = await import(`../config.js?test=${Date.now()}`);
  assert.equal(config.DATA_DIR, dir);
});

test('workspace slugs are normalized and isolated', async () => {
  const { currentWorkspace, normalizeWorkspace, runWithWorkspace, tenantFromRequest } = await import('../lib/workspace-context.js');
  assert.equal(normalizeWorkspace('Nuvelle'), 'nuvelle');
  assert.equal(normalizeWorkspace('../../etc'), 'flatkey');
  assert.equal(currentWorkspace(), 'flatkey');
  assert.equal(runWithWorkspace('voc', () => currentWorkspace()), 'voc');
  assert.equal(tenantFromRequest({ query: { tenant_id: '9034be95-5adb-4a36-a969-95f693196fbb' }, headers: {} }), '9034be95-5adb-4a36-a969-95f693196fbb');
  assert.equal(tenantFromRequest({ query: { tenant_id: '../../etc' }, headers: {} }), '');
});
