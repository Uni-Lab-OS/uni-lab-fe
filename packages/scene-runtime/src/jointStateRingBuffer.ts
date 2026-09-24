import { unwrapAngleRad } from './jointAngleUnwrap'

export interface JointStateFrameLike {
  materialId: string
  deviceId: string
  topologyDigest: string
  bootId: string
  sequence: number
  observedAt: number
  stale: boolean
  jointStates: Readonly<Record<string, number>>
}

export const JOINT_STATE_RENDER_DELAY_MS = 100
export const JOINT_STATE_STALE_MS = 500
const MAX_BUFFERED_FRAMES = 64

interface BufferedJointFrame {
  ts: number
  seq: number
  bootId: string
  jointStates: Readonly<Record<string, number>>
  frame: JointStateFrameLike
  arrivalMs: number
}

export interface JointStateRenderSample {
  jointStates: Readonly<Record<string, number>> | null
  stale: boolean
  resynced: boolean
  ts: number | null
  frame: JointStateFrameLike | null
}

/** 多帧时间缓冲；乱序可重排、跨 ±π 可展开、断流只冻结不回零。 */
export class JointStateRingBuffer {
  private readonly delayMs: number
  private readonly staleMs: number
  private frames: BufferedJointFrame[] = []
  private lastSequence = -1
  private lastArrival = 0
  private lastResyncArrival = 0
  private forceResync = false
  /** 首帧校准：observedAt − arrivalMs，把 Edge 时钟重映射到本地播放轴。 */
  private clockSkewMs: number | undefined

  constructor({
    delayMs = JOINT_STATE_RENDER_DELAY_MS,
    staleMs = JOINT_STATE_STALE_MS
  }: {
    delayMs?: number
    staleMs?: number
  } = {}) {
    this.delayMs = delayMs
    this.staleMs = staleMs
  }

  reset(): void {
    this.frames = []
    this.lastSequence = -1
    this.lastArrival = 0
    this.lastResyncArrival = 0
    this.forceResync = false
    this.clockSkewMs = undefined
  }

  markDisconnected(): void {
    if (this.frames.length) this.forceResync = true
  }

  push(frame: JointStateFrameLike, arrivalMs = Date.now()): boolean {
    const seq = frame.sequence
    if (
      this.forceResync ||
      (this.lastArrival > 0 && arrivalMs - this.lastArrival > this.staleMs)
    ) {
      this.frames = []
      this.lastResyncArrival = arrivalMs
      this.lastSequence = -1
      this.forceResync = false
      this.clockSkewMs = undefined
    }
    if (this.frames.some(entry => entry.seq === seq && entry.bootId === frame.bootId)) {
      return false
    }

    if (this.clockSkewMs === undefined) {
      this.clockSkewMs = frame.observedAt - arrivalMs
    }
    const ts = frame.observedAt - this.clockSkewMs

    const prior = this.frames.at(-1)
    const jointStates = prior
      ? unwrapJointRecord(frame.jointStates, prior.jointStates)
      : { ...frame.jointStates }

    this.frames.push({
      ts,
      seq,
      bootId: frame.bootId,
      jointStates,
      frame,
      arrivalMs
    })
    this.frames.sort((left, right) => left.ts - right.ts || left.seq - right.seq)
    for (let index = 1; index < this.frames.length; index += 1) {
      const previous = this.frames[index - 1]!
      const current = this.frames[index]!
      current.jointStates = unwrapJointRecord(
        current.frame.jointStates,
        previous.jointStates
      )
    }
    if (this.frames.length > MAX_BUFFERED_FRAMES) {
      this.frames.splice(0, this.frames.length - MAX_BUFFERED_FRAMES)
    }
    this.lastSequence = Math.max(this.lastSequence, seq)
    this.lastArrival = Math.max(this.lastArrival, arrivalMs)
    return true
  }

  sample(nowMs = Date.now()): JointStateRenderSample {
    if (!this.frames.length) {
      return {
        jointStates: null,
        stale: true,
        resynced: false,
        ts: null,
        frame: null
      }
    }
    const stale = nowMs - this.lastArrival > this.staleMs
    const renderTs = nowMs - this.delayMs

    let before = this.frames[0]!
    let after: BufferedJointFrame | null = null
    for (const entry of this.frames) {
      if (entry.ts <= renderTs) before = entry
      if (entry.ts >= renderTs) {
        after = entry
        break
      }
    }
    const resynced = Boolean(
      this.lastResyncArrival && nowMs - this.lastResyncArrival <= this.staleMs
    )
    if (!after || after === before || after.ts <= before.ts) {
      return {
        jointStates: { ...before.jointStates },
        stale,
        resynced,
        ts: before.ts,
        frame: before.frame
      }
    }
    const span = after.ts - before.ts
    const fraction = span > 0
      ? Math.min(1, Math.max(0, (renderTs - before.ts) / span))
      : 1
    return {
      jointStates: interpolateJointRecord(
        before.jointStates,
        after.jointStates,
        fraction
      ),
      stale,
      resynced,
      ts: renderTs,
      frame: after.frame
    }
  }

  /** 延迟播放轴上是否还有未消费的缓冲帧，需持续 RAF 插值。 */
  needsContinuousRender(nowMs = Date.now()): boolean {
    if (!this.frames.length) return false
    if (nowMs - this.lastArrival > this.staleMs) return false
    const renderTs = nowMs - this.delayMs
    const headTs = this.frames[this.frames.length - 1]!.ts
    return renderTs + 0.5 < headTs
  }
}

const buffers = new Map<string, JointStateRingBuffer>()

export function getJointStateRingBuffer(materialId: string): JointStateRingBuffer {
  let buffer = buffers.get(materialId)
  if (!buffer) {
    buffer = new JointStateRingBuffer()
    buffers.set(materialId, buffer)
  }
  return buffer
}

export function appendJointStateToRingBuffer(frame: JointStateFrameLike): void {
  getJointStateRingBuffer(frame.materialId).push(frame)
}

export function sampleJointStateAtRenderTime(
  materialId: string,
  nowMs = Date.now()
): JointStateRenderSample {
  return getJointStateRingBuffer(materialId).sample(nowMs)
}

export function jointStatePlaybackIsActive(
  materialId: string,
  nowMs = Date.now()
): boolean {
  return getJointStateRingBuffer(materialId).needsContinuousRender(nowMs)
}

export function resetJointStateRingBuffer(materialId: string): void {
  buffers.get(materialId)?.reset()
  buffers.delete(materialId)
}

export function resetAllJointStateRingBuffers(): void {
  buffers.clear()
}

export function markJointStateRingBufferDisconnected(materialId: string): void {
  buffers.get(materialId)?.markDisconnected()
}

export function replaceJointStateRingBufferSnapshot(
  frames: readonly JointStateFrameLike[]
): void {
  resetAllJointStateRingBuffers()
  for (const frame of frames) {
    appendJointStateToRingBuffer(frame)
  }
}

function unwrapJointRecord(
  raw: Readonly<Record<string, number>>,
  reference: Readonly<Record<string, number>>
): Readonly<Record<string, number>> {
  const next: Record<string, number> = {}
  for (const [name, value] of Object.entries(raw)) {
    next[name] = unwrapAngleRad(value, reference[name] ?? value)
  }
  return Object.freeze(next)
}

function interpolateJointRecord(
  from: Readonly<Record<string, number>>,
  to: Readonly<Record<string, number>>,
  fraction: number
): Readonly<Record<string, number>> {
  const alpha = fraction <= 0 ? 0 : fraction >= 1 ? 1 : fraction
  const names = new Set([...Object.keys(from), ...Object.keys(to)])
  const interpolated: Record<string, number> = {}
  for (const name of names) {
    const start = from[name]
    const end = to[name]
    if (start === undefined) {
      interpolated[name] = end as number
      continue
    }
    if (end === undefined) {
      interpolated[name] = start
      continue
    }
    interpolated[name] = start + (end - start) * alpha
  }
  return Object.freeze(interpolated)
}
