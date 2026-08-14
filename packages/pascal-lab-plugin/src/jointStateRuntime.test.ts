import { describe, expect, it, vi } from 'vitest'
import { Object3D } from 'three'

import {
  applyJointStateToUrdf,
  applyJointStateToUrdfWithDiagnostics,
  captureInitialJointState,
  resetJointStateUrdf,
  resolveUrdfJointValues
} from './jointStateRuntime'

describe('Pascal URDF joint runtime adapter', () => {
  it('maps local package joint keys to one instantiated Xacro prefix', () => {
    const robot = urdfRobot([
      'szlab_mixer_robot_arm_base_joint',
      'szlab_mixer_robot_cr7_joint_1'
    ])
    expect(resolveUrdfJointValues(robot, {
      arm_base_joint: 0.85,
      cr7_joint_1: Math.PI / 2,
      missing: 1
    })).toEqual({
      szlab_mixer_robot_arm_base_joint: 0.85,
      szlab_mixer_robot_cr7_joint_1: Math.PI / 2
    })
  })

  it('refuses ambiguous suffixes and applies exact names', () => {
    const robot = urdfRobot(['a_joint_1', 'b_joint_1', 'exact'])
    expect(resolveUrdfJointValues(robot, {
      joint_1: 1,
      exact: 2
    })).toEqual({ exact: 2 })
    expect(applyJointStateToUrdf(robot, { exact: 2 })).toBe(true)
    expect(robot.setJointValues).toHaveBeenCalledWith({ exact: 2 })
  })

  it('ignores non-URDF models', () => {
    expect(applyJointStateToUrdf(new Object3D(), { joint_1: 1 })).toBe(false)
  })

  it('reports bounded mapping diagnostics without exposing values', () => {
    const robot = urdfRobot([
      'robot_arm_base_joint',
      'a_joint_1',
      'b_joint_1'
    ])
    expect(applyJointStateToUrdfWithDiagnostics(robot, {
      arm_base_joint: 0.5,
      joint_1: 1,
      absent: 2
    })).toEqual({
      applied: true,
      availableCount: 3,
      movableCount: 0,
      inputCount: 3,
      resolvedCount: 1,
      exactCount: 0,
      suffixCount: 1,
      missingCount: 1,
      ambiguousCount: 1,
      requestedNonZeroCount: 3,
      changedCount: 0,
      degenerateLimitCount: 0,
      availableDegenerateLimitCount: 0,
      inputNameSample: ['arm_base_joint', 'joint_1', 'absent'],
      resolvedNameSample: ['robot_arm_base_joint'],
      availableNameSample: [
        'robot_arm_base_joint',
        'a_joint_1',
        'b_joint_1'
      ],
      degenerateLimitNameSample: []
    })
  })

  it('diagnoses a non-zero command clamped by degenerate URDF limits', () => {
    const robot = urdfRobot(['robot_joint_1'])
    robot.joints.robot_joint_1 = {
      jointValue: [0],
      jointType: 'revolute',
      limit: { lower: 0, upper: 0 },
      ignoreLimits: false
    }
    robot.setJointValues.mockImplementation((values) => {
      const requested = values.robot_joint_1 as number
      const joint = robot.joints.robot_joint_1
      const next = Math.min(
        joint.limit?.upper ?? requested,
        Math.max(joint.limit?.lower ?? requested, requested)
      )
      const changed = joint.jointValue?.[0] !== next
      joint.jointValue = [next]
      return changed
    })

    expect(applyJointStateToUrdfWithDiagnostics(robot, {
      joint_1: 0.5
    })).toMatchObject({
      applied: false,
      inputCount: 1,
      resolvedCount: 1,
      suffixCount: 1,
      requestedNonZeroCount: 1,
      changedCount: 0,
      degenerateLimitCount: 1,
      availableDegenerateLimitCount: 1,
      degenerateLimitNameSample: ['robot_joint_1']
    })
  })

  it('restores the model values captured before Mock preview', () => {
    const robot = urdfRobot(['joint_1'])
    robot.joints.joint_1 = { jointValue: [0.25] }
    captureInitialJointState(robot)
    robot.joints.joint_1.jointValue = [1.5]
    expect(resetJointStateUrdf(robot)).toBe(true)
    expect(robot.setJointValues).toHaveBeenLastCalledWith({ joint_1: 0.25 })
  })
})

function urdfRobot(names: string[]): Object3D & {
  joints: Record<string, {
    jointValue?: number[]
    jointType?: string
    limit?: { lower: number; upper: number }
    ignoreLimits?: boolean
  }>
  setJointValues: ReturnType<typeof vi.fn>
} {
  return Object.assign(new Object3D(), {
    joints: Object.fromEntries(names.map((name) => [name, {}])),
    setJointValues: vi.fn(() => true)
  })
}
