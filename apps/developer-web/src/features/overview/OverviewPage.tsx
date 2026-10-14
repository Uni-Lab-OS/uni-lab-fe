import { clsx } from 'clsx'
import overviewPageStyles from './OverviewPage.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Dropdown, Modal, message } from 'antd'
import type { MenuProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { TaskRuntimePresentation } from '@unilab-fe/core'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { AppIcon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { AsyncState } from '../../components/ui/AsyncState'
import type { StudioRoute } from '../../components/AppShell'
import { TaskTable } from './TaskTable'
import { OverviewSkeleton, SummaryStrip, TaskColumn } from './OverviewSections'
import { StationHandlingSection } from '../station-handling/StationHandlingSection'
import { useStationHandling } from '../station-handling/StationHandlingProvider'
import { stationStatusPresentation } from '../station-handling/stationHandlingPresentation'
import { toTaskRow, type TaskRow } from './taskPresentation'
import { useBackend } from '../../app/BackendProvider'
import { DebugTargetModal, type DebugTargetKind } from './DebugTargetModal'

const previewTasksEnabled =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('previewTasks') === '1'

const previewActiveRows: readonly TaskRow[] = [
  previewTaskRow(
    'preview-active-photo',
    'S05 烧杯拍照检测',
    'SZLab 标准物料转运',
    'running',
    68,
    '正在执行拍照检测，等待设备返回结果',
  ),
  previewTaskRow(
    'preview-active-transfer',
    'S09 移液站准备样品',
    '样品前处理工作流',
    'waiting',
    25,
    '等待移液站释放并准备样品',
  ),
  previewTaskRow(
    'preview-active-long-name',
    '批量检测任务：多孔板图像采集与结果分析',
    '高通量筛选工作流',
    'running',
    42,
    '正在分析图像结果',
  ),
  previewTaskRow(
    'preview-active-dosing',
    'S06 注射泵定量加样',
    '液体处理与清洗工作流',
    'waiting',
    75,
    '等待目标容器确认',
  ),
  previewTaskRow(
    'preview-active-stirring',
    'S04 磁搅拌清洗',
    '样品前处理工作流',
    'running',
    88,
    '正在执行清洗步骤',
  ),
]

const previewAttentionRows: readonly TaskRow[] = [
  previewTaskRow(
    'preview-attention-device',
    '设备离线，任务等待恢复',
    'SZLab 标准物料转运',
    'attention',
    null,
    '设备离线，任务等待恢复',
  ),
  previewTaskRow(
    'preview-attention-failed',
    '样品容器校验失败',
    '样品前处理工作流',
    'failed',
    51,
    '参数校验未通过，请检查样品容器',
  ),
  previewTaskRow(
    'preview-attention-timeout',
    '液体处理动作超时，请检查设备状态',
    '液体处理与清洗工作流',
    'attention',
    12,
    '动作执行超时，需要人工确认',
  ),
  previewTaskRow(
    'preview-attention-conflict',
    'S07 固体加料参数冲突',
    '高通量筛选工作流',
    'failed',
    33,
    '输入参数与设备能力不匹配',
  ),
  previewTaskRow(
    'preview-attention-interrupted',
    'S08 开关盖动作中断',
    '设备维护工作流',
    'attention',
    7,
    '设备返回动作中断状态',
  ),
]

function previewTaskRow(
  taskUuid: string,
  name: string,
  workflowName: string,
  status: string,
  progress: number | null,
  description: string,
): TaskRow {
  const task: TaskRuntimePresentation = {
    kind: 'task_runtime_presentation',
    source: 'fixture',
    taskUuid,
    workflowUuid: null,
    executionKind: 'workflow',
    status,
    runMode: 'normal',
    controlStatus: 'active',
    cleanupStatus: 'pending',
    priority: 'normal',
    description: null,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:05:00.000Z',
    finishedAt: null,
    attentionReason: status === 'attention' ? '设备或资源需要关注' : null,
    progress: null,
    jobs: [],
    raw: { name, workflow_name: workflowName },
  }
  return {
    task,
    name,
    workflowName,
    description,
    progress,
    priority: 'normal',
    status,
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:05:00.000Z',
  }
}

/**
 * 看板窗口与「所有任务」表格共用的页大小：投影按 Task 内嵌它自己的全部 Job，
 * 页越大越重，而 OS 的 `_normalize_page` 也会把 page_size 截断到 100。
 */
const TASK_PAGE_SIZE = 20

export function OverviewPage({
  onNavigate,
  onAttentionChange,
}: {
  onNavigate: (route: StudioRoute, search?: string) => void
  onAttentionChange?: (hasAttention: boolean) => void
}) {
  const { backend } = useBackend()
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [totalTasks, setTotalTasks] = useState(0)
  const [debugTargetKind, setDebugTargetKind] = useState<DebugTargetKind | null>(null)
  const [stationDialogOpen, setStationDialogOpen] = useState(false)
  // 看板（指标条、活动/异常两列、导航红点）不能只统计当前页，否则异常任务落在
  // 第 2 页时指标会显示「异常 0」、导航红点会灭。所以它单独读 OS 的矩阵窗口：
  // 一次返回全部活动/需关注 Task 加最近若干条终态，也不必按状态拆成一串请求。
  const windowQuery = useBackendQuery(
    'overview-task-window',
    (backend) =>
      backend.core.executionRead.listTaskPresentations({
        view: 'matrix',
        page: 1,
        terminalLimit: TASK_PAGE_SIZE,
      }),
    { live: true },
  )
  // 「所有任务」表格读真分页：page 进查询身份，切页是向后端要新的一页，
  // 不是在这一批数据上切片。live 仍然只表示「收到全局 SSE 失效后重读当前页」。
  const tableQuery = useBackendQuery(
    `overview-task-page:${page}`,
    (backend) =>
      backend.core.executionRead.listTaskPresentations({
        page,
        pageSize: TASK_PAGE_SIZE,
      }),
    { live: true },
  )
  const { snapshot, readError } = useStationHandling()
  const stationStatus = stationStatusPresentation(snapshot, readError)
  // 对话框只是工站决策的容器：恢复调度（或继续应用）在 OS 侧生效后快照就不再
  // needsAction，此时必须自动收起 —— StationHandlingSection 按同一判定自己隐藏，
  // 不收就会留下一个只有标题的空壳弹窗。判定只认重新读到的快照，不是命令回执。
  useEffect(() => {
    if (stationDialogOpen && !stationStatus.needsAction) setStationDialogOpen(false)
  }, [stationDialogOpen, stationStatus.needsAction])
  const windowRows = useMemo(
    () => (windowQuery.data?.items ?? []).map(toTaskRow),
    [windowQuery.data],
  )
  const pageRows = useMemo(() => (tableQuery.data?.items ?? []).map(toTaskRow), [tableQuery.data])
  // 「全部」是权威总数，只有普通分页查询会带；切页会短暂清空它的投影，所以记住
  // 上一次读到的总数，避免指标条在翻页时闪成 0。
  useEffect(() => {
    if (tableQuery.data) setTotalTasks(tableQuery.data.total)
  }, [tableQuery.data])
  // 首屏要等两份投影都到齐：总数还没读到时先渲染「全部 0」会闪一下。
  const totalPending = tableQuery.loading && totalTasks === 0
  const hasTableFilter = Boolean(keyword.trim()) || status !== 'all'
  // 关键字与状态仍在前端过滤，因此只作用于当前页（展示接口没有 keyword 参数）。
  const filteredRows = pageRows.filter((row) => {
    const matchesKeyword = `${row.name} ${row.workflowName} ${row.task.taskUuid}`
      .toLowerCase()
      .includes(keyword.toLowerCase())
    return matchesKeyword && (status === 'all' || row.status === status)
  })
  const activeRows = windowRows.filter((row) => ['running', 'waiting'].includes(row.status))
  const attentionRows = windowRows.filter(
    (row) => row.status === 'attention' || row.status === 'failed',
  )
  useEffect(() => {
    onAttentionChange?.(attentionRows.length > 0)
  }, [attentionRows.length, onAttentionChange])
  const activePreviewRows =
    previewTasksEnabled && activeRows.length === 0 ? previewActiveRows : activeRows
  const attentionPreviewRows =
    previewTasksEnabled && attentionRows.length === 0 ? previewAttentionRows : attentionRows
  const openTask = (row: TaskRow) =>
    onNavigate('tasks', `?task=${encodeURIComponent(row.task.taskUuid)}`)
  const openTaskByUuid = (taskUuid: string) =>
    onNavigate('tasks', `?task=${encodeURIComponent(taskUuid)}`)
  // 工站错误事实只带 sourceTaskUuid，名称要从任务投影里补。看板窗口保证覆盖
  // 活动/需关注任务，当前页再补上翻到的历史任务。
  const taskNames = useMemo(
    () => new Map([...windowRows, ...pageRows].map((row) => [row.task.taskUuid, row.name])),
    [windowRows, pageRows],
  )
  // 工站级入口收敛到「异常」指标卡：发现 + 去处置都在这里，首屏不再重复横幅与工站卡片。
  const openErrors = (snapshot?.errors ?? []).filter((item) => item.status === 'open')
  const pendingCommands = (snapshot?.controlCommands ?? []).filter((item) => item.needsApply).length
  const stationAlert = stationStatus.needsAction
    ? {
        hint: stationStatus.label,
        primary:
          openErrors.length > 0
            ? { label: '去处置', onClick: () => openTaskByUuid(openErrors[0].sourceTaskUuid) }
            : {
                label: pendingCommands > 0 ? '继续应用' : '恢复调度',
                onClick: () => setStationDialogOpen(true),
              },
        secondary:
          openErrors.length > 1 || pendingCommands > 0
            ? { label: '查看全部', onClick: () => setStationDialogOpen(true) }
            : undefined,
      }
    : undefined
  const newDebugMenu: MenuProps['items'] = [
    {
      key: 'device',
      icon: <AppIcon name="development/cpu-chip-01" size={16} />,
      label: '调试设备',
      onClick: () => setDebugTargetKind('device'),
    },
    {
      key: 'workflow',
      icon: <AppIcon name="development/dataflow-01" size={16} />,
      label: '调试工作流',
      onClick: () => setDebugTargetKind('workflow'),
    },
  ]
  return (
    <div className={clsx(appShellStyles['page-stack'], sharedStyles['page-stack'])}>
      <PageHeader
        title="总览"
        actions={
          <Dropdown menu={{ items: newDebugMenu }} trigger={['click']}>
            <Button
              type="primary"
              size="middle"
              icon={<AppIcon name="media/play-circle" color="white" size={16} />}
            >
              新建调试 <AppIcon name="arrows/chevron-down" color="white" size={14} />
            </Button>
          </Dropdown>
        }
      />
      <AsyncState
        loading={windowQuery.loading || totalPending}
        error={windowQuery.error}
        onRetry={windowQuery.reload}
        empty={!windowQuery.loading && windowRows.length === 0}
        emptyDescription="当前后端没有返回任务记录"
        loadingContent={<OverviewSkeleton />}
      >
        <SummaryStrip rows={windowRows} total={totalTasks} stationAlert={stationAlert} />
        {/* 工站级动作（恢复调度、继续应用、跨任务错误清单）收在按需打开的对话框里，
            默认不占用首屏；错误事实本身仍由每条错误所在的节点抽屉处置。 */}
        <Modal
          open={stationDialogOpen}
          onCancel={() => setStationDialogOpen(false)}
          footer={null}
          width={620}
          title="工站异常处置"
        >
          <StationHandlingSection
            taskNames={taskNames}
            onOpenTask={(taskUuid) => {
              setStationDialogOpen(false)
              openTaskByUuid(taskUuid)
            }}
          />
        </Modal>
        <div
          className={clsx(
            overviewPageStyles['overview-columns'],
            appShellStyles['overview-columns'],
            sharedStyles['overview-columns'],
          )}
        >
          <TaskColumn
            title="活动任务"
            rows={activePreviewRows}
            onView={openTask}
            empty="当前没有活动任务"
          />
          <TaskColumn
            title="异常任务"
            rows={attentionPreviewRows}
            onView={openTask}
            attention
            empty="当前没有异常任务"
          />
        </div>
      </AsyncState>
      {/* 表格单独一道异步门：翻页时只有表格回到加载态，指标条与两列不能被它
          打回骨架屏；看板窗口失败时上面那层已经整页报错，不会重复报一次。 */}
      <AsyncState
        loading={tableQuery.loading}
        error={tableQuery.error}
        onRetry={tableQuery.reload}
        empty={!tableQuery.loading && pageRows.length === 0 && !hasTableFilter}
        emptyDescription="当前后端没有任务记录"
        variant="table"
        tableColumns={6}
      >
        <TaskTable
          rows={filteredRows}
          total={totalTasks}
          page={page}
          pageSize={TASK_PAGE_SIZE}
          onPageChange={setPage}
          keyword={keyword}
          status={status}
          onKeywordChange={(value) => {
            setKeyword(value)
            // 过滤只覆盖当前页，换条件回第一页，不要停在一个被筛空的页上。
            setPage(1)
          }}
          onStatusChange={(value) => {
            setStatus(value)
            setPage(1)
          }}
          onView={openTask}
          onAbort={(row) => {
            Modal.confirm({
              title: '中止任务？',
              content: '将向 Core 控制端口发送 cancel 命令，最终状态以 OS 回传为准。',
              okText: '中止',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: async () => {
                try {
                  const receipt = await backend.core.executionControl.sendTaskCommand(
                    row.task.taskUuid,
                    {
                      type: 'cancel',
                      idempotencyKey: `studio-${row.task.taskUuid}-cancel-${Date.now()}`,
                    },
                  )
                  message.success(
                    receipt.accepted ? '中止命令已接受，等待 OS 生效' : '中止命令未被接受',
                  )
                  // 中止会同时改变表格那一行和看板窗口里的活动/异常计数，两边都重读。
                  windowQuery.reload()
                  tableQuery.reload()
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '中止失败')
                }
              },
            })
          }}
        />
      </AsyncState>
      <DebugTargetModal
        kind={debugTargetKind}
        onCancel={() => setDebugTargetKind(null)}
        onConfirm={(target) => {
          setDebugTargetKind(null)
          onNavigate(
            target.kind === 'device' ? 'devices' : 'workflows',
            target.kind === 'device'
              ? `?debugDevice=${encodeURIComponent(target.uuid)}`
              : `?debugWorkflow=${encodeURIComponent(target.uuid)}`,
          )
        }}
      />
    </div>
  )
}
