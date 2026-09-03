import { Object3D, Vector3 } from 'three'
import {
  URDFJoint,
  URDFLink,
  URDFRobot
} from 'urdf-loader/src/URDFClasses.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  JointStateSceneRuntime,
  type JointStateRenderFrame
} from './jointStateRuntime'

const NODE_A = '11111111-1111-4111-8111-111111111111'
const NODE_B = '22222222-2222-4222-8222-222222222222'

describe('Pascal joint-state scene runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps a static review asset renderable when the simulate frame has no joints', () => {
    const instance = articulatedRobot()
    const invalidate = vi.fn()
    const runtime = new JointStateSceneRuntime()
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'batch-b-static-device',
      robot: instance.robot,
      invalidate
    })

    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: {}
    })).toEqual([])
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('updates only A, clamps revolute/prismatic values and reloads neither model', () => {
    const fetchModel = vi.fn()
    vi.stubGlobal('fetch', fetchModel)
    const instanceA = articulatedRobot()
    const instanceB = articulatedRobot()
    const invalidateA = vi.fn()
    const invalidateB = vi.fn()
    const setA = vi.spyOn(instanceA.robot, 'setJointValues')
    const setB = vi.spyOn(instanceB.robot, 'setJointValues')
    const runtime = new JointStateSceneRuntime()
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a',
      robot: instanceA.robot,
      invalidate: invalidateA
    })
    runtime.registerTarget({
      nodeUuid: NODE_B,
      sceneNodeId: 'turntable-b',
      robot: instanceB.robot,
      invalidate: invalidateB
    })

    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: {
        revolute_joint: 4,
        prismatic_joint: 2
      }
    })).toEqual([])

    expect(setA).toHaveBeenCalledOnce()
    expect(setB).not.toHaveBeenCalled()
    expect(instanceA.revolute.jointValue[0]).toBeCloseTo(1, 8)
    expect(instanceA.prismatic.jointValue[0]).toBeCloseTo(0.25, 8)
    expect(instanceB.revolute.jointValue[0]).toBe(0)
    expect(instanceB.prismatic.jointValue[0]).toBe(0)
    expect(invalidateA).toHaveBeenCalledOnce()
    expect(invalidateB).not.toHaveBeenCalled()
    expect(fetchModel).not.toHaveBeenCalled()
  })

  it('diagnoses unknown UUIDs and joints without partially updating a robot', () => {
    const instance = articulatedRobot()
    const setJointValues = vi.spyOn(instance.robot, 'setJointValues')
    const report = vi.fn()
    const runtime = new JointStateSceneRuntime(report)
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a',
      robot: instance.robot,
      invalidate: vi.fn()
    })

    expect(runtime.apply({
      node_uuid: NODE_B,
      joint_states: { revolute_joint: 0.4 }
    })).toEqual([
      expect.objectContaining({ code: 'unknown_node_uuid' })
    ])
    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: {
        revolute_joint: 0.4,
        invented_joint: 0.2
      }
    })).toEqual([
      expect.objectContaining({
        code: 'unknown_joint',
        jointName: 'invented_joint'
      })
    ])
    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: { revolute_joint: Number.NaN }
    })).toEqual([
      expect.objectContaining({ code: 'invalid_joint_value' })
    ])
    expect(setJointValues).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledTimes(3)
  })

  it('moves a link-anchored child while a root-anchored child stays fixed', () => {
    const instance = articulatedRobot()
    const linkWarehouse = new Object3D()
    const rootWarehouse = new Object3D()
    instance.prismaticLink.add(linkWarehouse)
    instance.robot.add(rootWarehouse)
    instance.robot.updateMatrixWorld(true)

    const runtime = new JointStateSceneRuntime()
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a',
      robot: instance.robot,
      invalidate: vi.fn()
    })
    runtime.apply({
      node_uuid: NODE_A,
      joint_states: { prismatic_joint: 0.2 }
    })

    expect(linkWarehouse.getWorldPosition(new Vector3()).x).toBeCloseTo(
      0.2,
      8
    )
    expect(rootWarehouse.getWorldPosition(new Vector3()).x).toBeCloseTo(
      0,
      8
    )
  })

  it('applies a retained frame when its URDF robot finishes loading later', () => {
    const runtime = new JointStateSceneRuntime()
    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: { revolute_joint: 0.6 }
    })).toEqual([
      expect.objectContaining({ code: 'unknown_node_uuid' })
    ])

    const instance = articulatedRobot()
    const invalidate = vi.fn()
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a',
      robot: instance.robot,
      invalidate
    })

    expect(instance.revolute.jointValue[0]).toBeCloseTo(0.6, 8)
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('keeps the last good frame when a loaded target reports an unknown joint', () => {
    const runtime = new JointStateSceneRuntime()
    const first = articulatedRobot()
    const dispose = runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a',
      robot: first.robot,
      invalidate: vi.fn()
    })
    runtime.apply({
      node_uuid: NODE_A,
      joint_states: { revolute_joint: 0.25 }
    })
    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: { invented_joint: 0.9 }
    })).toEqual([
      expect.objectContaining({ code: 'unknown_joint' })
    ])
    dispose()
    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: { invented_joint: 0.8 }
    })).toEqual([
      expect.objectContaining({ code: 'unknown_node_uuid' })
    ])

    const replacement = articulatedRobot()
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a-reloaded',
      robot: replacement.robot,
      invalidate: vi.fn()
    })
    expect(replacement.revolute.jointValue[0]).toBeCloseTo(0.25, 8)
  })

  it('does not let an ambiguous UUID poison the last good frame', () => {
    const runtime = new JointStateSceneRuntime()
    const first = articulatedRobot()
    const second = articulatedRobot()
    const disposeFirst = runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'duplicate-a',
      robot: first.robot,
      invalidate: vi.fn()
    })
    runtime.apply({
      node_uuid: NODE_A,
      joint_states: { revolute_joint: 0.2 }
    })
    const disposeSecond = runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'duplicate-b',
      robot: second.robot,
      invalidate: vi.fn()
    })
    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: { revolute_joint: 0.8 }
    })).toEqual([
      expect.objectContaining({ code: 'ambiguous_node_uuid' })
    ])
    disposeFirst()
    disposeSecond()

    const replacement = articulatedRobot()
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'unique-a',
      robot: replacement.robot,
      invalidate: vi.fn()
    })
    expect(replacement.revolute.jointValue[0]).toBeCloseTo(0.2, 8)
  })

  it('replays last good when transient duplicate disposal leaves one target', () => {
    const runtime = new JointStateSceneRuntime()
    const oldRenderer = articulatedRobot()
    const newRenderer = articulatedRobot()
    const disposeOld = runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'renderer-old',
      robot: oldRenderer.robot,
      invalidate: vi.fn()
    })
    runtime.apply({
      node_uuid: NODE_A,
      joint_states: { revolute_joint: 0.45 }
    })
    const invalidateNew = vi.fn()
    const setJointValuesNew = vi.spyOn(
      newRenderer.robot,
      'setJointValues'
    )
    const disposeNew = runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'renderer-new',
      robot: newRenderer.robot,
      invalidate: invalidateNew
    })

    expect(newRenderer.revolute.jointValue[0]).toBe(0)
    disposeOld()
    disposeOld()

    expect(newRenderer.revolute.jointValue[0]).toBeCloseTo(0.45, 8)
    expect(invalidateNew).toHaveBeenCalledOnce()
    expect(setJointValuesNew).toHaveBeenCalledOnce()
    disposeNew()
  })

  it('does not let a failed joint update poison the last good frame', () => {
    const runtime = new JointStateSceneRuntime()
    const first = articulatedRobot()
    const setJointValues = vi.spyOn(first.robot, 'setJointValues')
    const dispose = runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a',
      robot: first.robot,
      invalidate: vi.fn()
    })
    runtime.apply({
      node_uuid: NODE_A,
      joint_states: { revolute_joint: 0.3 }
    })
    setJointValues.mockImplementationOnce(() => {
      throw new Error('synthetic update failure')
    })
    expect(runtime.apply({
      node_uuid: NODE_A,
      joint_states: { revolute_joint: 0.9 }
    })).toEqual([
      expect.objectContaining({ code: 'joint_update_failed' })
    ])
    dispose()

    const replacement = articulatedRobot()
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a-reloaded',
      robot: replacement.robot,
      invalidate: vi.fn()
    })
    expect(replacement.revolute.jointValue[0]).toBeCloseTo(0.3, 8)
  })

  it('rejects malformed joint maps and names before retaining them', () => {
    const runtime = new JointStateSceneRuntime()
    expect(runtime.apply(malformedFrame(null))).toEqual([
      expect.objectContaining({ code: 'invalid_joint_map' })
    ])
    expect(runtime.apply(malformedFrame([]))).toEqual([
      expect.objectContaining({ code: 'invalid_joint_map' })
    ])
    expect(runtime.apply(malformedFrame(new Map()))).toEqual([
      expect.objectContaining({ code: 'invalid_joint_map' })
    ])
    expect(runtime.apply(malformedFrame({ ' revolute_joint': 0.5 }))).toEqual([
      expect.objectContaining({ code: 'invalid_joint_name' })
    ])
    expect(runtime.apply(malformedFrame({ '': 0.5 }))).toEqual([
      expect.objectContaining({ code: 'invalid_joint_name' })
    ])

    const instance = articulatedRobot()
    runtime.registerTarget({
      nodeUuid: NODE_A,
      sceneNodeId: 'turntable-a',
      robot: instance.robot,
      invalidate: vi.fn()
    })
    expect(instance.revolute.jointValue[0]).toBe(0)
  })
})

function malformedFrame(jointStates: unknown): JointStateRenderFrame {
  return {
    node_uuid: NODE_A,
    joint_states: jointStates
  } as JointStateRenderFrame
}

function articulatedRobot(): {
  robot: URDFRobot
  revolute: URDFJoint
  prismatic: URDFJoint
  prismaticLink: URDFLink
} {
  const robot = new URDFRobot()
  const revolute = new URDFJoint()
  revolute.jointType = 'revolute'
  revolute.limit.lower = -1
  revolute.limit.upper = 1
  revolute.urdfName = 'revolute_joint'

  const prismatic = new URDFJoint()
  prismatic.jointType = 'prismatic'
  prismatic.limit.lower = 0
  prismatic.limit.upper = 0.25
  prismatic.urdfName = 'prismatic_joint'
  const prismaticLink = new URDFLink()
  prismaticLink.urdfName = 'moving_link'
  prismatic.add(prismaticLink)

  robot.joints = {
    revolute_joint: revolute,
    prismatic_joint: prismatic
  }
  robot.links = { moving_link: prismaticLink }
  robot.colliders = {}
  robot.visual = {}
  robot.frames = {
    revolute_joint: revolute,
    prismatic_joint: prismatic,
    moving_link: prismaticLink
  }
  robot.add(revolute, prismatic)
  return { robot, revolute, prismatic, prismaticLink }
}
