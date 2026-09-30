import type {
  NodeJobFeedbackPage,
  TaskJobSummary,
  TaskRuntimeDetail,
  TaskRuntimePresentation,
  WorkflowNodeJobDetail,
  TaskRuntimePresentationPage
} from '../../domain/workflow-execution-read/model'
import type {
  WorkflowDebugFacts,
  WorkflowTaskCommandReceipt
} from '../../domain/workflow-execution-read/model'
import type {
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary
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
}

export interface WorkflowDebuggingViewModel {
  readonly kind: 'workflow_debugging'
  readonly query: WorkflowDebuggingQuery
  readonly workflows: readonly PublishedWorkflowRevisionSummary[]
  readonly tasks: readonly TaskRuntimePresentation[]
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
  page: TaskRuntimePresentationPage,
  workflows: readonly PublishedWorkflowRevisionSummary[] = []
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
    lastCommand: null
  }
}

export function projectWorkflowDebugFacts(
  viewModel: WorkflowDebuggingViewModel,
  facts: WorkflowDebugFacts,
  jobs = viewModel.selectedJobs,
  task = viewModel.selectedTask
): WorkflowDebuggingViewModel {
  const timeline = jobs
    .slice()
    .sort((left, right) => left.topologicalIndex - right.topologicalIndex)
    .map((job) => {
      const syntheticCompletion = ['workflow_input', 'workflow_output'].includes(job.executorKind)
        && ['succeeded', 'failed', 'canceled', 'timeout'].includes(job.status)
      const rawCreatedAt = syntheticCompletion ? rawTimestamp(job.raw, 'create_time') : null
      const rawFinishedAt = syntheticCompletion ? rawTimestamp(job.raw, 'finished_at') : null
      return {
        jobUuid: job.jobUuid,
        workflowNodeUuid: job.workflowNodeUuid,
        nodeLabel: resolveNodeLabel(task, job.workflowNodeUuid, job.topologicalIndex),
        status: job.status,
        attempt: job.attempt,
        topologicalIndex: job.topologicalIndex,
        executorKind: job.executorKind,
        startedAt: job.startedAt ?? rawCreatedAt ?? rawFinishedAt,
        finishedAt: job.finishedAt ?? rawFinishedAt,
        waitReason: job.waitReason,
        errorInfo: job.errorInfo
      }
    })
  const focusJob = jobs.find((job) => ['running', 'intervention_required', 'execution_unknown', 'pending', 'dispatched'].includes(job.status))
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
      canCancel: !['succeeded', 'failed', 'canceled', 'timeout'].includes(taskStatus) && taskStatus !== ''
    },
    currentFocus: focusJob
      ? {
          reason: focusJob.status === 'execution_unknown' ? 'execution_unknown' :
            focusJob.status === 'intervention_required' ? 'intervention_required' :
              Object.keys(focusJob.waitReason).length > 0 ? 'resource_wait' : focusJob.status,
          nodeUuid: focusJob.workflowNodeUuid,
          jobUuid: focusJob.jobUuid
        }
      : task?.attentionReason
        ? { reason: task.attentionReason, nodeUuid: null, jobUuid: null }
        : null
  }
}

function resolveTaskTitle(task: TaskRuntimeDetail): string {
  const raw = task.raw
  const metadata = asRecord(raw.meta_data)
  const snapshot = asRecord(raw.workflow_snapshot)
  const workflow = asRecord(snapshot?.workflow)
  const explicit = [raw.name, raw.task_name, metadata?.name, metadata?.task_name]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (explicit) return explicit
  const workflowName = workflow?.name
  if (typeof workflowName === 'string' && workflowName.trim().length > 0) return workflowName
  const description = task.description?.trim()
  if (description && !/^从.+创建$/.test(description)) return description
  return `Task ${task.taskUuid.slice(0, 8)}`
}

function resolveNodeLabel(task: TaskRuntimeDetail | null, nodeUuid: string, topologicalIndex: number): string {
  const snapshot = asRecord(task?.raw.workflow_snapshot)
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  const node = nodes
    .map(asRecord)
    .find((candidate) => candidate?.uuid === nodeUuid)
  const explicit = [node?.name, node?.action_name, node?.description]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  if (explicit) return explicit
  return Number.isFinite(topologicalIndex) ? `节点 ${topologicalIndex + 1}` : '未命名节点'
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null
}

function rawTimestamp(raw: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function emptyControls(): WorkflowDebugControls {
  return { canStep: false, canPause: false, canResume: false, canCancel: false }
}
