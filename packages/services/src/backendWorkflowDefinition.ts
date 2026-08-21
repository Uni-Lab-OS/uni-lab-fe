import { ServiceError } from './errors'
import { requestData, type HttpClient } from './http'
import type {
  WorkflowRunEdgeOption,
  WorkflowRunHandleOption,
  WorkflowRunNodeOption,
  WorkflowRunPreparation
} from './workflowTaskContracts'

/**
 * 从 Backend 工作流图读取正式运行和只读画布共用的定义快照。
 *
 * @param http 已绑定 Backend 权威地址的 HTTP 客户端。
 * @param workflowUuid 待运行的工作流（Workflow）稳定身份。
 * @returns 工作流修订号以及节点、连线、端口和画布坐标快照。
 * @throws 图响应缺字段、身份不匹配或图身份重复时关闭失败。
 */
export async function loadBackendWorkflowRunPreparation(
  http: HttpClient,
  workflowUuid: string
): Promise<WorkflowRunPreparation> {
  const raw = await requestData<unknown>(
    http,
    `/api/v1/workflows/${encodeURIComponent(workflowUuid)}/graph`
  )
  const graph = asRecord(raw)
  const workflow = asRecord(graph.workflow)
  if (
    workflow.uuid !== workflowUuid ||
    !positiveSafeInteger(workflow.revision) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    !Array.isArray(graph.handle_templates)
  ) {
    throw invalidBackendRunPreparation('invalid workflow graph identity')
  }

  const handlesByTemplate = decodeBackendRunHandles(graph.handle_templates)
  const identities = new Set<string>()
  const nodes = graph.nodes.map((value, index) => {
    const node = decodeBackendRunNode(value, index, handlesByTemplate)
    if (identities.has(node.workflow_node_uuid)) {
      throw invalidBackendRunPreparation('duplicate workflow node identity')
    }
    identities.add(node.workflow_node_uuid)
    return node
  })
  return {
    workflow_uuid: workflowUuid,
    workflow_revision: workflow.revision,
    nodes,
    edges: decodeBackendRunEdges(graph.edges, identities)
  }
}

/** 把 Backend 图中的一个节点严格收窄为运行和只读画布节点。 */
function decodeBackendRunNode(
  value: unknown,
  index: number,
  handlesByTemplate: ReadonlyMap<string, WorkflowRunHandleOption[]>
): WorkflowRunNodeOption {
  const node = asRecord(value)
  if (
    !nonEmptyString(node.uuid) ||
    !nonEmptyString(node.name) ||
    !nonEmptyString(node.type) ||
    typeof node.disabled !== 'boolean'
  ) {
    throw invalidBackendRunPreparation(`invalid workflow node at index ${index}`)
  }
  const templateUuid = optionalNonEmptyString(node.workflow_node_template_uuid)
  const description = optionalNonEmptyString(node.description)
  const actionName = optionalNonEmptyString(node.action_name)
  const actionType = optionalNonEmptyString(node.action_type)
  const position = decodeBackendRunPosition(node.pose)
  const materialSource = node.type === 'material_source'
    ? decodeBackendMaterialSource(node.param, index)
    : undefined
  return {
    workflow_node_uuid: node.uuid,
    ...(templateUuid
      ? { workflow_node_template_uuid: templateUuid }
      : {}),
    name: node.name,
    type: node.type,
    disabled: node.disabled,
    ...(description ? { description } : {}),
    ...(actionName ? { action_name: actionName } : {}),
    ...(actionType ? { action_type: actionType } : {}),
    ...(position ? { position } : {}),
    ...(materialSource ? { material_source: materialSource } : {}),
    handles: templateUuid
      ? [...(handlesByTemplate.get(templateUuid) ?? [])]
      : []
  }
}

/**
 * 严格保留 Backend 物料来源（MaterialSource）的谱系角色与挂载身份。
 *
 * @param value 工作流节点 `param` 中的权威物料来源选择器。
 * @param nodeIndex 节点在 Backend 工作流定义数组中的位置，用于错误定位。
 * @returns 共享画布建立主样品与辅助物料谱系所需的只读字段。
 * @throws 选择器缺少模式、物料模板、挂载 UUID 或流角色时关闭失败。
 */
function decodeBackendMaterialSource(
  value: unknown,
  nodeIndex: number
): NonNullable<WorkflowRunNodeOption['material_source']> {
  const selector = asRecord(value)
  const mount = asRecord(selector.mount)
  if (
    !nonEmptyString(selector.mode) ||
    !nonEmptyString(selector.resource_template_uuid) ||
    !nonEmptyString(mount.uuid) ||
    !nonEmptyString(selector.flow_role)
  ) {
    throw invalidBackendRunPreparation(
      `invalid material source selector at node index ${nodeIndex}`
    )
  }
  return {
    mode: selector.mode,
    resource_template_uuid: selector.resource_template_uuid,
    mount_uuid: mount.uuid,
    flow_role: selector.flow_role
  }
}

/** 严格解码 Backend 端口模板并按节点模板身份建立只读索引。 */
function decodeBackendRunHandles(
  values: unknown[]
): ReadonlyMap<string, WorkflowRunHandleOption[]> {
  const identities = new Set<string>()
  const handlesByTemplate = new Map<string, WorkflowRunHandleOption[]>()
  values.forEach((value, index) => {
    const handle = asRecord(value)
    if (
      !nonEmptyString(handle.uuid) ||
      !nonEmptyString(handle.workflow_node_template_uuid) ||
      !nonEmptyString(handle.handle_key) ||
      !nonEmptyString(handle.display_name) ||
      (handle.io_type !== 'source' && handle.io_type !== 'target') ||
      !nonEmptyString(handle.type)
    ) {
      throw invalidBackendRunPreparation(
        `invalid workflow handle at index ${index}`
      )
    }
    if (identities.has(handle.uuid)) {
      throw invalidBackendRunPreparation('duplicate workflow handle identity')
    }
    identities.add(handle.uuid)
    const dataKey = optionalNonEmptyString(handle.data_key)
    const option: WorkflowRunHandleOption = {
      uuid: handle.uuid,
      handle_key: handle.handle_key,
      display_name: handle.display_name,
      io_type: handle.io_type,
      value_type: backendHandleValueType(handle.type),
      ...(dataKey ? { data_key: dataKey } : {})
    }
    const templateHandles = handlesByTemplate.get(
      handle.workflow_node_template_uuid
    ) ?? []
    templateHandles.push(option)
    handlesByTemplate.set(handle.workflow_node_template_uuid, templateHandles)
  })
  return handlesByTemplate
}

/**
 * 把 Backend 遗留 `material` Handle 归一为画布物料占位符（ResourceSlot）。
 *
 * @param value Backend 工作流 Handle 的类型标识。
 * @returns 共享物料谱系使用的类型；其它扩展类型保持原值。
 */
function backendHandleValueType(value: string): string {
  return value === 'material' ? 'ResourceSlot' : value
}

/** 严格解码 Backend 工作流有向边，并验证端点属于当前定义快照。 */
function decodeBackendRunEdges(
  values: unknown[],
  nodeIdentities: ReadonlySet<string>
): WorkflowRunEdgeOption[] {
  const identities = new Set<string>()
  return values.map((value, index) => {
    const edge = asRecord(value)
    if (
      !nonEmptyString(edge.uuid) ||
      !nonEmptyString(edge.source_node_uuid) ||
      !nonEmptyString(edge.target_node_uuid) ||
      !nonEmptyString(edge.source_handle_uuid) ||
      !nonEmptyString(edge.target_handle_uuid) ||
      !nodeIdentities.has(edge.source_node_uuid) ||
      !nodeIdentities.has(edge.target_node_uuid)
    ) {
      throw invalidBackendRunPreparation(
        `invalid workflow edge at index ${index}`
      )
    }
    if (identities.has(edge.uuid)) {
      throw invalidBackendRunPreparation('duplicate workflow edge identity')
    }
    identities.add(edge.uuid)
    return {
      uuid: edge.uuid,
      source_node_uuid: edge.source_node_uuid,
      target_node_uuid: edge.target_node_uuid,
      source_handle_uuid: edge.source_handle_uuid,
      target_handle_uuid: edge.target_handle_uuid
    }
  })
}

/** 从 Backend 兼容的直接或 position 包装坐标中读取有限画布位置。 */
function decodeBackendRunPosition(
  value: unknown
): { x: number; y: number } | undefined {
  const pose = asRecord(value)
  const nested = asRecord(pose.position)
  const x = finiteNumber(pose.x) ?? finiteNumber(nested.x)
  const y = finiteNumber(pose.y) ?? finiteNumber(nested.y)
  return x === undefined || y === undefined ? undefined : { x, y }
}

/** 判断未知值是非空字符串。 */
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 把可选未知值收窄为非空字符串。 */
function optionalNonEmptyString(value: unknown): string | undefined {
  return nonEmptyString(value) ? value : undefined
}

/** 把可选未知值收窄为有限数字。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined
}

/** 把未知值转换为只读解码用的对象视图。 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 判断未知值是正安全整数。 */
function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

/** 创建不可重试的 Backend 工作流运行准备合同错误。 */
function invalidBackendRunPreparation(detail: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_BACKEND_WORKFLOW_RUN_PREPARATION',
    message: `Backend 工作流运行准备响应无效：${detail}`,
    retryable: false
  })
}
