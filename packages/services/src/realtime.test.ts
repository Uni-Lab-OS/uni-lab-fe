import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import {
  createRealtimeService,
  toDeviceTelemetryUrl
} from './realtime'

const digest = 'a'.repeat(64)

class FakeEventSource extends EventTarget {
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  readonly url: string
  readyState = 1

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    FakeEventSource.instances.push(this)
  }

  close(): void { this.readyState = FakeEventSource.CLOSED }

  send(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }))
  }
}

function telemetry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    material_uuid: '3aeb8e29-4ea7-462f-985f-fb5f8f3b9f42',
    local_device_id: 'robot-01',
    telemetry_type: 'joint_state',
    boot_id: 'boot-1',
    sequence: 1,
    accepted_ref: 'sha256:accepted-1',
    observed_at: '2026-08-15T12:00:00.000000Z',
    stale_after_s: 1,
    stale: false,
    data: {
      topology_digest: digest,
      joint_states: { robot_joint_1: 0.25 }
    },
    ...overrides
  }
}

function attachmentTelemetry(): Record<string, unknown> {
  return telemetry({
    telemetry_type: 'kinematic_attachment',
    boot_id: 'robot-boot-1',
    sequence: 7,
    stale_after_s: 2,
    data: {
      schema_version: 1,
      kind: 'material_payload',
      child_ref: 'material-beaker',
      parent_ref: 'material-gripper',
      anchor: { kind: 'link', link_name: 'grasp_frame' },
      local_pose: {
        xyz_m: [0, 0, 0.08],
        orientation_xyzw: [0, 0, 0, 2]
      },
      state: 'attached',
      evidence: 'controller_confirmed',
      attachment_generation: 3,
      source: 'robot-runtime',
      source_boot_id: 'robot-boot-1',
      monotonic_sequence: 7,
      context_digest: 'b'.repeat(64)
    }
  })
}

afterEach(() => {
  FakeEventSource.instances = []
  vi.unstubAllGlobals()
})

describe('统一设备遥测（DeviceTelemetry）SSE', () => {
  it('把两个旧 WebSocket 地址单向迁移到 SSE', () => {
    expect(toDeviceTelemetryUrl('ws://127.0.0.1:18003/api/v1/ws/device_status'))
      .toBe('http://127.0.0.1:18003/api/v1/device-telemetry/events')
    expect(toDeviceTelemetryUrl('ws://127.0.0.1:18003/api/v1/edge/ws'))
      .toBe('http://127.0.0.1:18003/api/v1/device-telemetry/events')
  })

  it('通用卡片与 Pascal 共用一条连接', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const service = createRealtimeService(getDefaultBackend('local-python'))
    const closeStatus = service.subscribeDeviceStatus({ onDeviceStatus: vi.fn() })
    const closeJoint = service.subscribeJointState({ onJointState: vi.fn() })
    const closeAttachment = service.subscribeKinematicAttachment({
      onAttachment: vi.fn()
    })
    expect(FakeEventSource.instances).toHaveLength(1)
    closeStatus()
    closeJoint()
    closeAttachment()
    expect(FakeEventSource.instances[0]?.readyState).toBe(FakeEventSource.CLOSED)
  })

  it('严格解析工具/物料附着并归一化四元数', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const service = createRealtimeService(getDefaultBackend('local-python'))
    const onAttachment = vi.fn()
    service.subscribeKinematicAttachment({ onAttachment })
    FakeEventSource.instances[0]?.send(
      'device.telemetry.changed', attachmentTelemetry()
    )
    expect(onAttachment).toHaveBeenCalledWith(expect.objectContaining({
      childRef: 'material-beaker',
      parentRef: 'material-gripper',
      evidence: 'controller_confirmed',
      localPose: {
        xyzM: [0, 0, 0.08],
        orientationXyzw: [0, 0, 0, 1]
      }
    }))
  })

  it('严格投影属性和关节快照并给迟到订阅者重放', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const service = createRealtimeService(getDefaultBackend('local-python'))
    const statuses = vi.fn()
    const joints = vi.fn()
    service.subscribeDeviceStatus({ onDeviceStatus: statuses })
    service.subscribeJointState({ onJointState: joints })
    FakeEventSource.instances[0]?.send('device.telemetry.snapshot', {
      items: [
        telemetry({
          telemetry_type: 'device_properties',
          stale_after_s: null,
          data: {
            properties: { moveit_online: true },
            property_observed_at: {
              moveit_online: '2026-08-15T12:00:00.000000Z'
            }
          }
        }),
        telemetry()
      ]
    })
    expect(statuses).toHaveBeenLastCalledWith([{
      deviceId: 'robot-01',
      status: { moveit_online: true },
      timestamp: 1_786_795_200_000
    }])
    expect(joints).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'robot-01',
      topologyDigest: digest,
      acceptedRef: 'sha256:accepted-1',
      jointStates: { robot_joint_1: 0.25 }
    }))
    const late = vi.fn()
    service.subscribeJointState({ onJointState: late })
    expect(late).toHaveBeenCalledOnce()
  })

  it('快照替换会向 Pascal 发布空快照以清除幽灵姿态', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const service = createRealtimeService(getDefaultBackend('local-python'))
    const onSnapshot = vi.fn()
    service.subscribeJointState({ onJointState: vi.fn(), onSnapshot })
    FakeEventSource.instances[0]?.send('device.telemetry.snapshot', {
      items: [telemetry()]
    })
    FakeEventSource.instances[0]?.send('device.telemetry.snapshot', { items: [] })
    expect(onSnapshot).toHaveBeenLastCalledWith([])
  })

  it('拒绝带额外字段的漂移合同', () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    const service = createRealtimeService(getDefaultBackend('local-python'))
    const onJointState = vi.fn()
    const onError = vi.fn()
    service.subscribeJointState({ onJointState, onError })
    FakeEventSource.instances[0]?.send('device.telemetry.changed', telemetry({
      extra: true
    }))
    expect(onJointState).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('设备遥测更新合同无效')
  })
})
