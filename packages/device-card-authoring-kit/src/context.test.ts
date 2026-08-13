import { describe, expect, it } from 'vitest'

import {
  createDeviceCardAuthoringContext,
  summarizeDeviceCardAuthoringTarget
} from './context'

const target = {
  deviceId: 'robot-01',
  definition: packageDefinition(),
  title: 'Robot',
  online: true,
  actions: [{
    action: 'set_position',
    label: 'Set position',
    inputSchema: { position: { type: 'number' } },
    outputSchema: { accepted: { type: 'boolean' } },
    riskLevel: 'dangerous' as const
  }]
}

describe('device card authoring context', () => {
  it('creates a deterministic partial context from a neutral target', () => {
    const context = createDeviceCardAuthoringContext(target)

    expect(context).toMatchObject({
      schemaVersion: 'device-card-authoring-context/v2',
      deviceId: 'robot-01',
      deviceTypeId: 'community.robot_lab.robot_arm',
      sampleState: {
        online: true,
        actionBusy: { set_position: false }
      }
    })
    expect(context.stateSchema.current_position).toBeUndefined()
    expect(context.actions[0]?.riskLevel).toBe('dangerous')
    expect(summarizeDeviceCardAuthoringTarget(target))
      .toMatchObject({ contextAvailability: 'partial', actionCount: 1 })
  })

  it('keeps an explicit OS state schema authoritative', () => {
    const context = createDeviceCardAuthoringContext({
      ...target,
      stateSchema: {
        temperature: {
          type: 'number',
          source: 'driver',
          status: 'resolved'
        }
      },
      sampleState: { temperature: 22 }
    })

    expect(context.stateSchema).toEqual({
      temperature: {
        type: 'number',
        source: 'driver',
        status: 'resolved'
      },
      online: {
        type: 'boolean',
        source: 'host',
        status: 'resolved'
      },
      actionBusy: {
        type: 'object',
        source: 'host',
        status: 'resolved'
      }
    })
    expect(summarizeDeviceCardAuthoringTarget({
      ...target,
      stateSchema: context.stateSchema
    }).contextAvailability).toBe('ready')
  })
})

/**
 * 构造测试用领域设备包定义。
 *
 * @returns 含规范 FQID 与完整 PackageCatalog 摘要证据的定义引用。
 */
function packageDefinition() {
  return {
    fqid: 'community.robot_lab.robot_arm',
    version: '1.0.0',
    contentHash: `sha256:${'1'.repeat(64)}`,
    sourceIdentity: 'robot_lab.devices.robot:RobotArm',
    title: 'Robot',
    description: '',
    category: ['robot'],
    manufacturer: 'Uni-Lab',
    packageCatalog: {
      schemaVersion: '1' as const,
      distribution: {
        name: 'robot-lab',
        normalizedName: 'robot_lab',
        version: '0.1.0'
      },
      importPackage: 'robot_lab',
      namespace: 'community.robot_lab',
      contentDigest: `sha256:${'2'.repeat(64)}`,
      catalogDigest: `sha256:${'3'.repeat(64)}`
    }
  }
}
