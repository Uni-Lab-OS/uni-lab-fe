import { describe, expect, it } from 'vitest'

import { unwrapAngleRad } from './jointAngleUnwrap'
import {
  JointStateRingBuffer,
  JOINT_STATE_RENDER_DELAY_MS
} from './jointStateRingBuffer'
import type { JointStateFrameLike } from './jointStateRingBuffer'

const digest = 'a'.repeat(64)

function frame(
  overrides: Partial<JointStateFrameLike> & Pick<JointStateFrameLike, 'sequence' | 'observedAt' | 'jointStates'>
): JointStateFrameLike {
  return {
    materialId: 'material-robot',
    deviceId: 'robot',
    topologyDigest: digest,
    bootId: 'boot-1',
    stale: false,
    ...overrides
  }
}

describe('JointStateRingBuffer', () => {
  it('Edge observedAt 与 wall clock 漂移时仍可插值', () => {
    const base = 1_700_000_000_000
    const skew = 314_000
    const buffer = new JointStateRingBuffer({ delayMs: 100, staleMs: 500 })
    buffer.push(frame({
      sequence: 1,
      observedAt: base - skew,
      jointStates: { robot_joint_1: 0 }
    }), base)
    buffer.push(frame({
      sequence: 2,
      observedAt: base - skew + 100,
      jointStates: { robot_joint_1: 1 }
    }), base + 100)

    const middle = buffer.sample(base + 175)
    expect(middle.jointStates?.robot_joint_1).toBeCloseTo(0.75, 6)
    expect(middle.stale).toBe(false)
  })

  it('在 100ms 延迟下于缓冲内插值', () => {
    const base = 1_700_000_000_000
    const buffer = new JointStateRingBuffer({ delayMs: 100, staleMs: 500 })
    buffer.push(frame({
      sequence: 1,
      observedAt: base,
      jointStates: { robot_joint_1: 0 }
    }), base)
    buffer.push(frame({
      sequence: 2,
      observedAt: base + 100,
      jointStates: { robot_joint_1: 1 }
    }), base + 100)

    const middle = buffer.sample(base + 175)
    expect(middle.jointStates?.robot_joint_1).toBeCloseTo(0.75, 6)
    expect(middle.stale).toBe(false)
  })

  it('乱序帧重排后仍连续插值', () => {
    const base = 1_700_000_000_000
    const buffer = new JointStateRingBuffer({ delayMs: 100, staleMs: 500 })
    const deg170 = (170 * Math.PI) / 180
    const deg180 = Math.PI
    const degMinus170 = (-170 * Math.PI) / 180

    buffer.push(frame({
      sequence: 1,
      observedAt: base,
      jointStates: { robot_joint_1: deg170 }
    }), base)
    buffer.push(frame({
      sequence: 3,
      observedAt: base + 100,
      jointStates: { robot_joint_1: degMinus170 }
    }), base + 100)
    buffer.push(frame({
      sequence: 2,
      observedAt: base + 50,
      jointStates: { robot_joint_1: deg180 }
    }), base + 100)

    const middle = buffer.sample(base + 175)
    expect(middle.jointStates?.robot_joint_1).toBeCloseTo((185 * Math.PI) / 180, 6)
  })

  it('断流后冻结末帧，重连首帧直跳', () => {
    const base = 1_700_000_000_000
    const buffer = new JointStateRingBuffer({ delayMs: 100, staleMs: 500 })
    buffer.push(frame({
      sequence: 1,
      observedAt: base,
      jointStates: { robot_joint_1: 1.2 }
    }), base)

    const stale = buffer.sample(base + 701)
    expect(stale.stale).toBe(true)
    expect(stale.jointStates?.robot_joint_1).toBeCloseTo(1.2, 6)

    buffer.push(frame({
      sequence: 2,
      observedAt: base + 800,
      jointStates: { robot_joint_1: 0.5 }
    }), base + 800)
    const reconnected = buffer.sample(base + 800)
    expect(reconnected.jointStates?.robot_joint_1).toBeCloseTo(0.5, 6)
    expect(reconnected.resynced).toBe(true)
  })

  it('默认延迟与 pTLC 一致为 100ms', () => {
    expect(JOINT_STATE_RENDER_DELAY_MS).toBe(100)
  })

  it('缓冲未播完时需要持续 RAF', () => {
    const base = 1_700_000_000_000
    const buffer = new JointStateRingBuffer({ delayMs: 100, staleMs: 500 })
    buffer.push(frame({
      sequence: 1,
      observedAt: base,
      jointStates: { robot_joint_1: 0 }
    }), base)
    buffer.push(frame({
      sequence: 2,
      observedAt: base + 200,
      jointStates: { robot_joint_1: 1 }
    }), base + 200)
    expect(buffer.needsContinuousRender(base + 150)).toBe(true)
    expect(buffer.needsContinuousRender(base + 350)).toBe(false)
  })
})

describe('unwrapAngleRad', () => {
  it('跨 ±π 时取最近等价角', () => {
    const ref = (179 * Math.PI) / 180
    const value = (-179 * Math.PI) / 180
    expect(unwrapAngleRad(value, ref)).toBeCloseTo((181 * Math.PI) / 180, 6)
  })
})
