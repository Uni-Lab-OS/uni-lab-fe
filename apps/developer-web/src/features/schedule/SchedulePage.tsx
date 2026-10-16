import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Segmented, Space, Tag, Tooltip } from 'antd'
import { PageHeader } from '../../components/ui/PageHeader'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { navigateTo } from '../../app/navigation'
import { taskDisplayName } from '../overview/taskPresentation'
import { taskNodeNames } from '../tasks/taskDomain'
import {
  buildScheduleGantt,
  formatClock,
  formatSpan,
  taskHue,
  tickStep,
  type GanttBar,
} from './scheduleGanttModel'
import { useScheduleData } from './useScheduleData'
import styles from './SchedulePage.module.scss'

const LANE_HEIGHT = 34
const AXIS_HEIGHT = 28
const LABEL_WIDTH = 150
type Window = 'fit' | '10m' | '1h'

/**
 * 调度甘特图：按设备分泳道展示所有任务的实际执行与 OS 当前时间计划。
 * 实心条是调度器记录的实际区间（派发到观察到结果）；运行中的条画到“现在”，
 * 虚线延伸到预计结束；虚线框是当前已验证候选的预测，不是执行授权，也不代表资源释放。
 */
export function SchedulePage() {
  return (
    <div className={clsx(appShellStyles['page-stack'], sharedStyles['page-stack'])}>
      <PageHeader title="调度" />
      <section
        className={clsx(
          appShellStyles['data-section'],
          sharedStyles['data-section'],
          styles.section,
        )}
      >
        <ScheduleGantt />
      </section>
    </div>
  )
}

/** 可复用的调度甘特图；taskId 给定时只显示该任务的条（其他任务对设备的占用以灰色显示，便于看等待原因）。 */
export function ScheduleGantt({ taskId }: { taskId?: string } = {}) {
  const data = useScheduleData()
  const [windowMode, setWindowMode] = useState<Window>('fit')
  const [tick, setTick] = useState(() => Date.now())
  const hasRunning = (data.timeline?.entries ?? []).some((entry) => entry.endedAt == null)

  // 仅用于推进“现在”线与运行中条的长度（渲染时钟），不推断任何运行状态。
  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hasRunning])

  const now = tick / 1000 + data.serverOffset
  const names = useMemo(() => {
    const tasks = new Map<string, string>()
    const nodes = new Map<string, ReadonlyMap<string, string>>()
    for (const task of data.tasks) {
      tasks.set(task.taskUuid, taskDisplayName(task))
      nodes.set(task.taskUuid, taskNodeNames(task.raw))
    }
    return { tasks, nodes }
  }, [data.tasks])
  const kinds = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of data.tasks) {
      for (const job of task.jobs)
        map.set(`${task.taskUuid}|${job.workflowNodeUuid}`, job.executorKind)
    }
    return map
  }, [data.tasks])
  const gantt = useMemo(
    () =>
      buildScheduleGantt({
        timeline: data.timeline,
        plan: data.plan,
        now,
        label: (taskId, nodeId, fallback) => names.nodes.get(taskId)?.get(nodeId) ?? fallback,
        executorKind: (taskId, nodeId) => kinds.get(`${taskId}|${nodeId}`),
      }),
    [data.plan, data.timeline, kinds, names, now],
  )

  const frame = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(900)
  useEffect(() => {
    const element = frame.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(320, entry!.contentRect.width)),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const view = useMemo(() => {
    if (!gantt.range) return null
    const span = windowMode === '10m' ? 600 : windowMode === '1h' ? 3600 : null
    const end = span ? Math.max(now + span * 0.25, gantt.range.end) : gantt.range.end
    const start = span ? end - span : gantt.range.start
    const total = Math.max(1, end - start)
    const plotWidth = Math.max(200, width - LABEL_WIDTH)
    return { start, end, total, plotWidth, x: (t: number) => ((t - start) / total) * plotWidth }
  }, [gantt.range, now, width, windowMode])

  const plan = data.plan
  return (
    <>
      <div className={styles.toolbar}>
        <Space wrap size={8}>
          <span className={styles.metric}>
            排程方式：
            <strong>
              {plan
                ? plan.enabled
                  ? 'OS 时间排程（CP-SAT）'
                  : `原排序（${plan.algorithm}）`
                : '—'}
            </strong>
          </span>
          {gantt.candidate && (
            <Tag color={gantt.candidate.status === 'OPTIMAL' ? 'green' : 'gold'}>
              {gantt.candidate.status === 'OPTIMAL' ? '最优' : '可行（未证明最优）'}
            </Tag>
          )}
          {gantt.candidateTransient && gantt.candidateProblem ? (
            <Tooltip title="计划随最新状态重算期间暂时隐藏预测条，实际执行记录保留">
              <Tag>{gantt.candidateProblem}</Tag>
            </Tooltip>
          ) : (
            plan && plan.activeSolves > 0 && <Tag>求解中</Tag>
          )}
          {plan && plan.blocked.length > 0 && (
            <Tooltip title={blockedSummary(plan.blocked)}>
              <Tag>时间待定 {plan.blocked.length}</Tag>
            </Tooltip>
          )}
        </Space>
        <Space size={8}>
          <Segmented
            size="small"
            value={windowMode}
            onChange={(value) => setWindowMode(value as Window)}
            options={[
              { label: '全部', value: 'fit' },
              { label: '近 10 分钟', value: '10m' },
              { label: '近 1 小时', value: '1h' },
            ]}
          />
          <Button size="small" loading={data.loading} onClick={data.reload}>
            刷新
          </Button>
        </Space>
      </div>

      {!data.available && (
        <Alert
          type="warning"
          showIcon
          message="当前后端未声明调度观测能力"
          description={data.unavailableReason}
        />
      )}
      {data.error && (
        <Alert
          type="error"
          showIcon
          message="读取调度数据失败"
          description={`${data.error}。预测已隐藏，可点“刷新”重试。`}
        />
      )}
      {gantt.candidateProblem && !gantt.candidateTransient && data.available && !data.error && (
        <Alert
          type="info"
          showIcon
          message={gantt.candidateProblem}
          description="下面只显示已发生的实际执行记录。"
        />
      )}

      <div className={styles.legend} aria-label="图例">
        <span>
          <i className={styles.legendActual} />
          实际执行（派发 → 观察到结果）
        </span>
        <span>
          <i className={styles.legendRunning} />
          运行中（虚线为预计剩余）
        </span>
        <span>
          <i className={styles.legendManual} />
          待人工确认（占用设备，设备未动作）
        </span>
        <span>
          <i className={styles.legendPlanned} />
          OS 当前计划（预测，非执行授权）
        </span>
        <span>
          <i className={styles.legendFailed} />
          失败 / 取消
        </span>
        <span className={styles.legendNote}>颜色区分任务，不表示状态</span>
      </div>

      <div className={styles.frame} ref={frame}>
        {!view ? (
          <p className={styles.empty}>暂无调度记录。启动任务后，这里会按设备显示实际执行与计划。</p>
        ) : (
          <div className={styles.chart}>
            <div className={styles.labels} style={{ width: LABEL_WIDTH }}>
              <div style={{ height: AXIS_HEIGHT }} />
              {gantt.lanes.map((lane) => (
                <div
                  key={lane.deviceId}
                  className={styles.laneLabel}
                  style={{ height: LANE_HEIGHT }}
                  title={lane.deviceId}
                >
                  {lane.deviceId}
                </div>
              ))}
            </div>
            <svg
              className={styles.plot}
              width={view.plotWidth}
              height={AXIS_HEIGHT + gantt.lanes.length * LANE_HEIGHT}
              role="img"
              aria-label="调度甘特图"
            >
              <defs>
                <pattern
                  id="gantt-manual"
                  width="8"
                  height="8"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="8" height="8" fill="#fff4e3" />
                  <rect width="3" height="8" fill="#f2cf98" />
                </pattern>
              </defs>
              <Axis view={view} height={AXIS_HEIGHT + gantt.lanes.length * LANE_HEIGHT} />
              {gantt.lanes.map((lane, laneIndex) => (
                <g
                  key={lane.deviceId}
                  transform={`translate(0, ${AXIS_HEIGHT + laneIndex * LANE_HEIGHT})`}
                >
                  <rect
                    className={styles.laneBg}
                    x={0}
                    y={0}
                    width={view.plotWidth}
                    height={LANE_HEIGHT}
                    data-odd={laneIndex % 2}
                  />
                  {lane.bars
                    .filter((bar) => bar.end >= view.start && bar.start <= view.end)
                    .map((bar) => (
                      <Bar
                        key={bar.id}
                        bar={bar}
                        dimmed={Boolean(taskId) && bar.taskId !== taskId}
                        view={view}
                        taskName={names.tasks.get(bar.taskId) ?? bar.taskId.slice(0, 8)}
                      />
                    ))}
                </g>
              ))}
              {now >= view.start && now <= view.end && (
                <line
                  className={styles.nowLine}
                  x1={view.x(now)}
                  x2={view.x(now)}
                  y1={0}
                  y2={AXIS_HEIGHT + gantt.lanes.length * LANE_HEIGHT}
                />
              )}
            </svg>
          </div>
        )}
      </div>

      {gantt.tasks.length > 0 && (
        <table className={styles.summary}>
          <thead>
            <tr>
              <th>任务</th>
              <th>首个动作派发</th>
              <th>已执行到</th>
              <th>计划覆盖到</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {gantt.tasks
              .filter((task) => !taskId || task.taskId === taskId)
              .map((task) => (
                <tr key={task.taskId}>
                  <td>
                    <button
                      type="button"
                      className={styles.taskLink}
                      onClick={() =>
                        navigateTo('tasks', `?task=${encodeURIComponent(task.taskId)}`)
                      }
                    >
                      <i style={{ background: `hsl(${taskHue(task.taskId)} 60% 55%)` }} />
                      {names.tasks.get(task.taskId) ?? task.taskId.slice(0, 8)}
                    </button>
                  </td>
                  <td>{task.firstStart ? formatClock(task.firstStart) : '—'}</td>
                  <td>
                    {task.lastActualEnd ? formatClock(task.lastActualEnd) : '—'}
                    {task.firstStart && task.lastActualEnd
                      ? `（${formatSpan(task.lastActualEnd - task.firstStart)}）`
                      : ''}
                  </td>
                  <td>{task.plannedEnd ? formatClock(task.plannedEnd) : '—'}</td>
                  <td className={styles.muted}>
                    {task.partial
                      ? '计划只覆盖已知前缀（分支、人工确认或循环后续待定）'
                      : task.plannedEnd
                        ? '预测结束不代表实际完成'
                        : ''}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </>
  )
}

const BLOCKED_REASONS: Record<string, string> = {
  human_confirmation_required: '前面有人工确认',
  condition_unresolved: '条件分支未决',
  loop_tail_unknown: '循环轮数未定',
}

/** 按原因类型汇总“时间待定”节点（原因串如 condition_unresolved:<节点>;…，只取类型）。 */
function blockedSummary(blocked: readonly { readonly reason: string }[]): string {
  const counts = new Map<string, number>()
  for (const item of blocked) {
    const kinds = new Set(
      item.reason
        .split(';')
        .map((part) => part.split(':')[0]!.trim())
        .filter(Boolean),
    )
    for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${BLOCKED_REASONS[kind] ?? kind}：${count} 个节点`)
    .join('\n')
}

function Axis({
  view,
  height,
}: {
  view: { start: number; end: number; total: number; x: (t: number) => number }
  height: number
}) {
  const step = tickStep(view.total)
  const first = Math.ceil(view.start / step) * step
  const ticks: number[] = []
  for (let t = first; t <= view.end; t += step) ticks.push(t)
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line
            className={styles.grid}
            x1={view.x(t)}
            x2={view.x(t)}
            y1={AXIS_HEIGHT - 6}
            y2={height}
          />
          <text className={styles.tick} x={view.x(t) + 3} y={AXIS_HEIGHT - 10}>
            {formatClock(t)}
          </text>
        </g>
      ))}
    </g>
  )
}

function Bar({
  bar,
  view,
  taskName,
  dimmed = false,
}: {
  bar: GanttBar
  dimmed?: boolean
  view: { start: number; end: number; x: (t: number) => number }
  taskName: string
}) {
  const hue = taskHue(bar.taskId)
  const saturation = dimmed ? 0 : 60
  const x = Math.max(0, view.x(bar.start))
  const x2 = view.x(Math.min(bar.end, view.end))
  const w = Math.max(2, x2 - x)
  const failed =
    bar.kind === 'actual' &&
    bar.state &&
    !['succeeded', 'success', 'normal', 'finished'].includes(bar.state)
  const title = [
    `${taskName} · ${bar.label}`,
    `设备：${bar.deviceId}`,
    bar.kind === 'planned'
      ? `计划：${formatClock(bar.start)} → ${formatClock(bar.end)}${bar.parametersFinal === false ? '（参数待定，仅展示）' : ''}`
      : `${formatClock(bar.start)} → ${bar.kind === 'running' ? '运行中' : bar.kind === 'manual' ? '等待人工确认' : formatClock(bar.end)}（${formatSpan(bar.end - bar.start)}）`,
    bar.kind === 'running' && bar.estimatedEnd
      ? `预计结束：${formatClock(bar.estimatedEnd)}${bar.estimatedEnd < bar.end ? '（已超预计）' : ''}`
      : '',
    bar.state ? `结算：${bar.state}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const open = () => navigateTo('tasks', `?task=${encodeURIComponent(bar.taskId)}`)
  return (
    <g
      className={styles.bar}
      onClick={open}
      role="button"
      aria-label={title.split('\n')[0]}
      opacity={dimmed ? 0.7 : 1}
    >
      <title>{title}</title>
      {bar.kind === 'manual' ? (
        <rect
          x={x}
          y={6}
          width={w}
          height={LANE_HEIGHT - 12}
          rx={3}
          fill="url(#gantt-manual)"
          stroke="#b5671c"
          strokeWidth={1.5}
        />
      ) : bar.kind === 'planned' ? (
        <rect
          x={x}
          y={7}
          width={w}
          height={LANE_HEIGHT - 14}
          rx={3}
          fill={`hsl(${hue} 70% 55% / 0.12)`}
          stroke={`hsl(${hue} 60% 45%)`}
          strokeDasharray="4 3"
        />
      ) : (
        <rect
          x={x}
          y={6}
          width={w}
          height={LANE_HEIGHT - 12}
          rx={3}
          fill={`hsl(${hue} ${saturation}% ${dimmed ? 78 : 55}%)`}
          stroke={failed ? '#c0392b' : bar.kind === 'running' ? '#e08a1e' : 'none'}
          strokeWidth={failed || bar.kind === 'running' ? 2 : 0}
        />
      )}
      {bar.kind === 'running' && bar.estimatedEnd && bar.estimatedEnd > bar.end && (
        <rect
          x={x2}
          y={6}
          width={Math.max(0, view.x(Math.min(bar.estimatedEnd, view.end)) - x2)}
          height={LANE_HEIGHT - 12}
          rx={3}
          fill="none"
          stroke={`hsl(${hue} 60% 45%)`}
          strokeDasharray="4 3"
        />
      )}
      {w > 60 && (
        <text
          className={clsx(
            styles.barText,
            (bar.kind === 'planned' || bar.kind === 'manual') && styles.barTextPlanned,
          )}
          x={x + 5}
          y={LANE_HEIGHT / 2 + 4}
        >
          {bar.label.length > w / 7
            ? `${bar.label.slice(0, Math.max(1, Math.floor(w / 7) - 1))}…`
            : bar.label}
        </text>
      )}
    </g>
  )
}
