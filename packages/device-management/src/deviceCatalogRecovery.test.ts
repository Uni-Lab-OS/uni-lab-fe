import { describe, expect, it } from 'vitest'

import { deviceCatalogRecoveryDelay } from './deviceCatalogRecovery'

describe('device catalog recovery', () => {
  it('retries a successful startup snapshot while every device is offline', () => {
    expect(deviceCatalogRecoveryDelay({
      attempt: 0,
      backendEnabled: true,
      connection: 'connected',
      lastUpdated: 1,
      devices: [{ online: false }, { online: false }]
    })).toBe(1_000)
    expect(deviceCatalogRecoveryDelay({
      attempt: 3,
      backendEnabled: true,
      connection: 'connected',
      lastUpdated: 1,
      devices: []
    })).toBe(8_000)
  })

  it('stops when one device is online or the bounded recovery is exhausted', () => {
    expect(deviceCatalogRecoveryDelay({
      attempt: 0,
      backendEnabled: true,
      connection: 'connected',
      lastUpdated: 1,
      devices: [{ online: false }, { online: true }]
    })).toBeNull()
    expect(deviceCatalogRecoveryDelay({
      attempt: 6,
      backendEnabled: true,
      connection: 'connected',
      lastUpdated: 1,
      devices: [{ online: false }]
    })).toBeNull()
  })

  it('does not poll before the first successful read or while disconnected', () => {
    expect(deviceCatalogRecoveryDelay({
      attempt: 0,
      backendEnabled: true,
      connection: 'connected',
      lastUpdated: null,
      devices: []
    })).toBeNull()
    expect(deviceCatalogRecoveryDelay({
      attempt: 0,
      backendEnabled: true,
      connection: 'disconnected',
      lastUpdated: 1,
      devices: [{ online: false }]
    })).toBeNull()
  })
})
