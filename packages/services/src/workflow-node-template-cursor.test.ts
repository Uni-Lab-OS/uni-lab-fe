import { describe, expect, it } from 'vitest'

import type { HttpClient } from './http'
import {
  loadWorkflowNodeTemplateCatalog,
  mergeWorkflowNodeTemplateCatalogs,
  parseWorkflowNodeTemplateDetail
} from './workflowNodeTemplateCursor'

const firstUuid = '20000000-0000-4000-8000-000000000001'
const secondUuid = '20000000-0000-4000-8000-000000000002'
const resourceTemplateUuid = '10000000-0000-4000-8000-000000000001'
const fingerprint = `sha256:${'a'.repeat(64)}`

/**
 * 注册节点模板游标合同（NodeTemplateCursorContract）的测试集合。
 *
 * @returns 无返回值；测试由 Vitest 注册后执行。
 * @throws 不主动抛出异常；测试失败由 Vitest 汇报。
 */
function registerWorkflowNodeTemplateCursorTests(): void {
  it(
    '接受后端（Backend）UUID 游标合同且不要求权威或总数',
    acceptsBackendCursorWithoutOsExtensions
  )
  it(
    'fails closed for repeated item UUIDs across cursor pages',
    rejectsRepeatedItemUuid
  )
  it(
    'fails closed when has_more cannot advance a non-empty UUID cursor',
    rejectsEmptyCursorAdvance
  )
  it(
    'fails closed when a later page repeats an already used UUID cursor',
    rejectsRepeatedCursorAdvance
  )
  it(
    '接受游标目录 envelope 中的兼容 total 元数据',
    acceptsCompatibleTotalMetadata
  )
  it(
    '拒绝游标目录 envelope 中的无效 total 元数据',
    rejectsInvalidTotalMetadata
  )
  it(
    'accepts the current OS page/page_size/total contract without truncation',
    acceptsOsPageMetadata
  )
  it(
    '接受 Backend page/page_size/has_more 合同且不要求 total',
    acceptsBackendNumberedMetadataWithoutTotal
  )
  it(
    'fails closed when cursor and page metadata are mixed',
    rejectsMixedPaginationMetadata
  )
  it(
    'sends the explicit MaterialSource node_type without legacy page fields',
    sendsExplicitMaterialSourceFilter
  )
  it(
    'merges default and PublishedWorkflow catalogs by stable UUID identity',
    mergesDefaultAndPublishedWorkflowCatalogs
  )
  it(
    'requires an OS catalog generation to stay coherent through detail reads',
    verifiesOsGenerationAcrossListAndDetail
  )
}

describe(
  'Workflow node template UUID cursor adapter',
  registerWorkflowNodeTemplateCursorTests
)

/**
 * 验证后端（Backend）不发布 OS 扩展元数据时仍可完整遍历 UUID 游标。
 *
 * @returns Promise 完成时表示两页摘要已按服务端顺序收集。
 * @throws 游标字段、项目身份或请求路径不符合合同时由断言报告。
 */
async function acceptsBackendCursorWithoutOsExtensions(): Promise<void> {
  // 首次请求使用 Backend 页码；若旧服务返回游标，后续页仍可兼容推进。
  const requests: string[] = []
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': page(
      [summary(firstUuid, 'mix')],
      true,
      firstUuid
    ),
    [`/api/v1/workflow-node-templates?limit=100&cursor_uuid=${firstUuid}`]:
      page([summary(secondUuid, 'heat')], false, null)
  }, requests)

  const catalog = await loadWorkflowNodeTemplateCatalog(http)

  expect(catalog.items.map(readTemplateUuid)).toEqual([
    firstUuid,
    secondUuid
  ])
  expect(catalog.generation).toBeNull()
  expect(requests).toEqual([
    '/api/v1/workflow-node-templates?page=1&page_size=100',
    `/api/v1/workflow-node-templates?limit=100&cursor_uuid=${firstUuid}`
  ])
}

/**
 * 验证跨页重复的节点模板 UUID 会关闭失败，避免同一身份被解释两次。
 *
 * @returns Promise 完成时表示不可重试合同错误已被观察。
 * @throws 若重复身份被静默接受则由 Vitest 断言失败。
 */
async function rejectsRepeatedItemUuid(): Promise<void> {
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': page(
      [summary(firstUuid, 'mix')],
      true,
      firstUuid
    ),
    [`/api/v1/workflow-node-templates?limit=100&cursor_uuid=${firstUuid}`]:
      page([summary(firstUuid, 'mix')], false, null)
  })

  await expect(loadWorkflowNodeTemplateCatalog(http)).rejects.toMatchObject({
    code: 'INVALID_API_RESPONSE',
    retryable: false
  })
}

/**
 * 验证服务端声明还有下一页却无法给出非空新游标时关闭失败。
 *
 * @returns Promise 完成时表示空页和空游标均未造成无限请求。
 * @throws 若游标不能前进却仍被接受则由 Vitest 断言失败。
 */
async function rejectsEmptyCursorAdvance(): Promise<void> {
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': page([], true, null)
  })

  await expect(loadWorkflowNodeTemplateCatalog(http)).rejects.toMatchObject({
    code: 'INVALID_API_RESPONSE',
    retryable: false
  })
}

/**
 * 验证后续页不得把游标重新指向已使用的 UUID。
 *
 * @returns Promise 完成时表示重复游标被不可重试错误拒绝。
 * @throws 若重复游标导致继续请求或被接受则由 Vitest 断言失败。
 */
async function rejectsRepeatedCursorAdvance(): Promise<void> {
  const secondPath =
    `/api/v1/workflow-node-templates?limit=100&cursor_uuid=${firstUuid}`
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': page(
      [summary(firstUuid, 'mix')],
      true,
      firstUuid
    ),
    [secondPath]: page(
      [summary(secondUuid, 'heat')],
      true,
      firstUuid
    )
  })

  await expect(loadWorkflowNodeTemplateCatalog(http)).rejects.toMatchObject({
    code: 'INVALID_API_RESPONSE',
    retryable: false
  })
}

/**
 * 验证服务端可在 UUID 游标目录 envelope 中附带兼容总数。
 *
 * @returns Promise 完成时表示 total 未污染节点模板实体且目录可正常读取。
 * @throws 若兼容 total 仍被误判为未知字段则由 Vitest 断言失败。
 */
async function acceptsCompatibleTotalMetadata(): Promise<void> {
  const response = page([summary(firstUuid, 'mix')], false, null)
  // `data` 模拟当前部署环境在游标 envelope 上附带的合法目录总数。
  const data = response.data as Record<string, unknown>
  data.total = 1
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': response
  })

  const catalog = await loadWorkflowNodeTemplateCatalog(http)

  expect(catalog.items.map(readTemplateUuid)).toEqual([firstUuid])
}

/**
 * 验证兼容目录总数仍须是非负整数，不能成为任意值逃生口。
 *
 * @returns Promise 完成时表示无效 total 被不可重试合同错误拒绝。
 * @throws 若字符串、负数或小数 total 被静默接受则由 Vitest 断言失败。
 */
async function rejectsInvalidTotalMetadata(): Promise<void> {
  for (const invalidTotal of ['1', -1, 1.5]) {
    const response = page([summary(firstUuid, 'mix')], false, null)
    // `data` 是被测游标 envelope；每轮只改变兼容目录总数。
    const data = response.data as Record<string, unknown>
    data.total = invalidTotal
    const http = fixtureHttp({
      '/api/v1/workflow-node-templates?page=1&page_size=100': response
    })

    await expect(loadWorkflowNodeTemplateCatalog(http)).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
      retryable: false
    })
  }
}

/**
 * 验证当前 OS 页码合同会遍历到 total，且不会把第一页误当成完整目录。
 *
 * @returns Promise 完成时表示两个页码页均被读取并保持首见顺序。
 * @throws 若页码元数据被拒绝或目录被截断则由断言报告。
 */
async function acceptsOsPageMetadata(): Promise<void> {
  const requests: string[] = []
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': numberedPage(
      [summary(firstUuid, 'mix')], 1, 1, 2
    ),
    '/api/v1/workflow-node-templates?page=2&page_size=1': numberedPage(
      [summary(secondUuid, 'heat')], 2, 1, 2
    )
  }, requests)

  const catalog = await loadWorkflowNodeTemplateCatalog(http)

  expect(catalog.items.map(readTemplateUuid)).toEqual([firstUuid, secondUuid])
  expect(requests).toEqual([
    '/api/v1/workflow-node-templates?page=1&page_size=100',
    '/api/v1/workflow-node-templates?page=2&page_size=1'
  ])
}

/**
 * 验证最新后端（Backend）节点模板目录只用 has_more 表示是否还有下一页。
 *
 * @returns Promise 完成时表示无 total 的两页目录已完整读取。
 * @throws 若 has_more 被误判为游标字段或 total 仍为必填则由断言报告。
 */
async function acceptsBackendNumberedMetadataWithoutTotal(): Promise<void> {
  const requests: string[] = []
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': numberedPage(
      [summary(firstUuid, 'mix')], 1, 1, undefined, true
    ),
    '/api/v1/workflow-node-templates?page=2&page_size=1': numberedPage(
      [summary(secondUuid, 'heat')], 2, 1, undefined, false
    )
  }, requests)

  const catalog = await loadWorkflowNodeTemplateCatalog(http)

  expect(catalog.items.map(readTemplateUuid)).toEqual([firstUuid, secondUuid])
  expect(requests).toEqual([
    '/api/v1/workflow-node-templates?page=1&page_size=100',
    '/api/v1/workflow-node-templates?page=2&page_size=1'
  ])
}

/**
 * 验证一个响应不能同时宣称 UUID 游标与页码分页，避免代际歧义。
 *
 * @returns Promise 完成时表示混合合同被关闭失败。
 * @throws 若混合字段被静默接受则由 Vitest 断言失败。
 */
async function rejectsMixedPaginationMetadata(): Promise<void> {
  const response = page([summary(firstUuid, 'mix')], false, null)
  // `data` 是测试故意污染的列表主体，不允许同时声明两套分页坐标。
  const data = response.data as Record<string, unknown>
  data.page = 1
  data.page_size = 100
  data.next_cursor_uuid = null
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': response
  })

  await expect(loadWorkflowNodeTemplateCatalog(http)).rejects.toMatchObject({
    code: 'INVALID_API_RESPONSE',
    retryable: false
  })
}

/**
 * 验证物料来源（MaterialSource）目录必须通过显式 node_type 筛选读取。
 *
 * @returns Promise 完成时表示请求携带 Backend page/page_size 与显式筛选。
 * @throws 若请求路径偏离后端（Backend）合同则测试 HTTP fixture 抛错。
 */
async function sendsExplicitMaterialSourceFilter(): Promise<void> {
  const requests: string[] = []
  const path =
    '/api/v1/workflow-node-templates?page=1&page_size=100&node_type=material_source'
  const http = fixtureHttp({
    [path]: page([summary(firstUuid, 'material_source', 'material_source')],
      false,
      null)
  }, requests)

  const catalog = await loadWorkflowNodeTemplateCatalog(http, {
    nodeType: 'material_source'
  })

  expect(catalog.items).toHaveLength(1)
  expect(requests).toEqual([path])
}

/**
 * 验证默认动作目录与显式已发布工作流（PublishedWorkflow）目录稳定合并。
 *
 * @returns 无返回值；断言首见顺序、同内容去重和混合代际规则。
 * @throws 相同 UUID 内容冲突或代际不一致时合并函数应关闭失败。
 */
function mergesDefaultAndPublishedWorkflowCatalogs(): void {
  const generation = osGeneration()
  // 默认目录包含动作模板；工作流目录可能重复返回一个相同摘要。
  const action = summary(firstUuid, 'mix')
  const workflow = summary(secondUuid, 'workflow:test', 'workflow')

  expect(mergeWorkflowNodeTemplateCatalogs(
    { items: [action], generation },
    { items: [structuredClone(action), workflow], generation }
  )).toEqual({ items: [action, workflow], generation })

  const conflictingAction = { ...action, display_name: '冲突标题' }
  /**
   * 尝试合并同身份但不同内容的目录摘要。
   *
   * @returns 仅在冲突门禁失效时返回合并目录。
   * @throws 预期抛出节点模板（WorkflowNodeTemplate）冲突。
   */
  function mergeConflictingCatalogs(): unknown {
    return mergeWorkflowNodeTemplateCatalogs(
      { items: [action], generation },
      { items: [conflictingAction], generation }
    )
  }
  expect(mergeConflictingCatalogs).toThrow('节点模板')
}

/**
 * 验证 OS 目录代际扩展在列表页和详情响应中必须同时存在且完全一致。
 *
 * @returns Promise 完成时表示一致详情通过、缺失扩展详情关闭失败。
 * @throws 若详情混合缺失或漂移未被拒绝则由 Vitest 断言失败。
 */
async function verifiesOsGenerationAcrossListAndDetail(): Promise<void> {
  const generation = osGeneration()
  const http = fixtureHttp({
    '/api/v1/workflow-node-templates?page=1&page_size=100': page(
      [summary(firstUuid, 'mix')],
      false,
      null,
      generation
    )
  })
  const catalog = await loadWorkflowNodeTemplateCatalog(http)
  const coherentDetail = envelope({
    ...generationWire(generation),
    template: { uuid: firstUuid },
    handles: []
  })
  const missingGenerationDetail = envelope({
    template: { uuid: firstUuid },
    handles: []
  })

  expect(parseWorkflowNodeTemplateDetail(
    coherentDetail,
    catalog.generation
  ).template).toEqual({ uuid: firstUuid })
  /**
   * 尝试解码缺少 OS 目录代际的详情。
   *
   * @returns 仅在混代门禁失效时返回详情。
   * @throws 预期抛出节点模板（WorkflowNodeTemplate）代际错误。
   */
  function parseMissingGenerationDetail(): unknown {
    return parseWorkflowNodeTemplateDetail(
      missingGenerationDetail,
      catalog.generation
    )
  }
  expect(parseMissingGenerationDetail).toThrow('节点模板')
}

/**
 * 读取节点模板（WorkflowNodeTemplate）摘要 UUID。
 *
 * @param item 目录摘要。
 * @returns 稳定 UUID。
 * @throws 无。
 */
function readTemplateUuid(item: Record<string, unknown>): string {
  return String(item.uuid)
}

/**
 * 构造节点模板列表摘要 fixture。
 *
 * @param uuid 节点模板稳定 UUID。
 * @param name 节点模板稳定名称。
 * @param nodeType 节点类型；默认模拟设备动作。
 * @returns 后端（Backend）列表接口使用的最小合法摘要。
 */
function summary(
  uuid: string,
  name: string,
  nodeType = 'device_action'
): Record<string, unknown> {
  return {
    uuid,
    name,
    display_name: name,
    type: nodeType === 'workflow' ? 'workflow' : 'UniLabJsonCommand',
    node_type: nodeType,
    resource_template: {
      uuid: resourceTemplateUuid,
      name: 'host_node',
      display_name: 'Host Node'
    }
  }
}

/**
 * 构造 UUID 游标页响应。
 *
 * @param items 本页节点模板摘要。
 * @param hasMore 是否仍有后续页。
 * @param nextCursorUuid 下一页使用的模板 UUID；末页必须为 null。
 * @param generation 可选 OS 目录代际扩展；后端（Backend）fixture 省略。
 * @returns 带 code/data 外壳的节点模板列表响应。
 */
function page(
  items: Record<string, unknown>[],
  hasMore: boolean,
  nextCursorUuid: string | null,
  generation: ReturnType<typeof osGeneration> | null = null
): Record<string, unknown> {
  return envelope({
    ...(generation ? generationWire(generation) : {}),
    items,
    has_more: hasMore,
    next_cursor_uuid: nextCursorUuid
  })
}

/**
 * 构造 OS 或 Backend 使用的页码目录响应。
 *
 * @param items 当前页节点模板摘要。
 * @param pageNumber 当前页码。
 * @param pageSize 服务端确认的页大小。
 * @param total OS 可选总数。
 * @param hasMore Backend 可选后续页标记。
 * @returns 带统一外壳的页码响应 fixture。
 */
function numberedPage(
  items: Record<string, unknown>[],
  pageNumber: number,
  pageSize: number,
  total: number | undefined,
  hasMore?: boolean
): Record<string, unknown> {
  return envelope({
    items,
    page: pageNumber,
    page_size: pageSize,
    ...(hasMore === undefined ? {} : { has_more: hasMore }),
    ...(total === undefined ? {} : { total })
  })
}

/**
 * 构造成功 API 外壳（Envelope）。
 *
 * @param data 响应数据主体。
 * @returns code 为零且不含 error 的固定响应。
 */
function envelope(data: Record<string, unknown>): Record<string, unknown> {
  return { code: 0, data }
}

/**
 * 构造 OS 本地模板目录代际。
 *
 * @returns 可跨列表页与详情核对的权威（Authority）和目录指纹。
 */
function osGeneration(): {
  authorityId: string
  authorityKind: 'local'
  fingerprint: string
} {
  return {
    authorityId: 'os-local',
    authorityKind: 'local',
    fingerprint
  }
}

/**
 * 把内部目录代际投影回 OS wire 扩展字段。
 *
 * @param generation 已校验的 OS 模板目录代际。
 * @returns authority/catalog_fingerprint wire 字段。
 */
function generationWire(
  generation: ReturnType<typeof osGeneration>
): Record<string, unknown> {
  return {
    authority: {
      authority_id: generation.authorityId,
      kind: generation.authorityKind
    },
    catalog_fingerprint: generation.fingerprint
  }
}

/**
 * 构造只允许访问给定响应映射的 HTTP fixture。
 *
 * @param responses 请求路径到响应外壳的映射。
 * @param requests 可选请求观察列表，用于验证查询合同。
 * @returns 每次返回深拷贝响应的 HTTP 客户端。
 * @throws 请求未知路径时抛出错误，避免测试静默接受旧合同。
 */
function fixtureHttp(
  responses: Record<string, unknown>,
  requests: string[] = []
): HttpClient {
  /**
   * 读取测试响应并记录完整路径。
   *
   * @param path 被测 adapter 发出的相对 API 路径。
   * @returns 对应 fixture 的深拷贝。
   * @throws 路径未声明时抛出错误。
   */
  async function request<Value>(path: string): Promise<Value> {
    requests.push(path)
    if (!Object.prototype.hasOwnProperty.call(responses, path)) {
      throw new Error(`Unexpected request: ${path}`)
    }
    return structuredClone(responses[path]) as Value
  }
  return { request }
}
