import { describe, expect, it } from 'vitest'

import { workbenchDeviceConnection } from './workbench-device-connection'

describe('workbenchDeviceConnection', () => {
  it('does not call a ready Workspace Backend an Edge connection', () => {
    expect(workbenchDeviceConnection('local', 'connected', 'idle'))
      .toBe('disconnected')
    expect(workbenchDeviceConnection('local', 'connected', 'failed'))
      .toBe('error')
  })

  it('reports local devices connected only after Edge is ready', () => {
    expect(workbenchDeviceConnection('local', 'connected', 'starting'))
      .toBe('connecting')
    expect(workbenchDeviceConnection('local', 'connected', 'ready'))
      .toBe('connected')
  })

  it('keeps Backend mode bound to its authority health probe', () => {
    expect(workbenchDeviceConnection('backend', 'error', 'ready'))
      .toBe('error')
  })
})
