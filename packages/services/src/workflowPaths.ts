import type { BackendConfig } from './backends'
import type { WorkflowListQuery } from './workflowAuthoringContracts'
import type {
  WorkflowNodeJobFeedbackQuery,
  WorkflowTaskListQuery
} from './workflowTaskContracts'

/** 构造共享工作流事件流地址。 */
export function workflowEventsUrl(backend: BackendConfig): string {
  const url = new URL(backend.apiUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/events`
  url.search = ''
  url.hash = ''
  return url.toString()
}

/** 构造工作流任务（WorkflowTask）列表地址。 */
export function workflowTaskListPath(query: WorkflowTaskListQuery): string {
  const search = new URLSearchParams()
  for (const key of [
    'page',
    'page_size',
    'execution_kind',
    'workflow_uuid',
    'status',
    'cleanup_status'
  ] as const) {
    const value = query[key]
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const suffix = search.toString()
  return `/api/v1/workflow-tasks${suffix ? `?${suffix}` : ''}`
}

/** 构造工作流（Workflow）列表地址。 */
export function workflowListPath(query: WorkflowListQuery): string {
  const search = new URLSearchParams()
  if (query.page !== undefined) search.set('page', String(query.page))
  if (query.page_size !== undefined) {
    search.set('page_size', String(query.page_size))
  }
  const suffix = search.toString()
  return `/api/v1/workflows${suffix ? `?${suffix}` : ''}`
}

/** 构造工作流节点作业反馈分页地址。 */
export function workflowNodeJobFeedbackPath(
  jobUuid: string,
  query: WorkflowNodeJobFeedbackQuery
): string {
  const search = new URLSearchParams()
  if (query.after_sequence !== undefined) {
    search.set('after_sequence', String(query.after_sequence))
  }
  if (query.limit !== undefined) search.set('limit', String(query.limit))
  const suffix = search.toString()
  const base = `/api/v1/workflow-node-jobs/${
    encodeURIComponent(jobUuid)
  }/feedback`
  return `${base}${suffix ? `?${suffix}` : ''}`
}
