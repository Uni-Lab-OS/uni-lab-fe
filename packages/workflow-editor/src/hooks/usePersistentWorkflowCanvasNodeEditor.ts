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
import { updatePersistentAuthoringNodeDisabled } from '../utils/persistentAuthoringGraph'
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
  ideBridge?: WorkflowIdeBridge
  sourceProjection: WorkflowSourceProjection | null
}

/**
 * 集中维护工作流（Workflow）画布节点的选择、投影与编辑命令。
 *
 * 该 hook 只修改候选图，不负责保存草稿、应用候选或创建工作流任务
 * （WorkflowTask），从而把画布交互与持久化协议隔离。
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
  })

  /** 选择画布节点，并把代码编辑器定位到对应源码行。 */
  const selectCanvasNode = useCallback((
    nodeUuid: string,
    origin: 'canvas' | 'source' | 'runtime' = 'canvas'
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

  /** 从操作模板目录添加操作节点（ActionNode）。 */
  const addTypedActionNode = (templateUuid: string): void => {
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
      const next = createTypedActionNode(actionCatalog, graph, {
        nodeUuid: globalThis.crypto.randomUUID(),
        templateUuid,
        name
      })
      setGraph(next)
      setCanvasDirty(true)
      setMessage('已从真实操作模板创建节点；保存前将生成完整 Python')
    } catch (createError) {
      setError(errorMessage(createError))
    }
  }

  /** 从工作流模板目录添加复合工作流节点（WorkflowNode）。 */
  const addPublishedWorkflowNode = (templateUuid: string): void => {
    if (!actionCatalog || !graph) return
    const template = actionCatalog.workflowTemplates.find(
      (item) => item.uuid === templateUuid
    )
    if (!template) return
    const stem = template.source.symbol.replace(/[^A-Za-z0-9_]/g, '_') ||
      'workflow'
    let name = stem
    let suffix = 2
    while (graph.nodes.some((item) => item.name === name)) {
      name = `${stem}_${suffix}`
      suffix += 1
    }
    try {
      const next = createPublishedWorkflowNode(actionCatalog, graph, {
        nodeUuid: globalThis.crypto.randomUUID(),
        templateUuid,
        name
      })
      setGraph(next)
      setCanvasDirty(true)
      setMessage('已插入已发布工作流边界；内部展开与映射由 OS 生成')
    } catch (createError) {
      setError(errorMessage(createError))
    }
  }

  /** 添加物料来源（MaterialSource）节点，并立即选中它。 */
  const addMaterialSourceNode = (): void => {
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
        { nodeUuid, name }
      )
      setGraph(next)
      setCanvasDirty(true)
      setSelectedNodeUuid(nodeUuid)
      setSelectedNodeName(name)
      setSelectedNodeNameDirty(false)
      setMessage('已添加物料来源；请在属性面板中完成受控选择')
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

  /** 更新操作节点（ActionNode）的类型化字段值。 */
  const updateTypedField = (handleUuid: string, value: unknown): void => {
    if (!actionCatalog || !graph || !selectedNodeUuid) return
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
      setMessage('操作参数已更新；保存前将生成完整 Python')
    } catch (updateError) {
      setError(errorMessage(updateError))
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
  ): void => {
    try {
      updateTypedField(field.handleUuid, parseTypedFieldValue(field, raw))
    } catch (parseError) {
      setError(errorMessage(parseError))
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
  const connectTypedHandles = (connection: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  }): void => {
    if (!actionCatalog || !graph) return
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
      setMessage('已使用真实端口创建连线；保存前将生成完整 Python')
    } catch (connectError) {
      setError(errorMessage(connectError))
    }
  }

  return {
    addMaterialSourceNode,
    addPublishedWorkflowNode,
    addTypedActionNode,
    bindTypedFieldToWorkflowInput,
    connectTypedHandles,
    deleteCanvasElements,
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
