import { describe, expect, it } from 'vitest'

import { getDefaultBackend } from './backends'
import {
  SERVER_CAPABILITY_KEYS,
  getCapabilityStatus,
  hasServerCapability,
  resolveServerCapabilities
} from './capabilities'
import {
  UnsupportedCapabilityError,
  assertCapability
} from './errors'

describe('server capability matrix', () => {
  it.each(['local-go', 'local-python', 'cloud'])(
    'declares only verified target-contract features for %s',
    (backendId) => {
      const backend = getDefaultBackend(backendId)
      const capabilities = resolveServerCapabilities(backend)

      expect(capabilities.devices.runActionTask).toBe(
        backendId === 'local-python'
      )

      for (const capability of SERVER_CAPABILITY_KEYS) {
        const expected =
          (backendId === 'local-python' &&
            (capability === 'devices.listActions' ||
              capability === 'devices.subscribeStatus' ||
              capability === 'devices.forceUnlock' ||
              capability === 'devices.runActionTask' ||
              capability === 'material.readGraph'))
        expect(hasServerCapability(capabilities, capability)).toBe(expected)

        const status = getCapabilityStatus(
          backend,
          capabilities,
          capability
        )
        expect(status.available).toBe(expected)
        expect(status.reason == null).toBe(expected)
      }
    }
  )

  it('denies unknown profiles by default', () => {
    const backend = { id: 'custom', name: 'Custom server' }
    const capabilities = resolveServerCapabilities(backend)

    expect(capabilities.material.readGraph).toBe(false)
    expect(
      getCapabilityStatus(
        backend,
        capabilities,
        'material.readGraph'
      ).reason
    ).toContain('尚未声明')
    expect(capabilities.material.readContents).toBe(false)
    expect(capabilities.material.deleteSubtrees).toBe(false)
    expect(capabilities.reagentInfo).toEqual({
      read: false,
      create: false
    })
  })

  it('keeps planned content and reagent capabilities fail closed', () => {
    for (const backendId of ['local-go', 'local-python', 'cloud']) {
      const backend = getDefaultBackend(backendId)
      const capabilities = resolveServerCapabilities(backend)

      expect(
        hasServerCapability(
          capabilities,
          'material.readContents'
        )
      ).toBe(false)
      expect(
        hasServerCapability(capabilities, 'reagentInfo.create')
      ).toBe(false)
    }
  })

  it('throws one typed error for defensive action checks', () => {
    const backend = getDefaultBackend('local-python')
    const capabilities = resolveServerCapabilities(backend)
    const status = getCapabilityStatus(
      backend,
      capabilities,
      'realtime.setJointState'
    )

    expect(() =>
      assertCapability(status, 'realtime.setJointState')
    ).toThrow(UnsupportedCapabilityError)

    try {
      assertCapability(status, 'realtime.setJointState')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'UNSUPPORTED_CAPABILITY',
        capability: 'realtime.setJointState',
        retryable: false
      })
    }
  })
})
