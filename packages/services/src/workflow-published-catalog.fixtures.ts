import {
  authority,
  catalogResponses,
  detailDataFor,
  fingerprint,
  nodeUuid,
  resourceTemplateUuid,
  targetUuid,
  workflowCatalogPath,
  type Envelope,
  type RawHandle
} from './workflow-action-catalog.fixtures'

/** 发布工作流（PublishedWorkflow）节点模板的稳定身份。 */
export const workflowNodeUuid = '20000000-0000-4000-8000-000000000002'
/** 被发布工作流（PublishedWorkflow）的稳定身份。 */
export const workflowUuid = '40000000-0000-4000-8000-000000000001'
/** 发布工作流输入连接点（Handle）的稳定身份。 */
export const workflowInputUuid = '30000000-0000-4000-8000-000000000010'
/** 发布工作流输出连接点（Handle）的稳定身份。 */
export const workflowOutputUuid = '30000000-0000-4000-8000-000000000011'
/** 发布工作流 ready 输入连接点（Handle）的稳定身份。 */
export const workflowReadyTargetUuid =
  '30000000-0000-4000-8000-000000000012'
/** 发布工作流 ready 输出连接点（Handle）的稳定身份。 */
export const workflowReadySourceUuid =
  '30000000-0000-4000-8000-000000000013'
/** 承载发布工作流的资源模板（ResourceTemplate）稳定身份。 */
export const hostResourceTemplateUuid =
  '10000000-0000-4000-8000-000000000002'

/**
 * 读取发布工作流（PublishedWorkflow）的目录摘要 fixture。
 *
 * @param responses - 以请求路径为键的目录响应表。
 * @returns 与发布工作流稳定 UUID 对应的摘要。
 * @throws 响应表缺少预期摘要时抛出异常。
 */
export function workflowSummary(
  responses: Record<string, unknown>
): Record<string, unknown> {
  const list = (responses[workflowCatalogPath] as Envelope).data as {
    items: Array<Record<string, unknown>>
  }
  let value: Record<string, unknown> | undefined
  for (const item of list.items) {
    if (item.uuid === workflowNodeUuid) {
      value = item
      break
    }
  }
  if (!value) throw new Error('Published Workflow summary fixture missing')
  return value
}

/**
 * 读取发布工作流（PublishedWorkflow）的节点模板详情。
 *
 * @param responses - 以请求路径为键的目录响应表。
 * @returns 发布工作流节点模板的原始 wire 对象。
 * @throws 响应表缺少预期详情时，由访问操作暴露测试失败。
 */
export function workflowDetail(
  responses: Record<string, unknown>
): Record<string, unknown> {
  return detailDataFor(responses, workflowNodeUuid).template
}

/**
 * 读取发布工作流（PublishedWorkflow）的冻结 JSON Schema。
 *
 * @param responses - 以请求路径为键的目录响应表。
 * @returns 发布工作流节点模板中的 Schema 对象。
 * @throws 详情缺失 Schema 时，由后续访问暴露测试失败。
 */
export function workflowSchemaValue(
  responses: Record<string, unknown>
): Record<string, unknown> {
  return workflowDetail(responses).schema as Record<string, unknown>
}

/**
 * 读取发布工作流（PublishedWorkflow）的版本化合同扩展。
 *
 * @param responses - 以请求路径为键的目录响应表。
 * @returns `x-unilabos-workflow-contract` 原始对象。
 * @throws 合同扩展缺失时，由后续访问暴露测试失败。
 */
export function workflowExtension(
  responses: Record<string, unknown>
): Record<string, unknown> {
  return workflowSchemaValue(responses)[
    'x-unilabos-workflow-contract'
  ] as Record<string, unknown>
}

/**
 * 读取 Uni-Lab 私有发布投影元数据。
 *
 * @param responses - 以请求路径为键的目录响应表。
 * @returns 发布工作流节点模板的 `meta_data.unilab` 对象。
 * @throws 元数据缺失时，由后续访问暴露测试失败。
 */
export function workflowUnilab(
  responses: Record<string, unknown>
): Record<string, unknown> {
  return (workflowDetail(responses).meta_data as Record<string, unknown>)
    .unilab as Record<string, unknown>
}

/**
 * 读取工作流源码（Workflow Source）来源证明 fixture。
 *
 * @param responses - 以请求路径为键的目录响应表。
 * @returns 发布工作流的包来源证明对象。
 * @throws 来源证明缺失时，由后续访问暴露测试失败。
 */
export function workflowSource(
  responses: Record<string, unknown>
): Record<string, unknown> {
  return workflowUnilab(responses).workflow_source as Record<string, unknown>
}

/**
 * 读取发布工作流（PublishedWorkflow）的全部连接点（Handle）。
 *
 * @param responses - 以请求路径为键的目录响应表。
 * @returns 保留 wire 字段的连接点集合。
 * @throws 详情缺失时，由后续访问暴露测试失败。
 */
export function workflowHandles(
  responses: Record<string, unknown>
): RawHandle[] {
  return detailDataFor(responses, workflowNodeUuid).handles
}

/**
 * 按冻结顺序读取一个发布工作流连接点（Handle）的 Uni-Lab 元数据。
 *
 * @param responses - 以请求路径为键的目录响应表。
 * @param index - 连接点在冻结合同中的零基序号。
 * @returns 指定连接点的 `meta_data.unilab` 对象。
 * @throws index 对应连接点不存在时抛出异常。
 */
export function workflowHandleUnilab(
  responses: Record<string, unknown>,
  index: number
): Record<string, unknown> {
  const handle = workflowHandles(responses)[index]
  if (!handle) throw new Error(`Published Workflow Handle ${index} missing`)
  return (handle.meta_data as Record<string, unknown>)
    .unilab as Record<string, unknown>
}

/**
 * 构造必需物料占位符（ResourceSlot）的 Schema。
 *
 * @returns 限制到目标资源模板（ResourceTemplate）的占位符 Schema。
 * @throws 此纯 fixture 不抛出异常。
 */
export function resourceSlotSchema(): Record<string, unknown> {
  return {
    $slot: 'ResourceSlot',
    allowed_resource_template_uuids: [resourceTemplateUuid]
  }
}

/**
 * 构造可空物料占位符（ResourceSlot）的 Schema。
 *
 * @returns 允许目标资源模板或 null 的占位符 Schema。
 * @throws 此纯 fixture 不抛出异常。
 */
export function nullableResourceSlotSchema(): Record<string, unknown> {
  return {
    anyOf: [resourceSlotSchema(), { type: 'null' }]
  }
}

/**
 * 构造发布工作流（PublishedWorkflow）的冻结合同 Schema。
 *
 * @returns 带输入输出顺序、应用来源哈希和合同摘要的 Schema。
 * @throws 此纯 fixture 不抛出异常。
 */
export function workflowSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      goal: {
        type: 'object',
        additionalProperties: false,
        properties: { sample: resourceSlotSchema() },
        required: ['sample']
      },
      result: {
        type: 'object',
        additionalProperties: false,
        properties: { final_sample: nullableResourceSlotSchema() },
        required: ['final_sample']
      }
    },
    required: ['goal', 'result'],
    'x-unilabos-workflow-contract': {
      version: 1,
      compatibility_version: 1,
      workflow_uuid: workflowUuid,
      workflow_revision: 7,
      applied_source_hash: `sha256:${'b'.repeat(64)}`,
      contract_digest: `sha256:${'c'.repeat(64)}`,
      composition_allow_transparent: false,
      input_order: ['sample'],
      output_order: ['final_sample']
    }
  }
}

/**
 * 补齐发布工作流（PublishedWorkflow）连接点所属节点模板身份。
 *
 * @param value - 不含父节点模板 UUID 的预期连接点投影。
 * @returns 带发布工作流节点模板 UUID 的预期投影。
 * @throws 此纯 fixture 不抛出异常。
 */
export function expectedWorkflowHandle(
  value: Omit<Record<string, unknown>, 'workflowNodeTemplateUuid'>
): Record<string, unknown> {
  return {
    ...value,
    workflowNodeTemplateUuid: workflowNodeUuid
  }
}

/**
 * 构造动作（Action）与发布工作流（PublishedWorkflow）的联合目录响应。
 *
 * @returns 默认动作目录、显式 workflow 目录和两类详情的完整响应表。
 * @throws 此纯 fixture 不抛出异常。
 */
export function executableCatalogResponses(): Record<string, unknown> {
  const responses = catalogResponses()
  /** 显式 workflow 查询页是发布工作流节点模板的唯一集合入口。 */
  const workflowList = (responses[workflowCatalogPath] as Envelope).data as {
    items: Array<Record<string, unknown>>
  }
  workflowList.items.push({
    uuid: workflowNodeUuid,
    name: `workflow:${workflowUuid}`,
    display_name: 'Prepare sample',
    type: 'workflow',
    node_type: 'workflow',
    resource_template: {
      uuid: hostResourceTemplateUuid,
      name: 'host_node',
      display_name: 'Host Node'
    }
  })
  responses[`/api/v1/workflow-node-templates/${workflowNodeUuid}`] = {
    code: 0,
    data: {
      authority,
      catalog_fingerprint: fingerprint,
      template: {
        uuid: workflowNodeUuid,
        resource_template_uuid: hostResourceTemplateUuid,
        name: `workflow:${workflowUuid}`,
        display_name: 'Prepare sample',
        class: 'c1_published_lab.workflows.child:prepare_sample',
        type: 'workflow',
        node_type: 'workflow',
        schema: workflowSchema(),
        goal: { sample: 'sample' },
        goal_default: {},
        feedback: {},
        result: { final_sample: 'final_sample' },
        meta_data: {
          unilab: {
            framework_owner_only: true,
            workflow_contract: {
              version: 1,
              workflow_uuid: workflowUuid,
              workflow_revision: 7,
              contract_uuid: '11111111-1111-4111-8111-111111111111',
              contract_digest: `sha256:${'c'.repeat(64)}`,
              source_hash: `sha256:${'b'.repeat(64)}`
            },
            workflow_source: {
              kind: 'package',
              definition_fqid: 'c1_published_lab.workflows.prepare_sample',
              module: 'c1_published_lab.workflows.child',
              symbol: 'prepare_sample',
              package_catalog_digest: `sha256:${'d'.repeat(64)}`,
              definition_content_hash: `sha256:${'e'.repeat(64)}`
            }
          }
        }
      },
      handles: [
        rawWorkflowHandle({
          uuid: workflowInputUuid,
          handle_key: 'sample',
          io_type: 'target',
          display_name: 'Sample',
          type: 'ResourceSlot',
          required: true,
          data_source: 'goal',
          data_key: 'sample',
          valueSchema: resourceSlotSchema(),
          editorControl: 'material_port',
          allowedResourceTemplateUuids: [resourceTemplateUuid],
          implicitPassthrough: false
        }),
        rawWorkflowHandle({
          uuid: workflowOutputUuid,
          handle_key: 'final_sample',
          io_type: 'source',
          display_name: 'Final sample',
          type: 'ResourceSlot',
          required: false,
          data_source: 'result',
          data_key: 'final_sample',
          valueSchema: nullableResourceSlotSchema(),
          editorControl: 'material_port',
          allowedResourceTemplateUuids: [resourceTemplateUuid],
          implicitPassthrough: true
        }),
        rawWorkflowHandle({
          uuid: workflowReadyTargetUuid,
          handle_key: 'ready',
          io_type: 'target',
          display_name: 'Ready',
          type: 'boolean',
          required: false,
          data_source: 'dependency',
          data_key: 'ready',
          valueSchema: { type: 'boolean' },
          editorControl: 'variable_selector',
          allowedResourceTemplateUuids: null,
          implicitPassthrough: false,
          structuralRole: 'ready'
        }),
        rawWorkflowHandle({
          uuid: workflowReadySourceUuid,
          handle_key: 'ready',
          io_type: 'source',
          display_name: 'Ready',
          type: 'boolean',
          required: false,
          data_source: 'dependency',
          data_key: 'ready',
          valueSchema: { type: 'boolean' },
          editorControl: 'variable_selector',
          allowedResourceTemplateUuids: null,
          implicitPassthrough: false,
          structuralRole: 'ready'
        })
      ]
    }
  }
  return responses
}

/**
 * 把冻结工作流连接点（Handle）输入转换为原始 wire 结构。
 *
 * @param input - 连接点身份、方向、数据来源和编辑元数据。
 * @returns 归属于发布工作流节点模板的原始连接点。
 * @throws 此纯 fixture 不抛出异常。
 */
function rawWorkflowHandle(input: {
  uuid: string
  handle_key: string
  io_type: string
  display_name: string
  type: string
  required: boolean
  data_source: string
  data_key: string
  valueSchema: Record<string, unknown>
  editorControl: string
  allowedResourceTemplateUuids: string[] | null
  implicitPassthrough: boolean
  structuralRole?: 'ready'
}): Record<string, unknown> {
  return {
    uuid: input.uuid,
    workflow_node_template_uuid: workflowNodeUuid,
    handle_key: input.handle_key,
    io_type: input.io_type,
    display_name: input.display_name,
    type: input.type,
    required: input.required,
    data_source: input.data_source,
    data_key: input.data_key,
    meta_data: {
      unilab: {
        value_schema: input.valueSchema,
        editor_control: input.editorControl,
        allowed_resource_template_uuids:
          input.allowedResourceTemplateUuids,
        implicit_passthrough: input.implicitPassthrough,
        ...(input.structuralRole
          ? { structural_role: input.structuralRole }
          : {})
      }
    }
  }
}
