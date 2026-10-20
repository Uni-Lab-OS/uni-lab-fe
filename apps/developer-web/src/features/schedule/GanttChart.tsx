import { clsx } from 'clsx'
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { Button, Segmented, Tag, Tooltip } from 'antd'
import { AppIcon } from '../../components/ui/Icon'
import {
  axisTicks,
  centerOnNow,
  intersectsWindow,
  panWindow,
  presetWindow,
  zoomWindow,
  type GanttPreset,
  type TimeWindow,
} from './ganttViewport'
import {
  barStatusText,
  describeBar,
  formatClock,
  formatSpan,
  isUnsuccessfulBar,
  taskHue,
  type GanttBar,
  type GanttBarKind,
  type GanttLane,
} from './scheduleGanttModel'
import styles from './SchedulePage.module.scss'

export const AXIS_HEIGHT = 36
const ROW_HEIGHT = 26
const BAR_HEIGHT = 20
const LANE_PAD = 5

export function laneHeight(rows: number): number {
  return LANE_PAD * 2 + rows * ROW_HEIGHT
}

const PRESETS: { label: string; value: GanttPreset }[] = [
  { label: '当前活动', value: 'activity' },
  { label: '全部', value: 'all' },
  { label: '近 10 分钟', value: '10m' },
  { label: '近 1 小时', value: '1h' },
]

/** 悬停目标只记条带身份：运行中的条每秒更新，提示按身份取最新的条。 */
interface HoverTarget {
  readonly barId: string
  readonly deviceName: string
  readonly x: number
  readonly y: number
}

interface TooltipHandle {
  show(target: HoverTarget | null): void
}

export interface GanttChartProps {
  readonly lanes: readonly GanttLane[]
  readonly range: TimeWindow | null
  /** 当前服务端时刻（秒）。 */
  readonly now: number
  /** 给定时只突出该任务的条，其他任务的占用以灰色显示。 */
  readonly focusTaskId?: string
  readonly taskName: (taskId: string) => string
  readonly onOpen: (bar: GanttBar) => void
  /** 提示末尾的操作说明，例如“点击打开节点详情”。 */
  readonly openHint: (bar: GanttBar) => string
}

/**
 * 甘特图主体：设备泳道（左列固定）、时间轴（滚动时吸顶）、“现在”线与可缩放/平移的时间窗。
 * 只绘制与时间窗相交的条；悬停或键盘聚焦显示明细，点击或回车打开对应节点。
 */
export function GanttChart({
  lanes,
  range,
  now,
  focusTaskId,
  taskName,
  onOpen,
  openHint,
}: GanttChartProps) {
  const patternId = `gantt-manual-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const shellRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<SVGSVGElement | null>(null)
  const [width, setWidth] = useState(960)
  useEffect(() => {
    const element = frameRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(320, entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const labelWidth = width < 640 ? 116 : 184
  const plotWidth = Math.max(200, width - labelWidth)

  const [preset, setPreset] = useState<GanttPreset | null>('activity')
  const [custom, setCustom] = useState<TimeWindow | null>(null)
  const computed = useMemo(
    () => custom ?? presetWindow(preset ?? 'activity', { range, lanes, now }),
    [custom, lanes, now, preset, range],
  )
  // 预设窗口按整齐步长推进；只在端点真正变化时更新，避免每秒重排所有条。
  const viewStart = computed.start
  const viewEnd = computed.end
  const view = useMemo<TimeWindow>(() => ({ start: viewStart, end: viewEnd }), [viewStart, viewEnd])
  const span = Math.max(1e-6, view.end - view.start)
  const x = useCallback(
    (t: number) => ((t - view.start) / span) * plotWidth,
    [plotWidth, span, view.start],
  )
  const axis = useMemo(() => axisTicks(view, plotWidth), [plotWidth, view])

  const applyWindow = useCallback((next: TimeWindow) => {
    setCustom(next)
    setPreset(null)
  }, [])
  const viewRef = useRef(view)
  viewRef.current = view

  // Ctrl/⌘ + 滚轮以指针处为中心缩放；横向滚动或 Shift + 滚轮平移；普通滚轮仍然上下滚动泳道。
  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      const plot = plotRef.current
      if (!plot) return
      const rect = plot.getBoundingClientRect()
      const current = viewRef.current
      const currentSpan = current.end - current.start
      const plotPx = rect.width || 1
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const anchor = current.start + ((event.clientX - rect.left) / plotPx) * currentSpan
        applyWindow(
          zoomWindow(current, Math.exp(Math.max(-1, Math.min(1, event.deltaY * 0.002))), anchor),
        )
        return
      }
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault()
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        applyWindow(panWindow(current, (delta / plotPx) * currentSpan))
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [applyWindow])

  const drag = useRef<{ x: number; window: TimeWindow; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('[data-bar]')) return
    drag.current = { x: event.clientX, window: view, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.x
    if (!current.moved && Math.abs(dx) < 3) return
    current.moved = true
    const currentSpan = current.window.end - current.window.start
    applyWindow(panWindow(current.window, (-dx / plotWidth) * currentSpan))
  }
  const endDrag = () => {
    drag.current = null
    setDragging(false)
  }

  // 提示状态放在独立组件里：鼠标移动只重绘提示，不重建几百个条带。
  const tooltip = useRef<TooltipHandle | null>(null)
  const showDetail = useCallback(
    (bar: GanttBar | null, deviceName = '', clientX = 0, clientY = 0) => {
      if (!bar) {
        tooltip.current?.show(null)
        return
      }
      const rect = shellRef.current?.getBoundingClientRect()
      tooltip.current?.show({
        barId: bar.id,
        deviceName,
        x: clientX - (rect?.left ?? 0),
        y: clientY - (rect?.top ?? 0),
      })
    },
    [],
  )
  const barsById = useMemo(
    () => new Map(lanes.flatMap((lane) => lane.bars.map((bar) => [bar.id, bar] as const))),
    [lanes],
  )

  const layout = useMemo(() => {
    let top = 0
    return lanes.map((lane) => {
      const height = laneHeight(lane.rows)
      const item = { lane, top, height }
      top += height
      return item
    })
  }, [lanes])
  const bodyHeight = layout.reduce((sum, item) => sum + item.height, 0)
  // 分层绘制：泳道底色 → 网格 → 条带 → “现在”线，网格不压在条带上。
  const laneBackgrounds = layout.map(({ lane, top, height }, index) => (
    <g key={lane.deviceId} transform={`translate(0 ${top})`}>
      <rect
        className={styles.laneBg}
        x={0}
        y={0}
        width={plotWidth}
        height={height}
        data-odd={index % 2}
      />
      <line className={styles.laneRule} x1={0} x2={plotWidth} y1={height - 0.5} y2={height - 0.5} />
    </g>
  ))
  let visibleBars = 0
  const laneBars = layout.map(({ lane, top }) => {
    const bars = lane.bars.filter((bar) => intersectsWindow(bar, view))
    visibleBars += bars.length
    return (
      <g key={lane.deviceId} transform={`translate(0 ${top})`}>
        {bars.map((bar) => {
          const x1 = clampX(x(bar.start), plotWidth)
          const x2 = clampX(x(Math.min(bar.end, view.end)), plotWidth)
          const extension =
            bar.kind === 'running' && bar.estimatedEnd !== undefined && bar.estimatedEnd > bar.end
              ? Math.max(0, clampX(x(bar.estimatedEnd), plotWidth) - x2)
              : 0
          return (
            <GanttBarShape
              key={bar.id}
              bar={bar}
              x={x1}
              width={Math.max(3, x2 - x1)}
              extension={extension}
              y={LANE_PAD + bar.row * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2}
              dimmed={Boolean(focusTaskId) && bar.taskId !== focusTaskId}
              taskName={taskName(bar.taskId)}
              deviceName={lane.name}
              patternId={patternId}
              onDetail={showDetail}
              onOpen={onOpen}
            />
          )
        })}
      </g>
    )
  })

  const nowVisible = now >= view.start && now <= view.end
  const nowX = x(now)
  return (
    <div className={styles.chartArea}>
      <div className={styles.chartControls}>
        <Segmented
          size="small"
          value={preset ?? 'custom'}
          onChange={(value) => {
            setPreset(value as GanttPreset)
            setCustom(null)
          }}
          options={PRESETS}
        />
        <div className={styles.zoomGroup} role="group" aria-label="缩放与平移">
          <Tooltip title="缩小（看更长时间）">
            <Button
              size="small"
              icon={<AppIcon name="general/minus" size={14} />}
              aria-label="缩小时间轴"
              onClick={() => applyWindow(zoomWindow(view, 2, nowVisible ? now : undefined))}
            />
          </Tooltip>
          <Tooltip title="放大（看更多细节）">
            <Button
              size="small"
              icon={<AppIcon name="general/plus" size={14} />}
              aria-label="放大时间轴"
              onClick={() => applyWindow(zoomWindow(view, 0.5, nowVisible ? now : undefined))}
            />
          </Tooltip>
          <Tooltip title="向前（更早）">
            <Button
              size="small"
              icon={<AppIcon name="arrows/chevron-left" size={14} />}
              aria-label="向更早平移"
              onClick={() => applyWindow(panWindow(view, -span / 2))}
            />
          </Tooltip>
          <Tooltip title="向后（更晚）">
            <Button
              size="small"
              icon={<AppIcon name="arrows/chevron-right" size={14} />}
              aria-label="向更晚平移"
              onClick={() => applyWindow(panWindow(view, span / 2))}
            />
          </Tooltip>
          <Button
            size="small"
            icon={<AppIcon name="general/target-04" size={14} />}
            onClick={() => applyWindow(centerOnNow(view, now))}
          >
            回到现在
          </Button>
        </div>
        <span className={styles.windowText}>
          {formatClock(view.start)} – {formatClock(view.end)} · 跨度 {formatSpan(span)}
          {!preset && <Tag className={styles.customTag}>自定义视图</Tag>}
        </span>
        <span className={styles.controlHint}>拖动空白处平移，Ctrl/⌘ + 滚轮缩放</span>
      </div>

      <div className={styles.chartShell} ref={shellRef}>
        <div className={styles.frame} ref={frameRef}>
          <div className={styles.header} style={{ height: AXIS_HEIGHT }}>
            <div className={styles.corner} style={{ width: labelWidth, minWidth: labelWidth }}>
              设备
            </div>
            <svg className={styles.axis} width={plotWidth} height={AXIS_HEIGHT} aria-hidden="true">
              {axis.ticks.map((tick) => {
                const tickX = x(tick.t)
                return (
                  <g key={tick.t} transform={`translate(${tickX} 0)`}>
                    <line
                      className={clsx(styles.axisTick, tick.dayStart && styles.axisTickDay)}
                      y1={AXIS_HEIGHT - 6}
                      y2={AXIS_HEIGHT}
                    />
                    {/* 右端放不下完整标签时只画刻度线。 */}
                    {tickX <= plotWidth - tick.label.length * 6.5 - 6 && (
                      <text className={styles.tickLabel} x={4} y={AXIS_HEIGHT - 8}>
                        {tick.label}
                      </text>
                    )}
                  </g>
                )
              })}
              {nowVisible && <NowLabel x={nowX} plotWidth={plotWidth} now={now} />}
            </svg>
          </div>
          <div className={styles.body}>
            <div className={styles.labels} style={{ width: labelWidth, minWidth: labelWidth }}>
              {layout.map(({ lane, height }) => (
                <LaneLabel key={lane.deviceId} lane={lane} height={height} />
              ))}
            </div>
            <div className={styles.plotWrap}>
              <svg
                ref={plotRef}
                className={clsx(styles.plot, dragging && styles.plotDragging)}
                width={plotWidth}
                height={bodyHeight}
                role="group"
                aria-label={`调度甘特图：${lanes.length} 台设备，当前时间窗内 ${visibleBars} 个动作`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <defs>
                  <pattern
                    id={patternId}
                    width="8"
                    height="8"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="8" height="8" fill="#fff4e3" />
                    <rect width="3" height="8" fill="#f2cf98" />
                  </pattern>
                </defs>
                {laneBackgrounds}
                {axis.ticks.map((tick) => (
                  <line
                    key={tick.t}
                    className={clsx(styles.grid, tick.dayStart && styles.gridDay)}
                    x1={x(tick.t)}
                    x2={x(tick.t)}
                    y1={0}
                    y2={bodyHeight}
                  />
                ))}
                {laneBars}
                {nowVisible && (
                  <line className={styles.nowLine} x1={nowX} x2={nowX} y1={0} y2={bodyHeight} />
                )}
              </svg>
              {visibleBars === 0 && (
                <div className={styles.windowEmpty} role="status">
                  当前时间窗内没有记录，可选“当前活动”或“全部”查看。
                </div>
              )}
            </div>
          </div>
        </div>
        <GanttTooltip
          handle={tooltip}
          barsById={barsById}
          now={now}
          taskName={taskName}
          openHint={openHint}
          containerWidth={width}
        />
      </div>
    </div>
  )
}

function clampX(value: number, plotWidth: number): number {
  return Math.min(plotWidth + 4, Math.max(-4, value))
}

function NowLabel({ x, plotWidth, now }: { x: number; plotWidth: number; now: number }) {
  const text = `现在 ${formatClock(now)}`
  const boxWidth = 86
  const left = Math.min(plotWidth - boxWidth - 1, Math.max(1, x - boxWidth / 2))
  return (
    <g className={styles.nowLabel}>
      <rect x={left} y={2} width={boxWidth} height={15} rx={7.5} />
      <text x={left + boxWidth / 2} y={13} textAnchor="middle">
        {text}
      </text>
      <line x1={x} x2={x} y1={17} y2={AXIS_HEIGHT} />
    </g>
  )
}

function LaneLabel({ lane, height }: { lane: GanttLane; height: number }) {
  const running = lane.bars.some((bar) => bar.open)
  const ids = lane.deviceIds.join(' / ')
  const title = lane.nameKnown
    ? `${lane.name}\n设备 ID：${ids}`
    : `设备 ID：${ids}\nOS 未提供该设备的显示名`
  return (
    <div className={styles.laneLabel} style={{ height }} title={title}>
      <span className={styles.laneName}>
        <span className={styles.laneNameText}>{lane.name}</span>
        {running && <span className={styles.laneBusy}>进行中</span>}
      </span>
      {lane.nameKnown && <span className={styles.laneId}>{ids}</span>}
    </div>
  )
}

/** 估算文字像素宽度：中日韩字符按 11px，其余按 6.5px（11px 字号）。 */
function textWidth(text: string): number {
  let width = 0
  for (const char of text) width += /[⺀-鿿豈-﫿＀-￯]/.test(char) ? 11 : 6.5
  return width
}

export function fitText(text: string, maxPx: number): string {
  if (maxPx <= 12) return ''
  if (textWidth(text) <= maxPx) return text
  let result = ''
  for (const char of text) {
    if (textWidth(`${result}${char}…`) > maxPx) break
    result += char
  }
  return result ? `${result}…` : ''
}

const BAR_GLYPHS: Partial<Record<GanttBarKind | 'failed', string>> = {
  running: '▶ ',
  failed: '✕ ',
}

interface BarShapeProps {
  readonly bar: GanttBar
  readonly x: number
  readonly width: number
  readonly extension: number
  readonly y: number
  readonly dimmed: boolean
  readonly taskName: string
  readonly deviceName: string
  readonly patternId: string
  readonly onDetail: (bar: GanttBar | null, deviceName?: string, x?: number, y?: number) => void
  readonly onOpen: (bar: GanttBar) => void
}

const GanttBarShape = memo(
  function GanttBarShape({
    bar,
    x,
    width,
    extension,
    y,
    dimmed,
    taskName,
    deviceName,
    patternId,
    onDetail,
    onOpen,
  }: BarShapeProps) {
    const failed = isUnsuccessfulBar(bar)
    const status = barStatusText(bar)
    const hue = taskHue(bar.taskId)
    // 黄绿青色相亮度高，白字对比不足，改用深色文字。
    const darkText = hue >= 45 && hue <= 195
    const glyph = (failed ? BAR_GLYPHS.failed : BAR_GLYPHS[bar.kind]) ?? ''
    const text = fitText(`${glyph}${bar.label}`, width - 10)
    const onKeyDown = (event: ReactKeyboardEvent<SVGGElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onOpen(bar)
    }
    return (
      <g
        data-bar={bar.id}
        className={clsx(
          styles.bar,
          styles[`bar-${bar.kind}`],
          failed && styles['bar-failed'],
          dimmed && styles['bar-dimmed'],
          bar.kind === 'planned' && bar.parametersFinal === false && styles['bar-tentative'],
          darkText && styles['bar-dark-text'],
        )}
        style={{ ['--bar-hue' as string]: hue }}
        role="button"
        tabIndex={0}
        aria-label={`${taskName} · ${bar.nodeName} · ${status} · ${deviceName}`}
        onClick={() => onOpen(bar)}
        onKeyDown={onKeyDown}
        onMouseEnter={(event) => onDetail(bar, deviceName, event.clientX, event.clientY)}
        onMouseMove={(event) => onDetail(bar, deviceName, event.clientX, event.clientY)}
        onMouseLeave={() => onDetail(null)}
        onFocus={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          onDetail(bar, deviceName, rect.left + Math.min(rect.width / 2, 40), rect.bottom)
        }}
        onBlur={() => onDetail(null)}
      >
        <rect
          className={styles.barBody}
          x={x}
          y={y}
          width={width}
          height={BAR_HEIGHT}
          rx={4}
          // 内联样式优先于样式表，人工确认条用斜纹填充。
          style={bar.kind === 'manual' ? { fill: `url(#${patternId})` } : undefined}
        />
        {extension > 0 && (
          <rect
            className={styles.barEstimate}
            x={x + width}
            y={y + 1}
            width={extension}
            height={BAR_HEIGHT - 2}
            rx={3}
          />
        )}
        {text && (
          <text className={styles.barText} x={x + 6} y={y + BAR_HEIGHT / 2 + 4}>
            {text}
          </text>
        )}
      </g>
    )
  },
  (previous, next) =>
    previous.bar.id === next.bar.id &&
    previous.bar.kind === next.bar.kind &&
    previous.bar.label === next.bar.label &&
    previous.bar.state === next.bar.state &&
    previous.bar.open === next.bar.open &&
    previous.bar.parametersFinal === next.bar.parametersFinal &&
    previous.x === next.x &&
    previous.width === next.width &&
    previous.extension === next.extension &&
    previous.y === next.y &&
    previous.dimmed === next.dimmed &&
    previous.taskName === next.taskName &&
    previous.deviceName === next.deviceName &&
    previous.patternId === next.patternId &&
    previous.onDetail === next.onDetail &&
    previous.onOpen === next.onOpen,
)

function GanttTooltip({
  handle,
  barsById,
  now,
  taskName,
  openHint,
  containerWidth,
}: {
  handle: RefObject<TooltipHandle | null>
  barsById: ReadonlyMap<string, GanttBar>
  now: number
  taskName: (taskId: string) => string
  openHint: (bar: GanttBar) => string
  containerWidth: number
}) {
  const [target, setTarget] = useState<HoverTarget | null>(null)
  useImperativeHandle(handle, () => ({ show: setTarget }), [])
  const bar = target ? barsById.get(target.barId) : undefined
  if (!target || !bar) return null
  const rows = describeBar(bar, {
    now,
    taskName: taskName(bar.taskId),
    deviceName: target.deviceName,
  })
  const hint = openHint(bar)
  const tooltipWidth = 300
  const left =
    target.x + 14 + tooltipWidth > containerWidth
      ? Math.max(4, target.x - tooltipWidth - 14)
      : target.x + 14
  return (
    <div className={styles.tooltip} style={{ left, top: target.y + 16 }} role="tooltip">
      <dl>
        {rows.map((row) => (
          <div key={row.label} className={styles.tooltipRow}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {hint && <p className={styles.tooltipHint}>{hint}</p>}
    </div>
  )
}

/** 图例样例：与条带使用同一套样式类，保证图例和图中的形状一致。 */
export function LegendSwatch({
  kind,
  failed = false,
  patternId,
}: {
  kind: GanttBarKind
  failed?: boolean
  patternId: string
}) {
  return (
    <svg className={styles.legendSwatch} width={34} height={14} aria-hidden="true">
      <defs>
        <pattern
          id={patternId}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="#fff4e3" />
          <rect width="2.5" height="6" fill="#f2cf98" />
        </pattern>
      </defs>
      <g
        className={clsx(styles[`bar-${kind}`], failed && styles['bar-failed'], styles.legendBar)}
        style={{ ['--bar-hue' as string]: 215 }}
      >
        <rect
          className={styles.barBody}
          x={1}
          y={1}
          width={kind === 'running' ? 18 : 32}
          height={12}
          rx={3}
          style={kind === 'manual' ? { fill: `url(#${patternId})` } : undefined}
        />
        {kind === 'running' && (
          <rect className={styles.barEstimate} x={19} y={1.5} width={14} height={11} rx={2} />
        )}
      </g>
    </svg>
  )
}
