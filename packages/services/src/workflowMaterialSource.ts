import type { MaterialGraphPort } from '@unilab/material'
import {
  parseShapeLibrary,
  resolveShapeSpec,
  type MaterialShapeSpec
} from '@unilab/material/domain'

import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'
import { projectWorkflowMaterialSourceGraph } from './workflowMaterialSourceGraph'
import {
  loadWorkflowNodeTemplateCatalog,
  parseWorkflowNodeTemplateDetail
} from './workflowNodeTemplateCursor'
import { templateSchemaValue } from './workflowActionCatalogWire'

export interface WorkflowMaterialSourceHandleTemplate {
  uuid: string
  workflowNodeTemplateUuid: string
  handleKey: 'material'
  ioType: 'source'
  displayName: string
  valueType: 'ResourceSlot'
  required: false
  dataSource: string | null
  dataKey: string | null
  wireValue?: Record<string, unknown>
}

export interface WorkflowMaterialSourceNodeTemplate {
  uuid: string
  resourceTemplateUuid: string
  name: 'material_source'
  displayName: string
  actionClass: 'unilabos.workflow.authoring:material_source'
  actionType: 'material_source'
  schema: Record<string, unknown> | null
  sourceHandle: WorkflowMaterialSourceHandleTemplate
  wireValue?: Record<string, unknown>
}

export interface WorkflowMaterialSourceResourceTemplate {
  uuid: string
  displayName: string
  /** OS PackageCatalog-signed declaration identity; never an absolute path. */
  sourceUri?: string
  shape?: MaterialShapeSpec
}

export interface WorkflowMaterialSourceMaterial {
  uuid: string
  name: string
  resourceTemplateUuid: string
  /** 遗留展示字段；公共物料图没有该权威事实时必须省略，不能从物料名称猜测。 */
  materialClass?: string
}

export interface WorkflowMaterialSourceSite {
  uuid: string
  name: string
  sortOrder: number
  mountMaterialUuid: string
  allowedResourceTemplateUuids: string[]
  occupiedMaterialUuid: string | null
}

export interface WorkflowMaterialSourceCatalogSnapshot {
  authorityId?: string
  authorityKind?: 'local' | 'backend'
  fingerprint?: string
  template: WorkflowMaterialSourceNodeTemplate
  resourceTemplates: WorkflowMaterialSourceResourceTemplate[]
  materials: WorkflowMaterialSourceMaterial[]
  sites: WorkflowMaterialSourceSite[]
}

interface RegisteredWorkflowResourceTemplate {
  uuid: string
  displayName: string
  sourceUri?: string
  shape?: MaterialShapeSpec
}

const REGISTERED_TEMPLATE_PAGE_SIZE = 100
const REGISTERED_TEMPLATE_PAGE_BUDGET = 100

/**
 * 组合工作流物料来源（MaterialSource）框架模板与公共物料图（MaterialGraph）读模型。
 *
 * @param http 只负责读取公开工作流节点模板 API 的 HTTP 客户端。
 * @param materialGraph 公共物料图端口；其 wire 解码由物料服务（Material Service）唯一负责。
 * @returns 带目录权威、框架模板和公共物料/库位（Site）事实的创作快照。
 * @throws 模板目录不一致或公共物料图无效时抛出结构化服务错误。
 */
export async function loadWorkflowMaterialSourceCatalog(
  http: HttpClient,
  materialGraph: Pick<MaterialGraphPort, 'getGraph'>
): Promise<WorkflowMaterialSourceCatalogSnapshot> {
  // 物料来源只能走显式筛选，不能依赖默认动作目录偶然返回内部框架节点。
  const catalog = await loadWorkflowNodeTemplateCatalog(http, {
    nodeType: 'material_source'
  })
  // `candidates` 仍核对三个 discriminator，防止服务端忽略筛选条件。
  const candidates: Record<string, unknown>[] = []
  for (const summary of catalog.items) {
    if (
    summary.name === 'material_source' &&
    summary.type === 'material_source' &&
    summary.node_type === 'material_source'
    ) candidates.push(summary)
  }
  if (candidates.length !== 1) {
    invalidCatalog('OS 必须发布且仅发布一个物料来源（MaterialSource）框架模板')
  }
  const summary = candidates[0]
  // 框架模板 UUID 是工作流图引用该非动作节点合同的稳定身份。
  const summaryUuid = uuidString(summary.uuid)
  const summaryResource = recordValue(summary.resource_template)
  // 框架所有者资源模板 UUID 证明摘要与详情描述同一个节点模板。
  const summaryResourceUuid = uuidString(summaryResource.uuid)
  const detail = parseWorkflowNodeTemplateDetail(
    await http.request<unknown>(
    `/api/v1/workflow-node-templates/${encodeURIComponent(summaryUuid)}`
    ),
    catalog.generation
  )
  const template = recordValue(detail.template)
  const handles = recordArray(detail.handles)
  // OS 把数据库 JSON Schema 作为文本发布；解析后再校验物料来源选择器合同。
  const schema = materialSourceTemplateSchema(template.schema)
  if (
    uuidString(template.uuid) !== summaryUuid ||
    uuidString(template.resource_template_uuid) !== summaryResourceUuid ||
    template.name !== 'material_source' ||
    template.type !== 'material_source' ||
    template.node_type !== 'material_source' ||
    template.class !== 'unilabos.workflow.authoring:material_source' ||
    handles.length !== 1
  ) invalidCatalog('物料来源（MaterialSource）框架模板详情无效')
  const handle = handles[0]
  if (
    uuidString(handle.workflow_node_template_uuid) !== summaryUuid ||
    handle.handle_key !== 'material' ||
    handle.io_type !== 'source' ||
    handle.type !== 'ResourceSlot' ||
    handle.required !== false
  ) invalidCatalog('物料来源（MaterialSource）框架句柄无效')

  // 公共物料图聚合是物料、挂载关系和库位占用（SiteOccupancy）的唯一前端业务投影。
  const [graphProjection, registeredResourceTemplates] = await Promise.all([
    materialGraph.getGraph({ kind: 'singleton' })
      .then(projectWorkflowMaterialSourceGraph),
    loadRegisteredMaterialSourceTemplates(http)
  ])
  // 公共资源模板与外形目录只增强标题/外形，不再提供物料或库位事实。
  const resourceTemplates = mergeRegisteredResourceTemplates(
    graphProjection.resourceTemplates,
    graphProjection.materials,
    registeredResourceTemplates
  )

  // 来源句柄携带物料占位符（ResourceSlot）的原始 wire 合同以供图保存。
  const sourceHandle = attachWireValue({
    uuid: uuidString(handle.uuid),
    workflowNodeTemplateUuid: summaryUuid,
    handleKey: 'material' as const,
    ioType: 'source' as const,
    displayName: nonEmptyString(handle.display_name),
    valueType: 'ResourceSlot' as const,
    required: false as const,
    dataSource: nullableString(handle.data_source),
    dataKey: nullableString(handle.data_key)
  }, handle)
  // 框架模板保存 OS 发布的完整 wire 值，不从公共物料图反向构造模板合同。
  const frameworkTemplate = attachWireValue({
    uuid: summaryUuid,
    resourceTemplateUuid: summaryResourceUuid,
    name: 'material_source' as const,
    displayName: nonEmptyString(template.display_name),
    actionClass: 'unilabos.workflow.authoring:material_source' as const,
    actionType: 'material_source' as const,
    schema,
    sourceHandle
  }, template)

  return {
    ...(catalog.generation
      ? {
          authorityId: catalog.generation.authorityId,
          authorityKind: catalog.generation.authorityKind,
          fingerprint: catalog.generation.fingerprint
        }
      : {}),
    template: frameworkTemplate,
    ...graphProjection,
    resourceTemplates
  }
}

const MATERIAL_SOURCE_PARAMETER_KEYS = [
  'mode',
  'resource_template_uuid',
  'mount',
  'material_uuid',
  'site',
  'slot_range',
  'flow_role'
] as const

/**
 * 解析并校验 OS 发布的 MaterialSource 闭合选择器 Schema。
 *
 * @param raw 节点模板详情中的 JSON 对象或数据库 JSON 文本。
 * @returns 可供编辑器投影使用的结构化 Schema 副本。
 * @throws 根对象、字段集合或 SiteSelector 扩展与编辑合同不一致时关闭失败。
 */
function materialSourceTemplateSchema(
  raw: unknown
): Record<string, unknown> | null {
  // 保留旧 Edge 节点的无 Schema 框架合同；新 OS 发布时则必须完整校验。
  if (raw === null || raw === undefined) return null
  const schema = recordValue(templateSchemaValue(raw))
  const properties = recordValue(schema.properties)
  const mode = recordValue(properties.mode)
  const resourceTemplate = recordValue(properties.resource_template_uuid)
  const mount = recordValue(properties.mount)
  const mountProperties = recordValue(mount.properties)
  const mountUuid = recordValue(mountProperties.uuid)
  const materialUuid = recordValue(properties.material_uuid)
  const site = recordValue(properties.site)
  const siteSelector = recordValue(site['x-unilabos-site-selector'])
  const slotRange = recordValue(properties.slot_range)
  const slotItem = recordValue(slotRange.items)
  const flowRole = recordValue(properties.flow_role)
  if (
    schema.type !== 'object' ||
    schema.additionalProperties !== false ||
    !sameStringSet(Object.keys(properties), MATERIAL_SOURCE_PARAMETER_KEYS) ||
    !sameStringSet(schema.required, MATERIAL_SOURCE_PARAMETER_KEYS) ||
    mode.type !== 'string' ||
    !sameStringSet(mode.enum, ['existing', 'create_new']) ||
    resourceTemplate.type !== 'string' ||
    resourceTemplate.format !== 'uuid' ||
    mount.type !== 'object' ||
    mount.additionalProperties !== false ||
    !sameStringSet(Object.keys(mountProperties), ['uuid']) ||
    !sameStringSet(mount.required, ['uuid']) ||
    mountUuid.type !== 'string' ||
    mountUuid.format !== 'uuid' ||
    !sameStringSet(materialUuid.type, ['string', 'null']) ||
    materialUuid.format !== 'uuid' ||
    !sameStringSet(site.type, ['string', 'null']) ||
    site.format !== 'uuid' ||
    site['x-unilabos-editor-control'] !== 'site_selector' ||
    siteSelector.version !== 1 ||
    siteSelector.owner !== 'mount' ||
    siteSelector.occupant !== 'resource_template_uuid' ||
    siteSelector.show_occupied !== true ||
    siteSelector.allow_occupied !== false ||
    !sameStringSet(slotRange.type, ['array', 'null']) ||
    slotRange.minItems !== 1 ||
    slotRange.uniqueItems !== true ||
    slotItem.type !== 'string' ||
    slotItem.format !== 'uuid' ||
    flowRole.type !== 'string' ||
    !sameStringSet(flowRole.enum, [
      'primary_sample',
      'aliquot_sample',
      'reagent',
      'consumable'
    ])
  ) invalidCatalog('物料来源（MaterialSource）参数 Schema 无效')
  return structuredClone(schema)
}

/**
 * 合并公共物料图中的资源模板身份与正式目录提供的标题和外形。
 *
 * @param graphTemplates 公共物料图明确引用的资源模板 UUID 集合。
 * @param materials 公共图投影的物料实例，用于缺少正式标题时采用精确 class。
 * @param registeredTemplates 正式资源模板与外形库解析结果。
 * @returns 按 UUID 稳定排序、保留最新外形增强的资源模板目录。
 * @throws 不主动抛出异常；输入身份已由各自公共 adapter 校验。
 */
function mergeRegisteredResourceTemplates(
  graphTemplates: readonly WorkflowMaterialSourceResourceTemplate[],
  materials: readonly WorkflowMaterialSourceMaterial[],
  registeredTemplates: readonly RegisteredWorkflowResourceTemplate[]
): WorkflowMaterialSourceResourceTemplate[] {
  // 模板映射以公共图 UUID 为身份，值只承载展示增强。
  const templatesByUuid = new Map<string, WorkflowMaterialSourceResourceTemplate>()
  for (const template of graphTemplates) {
    templatesByUuid.set(template.uuid, { ...template })
  }
  for (const material of materials) {
    const current = templatesByUuid.get(material.resourceTemplateUuid)
    if (
      current
      && current.displayName === current.uuid
      && material.materialClass
    ) {
      templatesByUuid.set(current.uuid, {
        ...current,
        displayName: material.materialClass
      })
    }
  }
  for (const registered of registeredTemplates) {
    const current = templatesByUuid.get(registered.uuid)
    templatesByUuid.set(registered.uuid, {
      uuid: registered.uuid,
      displayName: registered.displayName,
      ...(registered.sourceUri ? { sourceUri: registered.sourceUri } : {}),
      ...(registered.shape
        ? { shape: registered.shape }
        : current?.shape
          ? { shape: current.shape }
          : {})
    })
  }
  const templates = [...templatesByUuid.values()]
  /**
   * 按资源模板 UUID 比较稳定输出顺序。
   *
   * @param left 左侧资源模板投影。
   * @param right 右侧资源模板投影。
   * @returns localeCompare 的三态排序结果。
   */
  function compareTemplateUuid(
    left: WorkflowMaterialSourceResourceTemplate,
    right: WorkflowMaterialSourceResourceTemplate
  ): number {
    return left.uuid.localeCompare(right.uuid)
  }
  templates.sort(compareTemplateUuid)
  return templates
}

/**
 * 加载已注册资源模板及可选外形增强。
 *
 * @param http 资源模板和物料外形接口共用的 HTTP 客户端。
 * @returns 已校验 UUID、标题与最佳外形的资源模板集合。
 * @throws 不向调用方抛出渐进增强错误；目录不可用时返回空集合。
 */
async function loadRegisteredMaterialSourceTemplates(
  http: HttpClient
): Promise<RegisteredWorkflowResourceTemplate[]> {
  try {
    const [templates, shapeCatalog] = await Promise.all([
      loadRegisteredResourceTemplatePages(http),
      requestData<Record<string, unknown>>(
        http,
        '/api/v1/material-shapes'
      )
    ])
    const library = parseShapeLibrary(shapeCatalog.items)
    const projected: RegisteredWorkflowResourceTemplate[] = []
    for (const template of templates) {
      const uuid = uuidString(template.uuid)
      const name = nonEmptyString(template.name)
      const displayName = nonEmptyString(template.display_name)
      const shapeCandidates = [
        ...stringArray(template.tags),
        name,
        displayName
      ]
      let shape: MaterialShapeSpec | undefined
      for (const candidate of shapeCandidates) {
        shape ??= resolveShapeSpec(library, candidate)
      }
      projected.push({
        uuid,
        displayName,
        ...(packageSourceUri(template.source_uri)
          ? { sourceUri: packageSourceUri(template.source_uri)! }
          : {}),
        ...(shape ? { shape } : {})
      })
    }
    return projected
  } catch {
    // 外形注册表是渐进增强；旧边缘侧（Edge）或不完整目录仍使用默认来源图标。
    return []
  }
}

/**
 * 遍历已注册资源模板目录，优先使用 Backend 页码合同并兼容旧 UUID 游标响应。
 *
 * @param http 正式资源模板接口的 HTTP 客户端。
 * @returns 保持服务端顺序且 UUID 无重复的资源模板记录。
 * @throws 重复 UUID、空页推进或游标重复时关闭失败。
 */
async function loadRegisteredResourceTemplatePages(
  http: HttpClient
): Promise<Record<string, unknown>[]> {
  const templates: Record<string, unknown>[] = []
  const seen = new Set<string>()
  let cursorUuid: string | null = null
  let paginationMode: 'cursor' | 'numbered' | null = null
  let numberedPage = 1
  let numberedPageSize: number | null = null
  for (
    let pageCount = 0;
    pageCount < REGISTERED_TEMPLATE_PAGE_BUDGET;
    pageCount += 1
  ) {
    const query: URLSearchParams = paginationMode !== 'cursor'
      ? new URLSearchParams({
          page: String(numberedPage),
          page_size: String(
            numberedPageSize ?? REGISTERED_TEMPLATE_PAGE_SIZE
          )
        })
      : new URLSearchParams({
          limit: String(REGISTERED_TEMPLATE_PAGE_SIZE)
        })
    if (paginationMode === 'cursor' && cursorUuid) {
      query.set('cursor_uuid', cursorUuid)
    }
    const response: Record<string, unknown> = await requestData<
      Record<string, unknown>
    >(
      http,
      `/api/v1/resource-templates?${query.toString()}`
    )
    const items = recordArray(response.items)
    for (const item of items) {
      const uuid = uuidString(item.uuid)
      if (seen.has(uuid)) {
        invalidCatalog('资源模板（ResourceTemplate）UUID 重复')
      }
      seen.add(uuid)
      templates.push(item)
    }
    if (typeof response.has_more !== 'boolean') {
      invalidCatalog('资源模板（ResourceTemplate）has_more 必须是布尔值')
    }
    const responseMode: 'cursor' | 'numbered' =
      Object.prototype.hasOwnProperty.call(response, 'page') ||
      Object.prototype.hasOwnProperty.call(response, 'page_size')
      ? 'numbered'
      : 'cursor'
    if (paginationMode !== null && responseMode !== paginationMode) {
      invalidCatalog('资源模板（ResourceTemplate）分页合同发生漂移')
    }
    paginationMode = responseMode

    if (responseMode === 'numbered') {
      const responsePage = positiveSafeInteger(response.page, '资源模板页码')
      const responsePageSize = positiveSafeInteger(
        response.page_size,
        '资源模板页大小'
      )
      if (
        responsePage !== numberedPage ||
        responsePageSize > REGISTERED_TEMPLATE_PAGE_SIZE
      ) {
        invalidCatalog('资源模板（ResourceTemplate）页码未按请求推进')
      }
      if (numberedPageSize === null) numberedPageSize = responsePageSize
      else if (responsePageSize !== numberedPageSize) {
        invalidCatalog('资源模板（ResourceTemplate）页大小发生漂移')
      }
      if (items.length > responsePageSize) {
        invalidCatalog('资源模板（ResourceTemplate）项目数超过页大小')
      }
      if (response.has_more !== true) return templates
      if (items.length === 0) {
        invalidCatalog('资源模板（ResourceTemplate）目录无法从空页推进')
      }
      numberedPage += 1
      continue
    }

    if (response.has_more !== true) return templates
    const nextCursor = uuidString(response.next_cursor_uuid)
    if (nextCursor === cursorUuid || items.length === 0) {
      invalidCatalog('资源模板（ResourceTemplate）目录分页提前终止')
    }
    cursorUuid = nextCursor
  }
  return invalidCatalog('资源模板（ResourceTemplate）目录超过分页预算')
}

/**
 * 读取资源模板页码合同中的正安全整数。
 *
 * @param value 未信任分页值。
 * @param label 中文诊断字段名。
 * @returns 大于零的安全整数。
 * @throws 值无效时抛出资源模板目录合同错误。
 */
function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalidCatalog(`${label}必须是正安全整数`)
  }
  return value as number
}

/**
 * 把原始 wire 记录保存为投影对象的不可枚举只读属性。
 *
 * @param value 面向编辑器的投影对象。
 * @param wireValue 服务端原始节点或连接点记录。
 * @returns 保留投影类型并增加 wireValue 的同一对象。
 * @throws structuredClone 无法复制异常值时传播原错误。
 */
function attachWireValue<T extends object>(
  value: T,
  wireValue: Record<string, unknown>
): T & { wireValue: Record<string, unknown> } {
  Object.defineProperty(value, 'wireValue', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: structuredClone(wireValue)
  })
  return value as T & { wireValue: Record<string, unknown> }
}

/**
 * 解析对象数组。
 *
 * @param value 未信任 wire 值。
 * @returns 每项均为普通记录的数组。
 * @throws 值不是数组或存在非对象项目时关闭失败。
 */
function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    invalidCatalog('Expected an object array')
  }
  const records: Record<string, unknown>[] = []
  for (const item of value) records.push(recordValue(item))
  return records
}

/** 解析普通对象；参数是未信任值，返回记录，null、数组或非对象时关闭失败。 */
function recordValue(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalidCatalog('Expected an object')
  return value
}

/** 解析非空字符串；参数是未信任值，返回原字符串，类型或空白值时关闭失败。 */
function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    invalidCatalog('Expected a non-empty string')
  }
  return value
}

/** 解析 UUID；参数是未信任值，返回 UUID 字符串，格式非法时关闭失败。 */
function uuidString(value: unknown): string {
  const uuid = nonEmptyString(value)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    invalidCatalog('Expected a UUID')
  }
  return uuid
}

/** 解析可空字符串；参数是未信任值，返回字符串或 null，非空值非法时关闭失败。 */
function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : nonEmptyString(value)
}

/** Accept only move-stable package source identities from the OS catalog. */
function packageSourceUri(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^package:\/\/([^/]+)\/(.+)$/.exec(value)
  if (!match || (match[2] ?? '').split('/').some(segment =>
    !segment || segment === '.' || segment === '..'
  )) return null
  return value
}

/** 解析非空字符串集合；参数是可选数组，返回合法项目，非数组返回空集合且不抛错。 */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const strings: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) strings.push(entry)
  }
  return strings
}

/** 校验未信任值是与期望成员完全一致的无重复字符串集合。 */
function sameStringSet(
  value: unknown,
  expected: readonly string[]
): boolean {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string') ||
    value.length !== expected.length ||
    new Set(value).size !== value.length
  ) return false
  return expected.every((entry) => value.includes(entry))
}

/** 判断普通对象；参数是未信任值，返回类型守卫结果，不主动抛错。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 抛出物料来源目录错误；参数是中文原因，永不返回，始终标记不可重试。 */
function invalidCatalog(message: string): never {
  throw new ServiceError({
    code: 'INVALID_WORKFLOW_MATERIAL_SOURCE_CATALOG',
    message,
    retryable: false
  })
}
