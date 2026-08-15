import { describe, expect, it } from 'vitest'

import { getDefaultBackend } from './backends'
import {
  authority,
  catalogResponses,
  defaultCatalogPath,
  detailData,
  detailDataFor,
  fingerprint,
  fixtureHttp,
  frameworkCatalogResponses,
  frameworkNodeUuid,
  frameworkResourceTemplateUuid,
  nodeUuid,
  resourceTemplateUuid,
  sourceUuid,
  targetUuid,
  workflowCatalogPath,
  type Envelope
} from './workflow-action-catalog.fixtures'
import { createWorkflowRuntime } from './workflow'

type MalformedActionMutation =
  | 'missing_fingerprint'
  | 'changed_detail_fingerprint'
  | 'duplicate_node_uuid'
  | 'wrong_handle_parent'
  | 'duplicate_handle_uuid'
  | 'unknown_io_type'
  | 'unknown_editor_control'
  | 'invalid_allowlist'

/** 每个条目声明一个应失败关闭的动作目录 wire 破坏方式。 */
const malformedActionCases: ReadonlyArray<{
  name: string
  mutation: MalformedActionMutation
}> = [
  { name: 'missing fingerprint', mutation: 'missing_fingerprint' },
  {
    name: 'detail fingerprint changed',
    mutation: 'changed_detail_fingerprint'
  },
  { name: 'duplicate node UUID', mutation: 'duplicate_node_uuid' },
  { name: 'wrong Handle parent', mutation: 'wrong_handle_parent' },
  { name: 'duplicate Handle UUID', mutation: 'duplicate_handle_uuid' },
  { name: 'unknown io_type', mutation: 'unknown_io_type' },
  { name: 'unknown editor control', mutation: 'unknown_editor_control' },
  { name: 'invalid allowlist', mutation: 'invalid_allowlist' }
]

describe('Workflow Action Catalog adapter', registerActionCatalogTests)

/**
 * 注册节点模板游标传输与动作（Action）投影测试。
 *
 * @returns 无返回值；Vitest 在收集阶段登记 13 项测试。
 * @throws 测试登记本身不抛出异常，运行断言失败由 Vitest 报告。
 */
function registerActionCatalogTests(): void {
  it(
    'bounds concurrent detail reads for a full Registry catalog',
    verifiesBoundedDetailConcurrency
  )
  it(
    'forwards caller cancellation to every catalog request',
    verifiesAbortSignalForwarding
  )
  it(
    'loads one authority-scoped snapshot without splitting action strings',
    verifiesActionSnapshot
  )
  it(
    'loads the persisted version 2 Action contract and canonical ready Handles',
    acceptsPersistedVersionTwoActionContract
  )
  it(
    'loads the Backend flat device Action parameter schema without legacy Handles',
    acceptsBackendFlatDeviceActionSchema
  )
  it(
    '接受 Backend 省略 properties 的无参数设备动作 Schema',
    acceptsBackendParameterlessDeviceActionSchema
  )
  it(
    'reads every page and excludes non-Action framework templates',
    verifiesCursorTraversalAndFrameworkExclusion
  )
  it.each(malformedActionCases)(
    'fails closed for a malformed $name',
    rejectsMalformedActionCatalog
  )
  it(
    'does not retain a catalog from another authority or fingerprint',
    verifiesCatalogGenerationIsolation
  )
}

/**
 * 证明大量节点模板详情读取并发大于一且不超过八。
 *
 * @returns 测试完成后的 Promise。
 * @throws 遇到未声明请求或并发断言不满足时使测试失败。
 */
async function verifiesBoundedDetailConcurrency(): Promise<void> {
  const detailCount = 24
  const responses = frameworkCatalogResponses(detailCount)
  let activeDetailReads = 0
  let maxActiveDetailReads = 0

  /**
   * 模拟带延迟的详情请求并观测当前并发数。
   *
   * @param path - 节点模板目录或详情请求路径。
   * @returns 对应 wire 响应的隔离副本。
   * @throws 请求路径未在 fixture 中声明时抛出异常。
   */
  async function request<ResponseValue>(path: string): Promise<ResponseValue> {
    if (!(path in responses)) throw new Error(`Unexpected request: ${path}`)
    if (path.startsWith('/api/v1/workflow-node-templates/')) {
      activeDetailReads += 1
      maxActiveDetailReads = Math.max(maxActiveDetailReads, activeDetailReads)
      await delay(2)
      activeDetailReads -= 1
    }
    return structuredClone(responses[path]) as ResponseValue
  }

  const runtime = createWorkflowRuntime(
    { request },
    getDefaultBackend('local-python')
  )
  const catalog = await runtime.getWorkflowActionCatalog()

  expect(catalog.actionTemplates).toEqual([])
  expect(catalog.workflowTemplates).toEqual([])
  expect(maxActiveDetailReads).toBeGreaterThan(1)
  expect(maxActiveDetailReads).toBeLessThanOrEqual(8)
}

/**
 * 证明调用方取消信号被原样传给目录页和全部详情请求。
 *
 * @returns 测试完成后的 Promise。
 * @throws 请求失败或任一请求未收到同一 AbortSignal 时使测试失败。
 */
async function verifiesAbortSignalForwarding(): Promise<void> {
  const controller = new AbortController()
  const observedSignals: Array<AbortSignal | null> = []
  const fixture = fixtureHttp(catalogResponses())

  /**
   * 记录每个目录请求接收的取消信号后转交公共 HTTP fixture。
   *
   * @param path - 节点模板目录或详情请求路径。
   * @param init - 包含调用方 AbortSignal 的请求选项。
   * @returns 对应 wire 响应。
   * @throws 请求路径未声明时由公共 fixture 抛出异常。
   */
  async function request<ResponseValue>(
    path: string,
    init?: RequestInit
  ): Promise<ResponseValue> {
    observedSignals.push(init?.signal ?? null)
    return fixture.request<ResponseValue>(path, init)
  }

  const runtime = createWorkflowRuntime(
    { request },
    getDefaultBackend('local-python')
  )
  await runtime.getWorkflowActionCatalog(controller.signal)

  expect(observedSignals.length).toBeGreaterThan(1)
  expect(new Set(observedSignals)).toEqual(new Set([controller.signal]))
}

/**
 * 证明动作（Action）目录形成一个权威代际一致且不拆分动作名的快照。
 *
 * @returns 测试完成后的 Promise。
 * @throws wire 投影或请求顺序偏离冻结合同时使测试失败。
 */
async function verifiesActionSnapshot(): Promise<void> {
  /** 请求记录证明默认目录与显式发布工作流目录是两个稳定入口。 */
  const requests: string[] = []
  const runtime = createWorkflowRuntime(
    fixtureHttp(catalogResponses(), requests),
    getDefaultBackend('local-python')
  )

  await expect(runtime.getWorkflowActionCatalog()).resolves.toEqual({
    authorityId: 'os-local',
    authorityKind: 'local',
    fingerprint,
    actionTemplates: [{
      uuid: nodeUuid,
      resourceTemplateUuid,
      name: 'transfer.sample.v1',
      displayName: '转移样品',
      actionClass: 'szlab.devices.pump:Pump',
      actionType: 'UniLabJsonCommand',
      schema: {
        type: 'object',
        properties: {
          goal: {
            type: 'object',
            properties: {
              sample: { $slot: 'ResourceSlot' },
              mode: {
                type: 'string',
                enum: ['safe', 'fast'],
                default: 'safe'
              }
            },
            required: ['sample'],
            additionalProperties: false
          },
          feedback: {},
          result: {
            type: 'object',
            properties: { sample: { $slot: 'ResourceSlot' } },
            required: ['sample'],
            additionalProperties: false
          }
        },
        required: ['goal'],
        'x-unilabos-action-contract': {
          version: 1,
          input_order: ['sample', 'mode'],
          output_order: ['sample'],
          resource_template_symbols: { goal: {}, result: {} }
        }
      },
      goal: { sample: 'sample', mode: 'mode' },
      goalDefault: { mode: 'safe' },
      handles: [
        {
          uuid: targetUuid,
          workflowNodeTemplateUuid: nodeUuid,
          handleKey: 'sample.input.v1',
          ioType: 'target',
          displayName: '样品',
          valueType: 'ResourceSlot',
          required: true,
          dataSource: 'goal',
          dataKey: 'sample',
          valueSchema: { $slot: 'ResourceSlot' },
          editorControl: 'material_port',
          allowedResourceTemplateUuids: [resourceTemplateUuid],
          implicitPassthrough: false,
          structuralRole: null
        },
        {
          uuid: sourceUuid,
          workflowNodeTemplateUuid: nodeUuid,
          handleKey: 'sample.output.v1',
          ioType: 'source',
          displayName: '处理后样品',
          valueType: 'ResourceSlot',
          required: false,
          dataSource: 'result',
          dataKey: 'sample',
          valueSchema: { $slot: 'ResourceSlot' },
          editorControl: 'material_port',
          allowedResourceTemplateUuids: [resourceTemplateUuid],
          implicitPassthrough: true,
          structuralRole: null
        }
      ]
    }],
    workflowTemplates: []
  })
  expect(requests).toEqual([
    defaultCatalogPath,
    workflowCatalogPath,
    `/api/v1/workflow-node-templates/${nodeUuid}`
  ])
}

/**
 * 证明数据库读投影可从保留元数据恢复第 2 版动作合同（Action Contract）。
 *
 * @returns 测试完成后的 Promise。
 * @throws JSON 文本目标 Schema、保留合同或规范 ready 连接点（Handle）被遗漏、
 * 错误放宽或拒绝时使测试失败。
 */
async function acceptsPersistedVersionTwoActionContract(): Promise<void> {
  const responses = catalogResponses()
  const detail = detailData(responses)
  const template = (responses[
    `/api/v1/workflow-node-templates/${nodeUuid}`
  ] as Envelope).data as { template: Record<string, unknown> }
  const contract = template.template.schema as Record<string, unknown>
  const extension = contract['x-unilabos-action-contract'] as Record<
    string,
    unknown
  >
  extension.version = 2
  template.template.meta_data = {
    unilab: { action_contract_schema: contract }
  }
  const properties = contract.properties as Record<string, Record<string, unknown>>
  template.template.schema = JSON.stringify(properties.goal)
  detail.handles.push(
    {
      uuid: '30000000-0000-4000-8000-000000000003',
      workflow_node_template_uuid: nodeUuid,
      handle_key: 'ready',
      io_type: 'target',
      display_name: 'ready',
      type: 'default',
      required: false,
      meta_data: {}
    },
    {
      uuid: '30000000-0000-4000-8000-000000000004',
      workflow_node_template_uuid: nodeUuid,
      handle_key: 'ready',
      io_type: 'source',
      display_name: 'ready',
      type: 'default',
      required: false,
      meta_data: {}
    }
  )
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-python')
  )

  const catalog = await runtime.getWorkflowActionCatalog()

  expect(catalog.actionTemplates).toHaveLength(1)
  expect(catalog.actionTemplates[0]?.schema)
    .toMatchObject({ 'x-unilabos-action-contract': { version: 2 } })
  expect(catalog.actionTemplates[0]?.handles.slice(-2)).toEqual([
    expect.objectContaining({ handleKey: 'ready', ioType: 'target' }),
    expect.objectContaining({ handleKey: 'ready', ioType: 'source' })
  ])
}

/**
 * 证明 Backend 当前持久化的平面设备动作参数 Schema 可直接形成 D1A 参数合同。
 *
 * @returns 测试完成后的 Promise。
 * @throws 平面参数、默认值或旧工作流连接点（Handle）被错误投影时使测试失败。
 */
async function acceptsBackendFlatDeviceActionSchema(): Promise<void> {
  const responses = catalogResponses()
  const detail = detailDataFor(responses, nodeUuid)
  detail.template.schema = {
    type: 'object',
    properties: {
      speed_rpm: {
        type: 'integer',
        title: '转速',
        minimum: 100,
        maximum: 1500
      },
      direction: {
        type: 'string',
        title: '方向',
        enum: ['clockwise', 'counterclockwise']
      }
    },
    required: ['speed_rpm'],
    additionalProperties: false
  }
  detail.template.goal_default = {
    speed_rpm: 600,
    direction: 'clockwise'
  }
  detail.template.meta_data = { seed: 'internal-demo' }

  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-go')
  )

  const catalog = await runtime.getWorkflowActionCatalog()

  expect(catalog.actionTemplates).toEqual([
    expect.objectContaining({
      uuid: nodeUuid,
      resourceTemplateUuid,
      schema: detail.template.schema,
      goalDefault: detail.template.goal_default,
      handles: []
    })
  ])
}

/**
 * 证明 Backend 的 EmptyIn 等无参数动作可使用省略 properties 的标准对象 Schema。
 *
 * @returns 测试完成后的 Promise。
 * @throws 省略 properties 被误判为无效目录时使测试失败。
 */
async function acceptsBackendParameterlessDeviceActionSchema(): Promise<void> {
  const responses = catalogResponses()
  const detail = detailDataFor(responses, nodeUuid)
  detail.template.schema = JSON.stringify({
    type: 'object',
    title: 'EmptyIn_Goal',
    additionalProperties: true
  })
  detail.template.goal = {}
  detail.template.goal_default = {}
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-go')
  )

  const catalog = await runtime.getWorkflowActionCatalog()

  expect(catalog.actionTemplates).toEqual([
    expect.objectContaining({
      uuid: nodeUuid,
      schema: {
        type: 'object',
        title: 'EmptyIn_Goal',
        additionalProperties: true
      },
      goalDefault: {}
    })
  ])
}

/**
 * 证明默认目录沿 UUID 游标完整读取，同时框架节点不成为动作（Action）。
 *
 * @returns 测试完成后的 Promise。
 * @throws 游标请求、详情读取或投影过滤偏离合同时使测试失败。
 */
async function verifiesCursorTraversalAndFrameworkExclusion(): Promise<void> {
  const requests: string[] = []
  const responses = catalogResponses()
  const first = responses[defaultCatalogPath] as Envelope
  /** 保留动作摘要到第二页，以证明分页结束前不会丢失节点身份。 */
  const typedSummary = structuredClone(
    (first.data as { items: unknown[] }).items[0]
  )
  ;(first.data as Record<string, unknown>).items = [{
    uuid: frameworkNodeUuid,
    name: 'group',
    display_name: 'Group',
    type: 'framework',
    node_type: 'group',
    resource_template: {
      uuid: frameworkResourceTemplateUuid,
      name: 'unilabos.resources.material_source',
      display_name: 'Material Source'
    }
  }]
  ;(first.data as Record<string, unknown>).has_more = true
  ;(first.data as Record<string, unknown>).next_cursor_uuid = frameworkNodeUuid
  /** 下一游标使用上一页最后一个节点模板 UUID，符合 Backend 合同。 */
  const secondCatalogPath =
    `/api/v1/workflow-node-templates?limit=100&cursor_uuid=${frameworkNodeUuid}`
  responses[secondCatalogPath] = {
    code: 0,
    data: {
      authority,
      catalog_fingerprint: fingerprint,
      items: [typedSummary],
      has_more: false,
      next_cursor_uuid: null
    }
  }
  responses[`/api/v1/workflow-node-templates/${frameworkNodeUuid}`] = {
    code: 0,
    data: {
      authority,
      catalog_fingerprint: fingerprint,
      template: {
        uuid: frameworkNodeUuid,
        resource_template_uuid: frameworkResourceTemplateUuid,
        name: 'group',
        display_name: 'Group',
        class: null,
        type: 'framework',
        node_type: 'group',
        schema: null,
        goal: {},
        goal_default: {},
        feedback: {},
        result: {},
        meta_data: {}
      },
      handles: []
    }
  }
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses, requests),
    getDefaultBackend('local-python')
  )
  const catalog = await runtime.getWorkflowActionCatalog()

  expect(actionTemplateUuids(catalog.actionTemplates)).toEqual([nodeUuid])
  expect(catalog.workflowTemplates).toEqual([])
  expect(requests).toEqual([
    defaultCatalogPath,
    secondCatalogPath,
    workflowCatalogPath,
    `/api/v1/workflow-node-templates/${frameworkNodeUuid}`,
    `/api/v1/workflow-node-templates/${nodeUuid}`
  ])
}

/**
 * 证明任一动作目录或连接点（Handle）畸形数据都失败关闭。
 *
 * @param testCase - 畸形场景显示名及声明式破坏类型。
 * @returns 测试完成后的 Promise。
 * @throws 未知破坏类型、请求异常或错误语义不符时使测试失败。
 */
async function rejectsMalformedActionCatalog(testCase: {
  name: string
  mutation: MalformedActionMutation
}): Promise<void> {
  const responses = catalogResponses()
  applyMalformedActionMutation(responses, testCase.mutation)
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-python')
  )

  await expect(runtime.getWorkflowActionCatalog()).rejects.toMatchObject({
    code: 'INVALID_API_RESPONSE',
    retryable: false
  })
}

/**
 * 证明不同目录权威或指纹的投影不会共享缓存代际。
 *
 * @returns 测试完成后的 Promise。
 * @throws 任一 runtime 丢失自身权威身份或指纹时使测试失败。
 */
async function verifiesCatalogGenerationIsolation(): Promise<void> {
  const first = createWorkflowRuntime(fixtureHttp(catalogResponses()), {
    ...getDefaultBackend('local-python'),
    apiUrl: 'http://127.0.0.1:8101'
  })
  const secondResponses = catalogResponses()
  const list = (secondResponses[defaultCatalogPath] as Envelope)
    .data as Record<string, unknown>
  const workflowList = (secondResponses[workflowCatalogPath] as Envelope)
    .data as Record<string, unknown>
  const detail = (secondResponses[
    `/api/v1/workflow-node-templates/${nodeUuid}`
  ] as Envelope).data as Record<string, unknown>
  list.authority = { authority_id: 'os-lab-b', kind: 'local' }
  workflowList.authority = { authority_id: 'os-lab-b', kind: 'local' }
  detail.authority = { authority_id: 'os-lab-b', kind: 'local' }
  list.catalog_fingerprint = `sha256:${'c'.repeat(64)}`
  workflowList.catalog_fingerprint = `sha256:${'c'.repeat(64)}`
  detail.catalog_fingerprint = `sha256:${'c'.repeat(64)}`
  const second = createWorkflowRuntime(fixtureHttp(secondResponses), {
    ...getDefaultBackend('local-python'),
    apiUrl: 'http://127.0.0.1:8102'
  })

  const [catalogA, catalogB] = await Promise.all([
    first.getWorkflowActionCatalog(),
    second.getWorkflowActionCatalog()
  ])
  expect(catalogA.authorityId).toBe('os-local')
  expect(catalogA.fingerprint).toBe(fingerprint)
  expect(catalogB.authorityId).toBe('os-lab-b')
  expect(catalogB.fingerprint).toBe(`sha256:${'c'.repeat(64)}`)
}

/**
 * 对响应表应用一个声明式动作目录破坏操作。
 *
 * @param responses - 即将交给适配器的可变 wire 响应表。
 * @param mutation - 需要证明失败关闭的破坏类型。
 * @returns 无返回值；响应表被原地修改。
 * @throws mutation 未覆盖时通过穷尽检查抛出异常。
 */
function applyMalformedActionMutation(
  responses: Record<string, unknown>,
  mutation: MalformedActionMutation
): void {
  switch (mutation) {
    case 'missing_fingerprint':
      delete ((responses[defaultCatalogPath] as Envelope)
        .data as Record<string, unknown>).catalog_fingerprint
      return
    case 'changed_detail_fingerprint':
      ((responses[
        `/api/v1/workflow-node-templates/${nodeUuid}`
      ] as Envelope).data as Record<string, unknown>).catalog_fingerprint =
        `sha256:${'b'.repeat(64)}`
      return
    case 'duplicate_node_uuid': {
      const data = (responses[defaultCatalogPath] as Envelope)
        .data as { items: unknown[] }
      data.items.push(structuredClone(data.items[0]))
      return
    }
    case 'wrong_handle_parent':
      detailData(responses).handles[0].workflow_node_template_uuid =
        '20000000-0000-4000-8000-000000000099'
      return
    case 'duplicate_handle_uuid': {
      const handles = detailData(responses).handles
      handles[1].uuid = handles[0].uuid
      return
    }
    case 'unknown_io_type':
      detailData(responses).handles[0].io_type = 'input'
      return
    case 'unknown_editor_control':
      detailData(responses).handles[0].meta_data = {
        unilab: {
          value_schema: { $slot: 'ResourceSlot' },
          editor_control: 'guessed_from_field_name',
          allowed_resource_template_uuids: [resourceTemplateUuid],
          implicit_passthrough: false
        }
      }
      return
    case 'invalid_allowlist':
      detailData(responses).handles[0].meta_data = {
        unilab: {
          value_schema: { $slot: 'ResourceSlot' },
          editor_control: 'material_port',
          allowed_resource_template_uuids: [],
          implicit_passthrough: false
        }
      }
      return
    default:
      throw new Error(`Unsupported malformed Action mutation: ${mutation}`)
  }
}

/**
 * 抽取动作节点模板稳定 UUID，避免测试内匿名映射回调。
 *
 * @param templates - 已投影的动作节点模板集合。
 * @returns 保持目录顺序的 UUID 集合。
 * @throws 此纯辅助函数不抛出异常。
 */
function actionTemplateUuids(
  templates: ReadonlyArray<{ uuid: string }>
): string[] {
  const uuids: string[] = []
  for (const template of templates) uuids.push(template.uuid)
  return uuids
}

/**
 * 等待指定毫秒，供并发上限测试制造可观测重叠。
 *
 * @param milliseconds - 非负等待时长。
 * @returns 等待结束后完成的 Promise。
 * @throws 定时器回调不抛出异常。
 */
function delay(milliseconds: number): Promise<void> {
  /**
   * 把 Promise 完成回调交给定时器辅助函数。
   *
   * @param resolve 完成当前等待的回调。
   * @returns 无。
   * @throws 定时器调度失败时由运行时传播。
   */
  function schedule(resolve: () => void): void {
    resolveAfterTimeout(resolve, milliseconds)
  }
  return new Promise(schedule)
}

/**
 * 调度延迟 Promise 的完成回调。
 *
 * @param resolve - 结束等待的回调。
 * @param milliseconds - 非负等待时长。
 * @returns 无返回值。
 * @throws 定时器调度失败时由运行时抛出异常。
 */
function resolveAfterTimeout(
  resolve: () => void,
  milliseconds: number
): void {
  setTimeout(resolve, milliseconds)
}
