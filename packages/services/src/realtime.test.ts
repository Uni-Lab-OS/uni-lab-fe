import { afterEach, describe, expect, it, vi } from 'vitest'

import { connectDeviceStatus } from './realtime'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('device realtime transport', () => {
  it('projects OS push_joint_state messages as typed joint frames', () => {
    const sockets: FakeWebSocket[] = []

    class FakeWebSocket {
      onopen: (() => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null
      onclose: (() => void) | null = null

      constructor(_url: string | URL) {
        sockets.push(this)
      }

      close(): void {}
    }

    vi.stubGlobal('WebSocket', FakeWebSocket)
    const onJointState = vi.fn()
    const close = connectDeviceStatus('http://127.0.0.1:18003', {
      onDeviceStatus: () => undefined,
      onJointState
    })

    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        type: 'push_joint_state',
        action: 'push_joint_state',
        schema_version: 2,
        data: {
          device_id: 'robot',
          topology_digest: 'a'.repeat(64),
          boot_id: 'edge-test',
          sequence: 42,
          observed_at: 1_723_600_000.125,
          stale_after_s: 0.25,
          joint_states: {
            robot_cr5_joint_1: 0.25,
            robot_cr5_joint_2: -0.5
          }
        }
      })
    } as MessageEvent)

    expect(onJointState).toHaveBeenCalledWith({
      deviceId: 'robot',
      topologyDigest: 'a'.repeat(64),
      bootId: 'edge-test',
      sequence: 42,
      observedAt: 1_723_600_000_125,
      staleAfterSeconds: 0.25,
      jointStates: {
        robot_cr5_joint_1: 0.25,
        robot_cr5_joint_2: -0.5
      }
    })
    close()
  })
})
