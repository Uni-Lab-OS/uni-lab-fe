import { clsx } from 'clsx'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Alert, Button, Skeleton, Space, Tag, Tooltip } from 'antd'
import { EmptyState } from '@unilab/design-v2'
import { PageHeader } from '../../components/ui/PageHeader'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { navigateTo } from '../../app/navigation'
import { useDeviceNames } from '../../hooks/useDeviceNames'
import { taskDisplayName } from '../overview/taskPresentation'
import { GanttChart, LegendSwatch } from './GanttChart'
import {
  buildScheduleGantt,
  formatClock,
  formatSpan,
  taskHue,
  type GanttBar,
} from './scheduleGanttModel'
import { useScheduleData } from './useScheduleData'
import { collectScheduleNodeFacts, nodeKey } from './scheduleNodeFacts'
import { blockReasonKinds, stalledPlanNodes } from '@unilab-fe/core'
import { usePersistentStalls } from './usePersistentStalls'
import styles from './SchedulePage.module.scss'

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

/** 默认打开方式：进入任务详情并定位到该节点（有作业身份时定位到该次作业）。 */
export function openBarInTasks(bar: Pick<GanttBar, 'taskId' | 'nodeId' | 'jobId' | 'kind'>) {
  const params = new URLSearchParams({ task: bar.taskId, node: bar.nodeId })
  if (bar.jobId && bar.kind !== 'planned') params.set('job', bar.jobId)
  navigateTo('tasks', `?${params.toString()}`)
}

/**
 * 可复用的调度甘特图；taskId 给定时只突出该任务的条（其他任务对设备的占用以灰色显示，便于看等待原因）。
 * onOpenBar 缺省时点击条进入任务详情并定位节点。
 */
export function ScheduleGantt({
  taskId,
  onOpenBar,
}: { taskId?: string; onOpenBar?: (bar: GanttBar) => void } = {}) {
  const data = useScheduleData()
  const deviceNames = useDeviceNames()
  const [tick, setTick] = useState(() => Date.now())
  const hasRunning = (data.timeline?.entries ?? []).some((entry) => entry.endedAt == null)

  // 仅用于推进“现在”线与运行中条的长度（渲染时钟），不推断任何运行状态，也不发请求。
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), hasRunning ? 1000 : 15_000)
    return () => clearInterval(timer)
  }, [hasRunning])

  const now = tick / 1000 + data.serverOffset
  const taskNames = useMemo(
    () => new Map(data.tasks.map((task) => [task.taskUuid, taskDisplayName(task)])),
    [data.tasks],
  )
  const facts = useMemo(() => collectScheduleNodeFacts(data.tasks), [data.tasks])
  const nodeName = useCallback(
    (task: string, node: string) => facts.names.get(nodeKey(task, node)),
    [facts],
  )
  const gantt = useMemo(
    () =>
      buildScheduleGantt({
        timeline: data.timeline,
        plan: data.plan,
        now,
        label: (task, node, fallback) => nodeName(task, node) ?? fallback,
        executorKind: (task, node) => facts.executorKinds.get(nodeKey(task, node)),
        manualDecidedAt: (task, node) => facts.manualDecidedAt.get(nodeKey(task, node)),
        devices: deviceNames,
      }),
    [data.plan, data.timeline, deviceNames, facts, nodeName, now],
  )

  // 只提示持续 60 秒以上的无法排程节点；派发间隙短暂出现的阻塞不提示。
  const rawStalls = useMemo(() => stalledPlanNodes(data.plan), [data.plan])
  const stalled = usePersistentStalls(rawStalls)

  const taskName = useCallback(
    (id: string) => taskNames.get(id) ?? `任务 ${id.slice(0, 8)}`,
    [taskNames],
  )
  const open = useCallback(
    (bar: GanttBar) => (onOpenBar ? onOpenBar(bar) : openBarInTasks(bar)),
    [onOpenBar],
  )
  const openHint = useCallback(
    (bar: GanttBar) =>
      taskId && bar.taskId !== taskId
        ? '点击打开该任务（其他任务对设备的占用）'
        : '点击打开节点详情，或按回车键',
    [taskId],
  )
  const legendId = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  const plan = data.plan
  const firstLoad = data.loadedAt === null
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
          {data.loadedAt !== null && (
            <span className={styles.updatedAt}>更新于 {formatClock(data.loadedAt / 1000)}</span>
          )}
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
      {stalled.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={`OS 无法为 ${stalled.length} 个已就绪节点排程，这些节点不会被派发`}
          description={
            <ul className={styles.stallList}>
              {stalled.slice(0, 5).map((item) => (
                <li key={`${item.taskId}:${item.nodeId}`}>
                  {taskNames.get(item.taskId) ?? item.taskId.slice(0, 8)} ·{' '}
                  {nodeName(item.taskId, item.nodeId) ?? item.nodeId.slice(0, 8)}：{item.reason}
                </li>
              ))}
              {stalled.length > 5 && <li>另有 {stalled.length - 5} 个</li>}
            </ul>
          }
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
          <LegendSwatch kind="actual" patternId={`${legendId}-a`} />
          实际执行（派发 → 观察到结果）
        </span>
        <span>
          <LegendSwatch kind="running" patternId={`${legendId}-r`} />
          {'▶ 运行中（橙色描边，虚线为预计剩余）'}
        </span>
        <span>
          <LegendSwatch kind="manual" patternId={`${legendId}-m`} />
          待人工确认（斜纹，占用设备，设备未动作）
        </span>
        <span>
          <LegendSwatch kind="planned" patternId={`${legendId}-p`} />
          OS 当前计划（虚线框，预测，非执行授权）
        </span>
        <span>
          <LegendSwatch kind="actual" failed patternId={`${legendId}-f`} />
          {'✕ 失败 / 取消（红色描边）'}
        </span>
        <span>
          <i className={styles.legendNow} aria-hidden="true" />
          现在
        </span>
        <span className={styles.legendNote}>条的颜色区分任务，不表示状态</span>
      </div>

      {data.available &&
        (firstLoad && !data.error ? (
          <div className={styles.placeholder} role="status" aria-live="polite">
            <p>正在读取调度数据…</p>
            <Skeleton active title={false} paragraph={{ rows: 5 }} />
          </div>
        ) : gantt.lanes.length === 0 ? (
          <EmptyState
            className={styles.placeholder}
            scene={data.error ? 'operation-failed' : 'no-data'}
            size="compact"
            title={data.error ? '暂时无法显示调度记录' : '暂无调度记录'}
            description={
              data.error
                ? '读取失败且没有已读取的记录，可点“刷新”重试。'
                : '启动任务后，这里会按设备显示实际执行与 OS 计划。'
            }
          />
        ) : (
          <GanttChart
            lanes={gantt.lanes}
            range={gantt.range}
            now={now}
            focusTaskId={taskId}
            taskName={taskName}
            onOpen={open}
            openHint={openHint}
          />
        ))}

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
                      <i style={{ background: `hsl(${taskHue(task.taskId)} 60% 52%)` }} />
                      {taskName(task.taskId)}
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
    const kinds = blockReasonKinds(item.reason)
    for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${BLOCKED_REASONS[kind] ?? kind}：${count} 个节点`)
    .join('\n')
}
