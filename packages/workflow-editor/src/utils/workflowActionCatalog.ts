import type {
  WorkflowActionCatalogSnapshot,
  WorkflowActionHandleTemplate,
  WorkflowActionNodeTemplate,
  WorkflowAuthoringDiagnostic,
  WorkflowAuthoringGraph,
  WorkflowPublishedNodeTemplate
} from '@unilab/services'
import { isWorkflowValueSchemaAssignable } from '@unilab/services'
import { v5 as uuidV5 } from 'uuid'

import { wouldCreateWorkflowCycle } from './workflowGraphConnection'

export { createPublishedWorkflowNode } from './workflowPublishedNode'

export interface TypedActionFieldProjection {
  handleUuid: string
  dataKey: string
  displayName: string
  required: boolean
  hasDefault: boolean
  defaultValue: unknown
  nullable: boolean
  editorControl: WorkflowActionHandleTemplate['editorControl']
  allowedResourceTemplateUuids?: string[] | null
  valueSchema: Record<string, unknown>
  valueState: 'missing' | 'null' | 'value'
  value: unknown
  enumValues: unknown[] | null
  providerKind: 'missing' | 'literal' | 'workflow_input' | 'upstream_output'
  workflowInput: string | null
  workflowInputOptions: string[]
}

export interface TypedActionFieldDiagnostic {
  handleUuid: string
  fieldPath: string
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface TypedActionEditorProjection {
  nodeUuid: string
  templateUuid: string
  fields: TypedActionFieldProjection[]
  diagnostics: TypedActionFieldDiagnostic[]
}

export function createTypedActionNode(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  input: {
    nodeUuid: string
    templateUuid: string
    name: string
    position?: { x: number; y: number }
  }
): WorkflowAuthoringGraph {
  const template = typedActionTemplate(catalog, input.templateUuid)
  if (graph.nodes.some((node) => node.uuid === input.nodeUuid)) {
    throw new Error('工作流节点 UUID 已存在')
  }
  if (!input.name || graph.nodes.some((node) => node.name === input.name)) {
    throw new Error('工作流节点名称无效或重复')
  }
  const nodeType = typeof template.wireValue?.node_type === 'string' &&
    template.wireValue.node_type
    ? template.wireValue.node_type
    : 'device'
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        uuid: input.nodeUuid,
        workflow_node_template_uuid: template.uuid,
        name: input.name,
        status: 'idle',
        type: nodeType,
        pose: input.position ? { position: { ...input.position } } : {},
        param: {},
        action_name: template.name,
        execution_policy: {},
        disabled: false,
        minimized: false,
        meta_data: {
          unilab: {
            input_bindings: {}
          }
        }
      }
    ],
    node_templates: appendCatalogRecords(
      graph.node_templates,
      [cloneRecord(template.wireValue ?? nodeTemplateWireValue(template))],
      'Workflow NodeTemplate'
    ),
    handle_templates: appendCatalogRecords(
      graph.handle_templates,
      template.handles.map((handle) =>
        cloneRecord(handle.wireValue ?? handleTemplateWireValue(handle))
      ),
      'Workflow HandleTemplate'
    )
  }
}

function appendCatalogRecords(
  existing: Array<Record<string, unknown>>,
  additions: Array<Record<string, unknown>>,
  label: string
): Array<Record<string, unknown>> {
  const identities = new Set<string>()
  for (const item of existing) {
    const uuid = requiredString(item.uuid)
    if (identities.has(uuid)) throw new Error(`${label} UUID 重复`)
    identities.add(uuid)
  }
  const appended = [...existing]
  for (const item of additions) {
    const uuid = requiredString(item.uuid)
    if (identities.has(uuid)) continue
    identities.add(uuid)
    appended.push(item)
  }
  return appended
}

export function projectTypedActionEditor(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  osDiagnostics: ReadonlyArray<WorkflowAuthoringDiagnostic>
): TypedActionEditorProjection {
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  if (!node) throw new Error('工作流节点不存在')
  const templateUuid = requiredString(node.workflow_node_template_uuid)
  const template = typedTemplate(catalog, templateUuid)
  const param = recordValue(node.param)
  const targetHandles = orderedTargetHandles(template)
  const providedHandleUuids = new Set(
    graph.edges
      .filter((edge) => edge.target_node_uuid === nodeUuid)
      .map((edge) => requiredString(edge.target_handle_uuid))
  )
  const metaData = recordOrNull(node.meta_data) ?? {}
  const unilab = recordOrNull(metaData.unilab) ?? {}
  const inputBindings = recordOrNull(unilab.input_bindings) ?? {}
  const workflowInputOptions = workflowInputNames(graph)
  const fields = targetHandles.map((handle) => {
    const dataKey = requiredString(handle.dataKey)
    const hasValue = Object.prototype.hasOwnProperty.call(param, dataKey)
    const value = hasValue ? param[dataKey] : undefined
    const hasDefault = Object.prototype.hasOwnProperty.call(
      handle.valueSchema,
      'default'
    )
    const edgeProvided = graph.edges.some((edge) =>
      edge.target_node_uuid === nodeUuid &&
      edge.target_handle_uuid === handle.uuid
    )
    const rawBinding = inputBindings[handle.uuid]
    const binding = rawBinding === undefined ? null : recordValue(rawBinding)
    const workflowInput = binding === null
      ? null
      : requiredString(binding.parameter)
    if (binding && (
      Object.keys(binding).some((key) => key !== 'parameter') ||
      !workflowInputOptions.includes(workflowInput as string)
    )) {
      throw new Error('工作流入参绑定与当前参数配置不一致')
    }
    const providerCount = Number(hasValue) + Number(edgeProvided) +
      Number(workflowInput !== null)
    if (providerCount > 1) throw new Error('操作目标端口存在多个数据来源')
    const providerKind = hasValue
      ? 'literal'
      : workflowInput !== null
        ? 'workflow_input'
        : edgeProvided
          ? 'upstream_output'
          : 'missing'
    if (providerKind !== 'missing') providedHandleUuids.add(handle.uuid)
    return {
      handleUuid: handle.uuid,
      dataKey,
      displayName: handle.displayName,
      required: handle.required,
      hasDefault,
      defaultValue: hasDefault ? handle.valueSchema.default : undefined,
      nullable: isNullable(handle.valueSchema),
      editorControl: handle.editorControl,
      allowedResourceTemplateUuids: resolvedResourceTemplateAllowlist(
        handle,
        unilab
      ),
      valueSchema: handle.valueSchema,
      valueState: !hasValue ? 'missing' : value === null ? 'null' : 'value',
      value,
      enumValues: enumValues(handle.valueSchema),
      providerKind,
      workflowInput,
      workflowInputOptions
    } satisfies TypedActionFieldProjection
  })
  const diagnostics: TypedActionFieldDiagnostic[] = fields
    .filter((field) =>
      field.required &&
      field.valueState === 'missing' &&
      !providedHandleUuids.has(field.handleUuid)
    )
    .map((field) => ({
      handleUuid: field.handleUuid,
      fieldPath: `/param/${escapeJsonPointer(field.dataKey)}`,
      severity: 'error',
      code: 'required_action_parameter_missing',
      message: `${field.displayName}为必填参数`
    }))
  for (const diagnostic of osDiagnostics) {
    if (diagnostic.node_id !== nodeUuid) continue
    const handleUuid = diagnostic.workflow_handle_template_uuid || ''
    if (
      handleUuid &&
      !targetHandles.some((handle) => handle.uuid === handleUuid)
    ) continue
    diagnostics.push({
      handleUuid,
      fieldPath: diagnostic.path || '/param',
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message
    })
  }
  return { nodeUuid, templateUuid, fields, diagnostics }
}

/**
 * Resolve the effective ResourceSlot allowlist for one Action input.
 *
 * Generic passthrough actions can accept any material in their static Catalog,
 * while a compiled node narrows that material through its output schema
 * override. The output-to-input passthrough map is the authoritative bridge
 * between those two contracts.
 */
function resolvedResourceTemplateAllowlist(
  handle: WorkflowActionHandleTemplate,
  nodeUnilab: Record<string, unknown>
): string[] | null | undefined {
  if (handle.allowedResourceTemplateUuids != null) {
    return handle.allowedResourceTemplateUuids
  }
  const passthroughHandles = recordOrNull(
    nodeUnilab.material_passthrough_handles
  )
  const outputHandleUuid = passthroughHandles
    ? Object.entries(passthroughHandles).find(
        ([, inputHandleUuid]) => inputHandleUuid === handle.uuid
      )?.[0]
    : undefined
  if (!outputHandleUuid) return handle.allowedResourceTemplateUuids
  const outputSchemaOverrides = recordOrNull(
    nodeUnilab.output_schema_overrides
  )
  const override = outputSchemaOverrides
    ? recordOrNull(outputSchemaOverrides[outputHandleUuid])
    : null
  const rawAllowlist = override?.allowed_resource_template_uuids
  if (rawAllowlist === undefined) return handle.allowedResourceTemplateUuids
  if (
    !Array.isArray(rawAllowlist) ||
    !rawAllowlist.every((value) => typeof value === 'string')
  ) {
    throw new Error('节点物料透传模板约束无效')
  }
  return [...rawAllowlist]
}

export function updateTypedActionLiteral(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  handleUuid: string,
  value: unknown
): WorkflowAuthoringGraph {
  assertParentBoundaryNode(graph, nodeUuid)
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  if (!node) throw new Error('工作流节点不存在')
  const template = typedTemplate(
    catalog,
    requiredString(node.workflow_node_template_uuid)
  )
  const handle = template.handles.find((item) => item.uuid === handleUuid)
  if (!handle || handle.ioType !== 'target') {
    throw new Error('操作目标端口不存在')
  }
  const dataKey = requiredString(handle.dataKey)
  if (value === undefined) {
    return clearTypedActionProvider(graph, nodeUuid, handleUuid, dataKey)
  }
  if (!acceptsValue(handle.valueSchema, value)) {
    throw new Error(`${handle.displayName} 的值不符合操作参数规范`)
  }
  return {
    ...graph,
    nodes: graph.nodes.map((item) => {
      if (item.uuid !== nodeUuid) return item
      const metaData = recordOrNull(item.meta_data) ?? {}
      const unilab = recordOrNull(metaData.unilab) ?? {}
      const inputBindings = {
        ...(recordOrNull(unilab.input_bindings) ?? {})
      }
      delete inputBindings[handleUuid]
      return {
        ...item,
        param: { ...recordValue(item.param), [dataKey]: value },
        meta_data: {
          ...metaData,
          unilab: {
            ...unilab,
            input_bindings: inputBindings
          }
        }
      }
    }),
    edges: graph.edges.filter((edge) => !(
      edge.target_node_uuid === nodeUuid &&
      edge.target_handle_uuid === handleUuid
    ))
  }
}

export function bindTypedActionWorkflowInput(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  handleUuid: string,
  parameter: string
): WorkflowAuthoringGraph {
  assertParentBoundaryNode(graph, nodeUuid)
  const handle = requireNodeHandle(
    catalog,
    graph,
    nodeUuid,
    handleUuid,
    'target'
  )
  const input = workflowInputDescriptors(graph).find(
    descriptor => descriptor.name === parameter
  )
  if (!input) {
    throw new Error('工作流入参不存在')
  }
  if (!isWorkflowValueSchemaAssignable(input.schema, handle.valueSchema)) {
    throw new Error('工作流入参 Schema 不能赋值给操作目标端口')
  }
  const dataKey = requiredString(handle.dataKey)
  const cleared = clearTypedActionProvider(
    graph,
    nodeUuid,
    handleUuid,
    dataKey
  )
  return {
    ...cleared,
    nodes: cleared.nodes.map((node) => {
      if (node.uuid !== nodeUuid) return node
      const metaData = recordOrNull(node.meta_data) ?? {}
      const unilab = recordOrNull(metaData.unilab) ?? {}
      return {
        ...node,
        meta_data: {
          ...metaData,
          unilab: {
            ...unilab,
            input_bindings: {
              ...(recordOrNull(unilab.input_bindings) ?? {}),
              [handleUuid]: { parameter }
            }
          }
        }
      }
    })
  }
}

export function connectTypedActionEdge(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  input: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  }
): WorkflowAuthoringGraph {
  assertParentBoundaryNode(graph, input.sourceNodeUuid)
  assertParentBoundaryNode(graph, input.targetNodeUuid)
  const sourceHandle = requireNodeHandle(
    catalog,
    graph,
    input.sourceNodeUuid,
    input.sourceHandleUuid,
    'source'
  )
  return connectTypedActionTarget(
    catalog,
    graph,
    input,
    sourceHandle.valueSchema,
    null
  )
}

export function connectFrameworkSourceToTypedActionEdge(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  input: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  },
  source: {
    nodeType: string
    nodeTemplateUuid: string
    handleUuid: string
    valueType: string
    valueSchema: Record<string, unknown>
    resourceTemplateUuid: string | null
  }
): WorkflowAuthoringGraph {
  assertParentBoundaryNode(graph, input.sourceNodeUuid)
  assertParentBoundaryNode(graph, input.targetNodeUuid)
  const sourceNode = graph.nodes.find(
    (node) => node.uuid === input.sourceNodeUuid
  )
  if (
    !sourceNode ||
    sourceNode.type !== source.nodeType ||
    sourceNode.workflow_node_template_uuid !== source.nodeTemplateUuid ||
    input.sourceHandleUuid !== source.handleUuid
  ) throw new Error('框架来源节点与端口标识不匹配')
  const graphHandle = graph.handle_templates.find(
    (handle) => handle.uuid === input.sourceHandleUuid
  )
  if (
    !graphHandle ||
    graphHandle.workflow_node_template_uuid !== source.nodeTemplateUuid ||
    graphHandle.io_type !== 'source' ||
    graphHandle.type !== source.valueType
  ) throw new Error('框架来源端口不在候选工作流中')
  return connectTypedActionTarget(
    catalog,
    graph,
    input,
    source.valueSchema,
    source.resourceTemplateUuid
  )
}

function connectTypedActionTarget(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  input: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  },
  sourceValueSchema: Record<string, unknown>,
  sourceResourceTemplateUuid: string | null
): WorkflowAuthoringGraph {
  if (wouldCreateWorkflowCycle(
    graph,
    input.sourceNodeUuid,
    input.targetNodeUuid
  )) {
    throw new Error('工作流连线会形成环路')
  }
  const edgeUuid = uuidV5(
    `authoring-edge:${input.sourceNodeUuid}:${input.sourceHandleUuid}:` +
      `${input.targetNodeUuid}:${input.targetHandleUuid}`,
    requiredString(graph.workflow.uuid)
  )
  if (graph.edges.some(
    (edge) =>
      edge.target_node_uuid === input.targetNodeUuid &&
      edge.target_handle_uuid === input.targetHandleUuid
  )) {
    throw new Error('操作目标端口已有数据来源')
  }
  if (graph.edges.some((edge) => edge.uuid === edgeUuid)) {
    throw new Error('工作流连线 UUID 已存在')
  }
  const targetHandle = requireNodeHandle(
    catalog,
    graph,
    input.targetNodeUuid,
    input.targetHandleUuid,
    'target'
  )
  if (!isWorkflowValueSchemaAssignable(
    sourceValueSchema,
    targetHandle.valueSchema
  )) {
    throw new Error('工作流连线两端的 valueSchema 不兼容')
  }
  if (
    sourceResourceTemplateUuid &&
    targetHandle.allowedResourceTemplateUuids?.length &&
    !targetHandle.allowedResourceTemplateUuids.includes(
      sourceResourceTemplateUuid
    )
  ) throw new Error('物料来源的资源模板不被操作目标接受')
  const dataKey = requiredString(targetHandle.dataKey)
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.uuid !== input.targetNodeUuid) return node
      const param = { ...recordValue(node.param) }
      delete param[dataKey]
      const metaData = recordOrNull(node.meta_data) ?? {}
      const unilab = recordOrNull(metaData.unilab) ?? {}
      const inputBindings = {
        ...(recordOrNull(unilab.input_bindings) ?? {})
      }
      delete inputBindings[input.targetHandleUuid]
      return {
        ...node,
        param,
        meta_data: {
          ...metaData,
          unilab: {
            ...unilab,
            input_bindings: inputBindings
          }
        }
      }
    }),
    edges: [
      ...graph.edges,
      {
        uuid: edgeUuid,
        source_node_uuid: input.sourceNodeUuid,
        source_handle_uuid: input.sourceHandleUuid,
        target_node_uuid: input.targetNodeUuid,
        target_handle_uuid: input.targetHandleUuid,
        meta_data: {}
      }
    ]
  }
}

export function rehydrateTypedActionGraph(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph
): WorkflowAuthoringGraph {
  const nodeUuids = new Set<string>()
  const nodesByUuid = new Map<string, WorkflowAuthoringGraph['nodes'][number]>()
  const referencedActionTemplateUuids = new Set<string>()
  const referencedFrameworkTemplateUuids = new Set<string>()
  for (const node of graph.nodes) {
    const nodeUuid = requiredString(node.uuid)
    if (nodeUuids.has(nodeUuid)) throw new Error('工作流节点 UUID 重复')
    nodeUuids.add(nodeUuid)
    nodesByUuid.set(nodeUuid, node)
    const templateUuid = requiredString(node.workflow_node_template_uuid)
    if (node.type === 'material_source') {
      const wireTemplate = graph.node_templates.find(
        (template) => template.uuid === templateUuid
      )
      if (
        !wireTemplate ||
        (
          wireTemplate.type !== 'material_source' &&
          wireTemplate.node_type !== 'material_source'
        )
      ) throw new Error('物料来源框架模板不在候选工作流中')
      referencedFrameworkTemplateUuids.add(templateUuid)
    } else {
      typedTemplate(catalog, templateUuid)
      referencedActionTemplateUuids.add(templateUuid)
    }
    recordValue(node.param)
  }
  const edgeUuids = new Set<string>()
  for (const edge of graph.edges) {
    const edgeUuid = requiredString(edge.uuid)
    if (edgeUuids.has(edgeUuid)) throw new Error('工作流连线 UUID 重复')
    edgeUuids.add(edgeUuid)
    requireRehydratedNodeHandle(
      catalog, graph, nodesByUuid,
      requiredString(edge.source_node_uuid),
      requiredString(edge.source_handle_uuid),
      'source'
    )
    requireRehydratedNodeHandle(
      catalog, graph, nodesByUuid,
      requiredString(edge.target_node_uuid),
      requiredString(edge.target_handle_uuid),
      'target'
    )
  }
  const referencedTemplates = [
    ...catalog.actionTemplates,
    ...catalog.workflowTemplates
  ].filter((template) =>
    referencedActionTemplateUuids.has(template.uuid)
  )
  const frameworkTemplates = graph.node_templates.filter((template) =>
    referencedFrameworkTemplateUuids.has(requiredString(template.uuid))
  )
  const frameworkHandles = graph.handle_templates.filter((handle) =>
    typeof handle.workflow_node_template_uuid === 'string' &&
    referencedFrameworkTemplateUuids.has(handle.workflow_node_template_uuid)
  )
  return {
    ...graph,
    node_templates: [
      ...referencedTemplates.map((template) =>
        cloneRecord(template.wireValue ?? executableNodeTemplateWireValue(
          template
        ))
      ),
      ...frameworkTemplates.map(cloneRecord)
    ],
    handle_templates: [
      ...referencedTemplates.flatMap((template) =>
        template.handles.map((handle) =>
          cloneRecord(handle.wireValue ?? handleTemplateWireValue(handle))
        )
      ),
      ...frameworkHandles.map(cloneRecord)
    ]
  }
}

function requireRehydratedNodeHandle(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  nodesByUuid: ReadonlyMap<string, WorkflowAuthoringGraph['nodes'][number]>,
  nodeUuid: string,
  handleUuid: string,
  ioType: 'source' | 'target'
): void {
  const node = nodesByUuid.get(nodeUuid)
  if (!node) throw new Error('工作流连线引用了不存在的节点')
  if (node.type !== 'material_source') {
    requireNodeHandle(catalog, graph, nodeUuid, handleUuid, ioType)
    return
  }
  const handle = graph.handle_templates.find(
    (item) => item.uuid === handleUuid
  )
  if (
    !handle ||
    handle.workflow_node_template_uuid !== node.workflow_node_template_uuid ||
    handle.io_type !== ioType
  ) throw new Error('框架节点端口不在候选工作流中')
}

function nodeTemplateWireValue(
  template: WorkflowActionNodeTemplate
): Record<string, unknown> {
  return {
    uuid: template.uuid,
    resource_template_uuid: template.resourceTemplateUuid,
    name: template.name,
    display_name: template.displayName,
    class: template.actionClass,
    type: template.actionType,
    schema: template.schema,
    goal: template.goal,
    goal_default: template.goalDefault
  }
}

function executableNodeTemplateWireValue(
  template: ExecutableNodeTemplate
): Record<string, unknown> {
  return 'workflowUuid' in template
    ? publishedNodeTemplateWireValue(template)
    : nodeTemplateWireValue(template)
}

function publishedNodeTemplateWireValue(
  template: WorkflowPublishedNodeTemplate
): Record<string, unknown> {
  return {
    uuid: template.uuid,
    resource_template_uuid: template.resourceTemplateUuid,
    name: template.name,
    display_name: template.displayName,
    class: template.workflowClass,
    type: 'workflow',
    node_type: 'workflow',
    schema: template.schema,
    goal: template.goal,
    goal_default: template.goalDefault,
    feedback: {},
    result: template.result,
    meta_data: {
      unilab: {
        framework_owner_only: true,
        workflow_source: {
          kind: template.source.kind,
          definition_fqid: template.source.definitionFqid,
          module: template.source.module,
          symbol: template.source.symbol,
          package_catalog_digest: template.source.packageCatalogDigest,
          definition_content_hash: template.source.definitionContentHash
        }
      }
    }
  }
}

function handleTemplateWireValue(
  handle: WorkflowActionHandleTemplate
): Record<string, unknown> {
  return {
    uuid: handle.uuid,
    workflow_node_template_uuid: handle.workflowNodeTemplateUuid,
    handle_key: handle.handleKey,
    io_type: handle.ioType,
    display_name: handle.displayName,
    type: handle.valueType,
    required: handle.required,
    data_source: handle.dataSource,
    data_key: handle.dataKey,
    meta_data: {
      unilab: {
        value_schema: handle.valueSchema,
        editor_control: handle.editorControl,
        allowed_resource_template_uuids:
          handle.allowedResourceTemplateUuids,
        implicit_passthrough: handle.implicitPassthrough,
        structural_role: handle.structuralRole
      }
    }
  }
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value)
}

function clearTypedActionProvider(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  handleUuid: string,
  dataKey: string
): WorkflowAuthoringGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.uuid !== nodeUuid) return node
      const param = { ...recordValue(node.param) }
      delete param[dataKey]
      const metaData = recordOrNull(node.meta_data) ?? {}
      const unilab = recordOrNull(metaData.unilab) ?? {}
      const inputBindings = {
        ...(recordOrNull(unilab.input_bindings) ?? {})
      }
      delete inputBindings[handleUuid]
      return {
        ...node,
        param,
        meta_data: {
          ...metaData,
          unilab: {
            ...unilab,
            input_bindings: inputBindings
          }
        }
      }
    }),
    edges: graph.edges.filter((edge) => !(
      edge.target_node_uuid === nodeUuid &&
      edge.target_handle_uuid === handleUuid
    ))
  }
}

function workflowInputDescriptors(
  graph: WorkflowAuthoringGraph
): Array<{ name: string; schema: Record<string, unknown> }> {
  const workflow = recordValue(graph.workflow)
  const metaData = recordOrNull(workflow.meta_data) ?? {}
  const unilab = recordOrNull(metaData.unilab) ?? {}
  const contract = recordOrNull(unilab.input_contract)
  if (!contract) return []
  if (contract.version !== 1 || !Array.isArray(contract.parameters)) {
    throw new Error('工作流入参定义与当前版本不一致')
  }
  const descriptors = contract.parameters.map((value) => {
    const descriptor = recordValue(value)
    return {
      name: requiredString(descriptor.name),
      schema: recordValue(descriptor.schema)
    }
  })
  const names = descriptors.map(descriptor => descriptor.name)
  if (new Set(names).size !== names.length) {
    throw new Error('工作流入参存在重复参数')
  }
  return descriptors
}

function workflowInputNames(graph: WorkflowAuthoringGraph): string[] {
  return workflowInputDescriptors(graph).map(descriptor => descriptor.name)
}

type ExecutableNodeTemplate =
  | WorkflowActionNodeTemplate
  | WorkflowPublishedNodeTemplate

function typedTemplate(
  catalog: WorkflowActionCatalogSnapshot,
  templateUuid: string
): ExecutableNodeTemplate {
  const action = catalog.actionTemplates.find((item) =>
    item.uuid === templateUuid
  )
  if (action) {
    const extension = recordOrNull(
      action.schema['x-unilabos-action-contract']
    )
    if (isSupportedTypedActionContract(extension)) return action
  }
  const workflow = catalog.workflowTemplates.find((item) =>
    item.uuid === templateUuid
  )
  if (workflow) {
    const extension = recordOrNull(
      workflow.schema['x-unilabos-workflow-contract']
    )
    if (extension?.version === 1) return workflow
  }
  throw new Error('类型化操作或工作流模板不存在')
}

function isSupportedTypedActionContract(
  extension: Record<string, unknown> | null
): boolean {
  return extension?.version === 1 || extension?.version === 2
}

function typedActionTemplate(
  catalog: WorkflowActionCatalogSnapshot,
  templateUuid: string
): WorkflowActionNodeTemplate {
  const template = typedTemplate(catalog, templateUuid)
  if ('workflowUuid' in template) {
    throw new Error('类型化操作模板不存在')
  }
  return template
}

function orderedTargetHandles(
  template: ExecutableNodeTemplate
): WorkflowActionHandleTemplate[] {
  const order = 'workflowUuid' in template
    ? template.inputOrder
    : stringArray(recordValue(
      template.schema['x-unilabos-action-contract']
    ).input_order)
  const handles = new Map(
    template.handles
      .filter((handle) =>
        handle.ioType === 'target' && handle.structuralRole === null
      )
      .map((handle) => [requiredString(handle.dataKey), handle])
  )
  if (handles.size !== order.length) {
    throw new Error('类型化操作的目标端口与参数规范不一致')
  }
  return order.map((dataKey) => {
    const handle = handles.get(dataKey)
    if (!handle) throw new Error('类型化操作的目标端口缺失')
    return handle
  })
}

function assertParentBoundaryNode(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string
): void {
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  if (!node) throw new Error('工作流节点不存在')
  if (node.parent_uuid !== undefined && node.parent_uuid !== null) {
    throw new Error('Composite internal/private Node 只读；请编辑 invocation boundary')
  }
}

function requireNodeHandle(
  catalog: WorkflowActionCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  handleUuid: string,
  ioType: 'source' | 'target'
): WorkflowActionHandleTemplate {
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  if (!node) throw new Error('工作流连线引用了未知节点')
  const template = typedTemplate(
    catalog,
    requiredString(node.workflow_node_template_uuid)
  )
  const handle = template.handles.find((item) => item.uuid === handleUuid)
  if (!handle || handle.ioType !== ioType) {
    throw new Error(`工作流连线引用了未知的 ${ioType} 端口`)
  }
  return handle
}

function acceptsValue(schema: Record<string, unknown>, value: unknown): boolean {
  if (value === null) return isNullable(schema)
  const base = nonNullSchema(schema)
  const values = enumValues(base)
  if (values && !values.some((item) => Object.is(item, value))) return false
  if (base.$slot === 'ResourceSlot') {
    return recordOrNull(value) !== null
  }
  switch (base.type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'array': return Array.isArray(value)
    case 'object': return recordOrNull(value) !== null
    default: return false
  }
}

function nonNullSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(schema.anyOf)) return schema
  return schema.anyOf.find((item) => {
    const member = recordOrNull(item)
    return member && member.type !== 'null'
  }) as Record<string, unknown> || {}
}

function isNullable(schema: Record<string, unknown>): boolean {
  return Array.isArray(schema.anyOf) && schema.anyOf.some((item) =>
    recordOrNull(item)?.type === 'null'
  )
}

function enumValues(schema: Record<string, unknown>): unknown[] | null {
  const base = nonNullSchema(schema)
  return Array.isArray(base.enum) ? [...base.enum] : null
}

function recordValue(value: unknown): Record<string, unknown> {
  const record = recordOrNull(value)
  if (!record) throw new Error('类型化操作的值必须是对象')
  return record
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new Error('类型化操作标识缺失')
  }
  return value
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('类型化操作顺序无效')
  }
  return value as string[]
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}
