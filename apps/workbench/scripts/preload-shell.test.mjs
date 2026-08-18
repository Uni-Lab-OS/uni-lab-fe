import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { injectWorkbenchPreloadShell } from './preload-shell.mjs'

describe('Workbench preload shell', () => {
  it('injects an inline startup surface after the generated stylesheet link', () => {
    const source = '<head><link rel="stylesheet" href="./bundle.css"></head>'
    const result = injectWorkbenchPreloadShell(source)

    assert.match(result, /id="unilab-workbench-preload-style"/)
    assert.match(result, /\.theia-preload\.theia-hidden/)
    assert.match(result, /content: "" !important/)
    assert.match(result, /font: 0\/0 sans-serif !important/)
    assert.match(result, /prefers-reduced-motion/)
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
