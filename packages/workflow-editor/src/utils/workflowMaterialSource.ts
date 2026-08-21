import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringGraph,
  WorkflowMaterialSourceCatalogSnapshot,
  WorkflowMaterialSourceMaterial,
  WorkflowMaterialSourceResourceTemplate,
  WorkflowMaterialSourceSite
} from '@unilab/services'

import { connectFrameworkSourceToTypedActionEdge } from './workflowActionCatalog'

export type MaterialSourceMode = 'existing' | 'create_new'
export type MaterialSourceFlowRole =
  | 'primary_sample'
  | 'aliquot_sample'
  | 'reagent'
  | 'consumable'
export type MaterialSourceSiteScope = 'all' | 'fixed' | 'candidates'
export type MaterialSourceCustodyPolicy =
  | 'task_exclusive'
  | 'shared_source'

export interface MaterialSourceSelectorUpdate {
  mode: MaterialSourceMode
  resourceTemplateUuid: string
  mountUuid: string
  fixedMaterialUuid: string | null
  siteScope: MaterialSourceSiteScope
  fixedSiteUuid?: string | null
  candidateSiteUuids?: readonly string[]
  flowRole: MaterialSourceFlowRole
  custodyPolicy: MaterialSourceCustodyPolicy
}

export interface MaterialSourceEditorProjection {
  nodeUuid: string
  name: string
  mode: MaterialSourceMode
  resourceTemplateUuid: string
  mountUuid: string
  fixedMaterialUuid: string | null
  siteScope: MaterialSourceSiteScope
  fixedSiteUuid: string | null
  candidateSiteUuids: string[]
  flowRole: MaterialSourceFlowRole
  custodyPolicy: MaterialSourceCustodyPolicy
  sharedSourceBlockedReason: string | null
  resourceTemplates: WorkflowMaterialSourceResourceTemplate[]
  mounts: WorkflowMaterialSourceMaterial[]
  fixedMaterials: WorkflowMaterialSourceMaterial[]
  sites: WorkflowMaterialSourceSite[]
  staleReferences: string[]
}

export function createMaterialSourceNode(
  catalog: WorkflowMaterialSourceCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  input: { nodeUuid: string; name: string }
): WorkflowAuthoringGraph {
  if (graph.nodes.some((node) => node.uuid === input.nodeUuid)) {
    throw new Error('工作流节点 UUID 已存在')
  }
  if (!validPythonName(input.name) || graph.nodes.some(
    (node) => node.name === input.name
  )) throw new Error('物料来源节点名称无效或重复')
  const mount = materialSourceMounts(catalog)[0]
  const mountTemplateUuids = new Set(
    materialSourceMounts(catalog).map((item) => item.resourceTemplateUuid)
  )
  const resourceTemplate = catalog.resourceTemplates.find(
    (item) => !mountTemplateUuids.has(item.uuid)
  ) ?? catalog.resourceTemplates[0]
  if (!resourceTemplate || !mount) {
    throw new Error('OS 物料与库位目录中没有可用的物料来源初始选项')
  }
  const template = catalog.template
  const sourceHandle = template.sourceHandle
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        uuid: input.nodeUuid,
        workflow_node_template_uuid: template.uuid,
        name: input.name,
        status: 'idle',
        type: 'material_source',
        pose: {},
        param: {
          resource_template_uuid: resourceTemplate.uuid,
          mode: 'existing',
          mount: { uuid: mount.uuid },
          material_uuid: null,
          site: null,
          slot_range: null,
          flow_role: 'primary_sample',
          custody_policy: 'task_exclusive'
        },
        execution_policy: {},
        disabled: false,
        minimized: false,
        meta_data: {}
      }
    ],
    node_templates: appendStableTemplate(
      graph.node_templates,
      requiredWireValue(template.wireValue, 'MaterialSource NodeTemplate'),
      [
        'uuid',
        'resource_template_uuid',
        'name',
        'class',
        'type',
        'node_type'
      ]
    ),
    handle_templates: appendStableTemplate(
      graph.handle_templates,
      requiredWireValue(sourceHandle.wireValue, 'MaterialSource HandleTemplate'),
      [
        'uuid',
        'workflow_node_template_uuid',
        'handle_key',
        'io_type',
        'type'
      ]
    )
  }
}

export function projectMaterialSourceEditor(
  catalog: WorkflowMaterialSourceCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  nodeUuid: string
): MaterialSourceEditorProjection {
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)
  if (!node || node.type !== 'material_source') {
    throw new Error('选择的节点不是物料来源')
  }
  if (node.workflow_node_template_uuid !== catalog.template.uuid) {
    throw new Error('物料来源框架模板标识不匹配')
  }
  const param = recordValue(node.param, 'MaterialSource param')
  assertClosedSelector(param)
  const mode = materialSourceMode(param.mode)
  const resourceTemplateUuid = requiredString(
    param.resource_template_uuid,
    'resource_template_uuid'
  )
  const mountRecord = recordValue(param.mount, 'mount')
  if (Object.keys(mountRecord).some((key) => key !== 'uuid')) {
    throw new Error('物料来源挂载点只接受稳定 UUID')
  }
  const mountUuid = requiredString(mountRecord.uuid, 'mount.uuid')
  const fixedMaterialUuid = nullableString(param.material_uuid, 'material_uuid')
  const fixedSiteUuid = nullableString(param.site, 'site')
  const candidateSiteUuids = nullableStringArray(param.slot_range, 'slot_range')
  if (fixedSiteUuid && candidateSiteUuids.length > 0) {
    throw new Error('物料来源库位选择器不能同时指定固定库位和候选集')
  }
  if (mode === 'create_new' && fixedMaterialUuid) {
    throw new Error('新建物料模式不能携带固定物料')
  }
  const flowRole = materialSourceFlowRole(param.flow_role)
  // 升级前已保存的七字段选择器明确沿用原有任务全程独占语义；下一次更新会
  // 写回完整八字段合同，绝不把旧工作流静默改成可共享来源。
  const custodyPolicy = materialSourceCustodyPolicy(
    param.custody_policy ?? 'task_exclusive'
  )
  const movementAction = sharedSourceMovementAction(graph, nodeUuid)
  const sites = compatibleSites(catalog, mountUuid, resourceTemplateUuid)
  const staleReferences: string[] = []
  if (!catalog.resourceTemplates.some((item) =>
    item.uuid === resourceTemplateUuid
  )) staleReferences.push(`资源模板 ${resourceTemplateUuid}`)
  if (!catalog.materials.some((item) => item.uuid === mountUuid)) {
    staleReferences.push(`挂载点 ${mountUuid}`)
  }
  if (fixedMaterialUuid && !catalog.materials.some((item) =>
    item.uuid === fixedMaterialUuid
  )) staleReferences.push(`物料 ${fixedMaterialUuid}`)
  for (const siteUuid of [
    ...(fixedSiteUuid ? [fixedSiteUuid] : []),
    ...candidateSiteUuids
  ]) {
    if (!catalog.sites.some((item) => item.uuid === siteUuid)) {
      staleReferences.push(`库位 ${siteUuid}`)
    }
  }
  return {
    nodeUuid,
    name: requiredString(node.name, 'name'),
    mode,
    resourceTemplateUuid,
    mountUuid,
    fixedMaterialUuid,
    siteScope: fixedSiteUuid
      ? 'fixed'
      : candidateSiteUuids.length > 0
        ? 'candidates'
        : 'all',
    fixedSiteUuid,
    candidateSiteUuids,
    flowRole,
    custodyPolicy,
    sharedSourceBlockedReason: movementAction
      ? `共享来源不能流入 ${movementAction} 物料移动动作`
      : null,
    resourceTemplates: catalog.resourceTemplates,
    mounts: materialSourceMounts(catalog),
    fixedMaterials: catalog.materials.filter((item) =>
      item.resourceTemplateUuid === resourceTemplateUuid
    ),
    sites,
    staleReferences
  }
}

export function updateMaterialSourceSelector(
  catalog: WorkflowMaterialSourceCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  update: MaterialSourceSelectorUpdate
): WorkflowAuthoringGraph {
  const projection = projectMaterialSourceEditor(catalog, graph, nodeUuid)
  requireOption(
    catalog.resourceTemplates,
    update.resourceTemplateUuid,
    '资源模板'
  )
  requireOption(materialSourceMounts(catalog), update.mountUuid, '挂载点')
  const sites = compatibleSites(
    catalog,
    update.mountUuid,
    update.resourceTemplateUuid
  )
  const fixedSiteUuid = update.siteScope === 'fixed'
    ? update.fixedSiteUuid ?? null
    : null
  const candidateSiteUuids = update.siteScope === 'candidates'
    ? [...new Set(update.candidateSiteUuids ?? [])].sort()
    : []
  if (update.siteScope === 'fixed' && !fixedSiteUuid) {
    throw new Error('固定库位范围必须选择一个库位')
  }
  if (update.siteScope === 'candidates' && candidateSiteUuids.length === 0) {
    throw new Error('候选库位集不能为空')
  }
  for (const siteUuid of [
    ...(fixedSiteUuid ? [fixedSiteUuid] : []),
    ...candidateSiteUuids
  ]) requireOption(sites, siteUuid, 'Site')
  const fixedMaterialUuid = update.mode === 'create_new'
    ? null
    : update.fixedMaterialUuid
  if (fixedMaterialUuid) {
    requireOption(
      catalog.materials.filter((item) =>
        item.resourceTemplateUuid === update.resourceTemplateUuid
      ),
      fixedMaterialUuid,
      '固定物料'
    )
  }
  const movementAction = update.custodyPolicy === 'shared_source'
    ? sharedSourceMovementAction(graph, nodeUuid)
    : null
  if (movementAction) {
    throw new Error(`共享来源不能流入 ${movementAction} 物料移动动作`)
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.uuid !== nodeUuid
      ? node
      : {
          ...node,
          param: {
            resource_template_uuid: update.resourceTemplateUuid,
            mode: update.mode,
            mount: { uuid: update.mountUuid },
            material_uuid: fixedMaterialUuid,
            site: fixedSiteUuid,
            slot_range: candidateSiteUuids.length > 0
              ? candidateSiteUuids
              : null,
            flow_role: update.flowRole,
            custody_policy: update.custodyPolicy
          }
        })
  }
}

export function connectMaterialSourceToTypedActionEdge(
  actionCatalog: WorkflowActionCatalogSnapshot,
  materialSourceCatalog: WorkflowMaterialSourceCatalogSnapshot,
  graph: WorkflowAuthoringGraph,
  input: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  }
): WorkflowAuthoringGraph {
  const projection = projectMaterialSourceEditor(
    materialSourceCatalog,
    graph,
    input.sourceNodeUuid
  )
  const template = materialSourceCatalog.template
  if (input.sourceHandleUuid !== template.sourceHandle.uuid) {
    throw new Error('物料来源输出端口标识不匹配')
  }
  if (graph.edges.some((edge) =>
    edge.source_node_uuid === input.sourceNodeUuid &&
    edge.source_handle_uuid === input.sourceHandleUuid
  )) throw new Error('物料来源输出端口最多只能连接一个目标')
  return connectFrameworkSourceToTypedActionEdge(
    actionCatalog,
    graph,
    input,
    {
      nodeType: 'material_source',
      nodeTemplateUuid: template.uuid,
      handleUuid: template.sourceHandle.uuid,
      valueType: template.sourceHandle.valueType,
      resourceTemplateUuid: projection.resourceTemplateUuid
    }
  )
}

function materialSourceMounts(
  catalog: WorkflowMaterialSourceCatalogSnapshot
): WorkflowMaterialSourceMaterial[] {
  const mountUuids = new Set(catalog.sites.map((site) => site.mountMaterialUuid))
  return catalog.materials.filter((material) => mountUuids.has(material.uuid))
}

/**
 * 按公共物料图（MaterialGraph）的 sort_order、UUID 顺序筛选兼容库位（Site）。
 *
 * @param catalog 工作流物料来源（MaterialSource）目录快照。
 * @param mountUuid 当前选择的挂载物料稳定 UUID。
 * @param resourceTemplateUuid 当前选择的资源模板（ResourceTemplate）稳定 UUID。
 * @returns 保留目录权威业务顺序的兼容库位集合。
 * @throws 无。
 */
function compatibleSites(
  catalog: WorkflowMaterialSourceCatalogSnapshot,
  mountUuid: string,
  resourceTemplateUuid: string
): WorkflowMaterialSourceSite[] {
  const sites: WorkflowMaterialSourceSite[] = []
  for (const site of catalog.sites) {
    const sameMount = site.mountMaterialUuid === mountUuid
    const acceptsTemplate = site.allowedResourceTemplateUuids.length === 0 ||
      site.allowedResourceTemplateUuids.includes(resourceTemplateUuid)
    if (sameMount && acceptsTemplate) sites.push(site)
  }
  return sites.sort(compareMaterialSourceSites)
}

/**
 * 按库位（Site）业务顺序和稳定 UUID 比较两个候选。
 *
 * @param left 左侧库位。
 * @param right 右侧库位。
 * @returns `sortOrder` 优先、UUID 次优先的比较结果。
 * @throws 无。
 */
function compareMaterialSourceSites(
  left: WorkflowMaterialSourceSite,
  right: WorkflowMaterialSourceSite
): number {
  return left.sortOrder - right.sortOrder || left.uuid.localeCompare(right.uuid)
}

function appendStableTemplate(
  current: Array<Record<string, unknown>>,
  template: Record<string, unknown>,
  identityKeys: readonly string[]
): Array<Record<string, unknown>> {
  const existing = current.find((item) => item.uuid === template.uuid)
  if (!existing) return [...current, structuredClone(template)]
  if (identityKeys.some((key) => existing[key] !== template[key])) {
    throw new Error(`模板 ${String(template.uuid)} 的标识内容冲突`)
  }
  return current
}

function requiredWireValue(
  value: Record<string, unknown> | undefined,
  label: string
): Record<string, unknown> {
  if (!value) throw new Error(`${label} 缺少 OS 传输值`)
  return value
}

function requireOption(
  options: ReadonlyArray<{ uuid: string }>,
  uuid: string,
  label: string
): void {
  if (!options.some((item) => item.uuid === uuid)) {
    throw new Error(`${label} ${uuid} 不在当前 OS 目录中`)
  }
}

function assertClosedSelector(param: Record<string, unknown>): void {
  const allowed = new Set([
    'resource_template_uuid',
    'mode',
    'mount',
    'material_uuid',
    'site',
    'slot_range',
    'flow_role',
    'custody_policy'
  ])
  const required = [...allowed].filter((key) => key !== 'custody_policy')
  if (
    Object.keys(param).some((key) => !allowed.has(key)) ||
    Object.keys(param).some((key) => !Object.prototype.hasOwnProperty.call(
      param,
      key
    )) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(param, key))
  ) throw new Error('物料来源选择器字段不符合闭合规范')
}

function materialSourceMode(value: unknown): MaterialSourceMode {
  if (value !== 'existing' && value !== 'create_new') {
    throw new Error('物料来源模式不在闭合目录中')
  }
  return value
}

function materialSourceFlowRole(value: unknown): MaterialSourceFlowRole {
  if (
    value !== 'primary_sample' &&
    value !== 'aliquot_sample' &&
    value !== 'reagent' &&
    value !== 'consumable'
  ) throw new Error('物料来源角色不在闭合目录中')
  return value
}

/** 把未知输入收窄为物料保管策略（MaterialCustodyPolicy）闭集。 */
function materialSourceCustodyPolicy(
  value: unknown
): MaterialSourceCustodyPolicy {
  if (value !== 'task_exclusive' && value !== 'shared_source') {
    throw new Error('物料保管策略不在闭合目录中')
  }
  return value
}

/**
 * 查找从一个物料来源沿物料占位符（ResourceSlot）可达的移动动作。
 *
 * @param graph 当前候选工作流图；只读取节点、端口与连线。
 * @param sourceNodeUuid 物料来源节点稳定 UUID。
 * @returns 首个可达的 ``pick``/``place``/``transfer_resource`` 动作名，或无冲突时
 * 返回 ``null``。
 * @throws 无；结构不完整的边由 OS Authoring 校验另行诊断，本函数不猜测类型。
 */
function sharedSourceMovementAction(
  graph: WorkflowAuthoringGraph,
  sourceNodeUuid: string
): string | null {
  const movementActions = new Set(['pick', 'place', 'transfer_resource'])
  const handleByUuid = new Map(graph.handle_templates.map((handle) => [
    String(handle.uuid || ''),
    handle
  ]))
  const nodeByUuid = new Map(
    graph.nodes.map((node) => [String(node.uuid || ''), node])
  )
  const compositeSourceBridges = materialCompositeSourceBridges(graph)
  const pending: Array<{ nodeUuid: string; handleUuid: string }> = []
  const enqueueOutgoing = (nodeUuid: string, handleUuid: string): void => {
    if (String(handleByUuid.get(handleUuid)?.type || '') !== 'ResourceSlot') return
    const sourceEndpoints = [
      { nodeUuid, handleUuid },
      ...(compositeSourceBridges.get(`${nodeUuid}:${handleUuid}`) ?? [])
    ]
    for (const source of sourceEndpoints) {
      for (const edge of graph.edges) {
        if (
          String(edge.source_node_uuid || '') !== source.nodeUuid ||
          String(edge.source_handle_uuid || '') !== source.handleUuid
        ) continue
        pending.push({
          nodeUuid: String(edge.target_node_uuid || ''),
          handleUuid: String(edge.target_handle_uuid || '')
        })
      }
    }
  }
  for (const edge of graph.edges) {
    if (String(edge.source_node_uuid || '') !== sourceNodeUuid) continue
    enqueueOutgoing(sourceNodeUuid, String(edge.source_handle_uuid || ''))
  }
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.shift()
    if (!current) continue
    const currentIdentity = `${current.nodeUuid}:${current.handleUuid}`
    if (visited.has(currentIdentity)) continue
    visited.add(currentIdentity)
    if (String(handleByUuid.get(current.handleUuid)?.type || '') !== 'ResourceSlot') {
      continue
    }
    const targetNode = nodeByUuid.get(current.nodeUuid)
    const actionName = String(targetNode?.action_name || '')
    if (movementActions.has(actionName)) return actionName
    if (!targetNode) continue
    pending.push(...materialCompositeTargetArrivals(
      targetNode,
      current.handleUuid,
      handleByUuid
    ))
    for (const handleUuid of materialPassThroughSourceHandles(
      graph,
      targetNode,
      current.handleUuid,
      handleByUuid
    )) enqueueOutgoing(current.nodeUuid, handleUuid)
  }
  return null
}

/** 把复合工作流外部物料输入映射到其冻结子图中的真实输入。 */
function materialCompositeTargetArrivals(
  node: WorkflowAuthoringGraph['nodes'][number],
  targetHandleUuid: string,
  handleByUuid: Map<string, WorkflowAuthoringGraph['handle_templates'][number]>
): Array<{ nodeUuid: string; handleUuid: string }> {
  const unilab = nestedRecord(node.meta_data, 'unilab')
  const composite = nestedRecord(unilab, 'composite')
  const targetMappings = nestedRecord(composite, 'target_mappings')
  const mappings = targetMappings?.[targetHandleUuid]
  if (!Array.isArray(mappings)) return []
  return mappings.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const mapping = value as Record<string, unknown>
    const nodeUuid = String(mapping.workflow_node_uuid || '')
    const handleUuid = String(mapping.target_handle_uuid || '')
    if (
      !nodeUuid ||
      handleByUuid.get(handleUuid)?.io_type !== 'target' ||
      handleByUuid.get(handleUuid)?.type !== 'ResourceSlot'
    ) return []
    return [{ nodeUuid, handleUuid }]
  })
}

/** 建立冻结子图物料输出到复合工作流外部输出的反向桥接索引。 */
function materialCompositeSourceBridges(
  graph: WorkflowAuthoringGraph
): Map<string, Array<{ nodeUuid: string; handleUuid: string }>> {
  const bridges = new Map<
    string,
    Array<{ nodeUuid: string; handleUuid: string }>
  >()
  for (const node of graph.nodes) {
    const unilab = nestedRecord(node.meta_data, 'unilab')
    const composite = nestedRecord(unilab, 'composite')
    const sourceMappings = nestedRecord(composite, 'source_mappings')
    for (const [outputHandleUuid, value] of Object.entries(sourceMappings ?? {})) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const mapping = value as Record<string, unknown>
      if (mapping.kind !== 'node_output') continue
      const childNodeUuid = String(mapping.workflow_node_uuid || '')
      const childHandleUuid = String(mapping.source_handle_uuid || '')
      if (!childNodeUuid || !childHandleUuid) continue
      const key = `${childNodeUuid}:${childHandleUuid}`
      const endpoints = bridges.get(key) ?? []
      endpoints.push({
        nodeUuid: String(node.uuid || ''),
        handleUuid: outputHandleUuid
      })
      bridges.set(key, endpoints)
    }
  }
  return bridges
}

/**
 * 解析一个动作输入所对应的同一物料输出，避免把多物料动作的其他输出串入血缘。
 */
function materialPassThroughSourceHandles(
  graph: WorkflowAuthoringGraph,
  node: WorkflowAuthoringGraph['nodes'][number],
  targetHandleUuid: string,
  handleByUuid: Map<string, WorkflowAuthoringGraph['handle_templates'][number]>
): string[] {
  const unilab = nestedRecord(node.meta_data, 'unilab')
  const mappings = nestedRecord(unilab, 'material_passthrough_handles')
  const explicit = Object.entries(mappings ?? {})
    .filter(([, inputHandleUuid]) => inputHandleUuid === targetHandleUuid)
    .map(([outputHandleUuid]) => outputHandleUuid)
    .filter((outputHandleUuid) => {
      const handle = handleByUuid.get(outputHandleUuid)
      return handle?.io_type === 'source' && handle.type === 'ResourceSlot'
    })
  if (explicit.length > 0) return explicit

  const target = handleByUuid.get(targetHandleUuid)
  if (!target) return []
  return graph.handle_templates
    .filter((handle) =>
      handle.workflow_node_template_uuid === node.workflow_node_template_uuid &&
      handle.io_type === 'source' &&
      handle.type === 'ResourceSlot' &&
      handle.handle_key === target.handle_key
    )
    .map((handle) => String(handle.uuid || ''))
    .filter(Boolean)
}

function nestedRecord(
  value: unknown,
  key: string
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const nested = (value as Record<string, unknown>)[key]
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null
  return nested as Record<string, unknown>
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} 缺失`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null
  return requiredString(value, label)
}

function nullableStringArray(value: unknown, label: string): string[] {
  if (value === null) return []
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !item) ||
    new Set(value).size !== value.length
  ) throw new Error(`${label} 必须是无重复稳定 UUID 数组或 null`)
  return [...value]
}

function validPythonName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}
