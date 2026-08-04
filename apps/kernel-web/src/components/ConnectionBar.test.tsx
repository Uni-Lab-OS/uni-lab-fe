import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { disconnect, reconnect, useWorkbench } = vi.hoisted(() => ({
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  useWorkbench: vi.fn()
}))

vi.mock('../context/WorkbenchContext', () => ({
  useWorkbench
}))

vi.mock('../hooks/useBackendConnection', () => ({
  useBackendConnection: () => ({
    client: null,
    isOnline: true,
    disconnect,
    reconnect
  })
}))

import ConnectionBar from './ConnectionBar'

describe('ConnectionBar', () => {
  beforeEach(() => {
    useWorkbench.mockReturnValue({
      backend: {
        id: 'local-python',
        name: 'Local Python OS',
        serverKind: 'edge',
        apiUrl: 'http://127.0.0.1:8002'
      },
      backendEnabled: true,
      connection: 'connected',
      availableBackends: [
        {
          id: 'local-python',
          name: 'Local Python OS',
          serverKind: 'edge',
          apiUrl: 'http://127.0.0.1:8002'
        }
      ],
      selectBackend: vi.fn(),
      updateBackend: vi.fn(),
      setBackendEnabled: vi.fn()
    })
  })

  it('keeps the confirmed connection status visible', () => {
    const markup = renderToStaticMarkup(<ConnectionBar />)

    expect(markup).toContain('Edge 已连接')
    expect(markup).toContain('data-connection-state="connected"')
  })

  it('offers an explicit connection path while the managed Edge is idle', () => {
    useWorkbench.mockReturnValue({
      ...useWorkbench(),
      backendEnabled: false,
      connection: 'disconnected'
    })

    const markup = renderToStaticMarkup(<ConnectionBar />)

    expect(markup).toContain('Edge 未连接')
    expect(markup).toContain('>连接</button>')
  })
})
