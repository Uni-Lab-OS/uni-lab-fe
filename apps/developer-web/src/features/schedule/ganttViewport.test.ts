import { describe, expect, it } from 'vitest'
import {
  activityWindow,
  axisTicks,
  centerOnNow,
  intersectsWindow,
  MAX_WINDOW_SPAN,
  MIN_WINDOW_SPAN,
  niceStep,
  panWindow,
  presetWindow,
  settleWindow,
  zoomWindow,
} from './ganttViewport'
import type { GanttLane, PlacedGanttBar } from './scheduleGanttModel'

const bar = (over: Partial<PlacedGanttBar>): PlacedGanttBar => ({
  id: over.id ?? 'b',
  kind: 'actual',
  taskId: 't',
  nodeId: 'n',
  deviceId: 'robot',
  label: 'x',
  nodeName: 'x',
  start: 0,
  end: 0,
  row: 0,
  ...over,
})
const lane = (bars: PlacedGanttBar[]): GanttLane => ({
  deviceId: 'robot',
  deviceIds: ['robot'],
  name: '机械臂',
  nameKnown: true,
  rows: 1,
  bars,
})

describe('gantt viewport', () => {
  it('settles windows on nice steps so a moving "now" does not rescale every second', () => {
    expect(niceStep(7)).toBe(10)
    expect(niceStep(10 ** 9)).toBe(86400)
    const a = settleWindow({ start: 1000, end: 1600 })
    const b = settleWindow({ start: 1000, end: 1601 })
    expect(a).toEqual(b)
    expect(a.start).toBeLessThanOrEqual(1000)
    expect(a.end).toBeGreaterThanOrEqual(1600)
    expect(settleWindow({ start: 5, end: 5 }).end - settleWindow({ start: 5, end: 5 }).start).toBe(
      MIN_WINDOW_SPAN + 0,
    )
  })

  it('fits current activity: open, planned and recently finished bars, always including now', () => {
    const now = 10_000
    const lanes = [
      lane([
        bar({ id: 'old', start: 100, end: 200 }),
        bar({ id: 'recent', start: 9_500, end: 9_700 }),
        bar({
          id: 'run',
          kind: 'running',
          open: true,
          start: 9_900,
          end: now,
          estimatedEnd: 10_300,
        }),
        bar({ id: 'plan', kind: 'planned', start: 10_300, end: 10_900 }),
      ]),
    ]
    expect(activityWindow(lanes, now)).toEqual({ start: 9_500, end: 10_900 })
    // 只有很久以前的记录时没有“当前活动”。
    expect(activityWindow([lane([bar({ start: 100, end: 200 })])], now)).toBeNull()
    // 单个很短的动作至少给一分钟跨度。
    expect(activityWindow([lane([bar({ start: 9_990, end: 9_995 })])], now)).toEqual({
      start: 9_990,
      end: 10_050,
    })
  })

  it('computes preset windows', () => {
    const now = 10_000
    const range = { start: 100, end: 9_000 }
    const idle = [lane([bar({ start: 100, end: 200 })])]
    const all = presetWindow('all', { range, lanes: idle, now })
    expect(all.start).toBeLessThanOrEqual(100)
    expect(all.end).toBeGreaterThanOrEqual(now)
    // 没有当前活动时“当前活动”回退为全部。
    expect(presetWindow('activity', { range, lanes: idle, now })).toEqual(all)
    const tenMinutes = presetWindow('10m', { range, lanes: idle, now })
    expect(tenMinutes.end - tenMinutes.start).toBe(600)
    expect(tenMinutes.start).toBeLessThan(now)
    expect(tenMinutes.end).toBeGreaterThan(now)
    expect(presetWindow('10m', { range, lanes: idle, now: now + 1 })).toEqual(tenMinutes)
    const hour = presetWindow('1h', { range, lanes: idle, now })
    expect(hour.end - hour.start).toBe(3600)
    const empty = presetWindow('all', { range: null, lanes: [], now })
    expect(empty.start).toBeLessThan(now)
    expect(empty.end).toBeGreaterThan(now)
  })

  it('zooms around an anchor, clamps the span and pans', () => {
    const window = { start: 0, end: 1000 }
    expect(zoomWindow(window, 0.5, 500)).toEqual({ start: 250, end: 750 })
    expect(zoomWindow(window, 0.5, 0)).toEqual({ start: 0, end: 500 })
    expect(zoomWindow(window, 2)).toEqual({ start: -500, end: 1500 })
    const tiny = zoomWindow(window, 1e-6, 0)
    expect(tiny.end - tiny.start).toBe(MIN_WINDOW_SPAN)
    const huge = zoomWindow(window, 1e9)
    expect(huge.end - huge.start).toBe(MAX_WINDOW_SPAN)
    expect(panWindow(window, -250)).toEqual({ start: -250, end: 750 })
    expect(centerOnNow(window, 5000)).toEqual({ start: 4200, end: 5200 })
  })

  it('chooses readable tick spacing from the pixel width and marks day changes', () => {
    const start = new Date(2026, 9, 20, 14, 0, 0).getTime() / 1000
    const minute = axisTicks({ start, end: start + 600 }, 840)
    expect(minute.step).toBe(60)
    expect(minute.ticks[0]).toMatchObject({ t: start, label: '14:00', dayStart: false })
    expect(minute.ticks).toHaveLength(11)
    const seconds = axisTicks({ start, end: start + 60 }, 840)
    expect(seconds.step).toBe(10)
    expect(seconds.ticks[1]?.label).toBe('14:00:10')
    const midnight = new Date(2026, 9, 20, 23, 0, 0).getTime() / 1000
    const overnight = axisTicks({ start: midnight, end: midnight + 7200 }, 600)
    expect(overnight.ticks[0]).toMatchObject({ label: '10-20 23:00', dayStart: true })
    const next = overnight.ticks.find((tick) => tick.label.startsWith('10-21'))
    expect(next).toMatchObject({ label: '10-21 00:00', dayStart: true })
  })

  it('culls bars outside the window, keeping the running estimate tail', () => {
    const window = { start: 100, end: 200 }
    expect(intersectsWindow({ start: 0, end: 50 }, window)).toBe(false)
    expect(intersectsWindow({ start: 0, end: 50, estimatedEnd: 120 }, window)).toBe(true)
    expect(intersectsWindow({ start: 250, end: 300 }, window)).toBe(false)
    expect(intersectsWindow({ start: 150, end: 160 }, window)).toBe(true)
  })
})
