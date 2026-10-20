import type { GanttLane } from './scheduleGanttModel'

/** 甘特图可见时间窗（绝对秒，服务端时钟）。 */
export interface TimeWindow {
  readonly start: number
  readonly end: number
}

/**
 * 预设视图：activity 适配当前活动（运行中、待确认、计划与最近完成的动作）；
 * all 显示全部记录；10m/1h 以“现在”为锚点的固定跨度。
 */
export type GanttPreset = 'activity' | 'all' | '10m' | '1h'

export const MIN_WINDOW_SPAN = 10
export const MAX_WINDOW_SPAN = 7 * 24 * 3600
/** 适配当前活动时一并显示的最近完成动作的回看时长（秒）。 */
export const RECENT_LOOKBACK = 10 * 60

const NICE_STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400,
]

/** 不小于 seconds 的“整齐”步长（秒）。 */
export function niceStep(seconds: number): number {
  return NICE_STEPS.find((step) => step >= seconds) ?? NICE_STEPS[NICE_STEPS.length - 1]!
}

/**
 * 把窗口两端向外对齐到整齐步长，并留出少量边距。窗口只在活动越过对齐边界时才变化，
 * 运行中每秒推进的“现在”不会让整张图持续缩放抖动。
 */
export function settleWindow(window: TimeWindow, padRatio = 0.04): TimeWindow {
  const span = Math.max(MIN_WINDOW_SPAN, window.end - window.start)
  const pad = span * padRatio
  const step = niceStep(span / 12)
  const start = Math.floor((window.start - pad) / step) * step
  let end = Math.ceil((window.end + pad) / step) * step
  if (end - start < MIN_WINDOW_SPAN) end = start + MIN_WINDOW_SPAN
  return { start, end }
}

/**
 * 当前活动区间：运行中/待确认的条、计划条，以及最近 lookback 秒内结束的实际执行。
 * 没有任何此类条时返回 null（调用方改为显示全部）。
 */
export function activityWindow(
  lanes: readonly GanttLane[],
  now: number,
  lookback = RECENT_LOOKBACK,
): TimeWindow | null {
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  for (const lane of lanes) {
    for (const bar of lane.bars) {
      const current = bar.open || bar.kind === 'planned'
      if (!current && bar.end < now - lookback) continue
      start = Math.min(start, bar.start)
      end = Math.max(end, bar.end, bar.estimatedEnd ?? bar.end)
    }
  }
  if (!Number.isFinite(start)) return null
  // 当前活动总要包含“现在”，并至少有一分钟跨度，避免单个短动作被放大到满屏。
  start = Math.min(start, now)
  end = Math.max(end, now)
  if (end - start < 60) end = start + 60
  return { start, end }
}

export function presetWindow(
  preset: GanttPreset,
  input: {
    readonly range: TimeWindow | null
    readonly lanes: readonly GanttLane[]
    readonly now: number
  },
): TimeWindow {
  const { now } = input
  if (preset === '10m' || preset === '1h') {
    // 以“现在”为锚：留 20% 看即将开始的计划；按跨度的 1/20 对齐，窗口分段推进而不是每秒移动。
    const span = preset === '10m' ? 600 : 3600
    const step = span / 20
    const end = Math.ceil((now + span * 0.2) / step) * step
    return { start: end - span, end }
  }
  if (preset === 'activity') {
    const activity = activityWindow(input.lanes, now)
    if (activity) return settleWindow(activity)
  }
  if (input.range)
    return settleWindow({ start: input.range.start, end: Math.max(input.range.end, now) })
  return settleWindow({ start: now - 600, end: now + 60 })
}

function clampSpan(span: number): number {
  return Math.min(MAX_WINDOW_SPAN, Math.max(MIN_WINDOW_SPAN, span))
}

/** 以 anchor 为不动点缩放（factor < 1 放大，> 1 缩小）；跨度限制在 10 秒到 7 天。 */
export function zoomWindow(window: TimeWindow, factor: number, anchor?: number): TimeWindow {
  const span = window.end - window.start
  const next = clampSpan(span * factor)
  const pivot = anchor ?? window.start + span / 2
  const ratio = span > 0 ? (pivot - window.start) / span : 0.5
  const start = pivot - ratio * next
  return { start, end: start + next }
}

export function panWindow(window: TimeWindow, deltaSeconds: number): TimeWindow {
  return { start: window.start + deltaSeconds, end: window.end + deltaSeconds }
}

/** 保持当前跨度，把“现在”放在窗口 80% 处。 */
export function centerOnNow(window: TimeWindow, now: number): TimeWindow {
  const span = window.end - window.start
  return { start: now - span * 0.8, end: now + span * 0.2 }
}

export interface AxisTick {
  readonly t: number
  readonly label: string
  /** 跨天时在当天第一个刻度标出日期。 */
  readonly dayStart: boolean
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 本地时区相对 UTC 的偏移（秒），用于把整点/整天刻度对齐到本地时间。 */
function localOffset(seconds: number): number {
  return -new Date(seconds * 1000).getTimezoneOffset() * 60
}

/**
 * 时间轴刻度：按像素宽度选步长，保证相邻标签至少 minLabelPx 像素，避免标签重叠。
 * 小于 1 分钟的步长显示秒；窗口跨天时，每天第一个刻度带“月-日”。
 */
export function axisTicks(
  window: TimeWindow,
  plotWidth: number,
  minLabelPx = 84,
): { readonly step: number; readonly ticks: readonly AxisTick[] } {
  const span = Math.max(1e-6, window.end - window.start)
  const secondsPerPx = span / Math.max(1, plotWidth)
  const step = niceStep(secondsPerPx * minLabelPx)
  const offset = localOffset(window.start)
  const first = Math.ceil((window.start + offset) / step) * step - offset
  const crossesDay =
    new Date(window.start * 1000).toDateString() !== new Date(window.end * 1000).toDateString()
  const ticks: AxisTick[] = []
  let previousDay = ''
  for (let t = first; t <= window.end + 1e-6 && ticks.length < 400; t += step) {
    const date = new Date(t * 1000)
    const day = date.toDateString()
    const dayStart = crossesDay && day !== previousDay
    previousDay = day
    const clock =
      step < 60
        ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
        : `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    ticks.push({
      t,
      label: dayStart ? `${date.getMonth() + 1}-${pad2(date.getDate())} ${clock}` : clock,
      dayStart,
    })
  }
  return { step, ticks }
}

/** 只保留与窗口相交的条（含运行条的预计剩余虚线），大量作业时减少绘制。 */
export function intersectsWindow(
  bar: { readonly start: number; readonly end: number; readonly estimatedEnd?: number },
  window: TimeWindow,
): boolean {
  return Math.max(bar.end, bar.estimatedEnd ?? bar.end) >= window.start && bar.start <= window.end
}
