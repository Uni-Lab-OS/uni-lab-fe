import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activateSceneRuntimeScope,
  getJointStateFrame,
  publishJointStateFrame,
  subscribeJointStateFrame
} from './index'

describe('scene runtime joint frames', () => {
  beforeEach(() => activateSceneRuntimeScope(`test-${crypto.randomUUID()}`))

  it('keeps the latest immutable frame per material', () => {
    const input = { joint_1: 0.25 }
    publishJointStateFrame({
      materialId: 'robot-a',
      jointStates: input,
      source: 'mock',
      updatedAt: 1
    })
    input.joint_1 = 99
    expect(getJointStateFrame('robot-a')).toMatchObject({
      materialId: 'robot-a',
      jointStates: { joint_1: 0.25 },
      source: 'mock'
    })
  })

  it('notifies only subscribers for the changed material', () => {
    const robotA = vi.fn()
    const robotB = vi.fn()
    const unsubscribeA = subscribeJointStateFrame('robot-a', robotA)
    const unsubscribeB = subscribeJointStateFrame('robot-b', robotB)
    publishJointStateFrame({
      materialId: 'robot-a',
      jointStates: { joint_1: 0.5 },
      source: 'mock',
      updatedAt: 1
    })
    expect(robotA).toHaveBeenCalledOnce()
    expect(robotB).not.toHaveBeenCalled()
    unsubscribeA()
    unsubscribeB()
  })

  it('clears frames when the runtime scope changes', () => {
    publishJointStateFrame({
      materialId: 'robot-a',
      jointStates: { joint_1: 0.5 },
      source: 'mock',
      updatedAt: 1
    })
    activateSceneRuntimeScope('another-profile|http://127.0.0.1:9000')
    expect(getJointStateFrame('robot-a')).toBeNull()
  })

  it('does not let a delayed older frame overwrite the latest pose', () => {
    publishJointStateFrame({
      materialId: 'robot-a',
      jointStates: { joint_1: 0.8 },
      source: 'mock',
      updatedAt: 20
    })
    publishJointStateFrame({
      materialId: 'robot-a',
      jointStates: { joint_1: 0.1 },
      source: 'mock',
      updatedAt: 10
    })
    expect(getJointStateFrame('robot-a')?.jointStates).toEqual({
      joint_1: 0.8
    })
  })

  it('rejects invalid joint values', () => {
    expect(() => publishJointStateFrame({
      materialId: 'robot-a',
      jointStates: { joint_1: Number.NaN },
      source: 'mock',
      updatedAt: 1
    })).toThrow('数值无效')
    expect(() => publishJointStateFrame({
      materialId: 'robot-a',
      jointStates: { joint_1: 0 },
      source: 'mock',
      updatedAt: Number.NaN
    })).toThrow('updatedAt 无效')
  })
})
