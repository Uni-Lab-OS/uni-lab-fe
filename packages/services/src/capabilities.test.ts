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

const OS_CAPABILITIES = [
  'devices.listOnline',
  'devices.listActions',
  'devices.subscribeStatus',
  'devices.forceUnlock',
  'devices.runActionTask',
  'material.readGraph',
  'workflow.readDefinitions',
  'workflow.authoring',
  'workflow.runTasks',
  'workflow.subscribeEvents',
  'workflow.recovery',
  'reagentInfo.read',
  'reagentInfo.create',
  'reagentInfo.update',
  'reagentInfo.delete',
  'inventory.readReagents',
  'inventory.createReagent',
  'inventory.updateReagent',
  'inventory.deleteReagent',
  'inventory.dispenseReagent',
  'inventory.readReagentHistory'
] as const

describe('server capability matrix', () => {
  it.each(['local-python', 'local-go', 'cloud', 'custom'])(
    'uses the Uni-Lab-OS capability matrix for %s',
    (backendId) => {
      const backend = backendId === 'custom'
        ? { id: 'custom', name: 'Custom server' }
        : getDefaultBackend(backendId)
      const capabilities = resolveServerCapabilities(backend)

      for (const capability of SERVER_CAPABILITY_KEYS) {
        const expected = OS_CAPABILITIES.includes(
          capability as (typeof OS_CAPABILITIES)[number]
        )
        expect(hasServerCapability(capabilities, capability)).toBe(expected)
        const status = getCapabilityStatus(backend, capabilities, capability)
        expect(status.available).toBe(expected)
        expect(status.reason == null).toBe(expected)
      }
    }
  )

  it('keeps planned material content capabilities fail closed', () => {
    const capabilities = resolveServerCapabilities(getDefaultBackend())
    expect(hasServerCapability(capabilities, 'material.readContents')).toBe(false)
  })

  it('exposes reagent information and inventory mutations on OS', () => {
    const capabilities = resolveServerCapabilities(getDefaultBackend())
    for (const capability of [
      'reagentInfo.create',
      'reagentInfo.update',
      'reagentInfo.delete',
      'inventory.createReagent',
      'inventory.updateReagent',
      'inventory.deleteReagent',
      'inventory.readReagentHistory'
    ] as const) {
      expect(hasServerCapability(capabilities, capability)).toBe(true)
    }
  })

  it('throws one typed error for defensive action checks', () => {
    const backend = getDefaultBackend()
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
