import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { shouldLoadWorkbenchMaterialGraph } from './workbench-material-graph-load'
import { resolveWorkbenchModelUrl } from './workbench-model-url'

describe('Workbench material viewport layer controls', () => {
  it('gives managed graph requests bounded headroom beyond the generic client default', async () => {
    const source = await readFile(
      fileURLToPath(new URL('./workbench-connection-profile.ts', import.meta.url)),
      'utf8'
    )

    expect(source).toContain('timeoutMs: 30_000')
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

  it('forwards the shared name-label layer in the viewport adapter', async () => {
    const source = await readFile(
      fileURLToPath(new URL('./workbench-material-viewport.tsx', import.meta.url)),
      'utf8'
    )

    expect(source).toMatch(
      /renderView=\{\(\s*viewMode,\s*\{\s*showSites,\s*showMaterialTransfers,\s*showMaterialLabels\s*\}\s*\)\s*=>/u
    )
    expect(source).toContain('showMaterialLabels={showMaterialLabels}')
    expect(source).toContain(
      'useWorkbenchMaterialGraphLoad(store, readStatus.available, loadState)'
    )
  })

  it('routes the Workbench surface through the shared viewport adapter', async () => {
    const source = await readFile(
      fileURLToPath(new URL('./unilab-workbench-widget.tsx', import.meta.url)),
      'utf8'
    )

    expect(source).toContain('<WorkbenchMaterialViewport')
    expect(source).toContain(
      'attachmentRealtimeEnabled={'
    )
    expect(source).toContain(
      'services.capabilities.realtime.subscribeKinematicAttachment'
    )
  })

  it('does not show the 2.5D fallback notice over pure 3D controls', async () => {
    const source = await readFile(
      fileURLToPath(new URL('./workbench-material-viewport.tsx', import.meta.url)),
      'utf8'
    )

    expect(source).toContain("displayedViewState.mode === '2.5d'")
    expect(source).toContain("displayedViewState.mode === 'split'")
  })

  it('keeps the Theia Backend proxy prefix for root-relative model paths', () => {
    expect(resolveWorkbenchModelUrl(
      'http://127.0.0.1:3100/__unilab_backend',
      '/api/v1/kinematic-models/robot.urdf'
    )).toBe(
      'http://127.0.0.1:3100/__unilab_backend/api/v1/kinematic-models/robot.urdf'
    )
  })

  it('leaves absolute model URLs unchanged', () => {
    expect(resolveWorkbenchModelUrl(
      'http://127.0.0.1:3100/__unilab_backend',
      'http://127.0.0.1:50895/api/v1/material-models/device.glb'
    )).toBe(
      'http://127.0.0.1:50895/api/v1/material-models/device.glb'
    )
  })
})
