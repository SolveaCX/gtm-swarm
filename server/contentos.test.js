import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

test('ensureProjectScaffold creates filesystem project files for DB-created workspaces', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'gtm-swarm-contentos-'))
  process.env.GTM_DATA_DIR = dataDir

  try {
    const { ensureProjectScaffold } = await import(`./contentos.js?test=${Date.now()}`)

    const result = ensureProjectScaffold({
      slug: 'acme',
      name: 'Acme',
      urls: { website: 'https://acme.example', github_kb: 'https://github.com/acme/kb' },
      project_config: {
        category: 'AI research',
        tagline: 'Research brief generator',
        audience: { primary: 'founders', secondary: 'marketers' },
        positioning: 'Turns raw research into GTM briefs',
        competitors: ['Legacy Research'],
        suggested_channels: ['reddit', 'x', 'blog'],
      },
    })

    const projectDir = path.join(dataDir, 'projects', 'acme')
    assert.equal(result.slug, 'acme')
    assert.equal(existsSync(path.join(projectDir, 'project.yaml')), true)
    assert.equal(existsSync(path.join(projectDir, 'strategy')), true)
    assert.equal(existsSync(path.join(projectDir, 'agents')), true)

    const projectYaml = readFileSync(path.join(projectDir, 'project.yaml'), 'utf-8')
    assert.match(projectYaml, /slug: acme/)
    assert.match(projectYaml, /name: Acme/)
    assert.match(projectYaml, /url: https:\/\/acme\.example/)
    assert.match(projectYaml, /github_kb: https:\/\/github\.com\/acme\/kb/)
    assert.match(projectYaml, /category: AI research/)
    assert.match(projectYaml, /tagline: Research brief generator/)
    assert.match(projectYaml, /positioning: Turns raw research into GTM briefs/)

    const registry = JSON.parse(readFileSync(path.join(dataDir, 'projects', '_registry.json'), 'utf-8'))
    assert.equal(registry.default, 'acme')
    assert.deepEqual(registry.projects.acme, {
      slug: 'acme',
      name: 'Acme',
      url: 'https://acme.example',
      status: 'active',
    })
  } finally {
    delete process.env.GTM_DATA_DIR
    rmSync(dataDir, { recursive: true, force: true })
  }
})
