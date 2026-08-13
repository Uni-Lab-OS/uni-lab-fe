import { describe, expect, it } from 'vitest'

import type { DeviceCardRuntimeSnapshot } from '@unilab/device-card-sdk'
import { createDeviceCardJointPreview } from './deviceCardJointPreview'

describe('device card joint preview', () => {
  it('binds a Mock frame to the host-selected Material', () => {
    expect(createDeviceCardJointPreview(context(), {
      arm_base_joint: 0.85,
      cr7_joint_1: Math.PI / 2
    }, 42)).toEqual({
      materialId: 'material-robot',
      jointStates: {
        arm_base_joint: 0.85,
        cr7_joint_1: Math.PI / 2
      },
      updatedAt: 42
    })
  })

  it('rejects Live writes and invalid values', () => {
    expect(() => createDeviceCardJointPreview({
      ...context(),
      mode: 'live'
    }, { cr7_joint_1: 0 })).toThrow('Live 模式禁止')
    expect(() => createDeviceCardJointPreview(
      context(),
      { cr7_joint_1: Number.NaN }
    )).toThrow('数值无效')
    expect(() => createDeviceCardJointPreview(context(), {}))
      .toThrow('不能为空')
  })
})

function context(): DeviceCardRuntimeSnapshot {
  return {
    mode: 'mock',
    device: {
      deviceId: null,
      materialId: 'material-robot',
      definitionFqid: 'community.example.robot',
      deviceTypeId: 'community.example.robot',
      title: 'Robot',
      definition: {
        fqid: 'community.example.robot',
        version: '1.0.0',
        contentHash: 'sha256:model',
        sourceIdentity: 'example.robot:Robot',
        title: 'Robot',
        description: '',
        category: ['robotic_arm'],
        manufacturer: '',
        packageCatalog: {
          schemaVersion: '1',
          distribution: {
            name: 'example',
            normalizedName: 'example',
            version: '1.0.0'
          },
          importPackage: 'example',
          namespace: 'community.example',
          contentDigest: 'sha256:content',
          catalogDigest: 'sha256:catalog'
        }
      }
    },
    state: {},
    config: {},
    theme: 'light',
    locale: 'zh-CN'
  }
}
