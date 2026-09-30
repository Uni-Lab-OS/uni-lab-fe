import { describe, expect, it } from 'vitest'
import { createProductHostAssembly, HOST_ASSEMBLY_EVALUATION } from './host'
import type { RequestTransport } from '../transport/request'

describe('product host assembly seam', () => {
  it('reuses the same core ports for each host kind', () => {
    const transport: RequestTransport = {
      async request() {
        return { status: 200, headers: {}, data: {} }
      },
    }
    const browser = createProductHostAssembly({
      kind: 'browser',
      transport,
    })
    const desktop = createProductHostAssembly({
      kind: 'desktop',
      transport,
    })
    const workbench = createProductHostAssembly({
      kind: 'workbench',
      transport,
    })

    expect(browser.host.capabilities).toEqual(['web_session'])
    expect(desktop.host.capabilities).toEqual(['window_lifecycle', 'local_process_bridge'])
    expect(workbench.host.capabilities).toEqual(['workspace', 'theia_extension'])
    expect(browser.core.runPreparation).toBeDefined()
    expect(browser.core.workflowDebugging).toBeDefined()
    expect(desktop.core.deviceActionDebugging).toBeDefined()
    expect(workbench.core.laboratoryOperations).toBeDefined()
    expect(desktop.core.workflowDefinitions).toBeDefined()
    expect(workbench.core.executionRead).toBeDefined()
    expect(HOST_ASSEMBLY_EVALUATION.browser.transport).toBe('FetchTransport')
  })
})
