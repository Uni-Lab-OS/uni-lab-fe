import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  copyWorkbenchDracoAssets,
  WORKBENCH_DRACO_FILES
} from './draco-assets.mjs'

describe('Workbench Draco runtime assets', () => {
  it('copies the complete decoder closure into the browser static root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'unilab-draco-assets-'))
    const sourceDirectory = path.join(root, 'source')
    const outputDirectory = path.join(root, 'output')
    try {
      await mkdir(sourceDirectory, { recursive: true })
      await Promise.all(WORKBENCH_DRACO_FILES.map(fileName => writeFile(
        path.join(sourceDirectory, fileName),
        `fixture:${fileName}`
      )))

      const result = await copyWorkbenchDracoAssets({
        sourceDirectory,
        outputDirectory
      })

      assert.deepEqual(result.files, WORKBENCH_DRACO_FILES)
      for (const fileName of WORKBENCH_DRACO_FILES) {
        assert.equal(
          await readFile(path.join(outputDirectory, fileName), 'utf8'),
          `fixture:${fileName}`
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves every decoder file from the pinned Three.js dependency', async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), 'unilab-draco-installed-')
    )
    const result = await copyWorkbenchDracoAssets({ outputDirectory })
    try {
      for (const fileName of WORKBENCH_DRACO_FILES) {
        assert.ok(
          (await readFile(path.join(result.outputDirectory, fileName))).length > 0
        )
      }
    } finally {
      await rm(result.outputDirectory, { recursive: true, force: true })
    }
  })
})
