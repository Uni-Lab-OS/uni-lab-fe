import type {
  WorkflowListQuery,
  WorkflowPage,
  WorkflowSummary
} from './workflowAuthoringContracts'
import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'

interface BackendNumberedPage {
  items?: unknown
  has_more?: unknown
  page?: unknown
  page_size?: unknown
}

const BACKEND_WORKFLOW_PAGE_SIZE = 100
const BACKEND_WORKFLOW_PAGE_BUDGET = 100

/**
 * 读取 Backend 页码目录，并保留前端现有编号分页端口。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @param query 前端目录页码和每页数量；adapter 在完整 Backend 结果上切片。
 * @returns 可供只读工作流目录展示的编号分页结果。
 */
export async function loadBackendWorkflowPage(
  http: HttpClient,
  query: WorkflowListQuery = {}
): Promise<WorkflowPage> {
  const allWorkflows: WorkflowSummary[] = []
  const workflowUuids = new Set<string>()
  let expectedPage = 1
  let observedPageSize: number | null = null

  for (
    let pageCount = 0;
    pageCount < BACKEND_WORKFLOW_PAGE_BUDGET;
    pageCount += 1
  ) {
    const search = new URLSearchParams({
      page: String(expectedPage),
      page_size: String(BACKEND_WORKFLOW_PAGE_SIZE)
    })
    const response = await requestData<BackendNumberedPage>(
      http,
      `/api/v1/workflows?${search.toString()}`
    )
    const responsePage = strictPositiveInteger(response.page, 'page')
    const responsePageSize = strictPositiveInteger(
      response.page_size,
      'page_size'
    )
    if (responsePage !== expectedPage) {
      throw invalidWorkflowCatalog('workflow page did not advance')
    }
    if (responsePageSize > BACKEND_WORKFLOW_PAGE_SIZE) {
      throw invalidWorkflowCatalog(
        'workflow page_size exceeds the client budget'
      )
    }
    if (observedPageSize === null) observedPageSize = responsePageSize
    else if (responsePageSize !== observedPageSize) {
      throw invalidWorkflowCatalog('workflow page_size changed while traversing')
    }
    if (typeof response.has_more !== 'boolean') {
      throw invalidWorkflowCatalog('workflow has_more must be a boolean')
    }
    const pageItems = recordArray(response.items).map(mapWorkflowSummary)
    if (pageItems.length > responsePageSize) {
      throw invalidWorkflowCatalog('workflow items exceed page_size')
    }
    for (const workflow of pageItems) {
      if (workflowUuids.has(workflow.uuid)) {
        throw invalidWorkflowCatalog('duplicate workflow UUID')
      }
      workflowUuids.add(workflow.uuid)
      allWorkflows.push(workflow)
    }
    if (!response.has_more) break
    if (pageItems.length === 0) {
      throw invalidWorkflowCatalog(
        'workflow catalog cannot advance from an empty page'
      )
    }
    expectedPage += 1
    if (pageCount === BACKEND_WORKFLOW_PAGE_BUDGET - 1) {
      throw invalidWorkflowCatalog('workflow catalog exceeds the page budget')
    }
  }

  const page = positiveInteger(query.page, 1)
  const pageSize = positiveInteger(query.page_size, 20)
  const start = (page - 1) * pageSize
  return {
    items: allWorkflows.slice(start, start + pageSize),
    total: allWorkflows.length,
    page,
    page_size: pageSize
  }
}

/** 把 Backend Workflow 基础模型映射为目录摘要。 */
function mapWorkflowSummary(raw: Record<string, unknown>): WorkflowSummary {
  return {
    uuid: requiredString(raw.uuid, 'uuid'),
    create_time: requiredString(raw.create_time, 'create_time'),
    update_time: requiredString(raw.update_time, 'update_time'),
    meta_data: isRecord(raw.meta_data) ? raw.meta_data : {},
    name: requiredString(raw.name, 'name'),
    tags: stringArray(raw.tags),
    revision: nonNegativeInteger(raw.revision, 'revision'),
    ...(optionalString(raw.description)
      ? { description: optionalString(raw.description) }
      : {}),
    ...(raw.definition_status === 'empty' || raw.definition_status === 'configured'
      ? { definition_status: raw.definition_status }
      : {})
  }
}

/** 读取普通对象数组并拒绝不完整的目录页。 */
function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw invalidWorkflowCatalog('items must be an object array')
  }
  return value as Record<string, unknown>[]
}

/** 读取正整数查询值，非法值回退到公开端口默认值。 */
function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback
}

/**
 * 读取 Backend 页码合同中的正安全整数，异常时关闭失败。
 *
 * @param value 未信任的页码或页大小。
 * @param field Backend wire 字段名。
 * @returns 大于零的安全整数。
 */
function strictPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidWorkflowCatalog(`${field} must be a positive safe integer`)
  }
  return value as number
}

/** 读取 Backend 非负整数修订号。 */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidWorkflowCatalog(`${field} must be a non-negative integer`)
  }
  return value
}

/** 读取必填非空字符串。 */
function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)
  if (!result) throw invalidWorkflowCatalog(`${field} must be a non-empty string`)
  return result
}

/** 读取可选非空字符串。 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result || undefined
}

/** 读取字符串数组并忽略非合同扩展值。 */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/** 判断未知 JSON 值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** 创建可诊断、不可重试的 Backend 工作流目录合同错误。 */
function invalidWorkflowCatalog(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_BACKEND_WORKFLOW_CATALOG',
    message: `Backend 工作流目录响应无效：${detail}`,
    retryable: false
  })
}
