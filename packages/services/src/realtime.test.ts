import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  connectJointStates,
  parseJointStateMessage,
  toJointStateUrl
} from './realtime'

describe('joint-state realtime service', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the dedicated OS WebSocket route', () => {
    expect(toJointStateUrl('http://127.0.0.1:18003')).toBe(
      'ws://127.0.0.1:18003/api/v1/ws/joint_states'
    )
    expect(toJointStateUrl(
      'ws://127.0.0.1:18003/ws/joint_states'
    )).toBe('ws://127.0.0.1:18003/api/v1/ws/joint_states')
  })

  it('delivers exact typed frames without reading or reloading Material Graph', () => {
    const sockets: FakeWebSocket[] = []
    vi.stubGlobal('WebSocket', class extends FakeWebSocket {
      constructor(url: URL | string) {
        super(url)
        sockets.push(this)
      }
    })
    const onJointState = vi.fn()
    const close = connectJointStates('http://127.0.0.1:18003', {
      onJointState
    })
    sockets[0].emit(JSON.stringify({
      node_uuid: '11111111-1111-4111-8111-111111111111',
      joint_states: { rotary_joint: 0.52, linear_joint: 0.18 }
    }))

    expect(onJointState).toHaveBeenCalledWith({
      node_uuid: '11111111-1111-4111-8111-111111111111',
      joint_states: { rotary_joint: 0.52, linear_joint: 0.18 }
    })
    expect(sockets).toHaveLength(1)
    close()
    expect(sockets[0].close).toHaveBeenCalledOnce()
  })

  it('rejects non-finite values and diagnoses the complete frame', () => {
    const sockets: FakeWebSocket[] = []
    vi.stubGlobal('WebSocket', class extends FakeWebSocket {
      constructor(url: URL | string) {
        super(url)
        sockets.push(this)
      }
    })
    const onJointState = vi.fn()
    const onDiagnostic = vi.fn()
    const close = connectJointStates('http://127.0.0.1:18003', {
      onJointState,
      onDiagnostic
    })
    sockets[0].emit(
      '{"node_uuid":"11111111-1111-4111-8111-111111111111","joint_states":{"linear_joint":1e400}}'
    )

    expect(onJointState).not.toHaveBeenCalled()
    expect(onDiagnostic).toHaveBeenCalledWith({
      code: 'invalid_joint_state_frame',
      message: expect.stringContaining('finite number')
    })
    close()
  })

  it('fails closed on extra envelope fields', () => {
    expect(() => parseJointStateMessage(JSON.stringify({
      node_uuid: '11111111-1111-4111-8111-111111111111',
      joint_states: {},
      material_revision: 4
    }))).toThrow(/only node_uuid and joint_states/)
  })

  it('rejects a non-canonical runtime UUID', () => {
    expect(() => parseJointStateMessage(JSON.stringify({
      node_uuid: 'turntable-a',
      joint_states: {}
    }))).toThrow(/canonical UUID/)
  })
})

class FakeWebSocket {
  readonly close = vi.fn()
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: URL | string) {}

  emit(data: unknown): void {
    this.onmessage?.({ data })
  }
}
