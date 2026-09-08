import type { Object3D } from 'three'
import type { URDFRobot } from 'urdf-loader'

export interface JointStateRenderFrame {
  node_uuid: string
  joint_states: Readonly<Record<string, number>>
}

export type JointStateRenderDiagnosticCode =
  | 'invalid_node_uuid'
  | 'invalid_joint_map'
  | 'invalid_joint_name'
  | 'invalid_joint_value'
  | 'unknown_node_uuid'
  | 'ambiguous_node_uuid'
  | 'unknown_joint'
  | 'joint_update_failed'

export interface JointStateRenderDiagnostic {
  code: JointStateRenderDiagnosticCode
  message: string
  nodeUuid?: string
  jointName?: string
}

export interface JointStateRenderTarget {
  nodeUuid: string
  sceneNodeId: string
  robot: URDFRobot
  invalidate: () => void
}

type DiagnosticReporter = (
  diagnostic: JointStateRenderDiagnostic
) => void

interface RegisteredTarget extends JointStateRenderTarget {
  token: symbol
}

const MAX_PENDING_NODE_STATES = 256

/**
 * Routes instance-scoped joint frames to already parsed URDF robots.
 * Material snapshots and model loading are intentionally outside this class.
 */
export class JointStateSceneRuntime {
  private readonly targets = new Map<
    string,
    Map<symbol, RegisteredTarget>
  >()
  /** Last frame successfully applied to exactly one loaded robot. */
  private readonly latest = new Map<string, JointStateRenderFrame>()
  /** Valid transport frame waiting for its first loaded robot. */
  private readonly pending = new Map<string, JointStateRenderFrame>()

  constructor(private readonly reportDiagnostic?: DiagnosticReporter) {}

  registerTarget(target: JointStateRenderTarget): () => void {
    const token = Symbol(target.sceneNodeId)
    const registered: RegisteredTarget = { ...target, token }
    const targetsForUuid = this.targets.get(target.nodeUuid) ?? new Map()
    targetsForUuid.set(token, registered)
    this.targets.set(target.nodeUuid, targetsForUuid)

    this.replayRetainedIfUnique(target.nodeUuid)

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const current = this.targets.get(target.nodeUuid)
      current?.delete(token)
      if (current?.size === 0) {
        this.targets.delete(target.nodeUuid)
      } else {
        this.replayRetainedIfUnique(target.nodeUuid)
      }
    }
  }

  apply(frame: JointStateRenderFrame): JointStateRenderDiagnostic[] {
    const diagnostics = validateFrame(frame)
    if (diagnostics.length > 0) return this.report(diagnostics)

    const matches = this.targets.get(frame.node_uuid)
    if (!matches || matches.size === 0) {
      this.retainPending(frame)
      return this.report([{
        code: 'unknown_node_uuid',
        message: `No loaded URDF robot matches runtime UUID ${frame.node_uuid}`,
        nodeUuid: frame.node_uuid
      }])
    }
    if (matches.size !== 1) {
      return this.report([{
        code: 'ambiguous_node_uuid',
        message: `Runtime UUID ${frame.node_uuid} matches ${matches.size} loaded URDF robots`,
        nodeUuid: frame.node_uuid
      }])
    }

    const target = matches.values().next().value as RegisteredTarget
    const unknownJoints = Object.keys(frame.joint_states).filter(
      (jointName) => !Object.prototype.hasOwnProperty.call(
        target.robot.joints,
        jointName
      )
    )
    if (unknownJoints.length > 0) {
      return this.report(
        unknownJoints.map((jointName) => ({
          code: 'unknown_joint' as const,
          message: `URDF robot ${target.sceneNodeId} has no joint named ${jointName}`,
          nodeUuid: frame.node_uuid,
          jointName
        }))
      )
    }

    try {
      const changed = target.robot.setJointValues({
        ...frame.joint_states
      })
      if (changed) {
        target.robot.updateMatrixWorld(true)
        target.invalidate()
      }
    } catch (cause) {
      return this.report([{
        code: 'joint_update_failed',
        message: cause instanceof Error ? cause.message : String(cause),
        nodeUuid: frame.node_uuid
      }])
    }
    this.retainLatest(frame)
    return []
  }

  private retainLatest(frame: JointStateRenderFrame): void {
    if (
      !this.latest.has(frame.node_uuid) &&
      this.latest.size >= MAX_PENDING_NODE_STATES
    ) {
      const oldest = this.latest.keys().next().value as string | undefined
      if (oldest) this.latest.delete(oldest)
    }
    this.latest.set(frame.node_uuid, {
      node_uuid: frame.node_uuid,
      joint_states: { ...frame.joint_states }
    })
    this.pending.delete(frame.node_uuid)
  }

  private retainPending(frame: JointStateRenderFrame): void {
    if (
      !this.pending.has(frame.node_uuid) &&
      this.pending.size >= MAX_PENDING_NODE_STATES
    ) {
      const oldest = this.pending.keys().next().value as string | undefined
      if (oldest) this.pending.delete(oldest)
    }
    this.pending.set(frame.node_uuid, {
      node_uuid: frame.node_uuid,
      joint_states: { ...frame.joint_states }
    })
  }

  private replayRetainedIfUnique(nodeUuid: string): void {
    if (this.targets.get(nodeUuid)?.size !== 1) return
    const pending = this.pending.get(nodeUuid)
    const latest = this.latest.get(nodeUuid)
    if (pending) {
      this.pending.delete(nodeUuid)
      const diagnostics = this.apply(pending)
      if (diagnostics.length > 0 && latest) this.apply(latest)
    } else if (latest) {
      this.apply(latest)
    }
  }

  private report(
    diagnostics: JointStateRenderDiagnostic[]
  ): JointStateRenderDiagnostic[] {
    diagnostics.forEach((diagnostic) => this.reportDiagnostic?.(diagnostic))
    return diagnostics
  }
}

export function findUrdfRobot(object: Object3D): URDFRobot | null {
  if (isUrdfRobot(object)) return object
  let result: URDFRobot | null = null
  object.traverse((child) => {
    if (!result && isUrdfRobot(child)) result = child
  })
  return result
}

function isUrdfRobot(object: Object3D): object is URDFRobot {
  return (object as Object3D & { isURDFRobot?: unknown }).isURDFRobot === true
}

function validateFrame(
  frame: JointStateRenderFrame
): JointStateRenderDiagnostic[] {
  if (
    typeof frame.node_uuid !== 'string' ||
    !frame.node_uuid.trim() ||
    frame.node_uuid !== frame.node_uuid.trim()
  ) {
    return [{
      code: 'invalid_node_uuid',
      message: 'Joint-state runtime UUID must be a non-empty trimmed string'
    }]
  }
  const jointStates: unknown = frame.joint_states
  if (!isPlainRecord(jointStates)) {
    return [{
      code: 'invalid_joint_map',
      message: 'Joint-state values must be a plain object',
      nodeUuid: frame.node_uuid
    }]
  }
  const diagnostics: JointStateRenderDiagnostic[] = []
  for (const [jointName, position] of Object.entries(jointStates)) {
    if (!jointName.trim() || jointName !== jointName.trim()) {
      diagnostics.push({
        code: 'invalid_joint_name',
        message: 'Joint names must be non-empty trimmed strings',
        nodeUuid: frame.node_uuid,
        jointName
      })
    }
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      diagnostics.push({
        code: 'invalid_joint_value',
        message: `Joint ${jointName} must have a finite numeric value`,
        nodeUuid: frame.node_uuid,
        jointName
      })
    }
  }
  return diagnostics
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const jointStateSceneRuntime = new JointStateSceneRuntime(
  (diagnostic) => {
    globalThis.console?.warn(
      `[joint-state:${diagnostic.code}] ${diagnostic.message}`
    )
  }
)
