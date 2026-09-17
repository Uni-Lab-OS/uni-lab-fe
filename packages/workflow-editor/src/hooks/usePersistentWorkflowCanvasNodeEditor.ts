import type {
  WorkflowActionCatalogSnapshot,
  WorkflowAuthoringDiagnostic,
  WorkflowAuthoringGraph,
  WorkflowAuthoringSourceMapEntry,
  WorkflowMaterialSourceCatalogSnapshot
} from '@unilab/services'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo } from 'react'

import {
  bindTypedActionWorkflowInput,
  createPublishedWorkflowNode,
  createTypedActionNode,
  connectTypedActionEdge,
  projectTypedActionEditor,
  updateTypedActionLiteral,
  type TypedActionFieldProjection
} from '../utils/workflowActionCatalog'
import {
  connectMaterialSourceToTypedActionEdge,
  createMaterialSourceNode,
  projectMaterialSourceEditor,
  updateMaterialSourceSelector,
  type MaterialSourceEditorProjection,
  type MaterialSourceSelectorUpdate
} from '../utils/workflowMaterialSource'
import {
  errorMessage,
  parseTypedFieldValue
} from '../utils/persistentAuthoringProjection'
import {
  updatePersistentAuthoringNodeDisabled,
  updatePersistentAuthoringNodeName,
  updatePersistentAuthoringNodePosition
} from '../utils/persistentAuthoringGraph'
import { authoringSafeIdentifier } from '../utils/workflowAuthoringNodeIdentity'
import type {
  WorkflowCanvasPoint,
  WorkflowHandleConnection,
  WorkflowHandleConnectionResult
} from '../utils/workflowCanvasCommands'
import { configureManualConfirmation } from '../utils/workflowManualConfirmation'
import { applyWorkflowConditionParam } from '../utils/workflowConditionControl'
import { useWorkflowCanvasDeletion } from './useWorkflowCanvasDeletion'
import {
  workflowNodeAtSourcePosition,
  workflowSourceLocationForNode,
  type WorkflowIdeBridge,
  type WorkflowSourceProjection
} from '../utils/workflowSourceNavigation'

interface PersistentWorkflowCanvasNodeEditorOptions {
  actionCatalog: WorkflowActionCatalogSnapshot | null
  canvasMutationEnabled: boolean
  codeSourceMap: readonly WorkflowAuthoringSourceMapEntry[]
  diagnostics: readonly WorkflowAuthoringDiagnostic[]
  effectiveMaterialSourceCatalog: WorkflowMaterialSourceCatalogSnapshot | null
  graph: WorkflowAuthoringGraph | null
  materialSourceAuthorityBlocked: boolean
  materialSourceCatalog: WorkflowMaterialSourceCatalogSnapshot | null
  revealLine: (line: number) => void
  selectedNodeNameDirty: boolean
  selectedNodeUuid: string | null
  setActionParametersOpen: Dispatch<SetStateAction<boolean>>
  setCanvasDirty: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setGraph: Dispatch<SetStateAction<WorkflowAuthoringGraph | null>>
  setMessage: Dispatch<SetStateAction<string>>
  setSelectedNodeName: Dispatch<SetStateAction<string>>
  setSelectedNodeNameDirty: Dispatch<SetStateAction<boolean>>
  setSelectedNodeUuid: Dispatch<SetStateAction<string | null>>
  setLocalValidationDiagnostics?: Dispatch<
    SetStateAction<WorkflowAuthoringDiagnostic[] | null>
  >
  /** 画布节点移动或连线成功后，把最新候选图同步到权威 OS。 */
  syncCanvasMutation?: (
    graph: WorkflowAuthoringGraph,
    reason: 'node_move' | 'connect' | 'create' | 'delete'
  ) => void
  ideBridge?: WorkflowIdeBridge
  sourceProjection: WorkflowSourceProjection | null
}

/**
 * 集中维护工作流（Workflow）画布节点的选择、投影与编辑命令。
 *
 * 该 hook 负责修改候选图，并在节点移动、连线成功后通知创作会话同步
 * OS；它不负责应用候选或创建工作流任务（WorkflowTask）。
 *
 * @param options 目录快照、候选图、选中态及受控状态写入器。
 * @returns 节点投影和画布编辑命令。
 */
export function usePersistentWorkflowCanvasNodeEditor(
  options: PersistentWorkflowCanvasNodeEditorOptions
) {
  const {
    actionCatalog,
    canvasMutationEnabled,
    codeSourceMap,
    diagnostics,
    effectiveMaterialSourceCatalog,
    graph,
    materialSourceAuthorityBlocked,
    materialSourceCatalog,
    revealLine,
    selectedNodeNameDirty,
    selectedNodeUuid,
    setActionParametersOpen,
    setCanvasDirty,
    setError,
    setGraph,
    setMessage,
    setSelectedNodeName,
    setSelectedNodeNameDirty,
    setSelectedNodeUuid,
    setLocalValidationDiagnostics,
    syncCanvasMutation,
    ideBridge,
    sourceProjection
  } = options

  const deleteCanvasElements = useWorkflowCanvasDeletion({
    graph,
    enabled: canvasMutationEnabled,
    onGraphChange: setGraph,
    onDirty: () => setCanvasDirty(true),
    onSelectionClear: () => {
      setSelectedNodeUuid(null)
      setSelectedNodeName('')
      setSelectedNodeNameDirty(false)
      setActionParametersOpen(false)
    },
    onError: setError,
    onMessage: setMessage
    , onMutation: syncCanvasMutation
  })

  /** 选择节点；调试检查器保持面板布局，源码联动入口才定位代码编辑器。 */
  const selectCanvasNode = useCallback((
    nodeUuid: string,
    origin: 'canvas' | 'source' | 'runtime' | 'inspector' = 'canvas'
  ): void => {
    if (selectedNodeNameDirty && nodeUuid !== selectedNodeUuid) {
      setError('请先保存当前节点名称修改，再选择其他节点')
      return
    }
    const node = graph?.nodes.find((item) => item.uuid === nodeUuid)
    if (!node) return
    setSelectedNodeUuid(nodeUuid)
    setSelectedNodeName(String(node.name || ''))
    setSelectedNodeNameDirty(false)
    // Selection already exposes the compact inspector beside the graph. Keep
    // the full parameter drawer behind its explicit "配置节点参数" action so a
    // navigation click cannot cover both the canvas and the linked editor.
    setActionParametersOpen(false)
    const location = sourceProjection
      ? workflowSourceLocationForNode(sourceProjection, nodeUuid)
      : null
    if (origin === 'canvas') {
      const sourceLine = location?.line ?? codeSourceMap.find(
        (entry) => entry.workflow_node_uuid === nodeUuid
      )?.start_line
      if (sourceLine) revealLine(sourceLine)
      if (location) ideBridge?.onRevealSourceLocation?.(location)
    }
  }, [
    codeSourceMap,
    graph,
    ideBridge?.onRevealSourceLocation,
    revealLine,
    selectedNodeNameDirty,
    selectedNodeUuid,
    setActionParametersOpen,
    setError,
    setSelectedNodeName,
    setSelectedNodeNameDirty,
    setSelectedNodeUuid,
    sourceProjection
  ])

  const sourceSelectedNodeUuid = useMemo(
    () => ideBridge?.sourcePosition
      ? workflowNodeAtSourcePosition(codeSourceMap, ideBridge.sourcePosition)
      : null,
    [
      codeSourceMap,
      ideBridge?.sourcePosition?.column,
      ideBridge?.sourcePosition?.line
    ]
  )

  useEffect(() => {
    if (
      !sourceSelectedNodeUuid ||
      sourceSelectedNodeUuid === selectedNodeUuid
    ) return
    selectCanvasNode(sourceSelectedNodeUuid, 'source')
  }, [
    codeSourceMap,
    selectedNodeUuid,
    selectCanvasNode,
    sourceSelectedNodeUuid
  ])

  const selectedGraphNode = graph?.nodes.find(
    (node) => node.uuid === selectedNodeUuid
  )
  const selectedIsMaterialSource = selectedGraphNode?.type === 'material_source'
  const selectedActionProjection = useMemo(() => {
    if (!actionCatalog || !graph || !selectedNodeUuid || selectedIsMaterialSource) {
      return { editor: null, error: null }
    }
    try {
      return {
        editor: projectTypedActionEditor(
          actionCatalog,
          graph,
          selectedNodeUuid,
          diagnostics
        ),
        error: null
      }
    } catch (projectionError) {
      return { editor: null, error: errorMessage(projectionError) }
    }
  }, [actionCatalog, diagnostics, graph, selectedIsMaterialSource, selectedNodeUuid])
  const selectedActionEditor = selectedActionProjection.editor
  const selectedActionTemplate = actionCatalog?.actionTemplates.find(
    (template) => template.uuid === selectedActionEditor?.templateUuid
  ) ?? null
  const selectedNodeIsInternal = graph?.nodes.some((node) =>
    node.uuid === selectedNodeUuid &&
    node.parent_uuid !== undefined &&
    node.parent_uuid !== null
  ) ?? false
  const selectedMaterialSourceProjection = useMemo(() => {
    if (
      !effectiveMaterialSourceCatalog ||
      !graph ||
      !selectedNodeUuid ||
      !selectedIsMaterialSource
    ) return { editor: null, error: null }
    try {
      return {
        editor: projectMaterialSourceEditor(
          effectiveMaterialSourceCatalog,
          graph,
          selectedNodeUuid
        ),
        error: null
      }
    } catch (projectionError) {
      return { editor: null, error: errorMessage(projectionError) }
    }
  }, [graph, effectiveMaterialSourceCatalog, selectedIsMaterialSource, selectedNodeUuid])
  const selectedMaterialSourceEditor = selectedMaterialSourceProjection.editor

  /** 原子提交一个新节点，并把选择和检查器同步到稳定 UUID。 */
  const commitInsertedNode = (
    next: WorkflowAuthoringGraph,
    nodeUuid: string,
    name: string,
    message: string,
    options?: {
      sync?: boolean
      diagnostics?: WorkflowAuthoringDiagnostic[]
    }
  ): void => {
    setGraph(next)
    setCanvasDirty(true)
    setSelectedNodeUuid(nodeUuid)
    setSelectedNodeName(name)
    setSelectedNodeNameDirty(false)
    setError(null)
    setMessage(message)
    if (options?.diagnostics) {
      setLocalValidationDiagnostics?.(options.diagnostics)
    }
    if (options?.sync === false) return
    syncCanvasMutation?.(next, 'create')
  }

  /** 从操作模板目录添加操作节点（ActionNode）。 */
  const addTypedActionNode = (
    templateUuid: string,
    position?: WorkflowCanvasPoint,
    manualConfirmation?: { deviceUuid: string; timeoutSeconds: number }
  ): void => {
    if (!actionCatalog || !graph) return
    const template = actionCatalog.actionTemplates.find(
      (item) => item.uuid === templateUuid
    )
    if (!template) return
    const stem = template.name.replace(/[^A-Za-z0-9_]/g, '_') || 'action'
    let name = stem
    let suffix = 2
    while (graph.nodes.some((item) => item.name === name)) {
      name = `${stem}_${suffix}`
      suffix += 1
    }
    try {
      const nodeUuid = globalThis.crypto.randomUUID()
      let next = createTypedActionNode(actionCatalog, graph, {
        nodeUuid,
        templateUuid,
        name,
        position
      })
      if (manualConfirmation) next = configureManualConfirmation(next, nodeUuid, template, manualConfirmation)
      const projection = projectTypedActionEditor(
        actionCatalog,
        next,
        nodeUuid,
        []
      )
      const missingRequired = projection.diagnostics.filter(
        (diagnostic) => diagnostic.code === 'required_action_parameter_missing'
      )
      commitInsertedNode(
        next,
        nodeUuid,
        name,
        missingRequired.length > 0
          ? '节点已加入画布，正在保存草稿；请继续配置必填物料或参数'
          : '已从真实操作模板创建节点；正在通过工作区同步保存',
        missingRequired.length > 0
          ? {
              diagnostics: missingRequired.map((diagnostic) => ({
                severity: diagnostic.severity,
                code: diagnostic.code,
                message: diagnostic.message,
                node_id: nodeUuid,
                path: diagnostic.fieldPath,
                workflow_handle_template_uuid: diagnostic.handleUuid
              })) as WorkflowAuthoringDiagnostic[]
            }
          : undefined
      )
      if (missingRequired.length > 0) {
        setActionParametersOpen(true)
      }
    } catch (createError) {
      setError(errorMessage(createError))
    }
  }

  /** 从工作流模板目录添加复合工作流节点（WorkflowNode）。 */
  const addPublishedWorkflowNode = (
    templateUuid: string,
    position?: WorkflowCanvasPoint,
    manualConfirmation?: { deviceUuid: string; timeoutSeconds: number }
  ): void => {
    if (!actionCatalog || !graph) return
    const template = actionCatalog.workflowTemplates.find(
      (item) => item.uuid === templateUuid
    )
    if (!template) return
    const stem = authoringSafeIdentifier(template.source.symbol, 'workflow')
    let name = stem
    let suffix = 2
    while (graph.nodes.some((item) => item.name === name)) {
      name = `${stem}_${suffix}`
      suffix += 1
    }
    try {
      const nodeUuid = globalThis.crypto.randomUUID()
      const next = createPublishedWorkflowNode(actionCatalog, graph, {
        nodeUuid,
        templateUuid,
        name,
        position
      })
      commitInsertedNode(
        next,
        nodeUuid,
        name,
        '已插入已发布工作流边界；正在通过工作区同步保存'
      )
    } catch (createError) {
      setError(errorMessage(createError))
    }
  }

  /** 添加物料来源（MaterialSource）节点，并立即选中它。 */
  const addMaterialSourceNode = (position?: WorkflowCanvasPoint): void => {
    if (!effectiveMaterialSourceCatalog || !graph || materialSourceAuthorityBlocked) {
      return
    }
    let name = 'material_source'
    let suffix = 2
    while (graph.nodes.some((item) => item.name === name)) {
      name = `material_source_${suffix}`
      suffix += 1
    }
    try {
      const nodeUuid = globalThis.crypto.randomUUID()
      const next = createMaterialSourceNode(
        effectiveMaterialSourceCatalog,
        graph,
        { nodeUuid, name, position }
      )
      commitInsertedNode(
        next,
        nodeUuid,
        name,
        '已添加物料来源；正在通过工作区同步保存'
      )
    } catch (createError) {
      setError(errorMessage(createError))
    }
  }

  /** 更新物料来源（MaterialSource）的受控选择器。 */
  const updateMaterialSource = (
    editorProjection: MaterialSourceEditorProjection,
    patch: Partial<MaterialSourceSelectorUpdate>
  ): void => {
    if (
      !effectiveMaterialSourceCatalog ||
      !graph ||
      !selectedNodeUuid ||
      materialSourceAuthorityBlocked
    ) return
    const changingTemplate = patch.resourceTemplateUuid !== undefined &&
      patch.resourceTemplateUuid !== editorProjection.resourceTemplateUuid
    const changingMount = patch.mountUuid !== undefined &&
      patch.mountUuid !== editorProjection.mountUuid
    const next: MaterialSourceSelectorUpdate = {
      mode: patch.mode ?? editorProjection.mode,
      resourceTemplateUuid: patch.resourceTemplateUuid ?? editorProjection.resourceTemplateUuid,
      mountUuid: patch.mountUuid ?? editorProjection.mountUuid,
      fixedMaterialUuid: patch.fixedMaterialUuid !== undefined
        ? patch.fixedMaterialUuid
        : changingTemplate ? null : editorProjection.fixedMaterialUuid,
      siteScope: patch.siteScope ?? (
        changingTemplate || changingMount ? 'all' : editorProjection.siteScope
      ),
      fixedSiteUuid: patch.fixedSiteUuid !== undefined
        ? patch.fixedSiteUuid
        : changingTemplate || changingMount ? null : editorProjection.fixedSiteUuid,
      candidateSiteUuids: patch.candidateSiteUuids ?? (
        changingTemplate || changingMount ? [] : editorProjection.candidateSiteUuids
      ),
      flowRole: patch.flowRole ?? editorProjection.flowRole,
      custodyPolicy: patch.custodyPolicy ?? editorProjection.custodyPolicy
    }
    try {
      const updated = updateMaterialSourceSelector(
        effectiveMaterialSourceCatalog,
        graph,
        selectedNodeUuid,
        next
      )
      setGraph(updated)
      setCanvasDirty(true)
      setError(null)
      setMessage('物料来源选择已更新；保存前将生成完整 Python')
    } catch (updateError) {
      setError(errorMessage(updateError))
    }
  }

  /** 修改确认超时或恢复普通设备动作，不改变底层动作参数。 */
  const updateManualConfirmation = (config: { deviceUuid: string; timeoutSeconds: number } | null): void => {
    if (!canvasMutationEnabled || !graph || !selectedNodeUuid || !selectedActionTemplate) return
    try {
      setGraph(configureManualConfirmation(graph, selectedNodeUuid, selectedActionTemplate, config))
      setCanvasDirty(true)
      setError(null)
      setMessage('人工确认配置已更新，请保存后调试')
    } catch (error) { setError(errorMessage(error)) }
  }

  /** 更新操作节点（ActionNode）的类型化字段值。 */
  const updateTypedField = (
    handleUuid: string,
    value: unknown
  ): string | null => {
    if (!actionCatalog || !graph || !selectedNodeUuid) {
      return '当前没有可编辑的操作节点'
    }
    try {
      const next = updateTypedActionLiteral(
        actionCatalog,
        graph,
        selectedNodeUuid,
        handleUuid,
        value
      )
      setGraph(next)
      setCanvasDirty(true)
      setError(null)
      setMessage('操作参数已更新；保存前将生成完整 Python')
      return null
    } catch (updateError) {
      const message = errorMessage(updateError)
      setError(message)
      return message
    }
  }

  /** 切换 OS Authoring 节点的静态禁用状态；Planner 将自动排除已禁用节点。 */
  const toggleNodeDisabled = (nodeUuid: string): void => {
    if (!graph || !canvasMutationEnabled) return
    const node = graph.nodes.find((item) => item.uuid === nodeUuid)
    if (!node) return
    try {
      const disabled = node.disabled !== true
      setGraph(updatePersistentAuthoringNodeDisabled(graph, nodeUuid, disabled))
      setCanvasDirty(true)
      setError(null)
      setMessage(disabled
        ? '节点已标记为禁用；保存后运行会自动跳过且不创建节点作业'
        : '节点已恢复启用；保存后将重新进入执行计划')
    } catch (updateError) {
      setError(errorMessage(updateError))
    }
  }

  /** 解析文本字段并更新操作节点（ActionNode）的类型化字段。 */
  const updateTypedFieldFromRaw = (
    field: TypedActionFieldProjection,
    raw: string
  ): string | null => {
    try {
      return updateTypedField(
        field.handleUuid,
        parseTypedFieldValue(field, raw)
      )
    } catch (parseError) {
      const message = errorMessage(parseError)
      setError(message)
      return message
    }
  }

  /** 把操作入参绑定到工作流入参（WorkflowInput）。 */
  const bindTypedFieldToWorkflowInput = (
    handleUuid: string,
    parameter: string
  ): void => {
    if (!actionCatalog || !graph || !selectedNodeUuid) return
    try {
      const next = bindTypedActionWorkflowInput(
        actionCatalog,
        graph,
        selectedNodeUuid,
        handleUuid,
        parameter
      )
      setGraph(next)
      setCanvasDirty(true)
      setMessage('操作参数已绑定工作流入参；保存前将生成完整 Python')
    } catch (bindingError) {
      setError(errorMessage(bindingError))
    }
  }

  /** 使用真实端口连接操作或物料来源（MaterialSource）节点。 */
  const connectTypedHandles = (
    connection: WorkflowHandleConnection
  ): WorkflowHandleConnectionResult => {
    if (!actionCatalog || !graph) {
      return { accepted: false, reason: '工作流目录或草稿尚未加载完成' }
    }
    try {
      const sourceNode = graph.nodes.find(
        (node) => node.uuid === connection.sourceNodeUuid
      )
      let next: WorkflowAuthoringGraph
      if (sourceNode?.type === 'material_source') {
        if (!materialSourceCatalog) throw new Error('物料来源目录尚未就绪')
        next = connectMaterialSourceToTypedActionEdge(
          actionCatalog,
          materialSourceCatalog,
          graph,
          connection
        )
      } else {
        next = connectTypedActionEdge(actionCatalog, graph, connection)
      }
      setGraph(next)
      setCanvasDirty(true)
      setError(null)
      setMessage('已使用真实端口创建连线；正在同步 OS…')
      syncCanvasMutation?.(next, 'connect')
      return { accepted: true }
    } catch (connectError) {
      const reason = errorMessage(connectError)
      setError(reason)
      return { accepted: false, reason }
    }
  }

  /** 更新画布坐标；纯布局调整不标记源码待保存。 */
  const moveCanvasNode = (
    nodeUuid: string,
    position: WorkflowCanvasPoint
  ): void => {
    if (!graph || !canvasMutationEnabled) return
    try {
      const next = updatePersistentAuthoringNodePosition(graph, nodeUuid, position)
      setGraph(next)
    } catch (moveError) {
      setError(errorMessage(moveError))
    }
  }

  /** 在失焦或确认时把名称提交到 Canonical 草稿。 */
  const renameCanvasNode = (nodeUuid: string, name: string): boolean => {
    if (!graph || !canvasMutationEnabled) return false
    try {
      setGraph(updatePersistentAuthoringNodeName(graph, nodeUuid, name))
      setSelectedNodeName(name.trim())
      setSelectedNodeNameDirty(false)
      setCanvasDirty(true)
      setError(null)
      setMessage('节点名称已更新；保存草稿后持久化')
      return true
    } catch (renameError) {
      setError(errorMessage(renameError))
      return false
    }
  }

  /** 更新条件/循环控制节点结构参数，并通过既有画布同步链路保存到 OS。 */
  const updateControlNodeParam = (
    nodeUuid: string,
    param: Record<string, unknown>
  ): void => {
    if (!graph || !canvasMutationEnabled) return
    const target = graph.nodes.find((node) => node.uuid === nodeUuid)
    const type = String(target?.type || '')
    if (!target || (type !== 'condition' && type !== 'repeat_until')) {
      setError('选中节点不是条件或循环控制节点')
      return
    }
    const next = type === 'condition'
      ? applyWorkflowConditionParam(graph, nodeUuid, param)
      : {
          ...graph,
          nodes: graph.nodes.map((node) => node.uuid === nodeUuid
            ? { ...node, param }
            : node)
        }
    setGraph(next)
    setCanvasDirty(true)
    setError(null)
    setMessage('控制节点结构已更新；正在同步 OS 草稿…')
    syncCanvasMutation?.(next, 'create')
  }

  return {
    addMaterialSourceNode,
    addPublishedWorkflowNode,
    addTypedActionNode,
    updateControlNodeParam,
    updateManualConfirmation,
    bindTypedFieldToWorkflowInput,
    connectTypedHandles,
    deleteCanvasElements,
    moveCanvasNode,
    renameCanvasNode,
    selectCanvasNode,
    selectedActionEditor,
    selectedActionProjection,
    selectedActionTemplate,
    selectedIsMaterialSource,
    selectedMaterialSourceEditor,
    selectedMaterialSourceProjection,
    selectedNodeIsInternal,
    sourceSelectedNodeUuid,
    toggleNodeDisabled,
    updateMaterialSource,
    updateTypedField,
    updateTypedFieldFromRaw
  }
}
