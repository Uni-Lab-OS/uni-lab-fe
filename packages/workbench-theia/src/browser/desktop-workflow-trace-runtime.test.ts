import { describe, expect, it, vi } from 'vitest'

import { desktopWorkflowTraceRuntime } from './desktop-workflow-trace-runtime'

describe('desktopWorkflowTraceRuntime', () => {
  it('returns the Electron observability bridge when trace methods exist', () => {
    const observability = {
      listTraces: vi.fn(),
      getTrace: vi.fn(),
      recordHttpRequest: vi.fn()
    }

    expect(desktopWorkflowTraceRuntime({ api: { observability } }))
      .toBe(observability)
    expect(desktopWorkflowTraceRuntime({ window: { api: { observability } } }))
      .toBe(observability)
  })

  it('keeps Trace unavailable outside the Electron preload environment', () => {
    expect(desktopWorkflowTraceRuntime({
      location: { search: '?workbenchConnection=backend' }
    })).toBeUndefined()
    expect(desktopWorkflowTraceRuntime({
      api: { observability: {} },
      location: { search: '?workbenchConnection=backend' }
    }))
      .toBeUndefined()
  })

  it('keeps a lazy Trace entry in Desktop mode until preload is ready', async () => {
    const runtime = desktopWorkflowTraceRuntime({ location: { search: '' } })

    expect(runtime).toBeDefined()
    await expect(runtime?.listTraces()).rejects.toThrow(
      'Desktop Trace 服务尚未就绪'
    )
  })
})
