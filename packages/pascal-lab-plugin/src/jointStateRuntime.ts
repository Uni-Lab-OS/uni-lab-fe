import type { Object3D } from 'three'

interface UrdfRobotLike extends Object3D {
  joints: Record<string, { jointValue?: number[] }>
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
  missingCount: number
  ambiguousCount: number
}

/**
 * 将领域设备包的局部 joint key 解析为 Xacro 实例化后的真实 URDF joint 名。
 * exact 优先；后缀匹配只在唯一时生效，避免多机械臂模型串关节。
 */
export function resolveUrdfJointValues(
  object: Object3D,
  jointStates: Readonly<Record<string, number>>
): Record<string, number> {
  const robot = asUrdfRobot(object)
  if (!robot) return {}
  const available = Object.keys(robot.joints)
  return Object.fromEntries(Object.entries(jointStates).flatMap(
    ([localName, value]) => {
      if (localName in robot.joints) return [[localName, value]]
      const matches = available.filter((name) => (
        name.endsWith(`_${localName}`)
      ))
      return matches.length === 1 ? [[matches[0], value]] : []
    }
  ))
}

/** Apply one frame and return bounded diagnostics without exposing joint values. */
export function applyJointStateToUrdfWithDiagnostics(
  object: Object3D,
  jointStates: Readonly<Record<string, number>>
): UrdfJointApplicationResult {
  const robot = asUrdfRobot(object)
  const inputCount = Object.keys(jointStates).length
  if (!robot) {
    return {
      applied: false,
      availableCount: 0,
      inputCount,
      resolvedCount: 0,
      missingCount: inputCount,
      ambiguousCount: 0
    }
  }
  const available = Object.keys(robot.joints)
  let missingCount = 0
  let ambiguousCount = 0
  const resolved: Record<string, number> = {}
  for (const [localName, value] of Object.entries(jointStates)) {
    if (localName in robot.joints) {
      resolved[localName] = value
      continue
    }
    const matches = available.filter((name) => name.endsWith(`_${localName}`))
    if (matches.length === 1) resolved[matches[0]] = value
    else if (matches.length > 1) ambiguousCount += 1
    else missingCount += 1
  }
  const resolvedCount = Object.keys(resolved).length
  return {
    applied: resolvedCount > 0 ? robot.setJointValues(resolved) : false,
    availableCount: available.length,
    inputCount,
    resolvedCount,
    missingCount,
    ambiguousCount
  }
}

/** 命令式更新已经加载的真实 URDFRobot，不触发 React/Pascal 场景重建。 */
export function applyJointStateToUrdf(
  object: Object3D,
  jointStates: Readonly<Record<string, number>>
): boolean {
  return applyJointStateToUrdfWithDiagnostics(object, jointStates).applied
}

/** 恢复模型加载完成时的关节值，用于清除 Mock scope 后撤销残留姿态。 */
export function resetJointStateUrdf(object: Object3D): boolean {
  const robot = asUrdfRobot(object) as UrdfRobotWithInitialValues | null
  if (!robot) return false
  robot[INITIAL_JOINT_VALUES] ??= Object.freeze(Object.fromEntries(
    Object.entries(robot.joints).map(([name, joint]) => {
      const values = joint.jointValue ?? [0]
      return [name, values.length === 1 ? values[0] ?? 0 : [...values]]
    })
  ))
  return robot.setJointValues({ ...robot[INITIAL_JOINT_VALUES] })
}

/** 首次写入前保存模型自己的初始姿态。 */
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

function asUrdfRobot(object: Object3D): UrdfRobotLike | null {
  const candidate = object as Partial<UrdfRobotLike>
  return candidate.joints && typeof candidate.setJointValues === 'function'
    ? candidate as UrdfRobotLike
    : null
}
