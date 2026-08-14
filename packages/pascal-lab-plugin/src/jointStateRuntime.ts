import type { Object3D } from 'three'

interface UrdfJointLike {
  jointValue?: number[]
  jointType?: string
  limit?: { lower: number; upper: number }
  ignoreLimits?: boolean
}

interface UrdfRobotLike extends Object3D {
  joints: Record<string, UrdfJointLike>
  setJointValues(values: Record<string, number | number[]>): boolean
}

const INITIAL_JOINT_VALUES = Symbol('unilabInitialJointValues')
const JOINT_DIAGNOSTIC_SAMPLE_LIMIT = 8
const JOINT_VALUE_EPSILON = 1e-9
const MOVABLE_JOINT_TYPES = new Set([
  'continuous',
  'floating',
  'planar',
  'prismatic',
  'revolute'
])

interface UrdfRobotWithInitialValues extends UrdfRobotLike {
  [INITIAL_JOINT_VALUES]?: Readonly<Record<string, number | number[]>>
}

export interface UrdfJointApplicationResult {
  applied: boolean
  availableCount: number
  movableCount: number
  inputCount: number
  resolvedCount: number
  exactCount: number
  suffixCount: number
  missingCount: number
  ambiguousCount: number
  requestedNonZeroCount: number
  changedCount: number
  degenerateLimitCount: number
  availableDegenerateLimitCount: number
  inputNameSample: readonly string[]
  resolvedNameSample: readonly string[]
  availableNameSample: readonly string[]
  degenerateLimitNameSample: readonly string[]
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
  const inputNames = Object.keys(jointStates)
  const inputCount = inputNames.length
  const requestedNonZeroCount = Object.values(jointStates).filter(
    (value) => Math.abs(value) > JOINT_VALUE_EPSILON
  ).length
  if (!robot) {
    return {
      applied: false,
      availableCount: 0,
      movableCount: 0,
      inputCount,
      resolvedCount: 0,
      exactCount: 0,
      suffixCount: 0,
      missingCount: inputCount,
      ambiguousCount: 0,
      requestedNonZeroCount,
      changedCount: 0,
      degenerateLimitCount: 0,
      availableDegenerateLimitCount: 0,
      inputNameSample: sampleJointNames(inputNames),
      resolvedNameSample: [],
      availableNameSample: [],
      degenerateLimitNameSample: []
    }
  }
  const available = Object.keys(robot.joints)
  const movable = available.filter((name) => isMovableJoint(robot.joints[name]))
  const availableDegenerateLimitNames = movable.filter((name) => (
    hasDegenerateLimit(robot.joints[name])
  ))
  let missingCount = 0
  let ambiguousCount = 0
  let exactCount = 0
  let suffixCount = 0
  const resolved: Record<string, number> = {}
  for (const [localName, value] of Object.entries(jointStates)) {
    if (localName in robot.joints) {
      resolved[localName] = value
      exactCount += 1
      continue
    }
    const matches = available.filter((name) => name.endsWith(`_${localName}`))
    if (matches.length === 1) {
      resolved[matches[0]] = value
      suffixCount += 1
    }
    else if (matches.length > 1) ambiguousCount += 1
    else missingCount += 1
  }
  const resolvedNames = Object.keys(resolved)
  const resolvedCount = resolvedNames.length
  const degenerateLimitNames = resolvedNames.filter((name) => (
    hasDegenerateLimit(robot.joints[name])
  ))
  const beforeValues = new Map(resolvedNames.map((name) => [
    name,
    [...(robot.joints[name]?.jointValue ?? [])]
  ]))
  const applied = resolvedCount > 0 ? robot.setJointValues(resolved) : false
  const changedCount = resolvedNames.filter((name) => (
    jointValuesChanged(
      beforeValues.get(name) ?? [],
      robot.joints[name]?.jointValue ?? []
    )
  )).length
  return {
    applied,
    availableCount: available.length,
    movableCount: movable.length,
    inputCount,
    resolvedCount,
    exactCount,
    suffixCount,
    missingCount,
    ambiguousCount,
    requestedNonZeroCount,
    changedCount,
    degenerateLimitCount: degenerateLimitNames.length,
    availableDegenerateLimitCount: availableDegenerateLimitNames.length,
    inputNameSample: sampleJointNames(inputNames),
    resolvedNameSample: sampleJointNames(resolvedNames),
    availableNameSample: sampleJointNames(available),
    degenerateLimitNameSample: sampleJointNames(
      availableDegenerateLimitNames
    )
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

function isMovableJoint(joint: UrdfJointLike | undefined): boolean {
  return Boolean(joint?.jointType && MOVABLE_JOINT_TYPES.has(joint.jointType))
}

function hasDegenerateLimit(joint: UrdfJointLike | undefined): boolean {
  if (
    !joint
    || joint.ignoreLimits
    || !['prismatic', 'revolute'].includes(joint.jointType ?? '')
  ) return false
  const lower = joint.limit?.lower
  const upper = joint.limit?.upper
  return Number.isFinite(lower)
    && Number.isFinite(upper)
    && Math.abs((upper as number) - (lower as number)) <= JOINT_VALUE_EPSILON
}

function jointValuesChanged(
  before: readonly number[],
  after: readonly number[]
): boolean {
  if (before.length !== after.length) return true
  return before.some((value, index) => (
    Math.abs(value - (after[index] ?? value)) > JOINT_VALUE_EPSILON
  ))
}

function sampleJointNames(names: readonly string[]): readonly string[] {
  return names.slice(0, JOINT_DIAGNOSTIC_SAMPLE_LIMIT)
}
