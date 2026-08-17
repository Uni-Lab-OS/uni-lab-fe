import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createApplicationPartitionEntryPoints,
  createWorkbenchBrowserBuildOptions
} from './browser-build-layout.mjs'

function options() {
  return {
    entryPoints: {
      bundle: 'frontend.js',
      'secondary-window': 'secondary.js',
      'editor.worker': 'editor-worker.js',
      'plugin-worker': 'plugin-worker.js'
    },
    plugins: [
      { name: 'copy' },
      { name: 'unilab-workbench-preload-shell' },
      { name: 'keep-me' }
    ]
  }
}

describe('Workbench browser build layout', () => {
  it('uses all generated entries as ESM partition seeds', () => {
    const { application } = createWorkbenchBrowserBuildOptions(options(), {
      'partition-seeds/000': '@theia/core'
    })

    assert.equal(application.format, 'esm')
    assert.equal(application.splitting, true)
    assert.equal(application.chunkNames, 'chunks/[name]-[hash]')
    assert.deepEqual(application.entryPoints, {
      bundle: 'frontend.js',
      'secondary-window': 'secondary.js',
      'partition-seeds/worker-editor': 'editor-worker.js',
      'partition-seeds/worker-plugin': 'plugin-worker.js',
      'partition-seeds/000': '@theia/core'
    })
  })

  it('creates stable, deduplicated partitions from generated require calls', () => {
    assert.deepEqual(createApplicationPartitionEntryPoints([
      "require('@theia/editor'); require('@theia/core')",
      "require('@theia/core')"
    ]), {
      'partition-seeds/000': '@theia/core',
      'partition-seeds/001': '@theia/editor'
    })
  })

  it('keeps workers as classic, self-contained scripts', () => {
    const { workers } = createWorkbenchBrowserBuildOptions(options())

    assert.equal(workers.format, 'iife')
    assert.equal(workers.splitting, false)
    assert.deepEqual(workers.entryPoints, {
      'editor.worker': 'editor-worker.js',
      'plugin-worker': 'plugin-worker.js'
    })
    assert.deepEqual(workers.plugins.map(plugin => plugin.name), ['keep-me'])
  })

  it('fails closed when Theia changes a required generated entry', () => {
    const incomplete = options()
    delete incomplete.entryPoints['plugin-worker']

    assert.throws(
      () => createWorkbenchBrowserBuildOptions(incomplete),
      /plugin-worker/
    )
  })
})
