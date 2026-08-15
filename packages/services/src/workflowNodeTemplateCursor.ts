import { ServiceError } from './errors'
import type { HttpClient } from './http'
import {
  catalogEnvelope,
  invalidCatalog,
  jsonEquals,
  mergeGeneration,
  optionalGeneration,
  parseListPagination,
  recordArray,
  uuidValue,
  workflowNodeTemplateNumberedListPath
} from './workflowNodeTemplateCursorWire'

const PAGE_LIMIT = 100
const PAGE_BUDGET = 100
const ITEM_BUDGET = PAGE_LIMIT * PAGE_BUDGET
const DETAIL_REQUEST_BATCH_SIZE = 8
type CatalogPagination =
  | {
    mode: 'cursor'
    hasMore: boolean
    nextCursorUuid: unknown
  }
  | {
    mode: 'numbered'
    hasMore?: boolean
    page: number
    pageSize: number
    total?: number
  }

interface NumberedPaginationState {
  page: number
  pageSize: number | null
  total: number | null
}

/** OS 微后端可选发布的节点模板目录代际。 */
export interface WorkflowNodeTemplateCatalogGeneration {
  authorityId: string
  authorityKind: 'local' | 'backend'
  fingerprint: string
}

/** 一个已完整遍历且身份无重复的节点模板目录。 */
export interface WorkflowNodeTemplateCatalog {
  items: Record<string, unknown>[]
  generation: WorkflowNodeTemplateCatalogGeneration | null
}

/** 节点模板目录的显式查询条件。 */
export interface WorkflowNodeTemplateCatalogQuery {
  nodeType?: string
  signal?: AbortSignal
}

/** 一个列表摘要及其同代际详情。 */
export interface WorkflowNodeTemplateDetailEntry {
  summary: Record<string, unknown>
  detail: Record<string, unknown>
}

/**
 * 通过 Backend 页码合同读取完整节点模板目录，并兼容旧 UUID 游标响应。
 *
 * @param http 节点模板 API 使用的 HTTP 客户端。
 * @param query 可选 node_type 筛选和取消信号；分页选择由响应合同决定。
 * @returns 按服务端游标顺序收集的唯一摘要，以及可选 OS 目录代际。
 * @throws 响应字段、UUID、游标推进、目录代际或预算无效时关闭失败。
 */
export async function loadWorkflowNodeTemplateCatalog(
  http: HttpClient,
  query: WorkflowNodeTemplateCatalogQuery = {}
): Promise<WorkflowNodeTemplateCatalog> {
  // `items` 保存跨页首见顺序，作为后续详情投影的稳定输入。
  const items: Record<string, unknown>[] = []
  // `itemUuids` 阻止同一节点模板身份跨页重复或覆盖。
  const itemUuids = new Set<string>()
  // `cursorUuids` 阻止服务端把客户端带回已经使用过的游标。
  const cursorUuids = new Set<string>()
  let cursorUuid: string | null = null
  let generation: WorkflowNodeTemplateCatalogGeneration | null | undefined
  let paginationMode: CatalogPagination['mode'] | null = null
  const numberedState: NumberedPaginationState = {
    page: 1,
    pageSize: null,
    total: null
  }

  for (let pageCount = 0; pageCount < PAGE_BUDGET; pageCount += 1) {
    const path = paginationMode !== 'cursor'
      ? workflowNodeTemplateNumberedListPath(
        query.nodeType,
        numberedState.page,
        numberedState.pageSize ?? PAGE_LIMIT
      )
      : workflowNodeTemplateListPath(query.nodeType, cursorUuid)
    const data = catalogEnvelope(await http.request<unknown>(path, {
      signal: query.signal
    }))
    const pagination = parseListPagination(data)
    if (paginationMode !== null && pagination.mode !== paginationMode) {
      invalidCatalog('节点模板（WorkflowNodeTemplate）目录分页合同发生漂移')
    }
    paginationMode = pagination.mode
    const pageGeneration = optionalGeneration(data)
    generation = mergeGeneration(generation, pageGeneration)
    const pageItems = recordArray(data.items)
    if (items.length + pageItems.length > ITEM_BUDGET) invalidCatalog(
      '节点模板（WorkflowNodeTemplate）目录超过项目预算'
    )
    for (const item of pageItems) {
      const itemUuid = uuidValue(item.uuid)
      if (itemUuids.has(itemUuid)) invalidCatalog(
        '节点模板（WorkflowNodeTemplate）目录出现重复 UUID'
      )
      itemUuids.add(itemUuid)
      items.push(item)
    }

    if (pagination.mode === 'cursor') {
      const nextCursorUuid = advanceCursorPagination(
        pagination,
        pageItems.length,
        cursorUuid,
        cursorUuids
      )
      if (nextCursorUuid === null) {
        return { items, generation: generation ?? null }
      }
      cursorUuid = nextCursorUuid
      continue
    }

    if (advanceNumberedPagination(
      pagination,
      numberedState,
      pageItems.length,
      items.length
    )) {
      return { items, generation: generation ?? null }
    }
  }
  return invalidCatalog('节点模板（WorkflowNodeTemplate）目录超过分页预算')
}

/** 校验 UUID 游标页并返回下一游标；null 表示目录已完整收集。 */
function advanceCursorPagination(
  pagination: Extract<CatalogPagination, { mode: 'cursor' }>,
  pageItemCount: number,
  currentCursorUuid: string | null,
  observedCursorUuids: Set<string>
): string | null {
  if (!pagination.hasMore) {
    if (pagination.nextCursorUuid !== null) invalidCatalog(
      '节点模板（WorkflowNodeTemplate）末页游标必须为 null'
    )
    return null
  }
  if (pageItemCount === 0) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录无法从空页推进'
  )
  const nextCursorUuid = uuidValue(pagination.nextCursorUuid)
  if (
    nextCursorUuid === currentCursorUuid ||
    observedCursorUuids.has(nextCursorUuid)
  ) invalidCatalog('节点模板（WorkflowNodeTemplate）目录游标重复')
  observedCursorUuids.add(nextCursorUuid)
  return nextCursorUuid
}

/**
 * 校验页码目录的稳定元数据，并在仍有后续页时推进请求页码。
 *
 * @param pagination 当前 Backend/OS 页码响应元数据。
 * @param state 跨页保存的请求页码、页大小与可选总数。
 * @param pageItemCount 当前页项目数。
 * @param collectedItemCount 已收集项目总数。
 * @returns true 表示目录完成，false 表示调用方应读取下一页。
 */
function advanceNumberedPagination(
  pagination: Extract<CatalogPagination, { mode: 'numbered' }>,
  state: NumberedPaginationState,
  pageItemCount: number,
  collectedItemCount: number
): boolean {
  if (pagination.page !== state.page) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录页码未按请求推进'
  )
  if (pagination.pageSize > PAGE_LIMIT) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录页大小超过项目预算'
  )
  if (state.pageSize === null) state.pageSize = pagination.pageSize
  else if (pagination.pageSize !== state.pageSize) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录页大小发生漂移'
  )
  if (pagination.total !== undefined) {
    if (state.total === null) state.total = pagination.total
    else if (pagination.total !== state.total) invalidCatalog(
      '节点模板（WorkflowNodeTemplate）目录总数发生漂移'
    )
  } else if (state.total !== null) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录 total 在后续页缺失'
  )
  if ((state.total ?? 0) > ITEM_BUDGET || pageItemCount > state.pageSize) {
    invalidCatalog('节点模板（WorkflowNodeTemplate）目录超过项目预算')
  }
  if (state.total !== null && collectedItemCount > state.total) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录项目数超过 total'
  )
  const hasMore = pagination.hasMore ?? (
    state.total !== null && collectedItemCount < state.total
  )
  if (!hasMore) {
    if (state.total !== null && collectedItemCount !== state.total) {
      invalidCatalog('节点模板（WorkflowNodeTemplate）目录项目数与 total 不一致')
    }
    return true
  }
  if (state.total !== null && collectedItemCount >= state.total) {
    invalidCatalog('节点模板（WorkflowNodeTemplate）目录 has_more 与 total 冲突')
  }
  if (pageItemCount === 0) {
    invalidCatalog('节点模板（WorkflowNodeTemplate）目录无法从空页推进')
  }
  state.page += 1
  return false
}

/**
 * 以固定并发上限读取目录中全部节点模板详情。
 *
 * @param http 节点模板详情 API 使用的 HTTP 客户端。
 * @param catalog 已完成游标遍历和 UUID 去重的目录。
 * @param signal 调用方取消信号；传递到每个详情请求。
 * @returns 与摘要首见顺序一致、且已核对可选 OS 代际的详情条目。
 * @throws 任一详情响应无效时拒绝整个结果，不返回部分目录。
 */
export async function loadWorkflowNodeTemplateDetails(
  http: HttpClient,
  catalog: WorkflowNodeTemplateCatalog,
  signal?: AbortSignal
): Promise<WorkflowNodeTemplateDetailEntry[]> {
  const entries: WorkflowNodeTemplateDetailEntry[] = []

  /**
   * 读取并核对一个摘要对应的节点模板详情。
   *
   * @param summary 已去重但字段仍保持 wire 形状的列表摘要。
   * @returns 原摘要与同代际详情组成的条目。
   * @throws 摘要 UUID 或详情响应无效时关闭失败。
   */
  async function loadDetail(
    summary: Record<string, unknown>
  ): Promise<WorkflowNodeTemplateDetailEntry> {
    const uuid = uuidValue(summary.uuid)
    const raw = await http.request<unknown>(
      `/api/v1/workflow-node-templates/${encodeURIComponent(uuid)}`,
      { signal }
    )
    return {
      summary,
      detail: parseWorkflowNodeTemplateDetail(raw, catalog.generation)
    }
  }

  for (
    let index = 0;
    index < catalog.items.length;
    index += DETAIL_REQUEST_BATCH_SIZE
  ) {
    const batch = catalog.items.slice(
      index,
      index + DETAIL_REQUEST_BATCH_SIZE
    )
    entries.push(...await Promise.all(batch.map(loadDetail)))
  }
  return entries
}

/**
 * 合并多个分别筛选的节点模板目录，并保持首见 UUID 顺序。
 *
 * @param catalogs 默认目录、已发布工作流（PublishedWorkflow）目录等结果。
 * @returns 同身份同内容只保留一次的闭合目录。
 * @throws 目录代际混合、同 UUID 内容冲突或输入为空时关闭失败。
 */
export function mergeWorkflowNodeTemplateCatalogs(
  ...catalogs: WorkflowNodeTemplateCatalog[]
): WorkflowNodeTemplateCatalog {
  if (catalogs.length === 0) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录合并输入为空'
  )
  // `mergedItems` 保留默认目录优先、显式目录随后出现的稳定顺序。
  const mergedItems: Record<string, unknown>[] = []
  // `itemsByUuid` 用于区分安全的相同摘要重叠与危险的身份冲突。
  const itemsByUuid = new Map<string, Record<string, unknown>>()
  let generation: WorkflowNodeTemplateCatalogGeneration | null | undefined
  for (const catalog of catalogs) {
    generation = mergeGeneration(generation, catalog.generation)
    for (const item of catalog.items) {
      const uuid = uuidValue(item.uuid)
      const current = itemsByUuid.get(uuid)
      if (current) {
        if (!jsonEquals(current, item)) invalidCatalog(
          '节点模板（WorkflowNodeTemplate）相同 UUID 的摘要发生冲突'
        )
        continue
      }
      itemsByUuid.set(uuid, item)
      mergedItems.push(item)
    }
  }
  return { items: mergedItems, generation: generation ?? null }
}

/**
 * 解码一个节点模板详情并核对其目录代际。
 *
 * @param raw 带 API 响应外壳的节点模板详情。
 * @param expectedGeneration 列表阶段得到的可选 OS 目录代际。
 * @returns 只含 template/handles 与可选 OS 扩展的详情数据主体。
 * @throws 响应外壳无效，或列表与详情混合缺失/漂移代际时关闭失败。
 */
export function parseWorkflowNodeTemplateDetail(
  raw: unknown,
  expectedGeneration: WorkflowNodeTemplateCatalogGeneration | null
): Record<string, unknown> {
  const data = catalogEnvelope(raw)
  const detailGeneration = optionalGeneration(data)
  mergeGeneration(expectedGeneration, detailGeneration)
  if (!Object.prototype.hasOwnProperty.call(data, 'template') ||
    !Object.prototype.hasOwnProperty.call(data, 'handles')) {
    invalidCatalog('节点模板（WorkflowNodeTemplate）详情字段不完整')
  }
  return data
}

/**
 * 构造仅含后端（Backend）正式字段的节点模板列表路径。
 *
 * @param nodeType 可选的显式节点类型筛选。
 * @param cursorUuid 上一页给出的 UUID 游标。
 * @returns 首次请求使用 Backend page/page_size；旧游标响应的后续页使用 cursor_uuid。
 * @throws nodeType 为空白时关闭失败；cursorUuid 已由调用方校验。
 */
function workflowNodeTemplateListPath(
  nodeType: string | undefined,
  cursorUuid: string | null
): string {
  if (cursorUuid === null) {
    return workflowNodeTemplateNumberedListPath(nodeType, 1, PAGE_LIMIT)
  }
  const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
  query.set('cursor_uuid', cursorUuid)
  if (nodeType !== undefined) {
    const normalizedNodeType = nodeType.trim()
    if (!normalizedNodeType) invalidCatalog(
      '节点模板（WorkflowNodeTemplate）node_type 不能为空'
    )
    query.set('node_type', normalizedNodeType)
  }
  return `/api/v1/workflow-node-templates?${query.toString()}`
}
