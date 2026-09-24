/**
 * URDF 关节投影（对齐 pTLC 的 RobotJointDriver 应用层）。
 *
 * 本模块只负责把已采样好的关节角写入 URDF，不做时间缓冲或帧间插值。
 * 播放缓冲与 100ms 延迟插值在 @unilab/scene-runtime 的 JointStateRingBuffer
 *（对齐 pTLC RobotPoseBuffer）；LabDeviceRenderer 经 sampleJointStateAtRenderTime
 * 取样后再调用 applyJointStateToUrdf。
 */
import type { Object3D } from 'three'

interface UrdfJointLike {
  jointValue?: number[]
}

interface UrdfRobotLike extends Object3D {
  joints: Record<string, UrdfJointLike>
  setJointValues(values: Record<string, number | number[]>): boolean
}

const INITIAL_JOINT_VALUES = Symbol('unilabInitialJointValues')

interface UrdfRobotWithInitialValues extends UrdfRobotLike {
  [INITIAL_JOINT_VALUES]?: Readonly<Record<string, number | number[]>>
}

export interface UrdfJointApplicationResult {
  applied: boolean
  availableCount: number
  inputCount: number
  resolvedCount: number
  exactCount: number
  suffixCount: number
  missingCount: number
  ambiguousCount: number
}

/**
 * 只接受领域包声明的完整限定 joint 名，禁止按后缀猜测多机械臂归属。
 */
export function resolveUrdfJointValues(
  object: Object3D,
  jointStates: Readonly<Record<string, number>>
): Record<string, number> {
  return resolveWithDiagnostics(object, jointStates).values
}

/** 命令式应用完整关节状态（JointState），不触发 React/Pascal 场景重建。 */
export function applyJointStateToUrdfWithDiagnostics(
  object: Object3D,
  jointStates: Readonly<Record<string, number>>
): UrdfJointApplicationResult {
  const robot = asUrdfRobot(object)
  const resolved = resolveWithDiagnostics(object, jointStates)
  return {
    applied: Boolean(robot && resolved.resolvedCount > 0 &&
      robot.setJointValues(resolved.values)),
    availableCount: resolved.availableCount,
    inputCount: Object.keys(jointStates).length,
    resolvedCount: resolved.resolvedCount,
    exactCount: resolved.exactCount,
    suffixCount: resolved.suffixCount,
    missingCount: resolved.missingCount,
    ambiguousCount: resolved.ambiguousCount
  }
}

export function applyJointStateToUrdf(
  object: Object3D,
  jointStates: Readonly<Record<string, number>>
): boolean {
  return applyJointStateToUrdfWithDiagnostics(object, jointStates).applied
}

/** 首次应用前记录模型自身的初始姿态。 */
export function captureInitialJointState(object: Object3D): void {
  const robot = asUrdfRobot(object) as UrdfRobotWithInitialValues | null
  if (!robot || robot[INITIAL_JOINT_VALUES]) return
  robot[INITIAL_JOINT_VALUES] = Object.freeze(Object.fromEntries(
    Object.entries(robot.joints).map(([name, joint]) => {
      const values = joint.jointValue ?? [0]
      return [name, values.length === 1 ? values[0] ?? 0 : [...values]]
    })
  ))
}

/** 快照清除该机械臂时恢复模型加载完成时的关节值。 */
export function resetJointStateUrdf(object: Object3D): boolean {
  const robot = asUrdfRobot(object) as UrdfRobotWithInitialValues | null
  if (!robot) return false
  captureInitialJointState(object)
  return robot.setJointValues({ ...robot[INITIAL_JOINT_VALUES] })
}

function resolveWithDiagnostics(
  object: Object3D,
  jointStates: Readonly<Record<string, number>>
): {
  values: Record<string, number>
  availableCount: number
  resolvedCount: number
  exactCount: number
  suffixCount: number
  missingCount: number
  ambiguousCount: number
} {
  const robot = asUrdfRobot(object)
  if (!robot) {
    return {
      values: {}, availableCount: 0, resolvedCount: 0,
      exactCount: 0, suffixCount: 0,
      missingCount: Object.keys(jointStates).length, ambiguousCount: 0
    }
  }
  const available = Object.keys(robot.joints)
  const values: Record<string, number> = {}
  let exactCount = 0
  let suffixCount = 0
  let missingCount = 0
  let ambiguousCount = 0
  for (const [localName, value] of Object.entries(jointStates)) {
    if (localName in robot.joints) {
      values[localName] = value
      exactCount += 1
      continue
    }
    missingCount += 1
  }
  return {
    values,
    availableCount: available.length,
    resolvedCount: Object.keys(values).length,
    exactCount,
    suffixCount,
    missingCount,
    ambiguousCount
  }
}

function asUrdfRobot(object: Object3D): UrdfRobotLike | null {
  const candidate = object as Partial<UrdfRobotLike>
  return candidate.joints && typeof candidate.setJointValues === 'function'
    ? candidate as UrdfRobotLike
    : null
}
