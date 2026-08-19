import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { shouldLoadWorkbenchMaterialGraph } from './workbench-material-graph-load'

const materialViewportConsumers = [
  './workbench-material-viewport.tsx',
  './unilab-workbench-widget.tsx'
] as const

describe('Workbench material viewport layer controls', () => {
  it('gives managed graph requests bounded headroom beyond the generic client default', async () => {
    const source = await readFile(
      fileURLToPath(new URL('./unilab-workbench-widget.tsx', import.meta.url)),
      'utf8'
    )

    expect(source).toContain('timeoutMs: 120_000')
  })

  it('allows one bounded recovery after an initial graph load failure', () => {
    expect(shouldLoadWorkbenchMaterialGraph({
      available: true,
      loadState: 'idle',
      errorRecoveryAttempted: false
    })).toBe(true)
    expect(shouldLoadWorkbenchMaterialGraph({
      available: true,
      loadState: 'error',
      errorRecoveryAttempted: false
    })).toBe(true)
    expect(shouldLoadWorkbenchMaterialGraph({
      available: true,
      loadState: 'error',
      errorRecoveryAttempted: true
    })).toBe(false)
    expect(shouldLoadWorkbenchMaterialGraph({
      available: false,
      loadState: 'idle',
      errorRecoveryAttempted: false
    })).toBe(false)
    expect(shouldLoadWorkbenchMaterialGraph({
      available: true,
      loadState: 'loading',
      errorRecoveryAttempted: false
    })).toBe(false)
    expect(shouldLoadWorkbenchMaterialGraph({
      available: true,
      loadState: 'ready',
      errorRecoveryAttempted: false
    })).toBe(false)
  })

  it.each(materialViewportConsumers)(
    'forwards the shared name-label layer in %s',
    async (relativePath) => {
      const source = await readFile(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        'utf8'
      )

      expect(source).toMatch(
        /renderView=\{\(viewMode,\s*\{\s*showSites,\s*showMaterialTransfers,\s*showMaterialLabels\s*\}\)\s*=>/u
      )
      expect(source).toContain('showMaterialLabels={showMaterialLabels}')
      expect(source).toContain(
        'useWorkbenchMaterialGraphLoad(store, readStatus.available, loadState)'
      )
    }
  )
})
