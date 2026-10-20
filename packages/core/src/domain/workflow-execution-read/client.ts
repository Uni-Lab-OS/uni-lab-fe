import type { RequestTransport } from '../../transport/request'
import {
  decodeTaskJobs,
  decodeTaskPage,
  decodeTaskPresentationPage,
  decodeTaskRuntimeDetail,
  unwrapTaskRecord,
} from './codec'
import { decodeNodeJobDetail, decodeNodeJobFeedbackPage } from './codec'
import { decodeTaskSummaryPage } from './summary-codec'
import type { TaskListFilters, WorkflowExecutionReadPort } from './port'
import type {
  NodeJobFeedbackResponse,
  TaskJobsResponse,
  TaskListResponse,
  TaskPresentationResponse,
  WorkflowExecutionRecord,
} from './api'
import { WorkflowExecutionReadError } from './errors'

// 首次完整定义、旧端点及 Jobs 仍可能很大，保留原分支的读取超时预算。
const TASK_PROJECTION_TIMEOUT_MS = 45_000

export class WorkflowExecutionReadClient implements WorkflowExecutionReadPort {
  // This client belongs to one endpoint/profile; cache immutable definitions only.
  private readonly definitions = new Map<string, WorkflowExecutionRecord>()
  private readonly pendingDetails = new Map<
    string,
    Promise<ReturnType<typeof decodeTaskRuntimeDetail>>
  >()

  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1',
  ) {}

  getTaskDetail(taskUuid: string) {
    const pending = this.pendingDetails.get(taskUuid)
    if (pending) return pending
    const request = this.readTaskDetail(taskUuid).finally(() =>
      this.pendingDetails.delete(taskUuid),
    )
    this.pendingDetails.set(taskUuid, request)
    return request
  }

  private async readTaskDetail(taskUuid: string) {
    const cached = this.definitions.get(taskUuid)
    const url = `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}`
    // OS 把任务包在 {code, data} 里：版本比对、合并与缓存都必须作用于任务本身，
    // 否则缓存永远写不进去，每次刷新都会重新读取完整定义。
    const read = async (target: string) =>
      unwrapTaskRecord(
        (
          await this.transport.request<WorkflowExecutionRecord>({
            method: 'GET',
            url: target,
            timeoutMs: TASK_PROJECTION_TIMEOUT_MS,
          })
        ).data,
      )
    let task = await read(cached ? `${url}?projection=state` : url)
    if (cached && task.definition_version === cached.definition_version) {
      return decodeTaskRuntimeDetail({ ...cached, ...task })
    }
    if (cached && (!('workflow_snapshot' in task) || !('execution_plan' in task))) {
      task = await read(url)
    }
    const decoded = decodeTaskRuntimeDetail(task)
    this.definitions.delete(taskUuid)
    if (
      typeof task.definition_version === 'string' &&
      task.definition_version &&
      'workflow_snapshot' in task &&
      'execution_plan' in task
    ) {
      this.definitions.set(taskUuid, {
        definition_version: task.definition_version,
        workflow_snapshot: task.workflow_snapshot,
        execution_plan: task.execution_plan,
      })
      // Large plans dominate memory; retain at most two task definitions.
      while (this.definitions.size > 2)
        this.definitions.delete(this.definitions.keys().next().value!)
    }
    return decoded
  }

  async listTasks(
    input: {
      readonly page?: number
      readonly pageSize?: number
      readonly workflowUuid?: string
      readonly executionKind?: string
      readonly status?: string
      readonly cleanupStatus?: string
    } = {},
  ) {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      page_size: String(input.pageSize ?? 20),
    })
    add(params, 'workflow_uuid', input.workflowUuid)
    add(params, 'execution_kind', input.executionKind)
    add(params, 'status', input.status)
    add(params, 'cleanup_status', input.cleanupStatus)
    const response = await this.transport.request<TaskListResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-tasks?${params.toString()}`,
    })
    return decodeTaskPage(response.data)
  }

  async listTaskPresentations(
    input: {
      readonly page?: number
      readonly pageSize?: number
      readonly workflowUuid?: string
      readonly executionKind?: string
      readonly status?: string
      readonly cleanupStatus?: string
      readonly view?: string
      readonly terminalLimit?: number
    } = {},
  ) {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      page_size: String(input.pageSize ?? 20),
    })
    add(params, 'workflow_uuid', input.workflowUuid)
    add(params, 'execution_kind', input.executionKind)
    add(params, 'status', input.status)
    add(params, 'cleanup_status', input.cleanupStatus)
    add(params, 'view', input.view)
    if (input.terminalLimit !== undefined) params.set('terminal_limit', String(input.terminalLimit))
    const response = await this.transport.request<TaskPresentationResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-task-presentations?${params.toString()}`,
      timeoutMs: TASK_PROJECTION_TIMEOUT_MS,
    })
    return decodeTaskPresentationPage(response.data)
  }

  async listTaskSummaries(input: TaskListFilters = {}) {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      page_size: String(input.pageSize ?? 20),
    })
    add(params, 'workflow_uuid', input.workflowUuid)
    add(params, 'execution_kind', input.executionKind)
    add(params, 'status', input.status)
    add(params, 'cleanup_status', input.cleanupStatus)
    params.set('view', 'summary')
    // 摘要不含执行计划与逐 Job 数组，体积小；沿用传输层默认超时。
    const response = await this.transport.request<TaskPresentationResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-task-presentations?${params.toString()}`,
    })
    return decodeTaskSummaryPage(response.data)
  }

  async listTaskJobs(taskUuid: string) {
    const response = await this.transport.request<TaskJobsResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}/jobs`,
      timeoutMs: TASK_PROJECTION_TIMEOUT_MS,
    })
    return decodeTaskJobs(response.data)
  }

  async getNodeJobDetail(jobUuid: string) {
    const response = await this.transport.request<WorkflowExecutionRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-node-jobs/${encodeURIComponent(jobUuid)}`,
    })
    return decodeNodeJobDetail(response.data)
  }

  async listNodeJobFeedback(
    jobUuid: string,
    input: { readonly afterSequence?: number; readonly limit?: number } = {},
  ) {
    const afterSequence = input.afterSequence ?? 0
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new WorkflowExecutionReadError(
        'INVALID_FEEDBACK_RESPONSE',
        'feedback afterSequence must be a non-negative safe integer',
      )
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new WorkflowExecutionReadError(
        'INVALID_FEEDBACK_RESPONSE',
        'feedback limit must be a positive safe integer',
      )
    }

    const accepted = [] as Awaited<ReturnType<typeof decodeNodeJobFeedbackPage>>['items'][number][]
    const identities = new Set<string>()
    let backendHasMore = false
    let raw: Readonly<Record<string, unknown>> = {}

    for (let page = 1; page <= 100; page += 1) {
      const params = new URLSearchParams({ page: String(page), page_size: '500' })
      const response = await this.transport.request<NodeJobFeedbackResponse>({
        method: 'GET',
        url: `${this.apiPrefix}/workflow-node-jobs/${encodeURIComponent(jobUuid)}/feedback?${params.toString()}`,
      })
      const decoded = decodeNodeJobFeedbackPage(response.data)
      raw = decoded.raw
      backendHasMore = decoded.hasMore
      for (const item of decoded.items) {
        if (item.jobUuid !== jobUuid) {
          throw new WorkflowExecutionReadError(
            'INVALID_FEEDBACK_RESPONSE',
            `feedback ${item.feedbackUuid} does not belong to job ${jobUuid}`,
          )
        }
        if (item.sequence <= afterSequence) continue
        const identity = `${item.jobUuid}:${item.sequence}`
        if (identities.has(identity)) {
          throw new WorkflowExecutionReadError(
            'INVALID_FEEDBACK_RESPONSE',
            `duplicate feedback sequence: ${identity}`,
          )
        }
        identities.add(identity)
        accepted.push(item)
      }
      if (accepted.length >= limit || !decoded.hasMore) break
      if (page === 100) {
        throw new WorkflowExecutionReadError(
          'INVALID_FEEDBACK_RESPONSE',
          'feedback page budget exceeded',
        )
      }
    }

    accepted.sort((left, right) => left.sequence - right.sequence)
    const items = accepted.slice(0, limit)
    return {
      items,
      nextCursor: items.at(-1)?.sequence ?? afterSequence,
      hasMore: accepted.length > items.length || backendHasMore,
      raw,
    }
  }
}

function add(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') params.set(key, value)
}
