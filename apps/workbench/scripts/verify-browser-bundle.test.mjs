import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { verifyBrowserBundle } from './verify-browser-bundle.mjs'

const temporaryDirectories = []

async function fixture({ moduleEntry = true, chunks = true, workerImport = false } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unilab-workbench-bundle-'))
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, 'chunks'))
  await Promise.all([
    writeFile(path.join(directory, 'index.html'), moduleEntry
      ? '<script type="module" src="./bundle.js" charset="utf-8"></script>'
      : '<script type="text/javascript" src="./bundle.js" charset="utf-8"></script>'),
    writeFile(
      path.join(directory, 'bundle.js'),
      'import "./chunks/shared.js";container.load(containerModule.default?.registry ? containerModule.default : containerModule.default?.default)'
    ),
    writeFile(path.join(directory, 'editor.worker.js'), workerImport ? 'import "./chunks/shared.js"' : 'self.onmessage = () => {}'),
    writeFile(path.join(directory, 'plugin-worker.js'), 'self.onmessage = () => {}'),
    ...(chunks ? [writeFile(path.join(directory, 'chunks', 'shared.js'), 'export const shared = true')] : []),
  ])
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true,
  })))
})

describe('Workbench browser bundle verifier', () => {
  it('accepts a split module application with classic workers', async () => {
    const report = await verifyBrowserBundle(await fixture())

    assert.equal(report.chunkCount, 1)
    assert.equal(report.javascriptFileCount, 4)
  })

  it('rejects a monolithic browser build', async () => {
    await assert.rejects(
      verifyBrowserBundle(await fixture({ chunks: false })),
      /没有生成 JavaScript 分块/,
    )
  })

  it('rejects a classic-script entry or a split worker', async () => {
    await assert.rejects(
      verifyBrowserBundle(await fixture({ moduleEntry: false })),
      /模块化 bundle\.js/,
    )
    await assert.rejects(
      verifyBrowserBundle(await fixture({ workerImport: true })),
      /worker\.js.*ESM 分块/,
    )
  })
})
