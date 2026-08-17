import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { validateWorkbenchFrontendBundles } from './check-workbench-frontend-bundles.mjs'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'unilab-workbench-bundles-'))
  await mkdir(join(directory, 'chunks'))
  await Promise.all([
    writeFile(join(directory, 'index.html'), '<script type="module" src="./bundle.js"></script>'),
    writeFile(join(directory, 'bundle.js'), 'import "./chunks/shared.js";\nconsole.log("ready")'),
    writeFile(join(directory, 'chunks/shared.js'), 'import "./nested.js";'),
    writeFile(join(directory, 'chunks/nested.js'), 'export const ready = true;'),
    writeFile(join(directory, 'editor.worker.js'), '(() => { self.onmessage = () => {} })();'),
    writeFile(join(directory, 'plugin-worker.js'), '(() => { self.onmessage = () => {} })();')
  ])
  return directory
}

describe('Workbench frontend bundle validation', () => {
  it('measures the transitive initial ESM graph and accepts classic workers', async () => {
    const directory = await fixture()
    const result = await validateWorkbenchFrontendBundles(directory)

    assert.equal(result.initialFiles, 3)
    assert.equal(result.javascriptFiles, 5)
    assert.ok(result.initialBytes > result.entryBytes)
  })

  it('rejects an ESM worker because Theia creates classic workers', async () => {
    const directory = await fixture()
    await writeFile(join(directory, 'plugin-worker.js'), 'import "./chunks/shared.js";')

    await assert.rejects(
      validateWorkbenchFrontendBundles(directory),
      /经典 Worker/
    )
  })

  it('rejects a main entry that exceeds its dedicated budget', async () => {
    const directory = await fixture()
    await writeFile(join(directory, 'bundle.js'), '1234567890')

    await assert.rejects(
      validateWorkbenchFrontendBundles(directory, {
        maximumEntryBytes: 5,
        maximumChunkBytes: 100,
        maximumInitialBytes: 100
      }),
      /分包未生效/
    )
  })
})
