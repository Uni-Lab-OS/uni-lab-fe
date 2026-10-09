import { clsx } from 'clsx'
import overviewPageStyles from './OverviewPage.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Dropdown, Modal, message } from 'antd'
import type { MenuProps } from 'antd'
import { useMemo, useState } from 'react'
import type { TaskRuntimePresentation } from '@unilab-fe/core'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { AppIcon } from '../../components/ui/Icon'
import { PageHeader } from '../../components/ui/PageHeader'
import { AsyncState } from '../../components/ui/AsyncState'
import type { StudioRoute } from '../../components/AppShell'
import { TaskTable } from './TaskTable'
import { OverviewSkeleton, SummaryStrip, TaskColumn } from './OverviewSections'
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

export function OverviewPage({
  onNavigate,
}: {
  onNavigate: (route: StudioRoute, search?: string) => void
}) {
  const { backend } = useBackend()
  const query = useBackendQuery('workflow-task-presentations', (backend) =>
    backend.core.executionRead.listTaskPresentations({
      page: 1,
      pageSize: 100,
      terminalLimit: 100,
    }),
  )
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [debugTargetKind, setDebugTargetKind] = useState<DebugTargetKind | null>(null)
  const rows = useMemo(() => (query.data?.items ?? []).map(toTaskRow), [query.data])
  const filteredRows = rows.filter((row) => {
    const matchesKeyword = `${row.name} ${row.workflowName} ${row.task.taskUuid}`
      .toLowerCase()
      .includes(keyword.toLowerCase())
    return matchesKeyword && (status === 'all' || row.status === status)
  })
  const activeRows = rows.filter((row) => ['running', 'waiting'].includes(row.status))
  const attentionRows = rows.filter((row) => row.status === 'attention' || row.status === 'failed')
  const activePreviewRows =
    previewTasksEnabled && activeRows.length === 0 ? previewActiveRows : activeRows
  const attentionPreviewRows =
    previewTasksEnabled && attentionRows.length === 0 ? previewAttentionRows : attentionRows
  const openTask = (row: TaskRow) =>
    onNavigate('tasks', `?task=${encodeURIComponent(row.task.taskUuid)}`)
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
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        empty={!query.loading && rows.length === 0}
        emptyDescription="当前后端没有返回任务记录"
        loadingContent={<OverviewSkeleton />}
      >
        <SummaryStrip rows={rows} />
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
        <TaskTable
          rows={filteredRows}
          keyword={keyword}
          status={status}
          onKeywordChange={setKeyword}
          onStatusChange={setStatus}
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
                  query.reload()
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
