import type {
  NodeJobFeedbackPage,
  TaskJobSummary,
  TaskRuntimeDetail,
  TaskRuntimeListItem,
  TaskRuntimeListPage,
  WorkflowNodeJobDetail,
} from '../../domain/workflow-execution-read/model'
import type {
  WorkflowDebugFacts,
  WorkflowTaskCommandReceipt,
} from '../../domain/workflow-execution-read/model'
import type {
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary,
} from '../../domain/workflow-definition/model'

export interface WorkflowDebuggingQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly workflowPage?: number
  readonly workflowPageSize?: number
  readonly workflowUuid?: string
  readonly executionKind?: string
  readonly status?: string
  readonly cleanupStatus?: string
  readonly view?: string
  readonly terminalLimit?: number
  /**
   * 任务列表读取方式：summary 读摘要视图（profile 须声明 workflow.taskPresentationSummary），
   * 缺省读默认展示投影。这是前端读取选择，不作为 view 参数原样下发。
   */
  readonly taskListView?: 'presentation' | 'summary'
}

export interface WorkflowDebuggingViewModel {
  readonly kind: 'workflow_debugging'
  readonly query: WorkflowDebuggingQuery
  readonly workflows: readonly PublishedWorkflowRevisionSummary[]
  readonly tasks: readonly TaskRuntimeListItem[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly selectedTaskUuid: string | null
  readonly selectedTask: TaskRuntimeDetail | null
  /** Human-readable task title projected from the authoritative Task snapshot. */
  readonly selectedTaskTitle: string | null
  readonly selectedWorkflowUuid: string | null
  readonly selectedWorkflow: PublishedWorkflowRevision | null
  readonly selectedJobs: readonly TaskJobSummary[]
  readonly selectedJobUuid: string | null
  readonly selectedJob: WorkflowNodeJobDetail | null
  readonly feedback: NodeJobFeedbackPage | null
  readonly facts: WorkflowDebugFacts | null
  readonly timeline: readonly WorkflowDebugTimelineItem[]
  readonly controls: WorkflowDebugControls
  readonly currentFocus: WorkflowDebugFocus | null
  readonly lastCommand: WorkflowTaskCommandReceipt | null
}

export interface WorkflowDebugTimelineItem {
  readonly jobUuid: string
  readonly workflowNodeUuid: string
  /** Stable display label from the immutable workflow snapshot; never a fabricated UI name. */
  readonly nodeLabel: string
  readonly status: string
  readonly attempt: number
  readonly topologicalIndex: number
  readonly executorKind: string
  readonly startedAt: string | null
  readonly finishedAt: string | null
  readonly waitReason: Readonly<Record<string, unknown>>
  readonly errorInfo: readonly unknown[]
  /**
   * OS 记录的物理不确定原因（job.uncertainty_reason）。结果未知的作业主状态可能仍是
   * running/failed，但实际在等待现场核对与人工处置，界面须如实区分。
   */
  readonly uncertaintyReason?: string | null
  /** false 表示已被重试替代的历史 attempt；时间线默认只突出当前 attempt。 */
  readonly currentAttempt?: boolean
  /** OS 作业创建时间（job.create_time），用于未开始节点的稳定排序与展示。 */
  readonly createdAt?: string | null
  /** 执行设备（实际执行者或快照固定绑定）；人工确认、物料来源等非设备节点为 null。 */
  readonly deviceId?: string | null
}

export interface WorkflowDebugControls {
  readonly canStep: boolean
  readonly canPause: boolean
  readonly canResume: boolean
  readonly canCancel: boolean
}

export interface WorkflowDebugFocus {
  readonly reason: string
  readonly nodeUuid: string | null
  readonly jobUuid: string | null
}

export function createWorkflowDebuggingViewModel(
  query: WorkflowDebuggingQuery,
  page: TaskRuntimeListPage,
  workflows: readonly PublishedWorkflowRevisionSummary[] = [],
): WorkflowDebuggingViewModel {
  return {
    kind: 'workflow_debugging',
    query,
    workflows,
    tasks: page.items,
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    selectedTaskUuid: null,
    selectedTask: null,
    selectedTaskTitle: null,
    selectedWorkflowUuid: null,
    selectedWorkflow: null,
    selectedJobs: [],
    selectedJobUuid: null,
    selectedJob: null,
    feedback: null,
    facts: null,
    timeline: [],
    controls: emptyControls(),
    currentFocus: null,
    lastCommand: null,
  }
}

export function projectWorkflowDebugFacts(
  viewModel: WorkflowDebuggingViewModel,
  facts: WorkflowDebugFacts,
  jobs = viewModel.selectedJobs,
  task = viewModel.selectedTask,
): WorkflowDebuggingViewModel {
  // 大工作流有数千节点：快照节点只建一次索引，不能每个作业线性查找。
  const nodes = snapshotNodeIndex(task)
  const timeline = jobs
    .slice()
    .sort((left, right) => left.topologicalIndex - right.topologicalIndex)
    .map((job) => {
      const syntheticCompletion =
        ['workflow_input', 'workflow_output'].includes(job.executorKind) &&
        ['succeeded', 'failed', 'canceled', 'timeout'].includes(job.status)
      const rawCreatedAt = syntheticCompletion ? rawTimestamp(job.raw, 'create_time') : null
      const rawFinishedAt = syntheticCompletion ? rawTimestamp(job.raw, 'finished_at') : null
      return {
        jobUuid: job.jobUuid,
        workflowNodeUuid: job.workflowNodeUuid,
        nodeLabel: resolveNodeLabel(nodes.get(job.workflowNodeUuid), job.topologicalIndex),
        deviceId: resolveDeviceId(job.controlData, nodes.get(job.workflowNodeUuid)),
        status: job.status,
        attempt: job.attempt,
        topologicalIndex: job.topologicalIndex,
        executorKind: job.executorKind,
        startedAt: job.startedAt ?? rawCreatedAt ?? rawFinishedAt,
        finishedAt: job.finishedAt ?? rawFinishedAt,
        waitReason: job.waitReason,
        errorInfo: job.errorInfo,
        uncertaintyReason:
          typeof job.raw.uncertainty_reason === 'string' && job.raw.uncertainty_reason
            ? job.raw.uncertainty_reason
            : null,
        currentAttempt: job.currentAttempt,
        createdAt: rawTimestamp(job.raw, 'create_time'),
      }
    })
  const focusJob = jobs.find((job) =>
    ['running', 'intervention_required', 'execution_unknown', 'pending', 'dispatched'].includes(
      job.status,
    ),
  )
  const taskStatus = task?.status ?? ''
  const taskCanBeControlled = ['pending', 'running'].includes(taskStatus)
  return {
    ...viewModel,
    facts,
    selectedTaskTitle: task ? resolveTaskTitle(task) : viewModel.selectedTaskTitle,
    timeline,
    controls: {
      canStep: taskCanBeControlled && task?.runMode === 'step' && task?.controlStatus === 'paused',
      canPause: taskCanBeControlled && task?.controlStatus === 'active',
      canResume: taskCanBeControlled && task?.controlStatus === 'paused',
      canCancel:
        !['succeeded', 'failed', 'canceled', 'timeout'].includes(taskStatus) && taskStatus !== '',
    },
    currentFocus: focusJob
      ? {
          reason:
            focusJob.status === 'execution_unknown'
              ? 'execution_unknown'
              : focusJob.status === 'intervention_required'
                ? 'intervention_required'
                : Object.keys(focusJob.waitReason).length > 0
                  ? 'resource_wait'
                  : focusJob.status,
          nodeUuid: focusJob.workflowNodeUuid,
          jobUuid: focusJob.jobUuid,
        }
      : task?.attentionReason
        ? { reason: task.attentionReason, nodeUuid: null, jobUuid: null }
        : null,
  }
}

function resolveTaskTitle(task: TaskRuntimeDetail): string {
  const raw = task.raw
  const metadata = asRecord(raw.meta_data)
  const snapshot = asRecord(raw.workflow_snapshot)
  const workflow = asRecord(snapshot?.workflow)
  const explicit = [raw.name, raw.task_name, metadata?.name, metadata?.task_name].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
  if (explicit) return explicit
  const workflowName = workflow?.name
  if (typeof workflowName === 'string' && workflowName.trim().length > 0) return workflowName
  const description = task.description?.trim()
  if (description && !/^从.+创建$/.test(description)) return description
  return `Task ${task.taskUuid.slice(0, 8)}`
}

function snapshotNodeIndex(
  task: TaskRuntimeDetail | null,
): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const snapshot = asRecord(task?.raw.workflow_snapshot)
  const index = new Map<string, Readonly<Record<string, unknown>>>()
  for (const item of Array.isArray(snapshot?.nodes) ? snapshot.nodes : []) {
    const node = asRecord(item)
    if (node && typeof node.uuid === 'string') index.set(node.uuid, node)
  }
  return index
}

/**
 * 执行设备：已派发作业以 OS 记录的实际执行者为准（control_data.actual_executor），
 * 未派发时用快照节点的固定执行绑定；都没有（如人工确认、物料来源）时为 null。
 */
function resolveDeviceId(
  controlData: Readonly<Record<string, unknown>>,
  node: Readonly<Record<string, unknown>> | undefined,
): string | null {
  const actual = asRecord(controlData.actual_executor)?.local_device_id
  if (typeof actual === 'string' && actual) return actual
  const binding = asRecord(asRecord(asRecord(node?.meta_data)?.unilab)?.executor_binding)?.device_id
  return typeof binding === 'string' && binding ? binding : null
}

function resolveNodeLabel(
  node: Readonly<Record<string, unknown>> | undefined,
  topologicalIndex: number,
): string {
  const explicit = [node?.name, node?.action_name, node?.description].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
  if (explicit) return explicit
  return Number.isFinite(topologicalIndex) ? `节点 ${topologicalIndex + 1}` : '未命名节点'
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function rawTimestamp(raw: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function emptyControls(): WorkflowDebugControls {
  return { canStep: false, canPause: false, canResume: false, canCancel: false }
}
