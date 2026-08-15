import { ServiceError } from './errors'
import type { WorkflowNodeTemplateCatalogGeneration } from './workflowNodeTemplateCursor'

const CURSOR_LIST_FIELDS = new Set([
  'authority',
  'catalog_fingerprint',
  'items',
  'has_more',
  'next_cursor_uuid',
  'total'
])
const NUMBERED_LIST_FIELDS = new Set([
  'authority',
  'catalog_fingerprint',
  'items',
  'has_more',
  'page',
  'page_size',
  'total'
])

export type CatalogPagination =
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

/** 构造当前 OS 页码合同的后续页路径。 */
export function workflowNodeTemplateNumberedListPath(
  nodeType: string | undefined,
  page: number,
  pageSize: number
): string {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize)
  })
  if (nodeType !== undefined) query.set('node_type', nodeType.trim())
  return `/api/v1/workflow-node-templates?${query.toString()}`
}

/**
 * 解码统一 API 响应外壳。
 *
 * @param raw 未信任 HTTP 响应。
 * @returns code 为零且无 error 的 data 对象。
 * @throws 外壳缺失、业务码非零或 data 非对象时关闭失败。
 */
export function catalogEnvelope(raw: unknown): Record<string, unknown> {
  const envelope = recordValue(raw)
  if (
    envelope.code !== 0 ||
    !Object.prototype.hasOwnProperty.call(envelope, 'data') ||
    Object.prototype.hasOwnProperty.call(envelope, 'error')
  ) invalidCatalog('节点模板（WorkflowNodeTemplate）响应外壳无效')
  return recordValue(envelope.data)
}

/**
 * 识别互斥的 UUID 游标与当前 OS 页码合同，并拒绝混合或未知字段。
 *
 * @param data 列表响应 data 对象。
 * @returns 已验证的分页元数据。
 * @throws 两套字段混合、字段缺失、类型无效或出现未知字段时关闭失败。
 */
export function parseListPagination(data: Record<string, unknown>): CatalogPagination {
  const hasCursorFields = ['next_cursor_uuid'].some((field) =>
    Object.prototype.hasOwnProperty.call(data, field)
  )
  // `total` 也可作为 UUID 游标响应的兼容统计元数据，不能单独判定为页码合同。
  const hasNumberedFields = ['page', 'page_size'].some((field) =>
    Object.prototype.hasOwnProperty.call(data, field)
  )
  if (hasCursorFields && hasNumberedFields) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录混合了两套分页字段'
  )
  const allowedFields = hasNumberedFields
    ? NUMBERED_LIST_FIELDS
    : CURSOR_LIST_FIELDS
  for (const field of Object.keys(data)) {
    if (!allowedFields.has(field)) invalidCatalog(
      `节点模板（WorkflowNodeTemplate）目录包含未约定字段 ${field}`
    )
  }
  const requiredFields = hasNumberedFields
    ? ['items', 'page', 'page_size']
    : ['items', 'has_more', 'next_cursor_uuid']
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) invalidCatalog(
      `节点模板（WorkflowNodeTemplate）目录缺少 ${field}`
    )
  }
  if (hasNumberedFields) {
    if (
      !Object.prototype.hasOwnProperty.call(data, 'has_more') &&
      !Object.prototype.hasOwnProperty.call(data, 'total')
    ) invalidCatalog(
      '节点模板（WorkflowNodeTemplate）页码目录必须包含 has_more 或 total'
    )
    if (
      Object.prototype.hasOwnProperty.call(data, 'has_more') &&
      typeof data.has_more !== 'boolean'
    ) invalidCatalog(
      '节点模板（WorkflowNodeTemplate）目录 has_more 必须是布尔值'
    )
    const total = Object.prototype.hasOwnProperty.call(data, 'total')
      ? nonNegativeInteger(data.total)
      : undefined
    return {
      mode: 'numbered',
      ...(typeof data.has_more === 'boolean'
        ? { hasMore: data.has_more }
        : {}),
      page: positiveInteger(data.page),
      pageSize: positiveInteger(data.page_size),
      ...(total === undefined ? {} : { total })
    }
  }
  if (typeof data.has_more !== 'boolean') invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录 has_more 必须是布尔值'
  )
  if (Object.prototype.hasOwnProperty.call(data, 'total')) {
    // `total` 只兼容部署端的目录统计，不参与 UUID 游标推进或模板实体投影。
    nonNegativeInteger(data.total)
  }
  return {
    mode: 'cursor',
    hasMore: data.has_more,
    nextCursorUuid: data.next_cursor_uuid
  }
}

/** 解析正整数分页字段。 */
function positiveInteger(raw: unknown): number {
  const value = nonNegativeInteger(raw)
  if (value < 1) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）分页字段必须为正整数'
  )
  return value
}

/** 解析不超过 JavaScript 安全范围的非负整数。 */
function nonNegativeInteger(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）分页字段必须为非负安全整数'
  )
  return raw as number
}

/**
 * 解析后端（Backend）可省略、OS 必须成对发布的目录代际扩展。
 *
 * @param data 列表或详情数据主体。
 * @returns 后端（Backend）响应返回 null；OS 响应返回权威和指纹。
 * @throws authority 与 catalog_fingerprint 只出现一个或格式无效时关闭失败。
 */
export function optionalGeneration(
  data: Record<string, unknown>
): WorkflowNodeTemplateCatalogGeneration | null {
  const hasAuthority = Object.prototype.hasOwnProperty.call(data, 'authority')
  const hasFingerprint = Object.prototype.hasOwnProperty.call(
    data,
    'catalog_fingerprint'
  )
  if (!hasAuthority && !hasFingerprint) return null
  if (hasAuthority !== hasFingerprint) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）OS 目录代际字段必须成对出现'
  )
  const authority = recordValue(data.authority)
  const authorityId = nonEmptyString(authority.authority_id)
  const authorityKind = nonEmptyString(authority.kind)
  if (authorityKind !== 'local' && authorityKind !== 'backend') invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录权威类型无效'
  )
  const fingerprint = nonEmptyString(data.catalog_fingerprint)
  if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）目录指纹无效'
  )
  return { authorityId, authorityKind, fingerprint }
}

/**
 * 合并前后响应中的可选 OS 目录代际。
 *
 * @param current 已观察代际；undefined 表示尚未观察任何响应。
 * @param next 新响应携带的代际或后端（Backend）缺省值 null。
 * @returns 第一次观察到的代际；合法后端（Backend）流程始终为 null。
 * @throws 混合缺失、权威漂移或指纹漂移时关闭失败。
 */
export function mergeGeneration(
  current: WorkflowNodeTemplateCatalogGeneration | null | undefined,
  next: WorkflowNodeTemplateCatalogGeneration | null
): WorkflowNodeTemplateCatalogGeneration | null {
  if (current === undefined) return next
  if (current === null || next === null) {
    if (current === next) return current
    return invalidCatalog(
      '节点模板（WorkflowNodeTemplate）目录代际混合缺失'
    )
  }
  if (
    current.authorityId !== next.authorityId ||
    current.authorityKind !== next.authorityKind ||
    current.fingerprint !== next.fingerprint
  ) return invalidCatalog('节点模板（WorkflowNodeTemplate）目录代际发生漂移')
  return current
}

/**
 * 解析记录数组且不丢弃任何无效项目。
 *
 * @param raw 未信任数组值。
 * @returns 每项均为普通对象的原顺序数组。
 * @throws 值非数组或任一项非对象时关闭失败。
 */
export function recordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）items 必须是数组'
  )
  const values: Record<string, unknown>[] = []
  for (const item of raw) values.push(recordValue(item))
  return values
}

/**
 * 解析非数组对象。
 *
 * @param raw 未信任值。
 * @returns 原对象记录。
 * @throws null、数组或非对象值时关闭失败。
 */
function recordValue(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）字段必须是对象'
  )
  return raw as Record<string, unknown>
}

/**
 * 解析非空字符串。
 *
 * @param raw 未信任值。
 * @returns 保留 wire 内容的非空字符串。
 * @throws 非字符串或空白字符串时关闭失败。
 */
function nonEmptyString(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) invalidCatalog(
    '节点模板（WorkflowNodeTemplate）字段必须是非空字符串'
  )
  return raw
}

/**
 * 解析并规范 UUID 身份。
 *
 * @param raw 未信任 UUID 值。
 * @returns 小写规范 UUID。
 * @throws UUID 版本或格式无效时关闭失败。
 */
export function uuidValue(raw: unknown): string {
  const value = nonEmptyString(raw)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    invalidCatalog('节点模板（WorkflowNodeTemplate）UUID 无效')
  }
  return value.toLowerCase()
}

/**
 * 比较两个 JSON 值的结构语义，不依赖对象键顺序。
 *
 * @param left 首次观察到的摘要。
 * @param right 后续目录中的同身份摘要。
 * @returns 数组顺序与对象键值语义均相同时为 true。
 */
export function jsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) ||
      left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
      if (!jsonEquals(left[index], right[index])) return false
    }
    return true
  }
  if (!left || typeof left !== 'object' ||
    !right || typeof right !== 'object') return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]
    if (key !== rightKeys[index] ||
      !jsonEquals(leftRecord[key], rightRecord[key])) return false
  }
  return true
}

/**
 * 抛出不可重试的节点模板目录合同错误。
 *
 * @param message 包含中文领域上下文的失败原因。
 * @returns 永不返回。
 * @throws 始终抛出 INVALID_API_RESPONSE 服务错误。
 */
export function invalidCatalog(message: string): never {
  throw new ServiceError({
    code: 'INVALID_API_RESPONSE',
    message,
    retryable: false
  })
}
