import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

const directory = new URL('../', import.meta.url)

describe('Workbench Docker deployment', () => {
  it('builds and serves the production Workbench as a non-root process', async () => {
    const dockerfile = await readFile(new URL('Dockerfile', directory), 'utf8')

    assert.match(dockerfile, /build:production/)
    assert.match(dockerfile, /UNILAB_CONTAINER_BUILD=1/)
    assert.match(dockerfile, /--ignore-scripts/)
    assert.match(dockerfile, /USER node/)
    assert.match(dockerfile, /HEALTHCHECK/)
    assert.match(dockerfile, /lib\/backend\/main\.js/)
    assert.doesNotMatch(dockerfile, /start-workbench\.mjs/)
  })

  it('replaces native drive discovery only for the container build', async () => {
    const esbuild = await readFile(new URL('esbuild.mjs', directory), 'utf8')
    const shim = await readFile(
      new URL('scripts/drivelist-container-shim.cjs', directory),
      'utf8'
    )

    assert.match(esbuild, /UNILAB_CONTAINER_BUILD/)
    assert.match(esbuild, /drivelist-container-shim\.cjs/)
    assert.match(shim, /mountpoints: \[\{ path: '\/' \}\]/)
  })

  it('publishes only loopback and requires an explicit Workspace mount', async () => {
    const compose = await readFile(new URL('compose.yaml', directory), 'utf8')
    const settings = JSON.parse(await readFile(
      new URL('docker-settings.json', directory),
      'utf8'
    ))

    assert.match(compose, /127\.0\.0\.1:3100:3100/)
    assert.match(compose, /UNILAB_WORKSPACE:\?Set UNILAB_WORKSPACE/)
    assert.match(compose, /host\.docker\.internal:30053/)
    assert.match(compose, /UNILAB_WORKBENCH_DOMAIN_MODE: backend/)
    assert.match(compose, /UNILAB_WORKSPACE_BACKEND_ENABLED: "0"/)
    assert.match(compose, /docker-settings\.json/)
    assert.deepEqual(settings['security.workspace.trust.trustedFolders'], [
      'file:///workspace'
    ])
  })
})
