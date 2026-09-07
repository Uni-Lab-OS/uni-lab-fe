import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore
} from 'react'

import type { SpatialShadowSnapshot } from './types'

export interface SpatialShadowPlaybackState {
  /** 唯一播放时间，单位为秒。 */
  timeS: number
  /** 是否由 Provider 的唯一时钟推进。 */
  playing: boolean
  /** 播放倍率；不改变快照中的诊断时间戳。 */
  rate: number
  /** 来自 hash-bound snapshot，而不是 UI 推测。 */
  durationS: number
  /** 完全由 timeS 和 snapshot segment 起点派生。 */
  currentSegmentIndex: number | null
}

export interface SpatialShadowPlaybackControls {
  toggle: () => void
  seek: (timeS: number) => void
  setRate: (rate: number) => void
  selectSegment: (segmentIndex: number) => void
}

export type SpatialShadowPlaybackValue = SpatialShadowPlaybackState &
  SpatialShadowPlaybackControls

export interface SpatialShadowPlaybackController {
  getState: () => SpatialShadowPlaybackState
  subscribe: (listener: () => void) => () => void
  setSnapshot: (snapshot: SpatialShadowSnapshot | null) => void
  toggle: () => void
  seek: (timeS: number) => void
  setRate: (rate: number) => void
  selectSegment: (segmentIndex: number) => void
  /** Provider 时钟使用；公开以便确定性测试，不代表机器人控制命令。 */
  advanceBy: (elapsedS: number) => void
}

export interface SpatialShadowPlaybackProviderProps {
  snapshot: SpatialShadowSnapshot | null
  children: ReactNode
}

interface PlaybackSegmentClock {
  segmentIndex: number
  startTimeS: number
}

const MIN_RATE = 0.1
const MAX_RATE = 4

function finiteDuration(snapshot: SpatialShadowSnapshot | null): number {
  const duration = snapshot?.playback.duration_s ?? 0
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function segmentClocks(
  snapshot: SpatialShadowSnapshot | null
): readonly PlaybackSegmentClock[] {
  if (!snapshot) return []
  return snapshot.playback.segments
    .map(segment => ({
      segmentIndex: segment.segment_index,
      startTimeS: segment.start_time_s
    }))
    .filter(segment => Number.isFinite(segment.startTimeS))
    .sort((left, right) => left.startTimeS - right.startTimeS)
}

function currentSegmentIndex(
  clocks: readonly PlaybackSegmentClock[],
  timeS: number
): number | null {
  for (let index = clocks.length - 1; index >= 0; index -= 1) {
    if (timeS >= clocks[index].startTimeS - 1e-9) {
      return clocks[index].segmentIndex
    }
  }
  return clocks[0]?.segmentIndex ?? null
}

function clampTime(timeS: number, durationS: number): number {
  return Math.min(durationS, Math.max(0, timeS))
}

class DefaultSpatialShadowPlaybackController
implements SpatialShadowPlaybackController {
  private snapshotKey: string | null
  private clocks: readonly PlaybackSegmentClock[]
  private listeners = new Set<() => void>()
  private state: SpatialShadowPlaybackState

  constructor(snapshot: SpatialShadowSnapshot | null) {
    this.snapshotKey = snapshot?.snapshot_digest ?? null
    this.clocks = segmentClocks(snapshot)
    const durationS = finiteDuration(snapshot)
    this.state = {
      timeS: 0,
      playing: false,
      rate: 1,
      durationS,
      currentSegmentIndex: currentSegmentIndex(this.clocks, 0)
    }
  }

  getState = (): SpatialShadowPlaybackState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setSnapshot = (snapshot: SpatialShadowSnapshot | null): void => {
    const nextKey = snapshot?.snapshot_digest ?? null
    const nextDurationS = finiteDuration(snapshot)
    const nextClocks = segmentClocks(snapshot)
    const changedSnapshot = nextKey !== this.snapshotKey
    this.snapshotKey = nextKey
    this.clocks = nextClocks

    if (changedSnapshot) {
      this.publish({
        ...this.state,
        timeS: 0,
        playing: false,
        durationS: nextDurationS,
        currentSegmentIndex: currentSegmentIndex(nextClocks, 0)
      })
      return
    }

    const nextTimeS = clampTime(this.state.timeS, nextDurationS)
    this.publish({
      ...this.state,
      timeS: nextTimeS,
      playing:
        nextDurationS > 0 && nextTimeS < nextDurationS
          ? this.state.playing
          : false,
      durationS: nextDurationS,
      currentSegmentIndex: currentSegmentIndex(nextClocks, nextTimeS)
    })
  }

  toggle = (): void => {
    if (this.state.durationS <= 0) return
    const replayFromStart =
      !this.state.playing && this.state.timeS >= this.state.durationS
    const timeS = replayFromStart ? 0 : this.state.timeS
    this.publish({
      ...this.state,
      timeS,
      playing: !this.state.playing,
      currentSegmentIndex: currentSegmentIndex(this.clocks, timeS)
    })
  }

  seek = (requestedTimeS: number): void => {
    if (!Number.isFinite(requestedTimeS)) return
    const timeS = clampTime(requestedTimeS, this.state.durationS)
    this.publish({
      ...this.state,
      timeS,
      playing:
        timeS >= this.state.durationS && this.state.durationS > 0
          ? false
          : this.state.playing,
      currentSegmentIndex: currentSegmentIndex(this.clocks, timeS)
    })
  }

  setRate = (requestedRate: number): void => {
    if (!Number.isFinite(requestedRate) || requestedRate <= 0) return
    this.publish({
      ...this.state,
      rate: Math.min(MAX_RATE, Math.max(MIN_RATE, requestedRate))
    })
  }

  selectSegment = (segmentIndex: number): void => {
    if (!Number.isInteger(segmentIndex)) return
    const segment = this.clocks.find(
      candidate => candidate.segmentIndex === segmentIndex
    )
    if (!segment) return
    this.seek(segment.startTimeS)
  }

  advanceBy = (elapsedS: number): void => {
    if (
      !this.state.playing ||
      !Number.isFinite(elapsedS) ||
      elapsedS <= 0
    ) {
      return
    }
    const timeS = clampTime(
      this.state.timeS + elapsedS * this.state.rate,
      this.state.durationS
    )
    this.publish({
      ...this.state,
      timeS,
      playing: timeS < this.state.durationS,
      currentSegmentIndex: currentSegmentIndex(this.clocks, timeS)
    })
  }

  private publish(next: SpatialShadowPlaybackState): void {
    if (
      next.timeS === this.state.timeS &&
      next.playing === this.state.playing &&
      next.rate === this.state.rate &&
      next.durationS === this.state.durationS &&
      next.currentSegmentIndex === this.state.currentSegmentIndex
    ) {
      return
    }
    this.state = next
    this.listeners.forEach(listener => listener())
  }
}

/** 创建纯前端诊断播放控制器；它不读取文件、不请求后端，也不发出调度命令。 */
export function createSpatialShadowPlaybackController(
  snapshot: SpatialShadowSnapshot | null
): SpatialShadowPlaybackController {
  return new DefaultSpatialShadowPlaybackController(snapshot)
}

const SpatialShadowPlaybackContext =
  createContext<SpatialShadowPlaybackValue | null>(null)

/**
 * 为 2D 诊断面板与 Pascal overlay 提供同一播放时钟。
 * Snapshot 切换只重置诊断播放，不修改 unknown/shadow/effect=none 事实。
 */
export function SpatialShadowPlaybackProvider({
  snapshot,
  children
}: SpatialShadowPlaybackProviderProps) {
  const controllerRef = useRef<SpatialShadowPlaybackController | null>(null)
  if (controllerRef.current === null) {
    controllerRef.current = createSpatialShadowPlaybackController(snapshot)
  }
  const controller = controllerRef.current
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState
  )

  useEffect(() => {
    controller.setSnapshot(snapshot)
  }, [controller, snapshot])

  useEffect(() => {
    if (!state.playing) return undefined
    let frameHandle = 0
    let previousTimestamp: number | null = null
    const advance = (timestamp: number) => {
      if (previousTimestamp !== null) {
        controller.advanceBy((timestamp - previousTimestamp) / 1000)
      }
      previousTimestamp = timestamp
      frameHandle = requestAnimationFrame(advance)
    }
    frameHandle = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frameHandle)
  }, [controller, state.playing])

  const value = useMemo<SpatialShadowPlaybackValue>(
    () => ({
      ...state,
      toggle: controller.toggle,
      seek: controller.seek,
      setRate: controller.setRate,
      selectSegment: controller.selectSegment
    }),
    [controller, state]
  )

  return (
    <SpatialShadowPlaybackContext.Provider value={value}>
      {children}
    </SpatialShadowPlaybackContext.Provider>
  )
}

export function useSpatialShadowPlayback(): SpatialShadowPlaybackValue {
  const value = useContext(SpatialShadowPlaybackContext)
  if (!value) {
    throw new Error(
      'useSpatialShadowPlayback 必须在 SpatialShadowPlaybackProvider 内使用'
    )
  }
  return value
}
