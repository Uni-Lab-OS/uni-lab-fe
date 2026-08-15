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
  /** 证明每个服务配置只开放已有合同、恢复和真实联调证据的能力。 */
  it.each(['local-go', 'local-python', 'cloud'])(
    'declares only verified target-contract features for %s',
    (backendId) => {
      const backend = getDefaultBackend(backendId)
      const capabilities = resolveServerCapabilities(backend)

      expect(capabilities.devices.runActionTask).toBe(
        backendId === 'local-go' || backendId === 'local-python'
      )

      for (const capability of SERVER_CAPABILITY_KEYS) {
        const localPythonCapabilities = [
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
          'inventory.readReagents'
        ]
        const localGoCapabilities = [
          'devices.listOnline',
          'devices.listActions',
          'devices.runActionTask',
          'material.readTemplates',
          'material.readGraph',
          'workflow.readDefinitions',
          'workflow.editDefinitions',
          'workflow.runTasks',
          'workflow.subscribeEvents',
          'reagentInfo.read',
          'reagentInfo.create',
          'reagentInfo.update',
          'reagentInfo.delete',
          'inventory.readReagents',
          'inventory.createReagent',
          'inventory.updateReagent',
          'inventory.deleteReagent',
          'inventory.readReagentHistory'
        ]
        const expected = backendId === 'local-python'
          ? localPythonCapabilities.includes(capability)
          : backendId === 'local-go'
            ? localGoCapabilities.includes(capability)
            : false
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
      create: false,
      update: false,
      delete: false
    })
  })

  it('keeps planned material content capabilities fail closed', () => {
    for (const backendId of ['local-go', 'local-python', 'cloud']) {
      const backend = getDefaultBackend(backendId)
      const capabilities = resolveServerCapabilities(backend)

      expect(
        hasServerCapability(
          capabilities,
          'material.readContents'
        )
      ).toBe(false)
    }
  })

  /** 证明化学品字典 CRUD 只在已完成真实联调的 Go Backend 开放。 */
  it('exposes reagent information CRUD only for the Go Backend', () => {
    const backendCapabilities = resolveServerCapabilities(
      getDefaultBackend('local-go')
    )
    const edgeCapabilities = resolveServerCapabilities(
      getDefaultBackend('local-python')
    )

    for (const capability of [
      'reagentInfo.create',
      'reagentInfo.update',
      'reagentInfo.delete'
    ] as const) {
      expect(hasServerCapability(backendCapabilities, capability)).toBe(true)
      expect(hasServerCapability(edgeCapabilities, capability)).toBe(false)
    }
  })

  /** 证明试剂写能力只对完成真实 CRUD 联调的 Go Backend 开放。 */
  it('keeps reagent mutations Backend-only', () => {
    const backendCapabilities = resolveServerCapabilities(
      getDefaultBackend('local-go')
    )
    const edgeCapabilities = resolveServerCapabilities(
      getDefaultBackend('local-python')
    )

    for (const capability of [
      'inventory.createReagent',
      'inventory.updateReagent',
      'inventory.deleteReagent',
      'inventory.readReagentHistory'
    ] as const) {
      expect(hasServerCapability(backendCapabilities, capability)).toBe(true)
      expect(hasServerCapability(edgeCapabilities, capability)).toBe(false)
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
