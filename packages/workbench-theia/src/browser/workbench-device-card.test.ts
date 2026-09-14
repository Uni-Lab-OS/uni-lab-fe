import { describe, expect, it } from 'vitest'

import type {
  DeviceCatalogItem,
  DeviceJointStateFrame
} from '@unilab/services'

import type { DevicePackageCardProject } from '@unilab/device-card-sdk'

import {
  buildDeviceCardRuntimeState,
  buildOfflinePreviewDevice,
  shouldSubscribeDeviceStatus,
  shouldSubscribeJointState
} from './workbench-device-card'

describe('通用设备卡片运行时状态', () => {
  it('把关节状态 SSE 完整帧投影到独立 jointState 键', () => {
    const device: DeviceCatalogItem = {
      actions: [],
      deviceId: 'robot',
      deviceKey: 'robot',
      deviceTypeId: 'robot',
      label: 'pTLC Robot',
      materialUuid: 'material-robot',
      namespace: 'ptlc',
      online: true
    }
    const frame: DeviceJointStateFrame = {
      acceptedRef: 'edge:robot',
      bootId: 'boot-a',
      deviceId: 'robot',
      jointStates: { robot_cr5_joint_1: 0.5 },
      materialId: 'material-robot',
      observedAt: 123,
      sequence: 9,
      stale: false,
      staleAfterSeconds: 2,
      topologyDigest: 'digest-a'
    }

    expect(buildDeviceCardRuntimeState(device, null, frame)).toMatchObject({
      jointState: {
        jointStates: { robot_cr5_joint_1: 0.5 },
        sequence: 9,
        stale: false
      },
      online: true
    })
  })

  it('把 authoring 快照投影为离线预览目录项', () => {
    const project: DevicePackageCardProject = {
      projectDir: '/tmp/mixer-robot-card',
      id: 'szlab.mixer-robot-card',
      version: '1.0.0',
      title: 'SZLab Mixer CR20 / 导轨调试卡片',
      deviceTypes: ['community.szlab_poly_studio.szlab_mixer_robot'],
      deviceId: 'szlab_mixer_robot',
      authoringPreview: {
        deviceTypeId: 'community.szlab_poly_studio.szlab_mixer_robot',
        deviceId: 'szlab_mixer_robot',
        title: 'SZLab Mixer CR20 / 导轨调试卡片',
        actions: [{
          action: 'home',
          label: '回原点',
          inputSchema: {},
          outputSchema: {},
          riskLevel: 'dangerous'
        }],
        stateSchema: { moveit_online: { type: 'boolean' } },
        sampleState: { moveit_online: true, online: true }
      }
    }

    expect(buildOfflinePreviewDevice(project)).toMatchObject({
      deviceId: 'szlab_mixer_robot',
      deviceTypeId: 'community.szlab_poly_studio.szlab_mixer_robot',
      online: false,
      actions: [{ actionName: 'home', label: '回原点' }]
    })
  })

  it('分别按设备属性与关节状态能力建立订阅', () => {
    const capabilities = {
      devices: { subscribeStatus: false },
      realtime: { subscribeJointState: true }
    } as unknown as Parameters<typeof shouldSubscribeJointState>[0]

    expect(shouldSubscribeDeviceStatus(capabilities)).toBe(false)
    expect(shouldSubscribeJointState(capabilities)).toBe(true)
  })
})
