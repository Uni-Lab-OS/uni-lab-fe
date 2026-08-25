import { createStore } from 'zustand/vanilla'

export type JointStateSource = 'mock' | 'live'

export interface JointStateFrame {
  materialId: string
  deviceId: string
  topologyDigest: string
  bootId: string
  sequence: number
  acceptedRef: string
  observedAt: number
  staleAfterSeconds: number
  stale: boolean
  jointStates: Readonly<Record<string, number>>
  source: JointStateSource
}

export type JointStateFrameInput = Omit<JointStateFrame, 'jointStates'> & {
  jointStates: Readonly<Record<string, number>>
}

export type KinematicAttachmentKind = 'tool' | 'material_payload'
export type KinematicAttachmentState =
  | 'attached'
  | 'detached'
  | 'detaching'
  | 'uncertain'
export type KinematicAttachmentEvidence =
  | 'observed'
  | 'controller_confirmed'
  | 'none'

export interface KinematicAttachmentFrame {
  carrierMaterialId: string
  deviceId: string
  kind: KinematicAttachmentKind
  childRef: string
  parentRef: string
  anchor: { kind: 'root' } | { kind: 'link'; linkName: string }
  localPose: {
    xyzM: readonly [number, number, number]
    orientationXyzw: readonly [number, number, number, number]
  }
  state: KinematicAttachmentState
  evidence: KinematicAttachmentEvidence
  attachmentGeneration: number
  contextDigest: string
  bootId: string
  sequence: number
  acceptedRef: string
  observedAt: number
  staleAfterSeconds: number
  stale: boolean
  source: string
  /** 首次进入本轮 attached 时的物料权威 revision，用于分阶段放料结算。 */
  materialRevisionAtAttach: number
  commandRef?: string
  jobRef?: string
}

export type KinematicAttachmentFrameInput = Omit<
KinematicAttachmentFrame,
'materialRevisionAtAttach'
> & {
  /** 接收本帧时 FE 已读取到的物料权威 revision。 */
  materialRevision: number
}

interface SceneRuntimeState {
  scopeId: string | null
  jointFrames: Readonly<Record<string, JointStateFrame>>
  attachmentFrames: Readonly<Record<string, KinematicAttachmentFrame>>
}

export const sceneRuntimeStore = createStore<SceneRuntimeState>(() => ({
  scopeId: null,
  jointFrames: {},
  attachmentFrames: {}
}))

/** 切换调度权威或端点时清除全部命令式关节帧，禁止跨环境串姿态。 */
export function activateSceneRuntimeScope(scopeId: string): void {
  const normalized = scopeId.trim()
  if (!normalized) throw new Error('场景运行时（SceneRuntime）scopeId 不能为空。')
  if (sceneRuntimeStore.getState().scopeId === normalized) return
  sceneRuntimeStore.setState({
    scopeId: normalized,
    jointFrames: {},
    attachmentFrames: {}
  })
}

/** 发布一台物料设备的完整 latest-value-wins 关节状态（JointState）快照。 */
export function publishJointStateFrame(
  input: JointStateFrameInput
): JointStateFrame {
  const frame = normalizeFrame(input)
  let accepted = frame
  sceneRuntimeStore.setState((state) => {
    const current = state.jointFrames[frame.materialId]
    if (current && !shouldReplace(current, frame)) {
      accepted = current
      return state
    }
    return {
      ...state,
      jointFrames: { ...state.jointFrames, [frame.materialId]: frame }
    }
  })
  return accepted
}

/**
 * 用 SSE 初始快照原子替换场景 latest；快照中缺失的机械臂必须清除，避免幽灵姿态。
 */
export function replaceJointStateSnapshot(
  inputs: readonly JointStateFrameInput[]
): void {
  const frames = Object.fromEntries(inputs.map(input => {
    const frame = normalizeFrame(input)
    return [frame.materialId, frame]
  }))
  if (Object.keys(frames).length !== inputs.length) {
    throw new Error('关节状态（JointState）快照包含重复物料身份。')
  }
  sceneRuntimeStore.setState(state => ({ ...state, jointFrames: frames }))
}

export function getJointStateFrame(materialId: string): JointStateFrame | null {
  return sceneRuntimeStore.getState().jointFrames[materialId] ?? null
}

export function subscribeJointStateFrame(
  materialId: string,
  listener: () => void
): () => void {
  let previous = getJointStateFrame(materialId)
  return sceneRuntimeStore.subscribe(state => {
    const next = state.jointFrames[materialId] ?? null
    if (next === previous) return
    previous = next
    listener()
  })
}

export function clearJointStateFrame(materialId: string): void {
  sceneRuntimeStore.setState(state => {
    if (!(materialId in state.jointFrames)) return state
    const next = { ...state.jointFrames }
    delete next[materialId]
    return { ...state, jointFrames: next }
  })
}

/** 发布一个工具或物料的 latest-value-wins 运动学附着投影。 */
export function publishKinematicAttachmentFrame(
  input: KinematicAttachmentFrameInput
): KinematicAttachmentFrame {
  const normalized = normalizeAttachmentFrame(input)
  let accepted = normalized
  sceneRuntimeStore.setState((state) => {
    const current = state.attachmentFrames[normalized.childRef]
    if (current && !shouldReplaceAttachment(current, normalized)) {
      accepted = current
      return state
    }
    const frame = current
      ? preserveAttachmentRevision(current, normalized)
      : normalized
    accepted = frame
    return {
      ...state,
      attachmentFrames: {
        ...state.attachmentFrames,
        [frame.childRef]: frame
      }
    }
  })
  return accepted
}

/** 用 SSE 初始快照原子替换全部附着 latest，清除上一个连接的幽灵关系。 */
export function replaceKinematicAttachmentSnapshot(
  inputs: readonly KinematicAttachmentFrameInput[]
): void {
  const frames = Object.fromEntries(inputs.map(input => {
    const frame = normalizeAttachmentFrame(input)
    return [frame.childRef, frame]
  }))
  if (Object.keys(frames).length !== inputs.length) {
    throw new Error('运动学附着（KinematicAttachment）快照包含重复 childRef。')
  }
  sceneRuntimeStore.setState(state => ({ ...state, attachmentFrames: frames }))
}

/** 返回按 childRef 索引的只读附着快照。 */
export function getKinematicAttachmentFrames(): Readonly<
Record<string, KinematicAttachmentFrame>
> {
  return sceneRuntimeStore.getState().attachmentFrames
}

/** 订阅任意附着关系变化；消费方负责按 childRef 做场景投影。 */
export function subscribeKinematicAttachmentFrames(
  listener: () => void
): () => void {
  let previous = getKinematicAttachmentFrames()
  return sceneRuntimeStore.subscribe(state => {
    if (state.attachmentFrames === previous) return
    previous = state.attachmentFrames
    listener()
  })
}

export function sceneRuntimeScopeId(profileId: string, endpoint: string): string {
  return `${profileId.trim()}|${endpoint.trim().replace(/\/+$/u, '')}`
}

function normalizeFrame(input: JointStateFrameInput): JointStateFrame {
  const materialId = boundedText(input.materialId, 'materialId')
  const deviceId = boundedText(input.deviceId, 'deviceId')
  const bootId = boundedText(input.bootId, 'bootId')
  const acceptedRef = boundedText(input.acceptedRef, 'acceptedRef')
  if (!/^[0-9a-f]{64}$/u.test(input.topologyDigest)) {
    throw new Error('关节状态（JointState）topologyDigest 必须是 SHA-256。')
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
    throw new Error('关节状态（JointState）sequence 无效。')
  }
  if (!Number.isFinite(input.observedAt) || input.observedAt < 0) {
    throw new Error('关节状态（JointState）observedAt 无效。')
  }
  if (!Number.isFinite(input.staleAfterSeconds) || input.staleAfterSeconds <= 0) {
    throw new Error('关节状态（JointState）staleAfterSeconds 无效。')
  }
  if (input.source !== 'mock' && input.source !== 'live') {
    throw new Error('关节状态（JointState）source 无效。')
  }
  const entries = Object.entries(input.jointStates)
  if (entries.length === 0 || entries.length > 512) {
    throw new Error('关节状态（JointState）必须包含 1 到 512 个关节。')
  }
  const jointStates: Record<string, number> = {}
  for (const [rawName, value] of entries) {
    const name = rawName.trim()
    if (!name || name.length > 255 || !Number.isFinite(value)) {
      throw new Error('关节状态（JointState）包含无效名称或数值。')
    }
    jointStates[name] = value
  }
  return Object.freeze({
    materialId,
    deviceId,
    topologyDigest: input.topologyDigest,
    bootId,
    sequence: input.sequence,
    acceptedRef,
    observedAt: input.observedAt,
    staleAfterSeconds: input.staleAfterSeconds,
    stale: input.stale,
    jointStates: Object.freeze(jointStates),
    source: input.source
  })
}

function shouldReplace(current: JointStateFrame, next: JointStateFrame): boolean {
  if (current.acceptedRef === next.acceptedRef) {
    return !current.stale && next.stale
  }
  if (current.bootId === next.bootId) return next.sequence > current.sequence
  return next.observedAt > current.observedAt
}

function normalizeAttachmentFrame(
  input: KinematicAttachmentFrameInput
): KinematicAttachmentFrame {
  const carrierMaterialId = boundedAttachmentText(
    input.carrierMaterialId, 'carrierMaterialId'
  )
  const deviceId = boundedAttachmentText(input.deviceId, 'deviceId')
  const childRef = boundedAttachmentText(input.childRef, 'childRef')
  const parentRef = boundedAttachmentText(input.parentRef, 'parentRef')
  const bootId = boundedAttachmentText(input.bootId, 'bootId')
  const acceptedRef = boundedAttachmentText(input.acceptedRef, 'acceptedRef')
  const source = boundedAttachmentText(input.source, 'source')
  if (input.kind !== 'tool' && input.kind !== 'material_payload') {
    throw new Error('运动学附着（KinematicAttachment）kind 无效。')
  }
  if (!['attached', 'detached', 'detaching', 'uncertain'].includes(input.state)) {
    throw new Error('运动学附着（KinematicAttachment）state 无效。')
  }
  if (!['observed', 'controller_confirmed', 'none'].includes(input.evidence)) {
    throw new Error('运动学附着（KinematicAttachment）evidence 无效。')
  }
  if ((input.state === 'uncertain') !== (input.evidence === 'none')) {
    throw new Error('运动学附着 uncertain 与 evidence=none 必须同时出现。')
  }
  if (!Number.isSafeInteger(input.attachmentGeneration) ||
      input.attachmentGeneration <= 0) {
    throw new Error('运动学附着 attachmentGeneration 无效。')
  }
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
    throw new Error('运动学附着 sequence 无效。')
  }
  if (!Number.isSafeInteger(input.materialRevision) ||
      input.materialRevision < 0) {
    throw new Error('运动学附着 materialRevision 无效。')
  }
  if (!Number.isFinite(input.observedAt) || input.observedAt < 0 ||
      !Number.isFinite(input.staleAfterSeconds) || input.staleAfterSeconds <= 0) {
    throw new Error('运动学附着时间或 TTL 无效。')
  }
  if (!/^[0-9a-f]{64}$/u.test(input.contextDigest)) {
    throw new Error('运动学附着 contextDigest 必须是 SHA-256。')
  }
  const anchor = input.anchor.kind === 'root'
    ? Object.freeze({ kind: 'root' as const })
    : Object.freeze({
        kind: 'link' as const,
        linkName: boundedAttachmentText(input.anchor.linkName, 'anchor.linkName')
      })
  const xyzM = finiteTuple(input.localPose.xyzM, 3, 'localPose.xyzM')
  const quaternion = finiteTuple(
    input.localPose.orientationXyzw, 4, 'localPose.orientationXyzw'
  )
  const norm = Math.sqrt(quaternion.reduce((sum, value) => sum + value * value, 0))
  if (norm <= 1e-12) throw new Error('运动学附着四元数不得为零。')
  return Object.freeze({
    carrierMaterialId,
    deviceId,
    kind: input.kind,
    childRef,
    parentRef,
    anchor,
    localPose: Object.freeze({
      xyzM: Object.freeze(xyzM) as readonly [number, number, number],
      orientationXyzw: Object.freeze(
        quaternion.map(value => value / norm)
      ) as unknown as readonly [number, number, number, number]
    }),
    state: input.state,
    evidence: input.evidence,
    attachmentGeneration: input.attachmentGeneration,
    contextDigest: input.contextDigest,
    bootId,
    sequence: input.sequence,
    acceptedRef,
    observedAt: input.observedAt,
    staleAfterSeconds: input.staleAfterSeconds,
    stale: input.stale,
    source,
    materialRevisionAtAttach: input.materialRevision,
    ...(input.commandRef
      ? { commandRef: boundedAttachmentText(input.commandRef, 'commandRef') }
      : {}),
    ...(input.jobRef
      ? { jobRef: boundedAttachmentText(input.jobRef, 'jobRef') }
      : {})
  })
}

/** 同一轮附着在 detached 到达前始终保留最初权威 revision。 */
function preserveAttachmentRevision(
  current: KinematicAttachmentFrame,
  next: KinematicAttachmentFrame
): KinematicAttachmentFrame {
  const startsNewAttachment =
    next.state === 'attached' && current.state === 'detached'
  if (startsNewAttachment ||
      current.attachmentGeneration !== next.attachmentGeneration) return next
  return Object.freeze({
    ...next,
    materialRevisionAtAttach: current.materialRevisionAtAttach
  })
}

function shouldReplaceAttachment(
  current: KinematicAttachmentFrame,
  next: KinematicAttachmentFrame
): boolean {
  if (current.acceptedRef === next.acceptedRef) {
    return !current.stale && next.stale
  }
  if (current.bootId === next.bootId) return next.sequence > current.sequence
  return next.observedAt > current.observedAt
}

function finiteTuple(
  value: readonly number[],
  length: number,
  field: string
): number[] {
  if (value.length !== length || value.some(item => !Number.isFinite(item))) {
    throw new Error(`运动学附着（KinematicAttachment）${field} 无效。`)
  }
  return [...value]
}

function boundedAttachmentText(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 255) {
    throw new Error(`运动学附着（KinematicAttachment）${field} 无效。`)
  }
  return normalized
}

function boundedText(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200) {
    throw new Error(`关节状态（JointState）${field} 无效。`)
  }
  return normalized
}
