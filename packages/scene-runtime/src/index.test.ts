import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activateSceneRuntimeScope,
  getKinematicAttachmentFrames,
  getJointStateFrame,
  publishKinematicAttachmentFrame,
  publishJointStateFrame,
  replaceJointStateSnapshot,
  subscribeJointStateFrame,
  type KinematicAttachmentFrameInput,
  type JointStateFrameInput
} from './index'

const digest = 'a'.repeat(64)

function frame(overrides: Partial<JointStateFrameInput> = {}): JointStateFrameInput {
  return {
    materialId: 'material-robot',
    deviceId: 'robot',
    topologyDigest: digest,
    bootId: 'boot-1',
    sequence: 1,
    acceptedRef: 'sha256:frame-1',
    observedAt: 1000,
    staleAfterSeconds: 1,
    stale: false,
    jointStates: { robot_joint_1: 0.25 },
    source: 'live',
    ...overrides
  }
}

function attachment(
  overrides: Partial<KinematicAttachmentFrameInput> = {}
): KinematicAttachmentFrameInput {
  return {
    carrierMaterialId: 'material-robot',
    deviceId: 'robot',
    kind: 'material_payload',
    childRef: 'material-beaker',
    parentRef: 'material-gripper',
    anchor: { kind: 'link', linkName: 'grasp_frame' },
    localPose: {
      xyzM: [0, 0, 0.08],
      orientationXyzw: [0, 0, 0, 2]
    },
    state: 'attached',
    evidence: 'observed',
    attachmentGeneration: 3,
    contextDigest: digest,
    bootId: 'robot-boot-1',
    sequence: 1,
    acceptedRef: 'sha256:attachment-1',
    observedAt: 1000,
    staleAfterSeconds: 2,
    stale: false,
    source: 'robot-runtime',
    materialRevision: 7,
    ...overrides
  }
}

describe('场景运行时（SceneRuntime）关节帧', () => {
  beforeEach(() => activateSceneRuntimeScope(`test-${crypto.randomUUID()}`))

  it('按 bootId 和 sequence 接受同代际最新帧', () => {
    publishJointStateFrame(frame({ sequence: 2, acceptedRef: 'sha256:2' }))
    publishJointStateFrame(frame({ sequence: 1, acceptedRef: 'sha256:1' }))
    expect(getJointStateFrame('material-robot')?.sequence).toBe(2)
  })

  it('跨 bootId 只按 observedAt 接受更新代际', () => {
    publishJointStateFrame(frame({ bootId: 'boot-2', observedAt: 2000 }))
    publishJointStateFrame(frame({ bootId: 'boot-3', observedAt: 1500 }))
    expect(getJointStateFrame('material-robot')?.bootId).toBe('boot-2')
  })

  it('同 acceptedRef 只允许 fresh 到 stale 的转换', () => {
    publishJointStateFrame(frame())
    publishJointStateFrame(frame({ stale: true }))
    publishJointStateFrame(frame({ stale: false }))
    expect(getJointStateFrame('material-robot')?.stale).toBe(true)
  })

  it('SSE 快照替换清除缺失机械臂', () => {
    publishJointStateFrame(frame())
    replaceJointStateSnapshot([frame({ materialId: 'material-other' })])
    expect(getJointStateFrame('material-robot')).toBeNull()
    expect(getJointStateFrame('material-other')).not.toBeNull()
  })

  it('只通知目标物料订阅者并在 scope 切换时清除', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeJointStateFrame('material-robot', listener)
    publishJointStateFrame(frame())
    expect(listener).toHaveBeenCalledOnce()
    activateSceneRuntimeScope('another|http://127.0.0.1')
    expect(listener).toHaveBeenCalledTimes(2)
    expect(getJointStateFrame('material-robot')).toBeNull()
    unsubscribe()
  })

  it('验证拓扑摘要、帧身份和关节数值', () => {
    expect(() => publishJointStateFrame(frame({ topologyDigest: 'bad' })))
      .toThrow('SHA-256')
    expect(() => publishJointStateFrame(frame({ jointStates: { joint_1: NaN } })))
      .toThrow('无效名称或数值')
  })
})

describe('场景运行时（SceneRuntime）运动学附着', () => {
  beforeEach(() => activateSceneRuntimeScope(`attachment-${crypto.randomUUID()}`))

  it('按 childRef 维护单一 latest 并归一化四元数', () => {
    publishKinematicAttachmentFrame(attachment())
    publishKinematicAttachmentFrame(attachment({
      sequence: 2,
      acceptedRef: 'sha256:attachment-2',
      state: 'uncertain',
      evidence: 'none'
    }))
    const frame = getKinematicAttachmentFrames()['material-beaker']
    expect(frame?.sequence).toBe(2)
    expect(frame?.localPose.orientationXyzw).toEqual([0, 0, 0, 1])
    expect(frame?.state).toBe('uncertain')
    expect(frame?.materialRevisionAtAttach).toBe(7)
  })

  it('同一轮释放保留抓取时 revision，新一轮 attached 才重置', () => {
    publishKinematicAttachmentFrame(attachment({ materialRevision: 7 }))
    publishKinematicAttachmentFrame(attachment({
      sequence: 2,
      acceptedRef: 'sha256:detached',
      state: 'detached',
      materialRevision: 8
    }))
    expect(getKinematicAttachmentFrames()['material-beaker']
      ?.materialRevisionAtAttach).toBe(7)
    publishKinematicAttachmentFrame(attachment({
      sequence: 3,
      acceptedRef: 'sha256:reattached',
      state: 'attached',
      materialRevision: 9
    }))
    expect(getKinematicAttachmentFrames()['material-beaker']
      ?.materialRevisionAtAttach).toBe(9)
  })

  it('拒绝把无证据状态伪装成确定附着', () => {
    expect(() => publishKinematicAttachmentFrame(attachment({ evidence: 'none' })))
      .toThrow('必须同时出现')
  })

  it('scope 切换同时清除关节与附着 latest', () => {
    publishKinematicAttachmentFrame(attachment())
    activateSceneRuntimeScope('attachment-other')
    expect(getKinematicAttachmentFrames()).toEqual({})
  })
})
