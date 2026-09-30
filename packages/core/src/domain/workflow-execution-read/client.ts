import type { RequestTransport } from '../../transport/request'
import {
  decodeTaskJobs,
  decodeTaskPage,
  decodeTaskPresentationPage,
  decodeTaskRuntimeDetail,
} from './codec'
import { decodeNodeJobDetail, decodeNodeJobFeedbackPage } from './codec'
import type { WorkflowExecutionReadPort } from './port'
import type {
  NodeJobFeedbackResponse,
  TaskJobsResponse,
  TaskListResponse,
  TaskPresentationResponse,
  WorkflowExecutionRecord,
} from './api'
import { WorkflowExecutionReadError } from './errors'

export class WorkflowExecutionReadClient implements WorkflowExecutionReadPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1',
  ) {}

  async getTaskDetail(taskUuid: string) {
    const response = await this.transport.request<WorkflowExecutionRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}`,
    })
    return decodeTaskRuntimeDetail(response.data)
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
    })
    return decodeTaskPresentationPage(response.data)
  }

  async listTaskJobs(taskUuid: string) {
    const response = await this.transport.request<TaskJobsResponse>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}/jobs`,
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
