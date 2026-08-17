import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  enableWorkbenchModuleEntry,
  injectWorkbenchPreloadShell,
  prepareWorkbenchFrontendHtml
} from './preload-shell.mjs'

describe('Workbench preload shell', () => {
  it('injects an inline startup surface after the generated stylesheet link', () => {
    const source = '<head><link rel="stylesheet" href="./bundle.css"></head>'
    const result = injectWorkbenchPreloadShell(source)

    assert.match(result, /id="unilab-workbench-preload-style"/)
    assert.match(result, /\.theia-preload\.theia-hidden/)
    assert.ok(result.indexOf('bundle.css') < result.indexOf('unilab-workbench-preload-style'))
  })

  it('is idempotent when the build hook runs more than once', () => {
    const source = '<head><link rel="stylesheet" href="./bundle.css"></head>'
    const once = injectWorkbenchPreloadShell(source)

    assert.equal(injectWorkbenchPreloadShell(once), once)
  })

  it('fails closed when Theia changes the generated HTML contract', () => {
    assert.throws(
      () => injectWorkbenchPreloadShell('<head></head>'),
      /bundle\.css/
    )
  })
})

describe('Workbench ESM entry', () => {
  const classicEntry = '<script type="text/javascript" src="./bundle.js" charset="utf-8"></script>'

  it('changes only the generated main entry to a module script', () => {
    assert.equal(
      enableWorkbenchModuleEntry(classicEntry),
      '<script type="module" src="./bundle.js" charset="utf-8"></script>'
    )
  })

  it('prepares the preload surface and module entry together', () => {
    const source = `<head><link rel="stylesheet" href="./bundle.css"></head>${classicEntry}`
    const result = prepareWorkbenchFrontendHtml(source)

    assert.match(result, /id="unilab-workbench-preload-style"/)
    assert.match(result, /<script type="module" src="\.\/bundle\.js"/)
    assert.equal(prepareWorkbenchFrontendHtml(result), result)
  })

  it('fails closed when Theia changes the generated script contract', () => {
    assert.throws(
      () => enableWorkbenchModuleEntry('<script src="./other.js"></script>'),
      /bundle\.js/
    )
  })
})
