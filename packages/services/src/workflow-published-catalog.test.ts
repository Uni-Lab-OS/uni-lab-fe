import { describe, expect, it } from 'vitest'

import { getDefaultBackend } from './backends'
import {
  defaultCatalogPath,
  detailDataFor,
  fingerprint,
  fixtureHttp,
  nodeUuid,
  resourceTemplateUuid,
  targetUuid,
  workflowCatalogPath
} from './workflow-action-catalog.fixtures'
import {
  executableCatalogResponses,
  expectedWorkflowHandle,
  hostResourceTemplateUuid,
  nullableResourceSlotSchema,
  resourceSlotSchema,
  workflowDetail,
  workflowExtension,
  workflowHandleUnilab,
  workflowHandles,
  workflowInputUuid,
  workflowNodeUuid,
  workflowOutputUuid,
  workflowReadySourceUuid,
  workflowReadyTargetUuid,
  workflowSchema,
  workflowSchemaValue,
  workflowSource,
  workflowSummary,
  workflowUnilab,
  workflowUuid
} from './workflow-published-catalog.fixtures'
import { createWorkflowRuntime } from './workflow'

type MalformedWorkflowMutation =
  | 'action_discriminator'
  | 'wrong_node_type'
  | 'wrong_framework_owner'
  | 'wrong_contract_version'
  | 'wrong_compatibility_version'
  | 'extra_contract_field'
  | 'invalid_revision'
  | 'wrong_workflow_uuid'
  | 'invalid_source_hash'
  | 'invalid_contract_digest'
  | 'duplicate_input_order'
  | 'unknown_input_order'
  | 'missing_output_order'
  | 'open_workflow_schema'
  | 'missing_provenance_field'
  | 'extra_provenance_field'
  | 'wrong_provenance_kind'
  | 'absolute_package_module'
  | 'wrong_class_source'
  | 'wrong_handle_parent'
  | 'wrong_input_direction'
  | 'wrong_input_data_source'
  | 'wrong_input_data_key'
  | 'wrong_input_value_schema'
  | 'wrong_resource_slot_allowlist'
  | 'missing_ready_handle'
  | 'missing_ready_role'
  | 'wrong_ready_data_source'
  | 'duplicate_global_handle_uuid'
  | 'required_output_handle'

/** 每个条目声明一个应失败关闭的发布工作流（PublishedWorkflow）合同破坏方式。 */
const malformedWorkflowCases: ReadonlyArray<{
  name: string
  mutation: MalformedWorkflowMutation
}> = [
  {
    name: 'workflow discriminator on an Action-shaped template',
    mutation: 'action_discriminator'
  },
  { name: 'workflow node_type', mutation: 'wrong_node_type' },
  { name: 'framework renderer owner flag', mutation: 'wrong_framework_owner' },
  { name: 'workflow contract version', mutation: 'wrong_contract_version' },
  {
    name: 'workflow compatibility version',
    mutation: 'wrong_compatibility_version'
  },
  { name: 'workflow contract extension field', mutation: 'extra_contract_field' },
  { name: 'workflow revision', mutation: 'invalid_revision' },
  { name: 'workflow UUID identity', mutation: 'wrong_workflow_uuid' },
  { name: 'Applied source hash', mutation: 'invalid_source_hash' },
  { name: 'contract digest', mutation: 'invalid_contract_digest' },
  { name: 'duplicate input order', mutation: 'duplicate_input_order' },
  { name: 'input order/schema correspondence', mutation: 'unknown_input_order' },
  { name: 'output order/schema correspondence', mutation: 'missing_output_order' },
  { name: 'closed workflow schema', mutation: 'open_workflow_schema' },
  { name: 'missing Package provenance field', mutation: 'missing_provenance_field' },
  { name: 'extra Package provenance field', mutation: 'extra_provenance_field' },
  { name: 'Package provenance kind', mutation: 'wrong_provenance_kind' },
  { name: 'absolute Package module', mutation: 'absolute_package_module' },
  { name: 'Package class/source correspondence', mutation: 'wrong_class_source' },
  { name: 'workflow Handle parent', mutation: 'wrong_handle_parent' },
  { name: 'input Handle direction', mutation: 'wrong_input_direction' },
  { name: 'input Handle data source', mutation: 'wrong_input_data_source' },
  { name: 'input Handle data key', mutation: 'wrong_input_data_key' },
  { name: 'input Handle value schema', mutation: 'wrong_input_value_schema' },
  { name: 'missing structural ready Handle', mutation: 'missing_ready_handle' },
  { name: 'ready Handle structural role', mutation: 'missing_ready_role' },
  { name: 'ready Handle data source', mutation: 'wrong_ready_data_source' },
  {
    name: 'global Action/Workflow Handle UUID',
    mutation: 'duplicate_global_handle_uuid'
  },
  { name: 'output Handle required flag', mutation: 'required_output_handle' }
]

describe('Published Workflow catalog projection', registerPublishedWorkflowTests)

/**
 * 注册发布工作流（PublishedWorkflow）冻结合同与投影测试。
 *
 * @returns 无返回值；Vitest 在收集阶段登记测试。
 * @throws 测试登记本身不抛出异常，运行断言失败由 Vitest 报告。
 */
function registerPublishedWorkflowTests(): void {
  it(
    'treats JSON object and required-key order as non-semantic',
    acceptsNonSemanticSchemaOrder
  )
  it('accepts a Unicode Python workflow symbol', acceptsUnicodePythonSymbol)
  it(
    'validates workflow defaults separately from Handle value schemas',
    validatesWorkflowDefaultsSeparately
  )
  it(
    'loads one coherent executable union with a complete Published Workflow projection',
    projectsCompletePublishedWorkflow
  )
  it(
    'loads persisted schema text with canonical ready Handles',
    acceptsPersistedSchemaTextAndCanonicalReadyHandles
  )
  it.each(malformedWorkflowCases)(
    'fails closed for malformed Published Workflow $name',
    rejectsMalformedPublishedWorkflow
  )
  it(
    'normalizes Published Handles to the frozen contract order',
    normalizesHandlesToFrozenOrder
  )
  it(
    'heals ResourceSlot allowlist drift from rematerialized schema',
    healsResourceSlotAllowlistDrift
  )
}

/**
 * 证明 JSON 对象键和 required 数组顺序不会改变发布工作流合同语义。
 *
 * @returns 测试完成后的 Promise。
 * @throws 规范化后合同被错误拒绝时使测试失败。
 */
async function acceptsNonSemanticSchemaOrder(): Promise<void> {
  const responses = executableCatalogResponses()
  const schema = workflowSchemaValue(responses)
  schema.required = ['result', 'goal']
  const properties = schema.properties as Record<string, unknown>
  schema.properties = {
    result: properties.result,
    goal: properties.goal
  }
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-python')
  )

  await expect(runtime.getWorkflowActionCatalog()).resolves.toBeDefined()
}

/**
 * 证明工作流源码（Workflow Source）允许合法 Unicode Python 符号。
 *
 * @returns 测试完成后的 Promise。
 * @throws 符号和 class 来源一致却被拒绝时使测试失败。
 */
async function acceptsUnicodePythonSymbol(): Promise<void> {
  const responses = executableCatalogResponses()
  const source = workflowSource(responses)
  /** Unicode 符号模拟真实中文实验工作流函数名。 */
  const symbol = 's07_粉桶与烧杯搬运后固体称量'
  source.symbol = symbol
  workflowDetail(responses).class = `${String(source.module)}:${symbol}`
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-python')
  )

  await expect(runtime.getWorkflowActionCatalog()).resolves.toBeDefined()
}

/**
 * 证明工作流默认值与连接点（Handle）值 Schema 分别验证。
 *
 * @returns 测试完成后的 Promise。
 * @throws 合法的可选默认物料引用被错误拒绝时使测试失败。
 */
async function validatesWorkflowDefaultsSeparately(): Promise<void> {
  const responses = executableCatalogResponses()
  const schema = workflowSchemaValue(responses)
  const goal = (schema.properties as Record<string, Record<string, unknown>>)
    .goal
  const sample = (goal.properties as Record<string, Record<string, unknown>>)
    .sample
  /** 默认物料（Material）引用只保存稳定 UUID，不保存快照。 */
  const defaultSample = { uuid: '60000000-0000-4000-8000-000000000001' }
  sample.default = defaultSample
  goal.required = []
  workflowDetail(responses).goal_default = { sample: defaultSample }
  const firstHandle = workflowHandles(responses)[0]
  if (!firstHandle) throw new Error('Published Workflow input Handle missing')
  firstHandle.required = false
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-python')
  )

  await expect(runtime.getWorkflowActionCatalog()).resolves.toBeDefined()
}

/**
 * 证明默认动作目录和显式 workflow 目录稳定合并为完整可执行投影。
 *
 * @returns 测试完成后的 Promise。
 * @throws 投影字段、wire 证据或请求顺序偏离冻结合同时使测试失败。
 */
async function projectsCompletePublishedWorkflow(): Promise<void> {
  /** 请求顺序证明发布工作流只从显式 node_type=workflow 集合读取。 */
  const requests: string[] = []
  const responses = executableCatalogResponses()
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses, requests),
    getDefaultBackend('local-python')
  )

  const catalog = await runtime.getWorkflowActionCatalog() as unknown as {
    authorityId: string
    authorityKind: string
    fingerprint: string
    actionTemplates: Array<Record<string, unknown>>
    workflowTemplates: Array<Record<string, unknown>>
  }

  expect(catalog).toEqual({
    authorityId: 'os-local',
    authorityKind: 'local',
    fingerprint,
    actionTemplates: [expect.objectContaining({
      uuid: nodeUuid,
      name: 'transfer.sample.v1'
    })],
    workflowTemplates: [{
      uuid: workflowNodeUuid,
      resourceTemplateUuid: hostResourceTemplateUuid,
      name: `workflow:${workflowUuid}`,
      displayName: 'Prepare sample',
      workflowClass: 'c1_published_lab.workflows.child:prepare_sample',
      workflowUuid,
      workflowRevision: 7,
      appliedSourceHash: `sha256:${'b'.repeat(64)}`,
      contractDigest: `sha256:${'c'.repeat(64)}`,
      compositionAllowTransparent: false,
      inputOrder: ['sample'],
      outputOrder: ['final_sample'],
      schema: workflowSchema(),
      goal: { sample: 'sample' },
      goalDefault: {},
      result: { final_sample: 'final_sample' },
      source: {
        kind: 'package',
        definitionFqid: 'c1_published_lab.workflows.prepare_sample',
        module: 'c1_published_lab.workflows.child',
        symbol: 'prepare_sample',
        packageCatalogDigest: `sha256:${'d'.repeat(64)}`,
        definitionContentHash: `sha256:${'e'.repeat(64)}`
      },
      handles: [
        expectedWorkflowHandle({
          uuid: workflowInputUuid,
          handleKey: 'sample',
          ioType: 'target',
          displayName: 'Sample',
          valueType: 'ResourceSlot',
          required: true,
          dataSource: 'goal',
          dataKey: 'sample',
          valueSchema: resourceSlotSchema(),
          editorControl: 'material_port',
          allowedResourceTemplateUuids: [resourceTemplateUuid],
          implicitPassthrough: false,
          structuralRole: null
        }),
        expectedWorkflowHandle({
          uuid: workflowOutputUuid,
          handleKey: 'final_sample',
          ioType: 'source',
          displayName: 'Final sample',
          valueType: 'ResourceSlot',
          required: false,
          dataSource: 'result',
          dataKey: 'final_sample',
          valueSchema: nullableResourceSlotSchema(),
          editorControl: 'material_port',
          allowedResourceTemplateUuids: [resourceTemplateUuid],
          implicitPassthrough: true,
          structuralRole: null
        }),
        expectedWorkflowHandle({
          uuid: workflowReadyTargetUuid,
          handleKey: 'ready',
          ioType: 'target',
          displayName: 'Ready',
          valueType: 'boolean',
          required: false,
          dataSource: 'dependency',
          dataKey: 'ready',
          valueSchema: { type: 'boolean' },
          editorControl: 'variable_selector',
          allowedResourceTemplateUuids: null,
          implicitPassthrough: false,
          structuralRole: 'ready'
        }),
        expectedWorkflowHandle({
          uuid: workflowReadySourceUuid,
          handleKey: 'ready',
          ioType: 'source',
          displayName: 'Ready',
          valueType: 'boolean',
          required: false,
          dataSource: 'dependency',
          dataKey: 'ready',
          valueSchema: { type: 'boolean' },
          editorControl: 'variable_selector',
          allowedResourceTemplateUuids: null,
          implicitPassthrough: false,
          structuralRole: 'ready'
        })
      ]
    }]
  })
  expect(requests).toEqual([
    defaultCatalogPath,
    workflowCatalogPath,
    `/api/v1/workflow-node-templates/${nodeUuid}`,
    `/api/v1/workflow-node-templates/${workflowNodeUuid}`
  ])

  const workflowTemplate = catalog.workflowTemplates[0]!
  expect(Object.keys(workflowTemplate)).not.toContain('wireValue')
  expect(Object.getOwnPropertyDescriptor(workflowTemplate, 'wireValue'))
    .toMatchObject({ enumerable: false, writable: false })
  expect(workflowTemplate.wireValue).toEqual(
    detailDataFor(responses, workflowNodeUuid).template
  )
  for (const handle of workflowTemplate.handles as Array<
    Record<string, unknown>
  >) {
    expect(Object.keys(handle)).not.toContain('wireValue')
    expect(Object.getOwnPropertyDescriptor(handle, 'wireValue'))
      .toMatchObject({ enumerable: false, writable: false })
  }
}

/**
 * 证明数据库读投影的 JSON 文本 Schema 与规范 ready 连接点（Handle）可执行。
 *
 * @returns 测试完成后的 Promise。
 * @throws Schema 文本或规范结构连接点被遗漏、错误放宽或拒绝时使测试失败。
 */
async function acceptsPersistedSchemaTextAndCanonicalReadyHandles(): Promise<void> {
  const responses = executableCatalogResponses()
  const detail = workflowDetail(responses)
  detail.schema = JSON.stringify(detail.schema)
  const readyHandles = workflowHandles(responses).filter(
    (handle) => handle.handle_key === 'ready'
  )
  for (const handle of readyHandles) {
    handle.type = 'default'
    delete handle.data_source
    delete handle.data_key
    handle.meta_data = {}
  }
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-python')
  )

  const catalog = await runtime.getWorkflowActionCatalog()

  expect(catalog.workflowTemplates).toHaveLength(1)
  expect(catalog.workflowTemplates[0]?.handles.slice(-2)).toEqual([
    expect.objectContaining({
      handleKey: 'ready',
      ioType: 'target',
      valueType: 'default',
      dataSource: null,
      dataKey: null,
      structuralRole: 'ready'
    }),
    expect.objectContaining({
      handleKey: 'ready',
      ioType: 'source',
      valueType: 'default',
      dataSource: null,
      dataKey: null,
      structuralRole: 'ready'
    })
  ])
}

/**
 * 证明发布工作流（PublishedWorkflow）任一合同破坏都失败关闭。
 *
 * @param testCase - 畸形场景显示名及声明式破坏类型。
 * @returns 测试完成后的 Promise。
 * @throws 未知破坏类型、请求异常或错误语义不符时使测试失败。
 */
async function rejectsMalformedPublishedWorkflow(testCase: {
  name: string
  mutation: MalformedWorkflowMutation
}): Promise<void> {
  const responses = executableCatalogResponses()
  applyMalformedWorkflowMutation(responses, testCase.mutation)
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
 * 证明发布工作流连接点（Handle）按冻结输入、输出和 ready 顺序投影。
 *
 * @returns 测试完成后的 Promise。
 * @throws 详情 wire 顺序影响冻结合同顺序时使测试失败。
 */
async function normalizesHandlesToFrozenOrder(): Promise<void> {
  const responses = executableCatalogResponses()
  const handles = workflowHandles(responses)
  ;[handles[0], handles[1]] = [handles[1]!, handles[0]!]
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-python')
  )

  const catalog = await runtime.getWorkflowActionCatalog()
  expect(workflowHandleUuids(catalog.workflowTemplates[0]?.handles ?? []))
    .toEqual([
      workflowInputUuid,
      workflowOutputUuid,
      workflowReadyTargetUuid,
      workflowReadySourceUuid
    ])
}

/**
 * Local Domain 重建后，合同 schema 白名单可能已重写，而 Handle wire 仍保留旧 UUID。
 * 目录投影应以 schema 为准治愈 ResourceSlot 白名单漂移。
 */
async function healsResourceSlotAllowlistDrift(): Promise<void> {
  const responses = executableCatalogResponses()
  applyMalformedWorkflowMutation(responses, 'wrong_resource_slot_allowlist')
  const runtime = createWorkflowRuntime(
    fixtureHttp(responses),
    getDefaultBackend('local-python')
  )

  const catalog = await runtime.getWorkflowActionCatalog()
  const input = catalog.workflowTemplates[0]?.handles.find((handle) =>
    handle.handleKey === 'sample' && handle.ioType === 'target'
  )
  expect(input?.allowedResourceTemplateUuids).toEqual([resourceTemplateUuid])
  expect(input?.valueSchema).toEqual({
    $slot: 'ResourceSlot',
    allowed_resource_template_uuids: [resourceTemplateUuid]
  })
}

/**
 * 对响应表应用一个声明式发布工作流合同破坏操作。
 *
 * @param responses - 即将交给适配器的可变 wire 响应表。
 * @param mutation - 需要证明失败关闭的破坏类型。
 * @returns 无返回值；响应表被原地修改。
 * @throws mutation 未覆盖时通过穷尽检查抛出异常。
 */
function applyMalformedWorkflowMutation(
  responses: Record<string, unknown>,
  mutation: MalformedWorkflowMutation
): void {
  switch (mutation) {
    case 'action_discriminator':
      workflowSummary(responses).type = 'UniLabJsonCommand'
      workflowSummary(responses).node_type = 'device'
      workflowDetail(responses).type = 'UniLabJsonCommand'
      workflowDetail(responses).node_type = 'device'
      return
    case 'wrong_node_type':
      workflowSummary(responses).node_type = 'device'
      workflowDetail(responses).node_type = 'device'
      return
    case 'wrong_framework_owner':
      workflowUnilab(responses).framework_owner_only = false
      return
    case 'wrong_contract_version':
      workflowExtension(responses).version = 2
      return
    case 'wrong_compatibility_version':
      workflowExtension(responses).compatibility_version = 2
      return
    case 'extra_contract_field':
      workflowExtension(responses).frontend_compatibility_guess = true
      return
    case 'invalid_revision':
      workflowExtension(responses).workflow_revision = 0
      return
    case 'wrong_workflow_uuid':
      workflowExtension(responses).workflow_uuid =
        '40000000-0000-4000-8000-000000000099'
      return
    case 'invalid_source_hash':
      workflowExtension(responses).applied_source_hash = 'source-hash'
      return
    case 'invalid_contract_digest':
      workflowExtension(responses).contract_digest = `sha256:${'A'.repeat(64)}`
      return
    case 'duplicate_input_order':
      workflowExtension(responses).input_order = ['sample', 'sample']
      return
    case 'unknown_input_order':
      workflowExtension(responses).input_order = ['missing']
      return
    case 'missing_output_order':
      workflowExtension(responses).output_order = []
      return
    case 'open_workflow_schema':
      workflowSchemaValue(responses).frontend_derived = true
      return
    case 'missing_provenance_field':
      delete workflowSource(responses).definition_fqid
      return
    case 'extra_provenance_field':
      workflowSource(responses).device_name = 'host_node'
      return
    case 'wrong_provenance_kind':
      workflowSource(responses).kind = 'registry'
      return
    case 'absolute_package_module':
      workflowSource(responses).module = '.workflows.child'
      return
    case 'wrong_class_source':
      workflowDetail(responses).class =
        'c1_published_lab.workflows.other:prepare_sample'
      return
    case 'wrong_handle_parent':
      workflowHandles(responses)[0]!.workflow_node_template_uuid = nodeUuid
      return
    case 'wrong_input_direction':
      workflowHandles(responses)[0]!.io_type = 'source'
      return
    case 'wrong_input_data_source':
      workflowHandles(responses)[0]!.data_source = 'result'
      return
    case 'wrong_input_data_key':
      workflowHandles(responses)[0]!.data_key = 'guessed_sample'
      return
    case 'wrong_input_value_schema':
      workflowHandleUnilab(responses, 0).value_schema = { type: 'string' }
      return
    case 'wrong_resource_slot_allowlist':
      workflowHandleUnilab(responses, 0).allowed_resource_template_uuids = [
        hostResourceTemplateUuid
      ]
      return
    case 'missing_ready_handle':
      workflowHandles(responses).pop()
      return
    case 'missing_ready_role':
      delete workflowHandleUnilab(responses, 2).structural_role
      return
    case 'wrong_ready_data_source':
      workflowHandles(responses)[2]!.data_source = 'goal'
      return
    case 'duplicate_global_handle_uuid':
      workflowHandles(responses)[0]!.uuid = targetUuid
      return
    case 'required_output_handle':
      workflowHandles(responses)[1]!.required = true
      return
    default:
      throw new Error(`Unsupported malformed Workflow mutation: ${mutation}`)
  }
}

/**
 * 抽取发布工作流连接点（Handle）稳定 UUID，避免匿名映射回调。
 *
 * @param handles - 已按冻结合同排序的连接点投影。
 * @returns 保持投影顺序的 UUID 集合。
 * @throws 此纯辅助函数不抛出异常。
 */
function workflowHandleUuids(
  handles: ReadonlyArray<{ uuid: string }>
): string[] {
  const uuids: string[] = []
  for (const handle of handles) uuids.push(handle.uuid)
  return uuids
}
