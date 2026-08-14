import { createStore } from 'zustand/vanilla'

export type JointStateSource = 'mock' | 'live'

export interface JointStateFrame {
  materialId: string
  jointStates: Readonly<Record<string, number>>
  source: JointStateSource
  updatedAt: number
  modelRevision?: string
}

export interface DeviceJointStateInput {
  deviceId: string
  topologyDigest: string
  observedAt: number
  jointStates: Readonly<Record<string, number>>
}

export interface DeviceMaterialBinding {
  deviceId: string
  materialId: string
}

interface SceneRuntimeState {
  scopeId: string | null
  jointFrames: Readonly<Record<string, JointStateFrame>>
}

const EMPTY_STATE: SceneRuntimeState = {
  scopeId: null,
  jointFrames: {}
}

/**
 * 高频关节状态的单一命令式帧缓存。Material Graph 不订阅也不持久化这些值。
 */
export const sceneRuntimeStore = createStore<SceneRuntimeState>(() => (
  EMPTY_STATE
))

/**
 * 激活当前运行时 scope。切换 Profile/Edge 时清空旧帧，防止跨环境串姿态。
 */
export function activateSceneRuntimeScope(scopeId: string): void {
  const normalized = scopeId.trim()
  if (!normalized) throw new Error('scene runtime scopeId 不能为空。')
  if (sceneRuntimeStore.getState().scopeId === normalized) return
  sceneRuntimeStore.setState({ scopeId: normalized, jointFrames: {} })
}

/** 发布一台物料设备的完整 latest-value-wins 关节快照。 */
export function publishJointStateFrame(frame: JointStateFrame): JointStateFrame {
  const materialId = frame.materialId.trim()
  if (!materialId) throw new Error('joint frame materialId 不能为空。')
  const jointStates = normalizeJointStates(frame.jointStates)
  const normalized: JointStateFrame = Object.freeze({
    materialId,
    jointStates: Object.freeze(jointStates),
    source: frame.source,
    updatedAt: frame.updatedAt,
    ...(frame.modelRevision ? { modelRevision: frame.modelRevision } : {})
  })
  if (frame.source !== 'mock' && frame.source !== 'live') {
    throw new Error('joint frame source 无效。')
  }
  if (!Number.isFinite(frame.updatedAt) || frame.updatedAt < 0) {
    throw new Error('joint frame updatedAt 无效。')
  }
  let accepted = normalized
  sceneRuntimeStore.setState((state) => {
    const current = state.jointFrames[materialId]
    if (current && current.updatedAt > normalized.updatedAt) {
      accepted = current
      return state
    }
    return {
      ...state,
      jointFrames: {
        ...state.jointFrames,
        [materialId]: normalized
      }
    }
  })
  return accepted
}

/**
 * 把 OS 的设备关节帧投影到唯一场景物料。未知或重复设备绑定均失败关闭。
 */
export function publishDeviceJointStateFrame(
  frame: DeviceJointStateInput,
  bindings: readonly DeviceMaterialBinding[],
  source: JointStateSource
): JointStateFrame | null {
  const deviceId = frame.deviceId.trim()
  if (!deviceId) return null
  const matches = bindings.filter(binding => binding.deviceId.trim() === deviceId)
  if (matches.length !== 1) return null
  const materialId = matches[0]?.materialId.trim()
  if (!materialId) return null
  return publishJointStateFrame({
    materialId,
    jointStates: frame.jointStates,
    source,
    updatedAt: frame.observedAt,
    ...(frame.topologyDigest.trim()
      ? { modelRevision: frame.topologyDigest.trim() }
      : {})
  })
}

export function getJointStateFrame(
  materialId: string
): JointStateFrame | null {
  return sceneRuntimeStore.getState().jointFrames[materialId] ?? null
}

export function subscribeJointStateFrame(
  materialId: string,
  listener: () => void
): () => void {
  let previous = getJointStateFrame(materialId)
  return sceneRuntimeStore.subscribe((state) => {
    const next = state.jointFrames[materialId] ?? null
    if (next === previous) return
    previous = next
    listener()
  })
}

export function clearJointStateFrame(materialId: string): void {
  sceneRuntimeStore.setState((state) => {
    if (!(materialId in state.jointFrames)) return state
    const next = { ...state.jointFrames }
    delete next[materialId]
    return { ...state, jointFrames: next }
  })
}

export function sceneRuntimeScopeId(
  profileId: string,
  endpoint: string
): string {
  return `${profileId.trim()}|${endpoint.trim().replace(/\/+$/u, '')}`
}

function normalizeJointStates(
  input: Readonly<Record<string, number>>
): Record<string, number> {
  const entries = Object.entries(input)
  if (entries.length === 0) throw new Error('joint frame 不能为空。')
  if (entries.length > 128) throw new Error('joint frame 最多包含 128 个关节。')
  return Object.fromEntries(entries.map(([rawName, value]) => {
    const name = rawName.trim()
    if (!name || name.length > 200) {
      throw new Error('joint frame 包含无效关节名。')
    }
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
      throw new Error(`joint ${name} 的数值无效。`)
    }
    return [name, value]
  }))
}
