import type {
  MaterialTemplateCatalog,
  MaterialTemplateDetail,
  MaterialTemplateSummary
} from '@unilab/material'

import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'

interface BackendNumberedPage {
  items?: unknown
  has_more?: unknown
  page?: unknown
  page_size?: unknown
}

const BACKEND_CATALOG_PAGE_SIZE = 100
const BACKEND_CATALOG_PAGE_BUDGET = 100

/**
 * 读取 Backend 的完整资源模板目录，并把页码分页隐藏在 Service adapter 内。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @returns 前端统一的只读物料模板目录；revision 由当前目录内容稳定派生。
 */
export async function loadBackendMaterialTemplateCatalog(
  http: HttpClient
): Promise<MaterialTemplateCatalog> {
  const rawItems: Record<string, unknown>[] = []
  let expectedPage = 1
  let observedPageSize: number | null = null

  for (
    let pageCount = 0;
    pageCount < BACKEND_CATALOG_PAGE_BUDGET;
    pageCount += 1
  ) {
    const query = new URLSearchParams({
      page: String(expectedPage),
      page_size: String(BACKEND_CATALOG_PAGE_SIZE)
    })
    const response = await requestData<BackendNumberedPage>(
      http,
      `/api/v1/resource-templates?${query.toString()}`
    )
    const page = positiveInteger(response.page, 'page')
    const pageSize = positiveInteger(response.page_size, 'page_size')
    if (page !== expectedPage) throw invalidCatalog('page did not advance')
    if (pageSize > BACKEND_CATALOG_PAGE_SIZE) {
      throw invalidCatalog('page_size exceeds the client budget')
    }
    if (observedPageSize === null) observedPageSize = pageSize
    else if (pageSize !== observedPageSize) {
      throw invalidCatalog('page_size changed while traversing the catalog')
    }
    if (typeof response.has_more !== 'boolean') {
      throw invalidCatalog('has_more must be a boolean')
    }
    const items = recordArray(response.items, 'resource template items')
    if (items.length > pageSize) {
      throw invalidCatalog('items exceed page_size')
    }
    rawItems.push(...items)

    if (!response.has_more) {
      const mappedItems = rawItems.map(mapBackendTemplateSummary)
      ensureUniqueTemplateUuids(mappedItems)
      return {
        revision: contentFingerprint(mappedItems),
        stale: false,
        items: mappedItems
      }
    }
    if (items.length === 0) {
      throw invalidCatalog('cannot advance from an empty page')
    }
    expectedPage += 1
  }

  throw invalidCatalog('catalog exceeds the page budget')
}

/**
 * 拒绝跨页重复的资源模板 UUID，避免同一稳定身份被覆盖。
 *
 * @param items 已解码的完整资源模板目录。
 * @returns 无返回值；全部稳定身份唯一即完成。
 */
function ensureUniqueTemplateUuids(items: MaterialTemplateSummary[]): void {
  const uuids = new Set<string>()
  for (const item of items) {
    if (uuids.has(item.uuid)) throw invalidCatalog('duplicate template UUID')
    uuids.add(item.uuid)
  }
}

/**
 * 读取一个 Backend 资源模板详情，并映射为只读物料模板详情。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @param templateId Backend 资源模板 UUID。
 * @returns 前端可展示的模板详情；不虚构几何、库位或创建能力。
 */
export async function loadBackendMaterialTemplateDetail(
  http: HttpClient,
  templateId: string
): Promise<MaterialTemplateDetail> {
  const raw = await requestData<Record<string, unknown>>(
    http,
    `/api/v1/resource-templates/${encodeURIComponent(templateId)}`
  )
  const summary = mapBackendTemplateSummary(raw)
  const assets: Record<string, string> = {}
  const cover = optionalString(raw.cover)
  if (cover) assets.cover = cover

  return {
    ...summary,
    description: optionalString(raw.description),
    contentHash: contentFingerprint(raw),
    compatibility: {},
    configuration: {
      schema: asRecord(raw.config_schema),
      uiSchema: asRecord(raw.ui_overlay)
    },
    assets
  }
}

/** 把 Backend 资源模板摘要映射为前端只读模板，不提升写入能力。 */
function mapBackendTemplateSummary(
  raw: Record<string, unknown>
): MaterialTemplateSummary {
  const uuid = requiredString(raw.uuid, 'uuid')
  const key = requiredString(raw.name, 'name')
  const resourceType = requiredString(raw.resource_type, 'resource_type')
  const kind = resourceType === 'device' ? 'device' : 'resource'
  const tags = stringArray(raw.tags)

  return {
    uuid,
    key,
    sourceNamespace: 'backend',
    kind,
    displayName: optionalString(raw.display_name) ?? key,
    tags,
    categoryPath: [resourceType],
    icon: optionalString(raw.icon),
    description: optionalString(raw.description),
    status: 'ready',
    contentHash: contentFingerprint({
      uuid,
      key,
      resourceType,
      displayName: raw.display_name,
      tags
    }),
    creation: {
      mode: kind === 'device' ? 'dynamic-device' : 'resource-tree',
      available: false,
      reason: 'Backend 尚未向前端开放带修订与补偿语义的物料创建命令'
    }
  }
}

/** 为只读目录生成稳定的非安全散列，只用于检测同一会话中的内容变化。 */
function contentFingerprint(value: unknown): string {
  const content = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `backend:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/** 读取对象数组；Backend 合同形状异常时失败关闭。 */
function recordArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw invalidCatalog(`${field} must be an object array`)
  }
  return value as Record<string, unknown>[]
}

/** 读取必填非空字符串。 */
function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)
  if (!result) throw invalidCatalog(`${field} must be a non-empty string`)
  return result
}

/** 读取可选非空字符串。 */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const result = value.trim()
  return result || undefined
}

/** 读取字符串数组并丢弃非法扩展值。 */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * 读取 Backend 页码合同中的正安全整数。
 *
 * @param value 未信任的页码或页大小。
 * @param field Backend wire 字段名。
 * @returns 大于零的安全整数。
 */
function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidCatalog(`${field} must be a positive safe integer`)
  }
  return value as number
}

/** 把未知 JSON 值收敛为普通对象。 */
function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/** 判断未知 JSON 值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** 创建可诊断、不可重试的 Backend 模板合同错误。 */
function invalidCatalog(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_BACKEND_RESOURCE_TEMPLATE',
    message: `Backend 资源模板响应无效：${detail}`,
    retryable: false
  })
}
