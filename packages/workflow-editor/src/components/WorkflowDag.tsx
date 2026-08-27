/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: ReactFlow DAG 拓扑视图(节点分色 + 有向边 + 控件)
 * Context: 工作流方向拓扑连接图展示
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel
} from 'reactflow'
import type {
  Connection,
  EdgeChange,
  Node,
  NodeChange,
  ReactFlowInstance
} from 'reactflow'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useWorkflowDag } from '../hooks/useWorkflowDag'
import WorkflowRoundedStepEdge from './WorkflowRoundedStepEdge'
import { WorkflowButton } from './WorkflowButton'
import WorkflowMaterialVisibilityControl from './WorkflowMaterialVisibilityControl'
import WorkflowSupportingMaterialPresentationControl from './WorkflowSupportingMaterialPresentationControl'
import { WORKFLOW_DAG_NODE_TYPES } from './workflowDagNodeTypes'
import type { WorkflowNodeData } from './WorkflowNodeCard'
import type { WorkflowLink, WorkflowNode } from '../utils/parseWorkflow'
import {
  projectNestedWorkflow,
  visibleNestedWorkflowNodeId
} from '../utils/canonicalWorkflow'
import {
  filterWorkflowByMaterialRoles,
  projectMaterialTraces,
  workflowMaterialRoleOptions
} from '../utils/workflowMaterialTrace'
import {
  DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION,
  WORKFLOW_DAG_LAYOUT_STRATEGIES,
  WORKFLOW_MATERIAL_SWIMLANE_DIRECTIONS,
  workflowDagLayoutStrategyLabel,
  workflowMaterialSwimlaneDirectionLabel,
  type WorkflowDagLayoutStrategy,
  type WorkflowMaterialSwimlaneDirection
} from '../utils/workflowDagLayoutStrategy'
import {
  CANVAS_EDIT_WORKFLOW_CANVAS,
  READ_ONLY_WORKFLOW_CANVAS,
  visibleReadOnlyEdgeChanges,
  visibleReadOnlyNodeChanges
} from '../utils/workflowCanvasPolicy'
import type {
  WorkflowSupportingMaterialPresentation
} from '../utils/workflowReactionMaterialProjection'
import 'reactflow/dist/style.css'
import styles from './workflow.module.scss'

interface WorkflowDagProps {
  nodes: WorkflowNode[]
  links: WorkflowLink[]
  onNodeSelect: (nodeId: string) => void
  /** IDE 光标反查的单一节点；undefined 时由 React Flow 管理本地多选。 */
  selectedNodeId?: string | null
  /** 运行输出等外部入口发出的可重复画布聚焦请求。 */
  revealNodeRequest?: Readonly<{ nodeId: string; nonce: number }> | null
  onSetStart?: (nodeId: string) => void
  onToggleBreakpoint?: (nodeId: string) => void
  onToggleDisabled?: (nodeId: string) => void
  nodeStates?: Readonly<Record<string, string>>
  breakpoints?: ReadonlySet<string>
  startNodeId?: string | null
  beforeStartNodeIds?: ReadonlySet<string>
  pausedBeforeNodeId?: string | null
  canBeautify?: boolean
  beautifyDisabledReason?: string
  onBeautify?: (
    strategy: WorkflowDagLayoutStrategy,
    swimlaneDirection: WorkflowMaterialSwimlaneDirection
  ) => void
  canvasMutationEnabled?: boolean
  nodePositionMutationEnabled?: boolean
  onNodePositionChange?: (
    nodeId: string,
    position: { x: number; y: number }
  ) => void
  onConnectHandles?: (connection: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  }) => void
  onDeleteRequest?: (selection: {
    nodeUuids: string[]
    edgeUuids: string[]
  }) => void
  visibleMaterialRoles?: readonly string[] | null
  onVisibleMaterialRolesChange?: (
    visibleMaterialRoles: readonly string[] | null
  ) => void
}
// 注册自定义边类型（在组件外定义，避免每次渲染重建）。
const edgeTypes = { workflowRoundedStep: WorkflowRoundedStepEdge }
const WORKFLOW_FIT_VIEW_OPTIONS = {
  padding: 0.16,
  minZoom: 0.2,
  maxZoom: 1.35
} as const
// 暂停暴露会把画布布局写回工作流（Workflow）草稿的入口；保留实现便于后续恢复。
const WORKFLOW_LAYOUT_APPLY_ACTION_VISIBLE = false

/**
 * 渲染工作流拓扑、运行状态、物料流句柄及可选的画布编辑控制。
 *
 * @param props 工作流节点、边、状态、编辑能力与布局回调。
 * @returns 可缩放、可适配且遵守当前画布权限的 ReactFlow 视图。
 */
export default function WorkflowDag({
  nodes,
  links,
  onNodeSelect,
  selectedNodeId,
  revealNodeRequest = null,
  onSetStart,
  onToggleBreakpoint,
  onToggleDisabled,
  nodeStates = {},
  breakpoints = new Set(),
  startNodeId = null,
  beforeStartNodeIds = new Set(),
  pausedBeforeNodeId = null,
  canBeautify = true,
  beautifyDisabledReason = '请先完成当前 Python 编译',
  onBeautify,
  canvasMutationEnabled = false,
  nodePositionMutationEnabled = false,
  onNodePositionChange,
  onConnectHandles,
  onDeleteRequest,
  visibleMaterialRoles,
  onVisibleMaterialRolesChange
}: WorkflowDagProps): React.JSX.Element {
  const [isBeautifying, setIsBeautifying] = useState(false)
  const initialLayoutStrategy: WorkflowDagLayoutStrategy = nodes.some(
    (node) => node.materialSource?.flowRole === 'primary_sample'
  )
    ? 'primary-sample-serpentine'
    : DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY
  const [layoutStrategy, setLayoutStrategy] =
    useState<WorkflowDagLayoutStrategy>(
      initialLayoutStrategy
    )
  const layoutStrategyInitializedRef = useRef(
    initialLayoutStrategy === 'primary-sample-serpentine'
  )
  const [swimlaneDirection, setSwimlaneDirection] =
    useState<WorkflowMaterialSwimlaneDirection>(
      DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION
    )
  const [supportingMaterialPresentation, setSupportingMaterialPresentation] =
    useState<WorkflowSupportingMaterialPresentation>('reaction-formula')
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set()
  )
  const [localVisibleMaterialRoles, setLocalVisibleMaterialRoles] = useState<
    readonly string[] | null
  >(null)
  const activeVisibleMaterialRoles = visibleMaterialRoles === undefined
    ? localVisibleMaterialRoles
    : visibleMaterialRoles
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null)
  const nodeDragOriginRef = useRef<{
    id: string
    x: number
    y: number
  } | null>(null)
  const beautifyTimerRef = useRef<
    ReturnType<typeof globalThis.setTimeout> | null
  >(null)
  const revealTimerRef = useRef<
    ReturnType<typeof globalThis.setTimeout> | null
  >(null)
  const groupSignature = useMemo(
    () => nodes
      .filter((node) => node.groupKind === 'subworkflow')
      .map((node) => `${node.id}:${node.compositeSignature || ''}`)
      .join('|'),
    [nodes]
  )
  useEffect(() => {
    setExpandedGroupIds(new Set())
  }, [groupSignature])
  useEffect(
    () => () => {
      if (beautifyTimerRef.current !== null) {
        globalThis.clearTimeout(beautifyTimerRef.current)
      }
      if (revealTimerRef.current !== null) {
        globalThis.clearTimeout(revealTimerRef.current)
      }
    },
    []
  )
  const materialTraceProjection = useMemo(
    () => projectMaterialTraces(nodes, links),
    [links, nodes]
  )
  const materialRoleOptions = useMemo(
    () => workflowMaterialRoleOptions(materialTraceProjection),
    [materialTraceProjection]
  )
  useEffect(() => {
    if (layoutStrategyInitializedRef.current) return
    if (!materialRoleOptions.some((option) =>
      option.value === 'primary_sample'
    )) return
    layoutStrategyInitializedRef.current = true
    setLayoutStrategy('primary-sample-serpentine')
  }, [materialRoleOptions])
  const materialRoleProjection = useMemo(
    () => filterWorkflowByMaterialRoles(
      nodes,
      links,
      activeVisibleMaterialRoles
        ? new Set(activeVisibleMaterialRoles)
        : null,
      materialTraceProjection
    ),
    [
      activeVisibleMaterialRoles,
      links,
      materialTraceProjection,
      nodes
    ]
  )
  const nestedProjection = useMemo(
    () => projectNestedWorkflow(
      materialRoleProjection.nodes,
      materialRoleProjection.links,
      expandedGroupIds
    ),
    [expandedGroupIds, materialRoleProjection]
  )
  const visibleSelectedNodeId = selectedNodeId === undefined
    ? undefined
    : selectedNodeId === null
      ? null
      : visibleNestedWorkflowNodeId(
          materialRoleProjection.nodes,
          nestedProjection.collapsedGroupIds,
          selectedNodeId
        )
  const visibleRevealNodeId = revealNodeRequest
    ? visibleNestedWorkflowNodeId(
        materialRoleProjection.nodes,
        nestedProjection.collapsedGroupIds,
        revealNodeRequest.nodeId
      )
    : null
  const [retainedRevealNodeId, setRetainedRevealNodeId] = useState<
    string | null
  >(null)
  useEffect(() => {
    if (visibleRevealNodeId) setRetainedRevealNodeId(visibleRevealNodeId)
  }, [revealNodeRequest?.nonce, visibleRevealNodeId])
  const highlightedNodeId = visibleSelectedNodeId ??
    visibleRevealNodeId ??
    retainedRevealNodeId
  const externalSelectionActive = visibleSelectedNodeId !== undefined ||
    highlightedNodeId !== null
  useEffect(() => {
    if (!activeVisibleMaterialRoles || materialRoleOptions.length === 0) return
    const availableRoles = new Set(
      materialRoleOptions.map((option) => option.value)
    )
    const nextRoles = activeVisibleMaterialRoles.filter((role) =>
      availableRoles.has(role)
    )
    if (
      layoutStrategy === 'primary-sample-serpentine' &&
      availableRoles.has('primary_sample') &&
      !nextRoles.includes('primary_sample')
    ) nextRoles.unshift('primary_sample')
    if (
      nextRoles.length === activeVisibleMaterialRoles.length &&
      nextRoles.every((role, index) =>
        role === activeVisibleMaterialRoles[index]
      )
    ) return
    const normalizedRoles = nextRoles.length === 0 ? null : nextRoles
    if (visibleMaterialRoles === undefined) {
      setLocalVisibleMaterialRoles(normalizedRoles)
    }
    onVisibleMaterialRolesChange?.(normalizedRoles)
  }, [
    activeVisibleMaterialRoles,
    layoutStrategy,
    materialRoleOptions,
    onVisibleMaterialRolesChange,
    visibleMaterialRoles
  ])
  const toggleGroup = useCallback((nodeId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])
  const { nodes: flowNodes, edges: flowEdges, onNodesChange, onEdgesChange } = useWorkflowDag(
    nestedProjection.nodes,
    nestedProjection.links,
    layoutStrategy,
    swimlaneDirection,
    supportingMaterialPresentation
  )
  // `canvasLayoutDirection` 是当前视觉投影的实际阅读方向；蛇形固定横向，
  // 物料泳道（Material Swimlane）才使用用户选择的方向。
  const canvasLayoutDirection: WorkflowMaterialSwimlaneDirection =
    layoutStrategy === 'primary-sample-serpentine'
      ? 'horizontal'
      : swimlaneDirection
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const visibleChanges = nodePositionMutationEnabled
        ? changes
        : visibleReadOnlyNodeChanges(changes)
      if (visibleChanges.length > 0) onNodesChange(visibleChanges)
    },
    [nodePositionMutationEnabled, onNodesChange]
  )
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const visibleChanges = visibleReadOnlyEdgeChanges(changes)
      if (visibleChanges.length > 0) onEdgesChange(visibleChanges)
    },
    [onEdgesChange]
  )
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  )
  const runtimeNodes = useMemo(
    () => flowNodes.map((node) => {
      if (node.type === 'wfReactionMaterial') {
        return { ...node, deletable: false }
      }
      const sourceNode = nodeById.get(node.id)
      const status = sourceNode?.groupKind === 'subworkflow'
        ? nestedGroupStatus(sourceNode, nodeStates)
        : nodeStates[node.id] || 'pending'
      const beforeStart = beforeStartNodeIds.has(node.id)
      const pausedBefore = pausedBeforeNodeId === node.id
      const startNode = startNodeId === node.id
      return {
        ...node,
        selected: !externalSelectionActive
          ? node.selected
          : node.id === highlightedNodeId,
        deletable: false,
        className: [
          node.className,
          `wf-flow-node--${status}`,
          beforeStart ? 'wf-flow-node--before-start' : '',
          startNode ? 'wf-flow-node--start' : '',
          pausedBefore ? 'wf-flow-node--paused-before' : '',
          breakpoints.has(node.id) ? 'wf-flow-node--breakpoint' : '',
          sourceNode?.disabled ? 'wf-flow-node--disabled' : '',
          highlightedNodeId === node.id
            ? 'wf-flow-node--source-selected'
            : '',
          retainedRevealNodeId === node.id || visibleRevealNodeId === node.id
            ? 'wf-flow-node--runtime-selected'
            : '',
          sourceNode?.groupKind === 'subworkflow'
            ? 'wf-flow-node--subworkflow'
            : ''
        ].filter(Boolean).join(' '),
        data: {
          ...node.data,
          color: beforeStart
            ? 'var(--unilab-color-skipped)'
            : pausedBefore
              ? 'var(--unilab-color-paused)'
              : status === 'success'
                ? 'var(--unilab-color-success)'
                : status === 'running'
                  ? 'var(--unilab-color-warning)'
                  : 'var(--unilab-color-text-subtle)',
          status,
          sourceSelected: highlightedNodeId === node.id,
          breakpoint: breakpoints.has(node.id),
          disabled: sourceNode?.disabled === true,
          startNode,
          beforeStart,
          pausedBefore,
          groupExpanded: expandedGroupIds.has(node.id),
          onToggleGroup: toggleGroup,
          onSetStart: sourceNode?.type === 'material_source'
            ? undefined
            : onSetStart,
          onToggleBreakpoint: sourceNode?.type === 'material_source'
            ? undefined
            : onToggleBreakpoint,
          onToggleDisabled: sourceNode?.authoringReadOnly
            ? undefined
            : onToggleDisabled
        }
      }
    }),
    [
      beforeStartNodeIds,
      breakpoints,
      externalSelectionActive,
      flowNodes,
      highlightedNodeId,
      expandedGroupIds,
      nodeById,
      nodeStates,
      onSetStart,
      onToggleBreakpoint,
      onToggleDisabled,
      pausedBeforeNodeId,
      retainedRevealNodeId,
      startNodeId,
      toggleGroup,
      visibleRevealNodeId
    ]
  )
  const scheduleCanvasNodeReveal = useCallback((
    instance: ReactFlowInstance,
    nodeId: string
  ): void => {
    if (revealTimerRef.current !== null) {
      globalThis.clearTimeout(revealTimerRef.current)
    }
    revealTimerRef.current = globalThis.setTimeout(() => {
      revealTimerRef.current = null
      const node = instance.getNode(nodeId)
      if (!node) return
      const width = node.width ?? 0
      const height = node.height ?? 0
      instance.setCenter(
        node.position.x + width / 2,
        node.position.y + height / 2,
        {
          zoom: Math.max(instance.getZoom(), 0.72),
          duration: 280
        }
      )
    }, 0)
  }, [])
  useEffect(() => {
    const instance = flowInstanceRef.current
    if (!instance || !visibleRevealNodeId) return
    scheduleCanvasNodeReveal(instance, visibleRevealNodeId)
  }, [
    revealNodeRequest?.nonce,
    scheduleCanvasNodeReveal,
    visibleRevealNodeId
  ])
  const runtimeEdges = useMemo(
    () => flowEdges.map((edge) => ({
      ...edge,
      deletable: false,
      className: [
        edge.className,
        beforeStartNodeIds.has(edge.source) ||
        beforeStartNodeIds.has(edge.target)
          ? 'wf-flow-edge--before-start'
          : ''
      ].filter(Boolean).join(' ')
    })),
    [beforeStartNodeIds, flowEdges]
  )
  const deletionSelection = useMemo(() => ({
    nodeUuids: flowNodes
      .filter((node) => node.selected)
      .map((node) => node.id),
    edgeUuids: flowEdges
      .filter((edge) => edge.selected)
      .map((edge) => edge.id)
  }), [flowEdges, flowNodes])
  const deletionSelectionCount = deletionSelection.nodeUuids.length +
    deletionSelection.edgeUuids.length
  const deletionDisabledReason = useMemo(() => {
    if (!canvasMutationEnabled) {
      return '代码模式下工作流画布只读；请切换到画布模式'
    }
    if (
      deletionSelection.nodeUuids.length === 0 &&
      deletionSelection.edgeUuids.length === 0
    ) return '请先选择允许编辑的节点或连线'
    for (const nodeUuid of deletionSelection.nodeUuids) {
      const sourceNode = nodeById.get(nodeUuid)
      if (sourceNode?.authoringReadOnly) {
        return sourceNode.authoringReadOnlyReason ||
          '复合工作流内部或系统节点只读，不能直接删除'
      }
    }
    for (const edgeUuid of deletionSelection.edgeUuids) {
      const edge = flowEdges.find((item) => item.id === edgeUuid)
      if (!edge) continue
      const sourceReason = nodeById.get(edge.source)?.authoringReadOnlyReason
      const targetReason = nodeById.get(edge.target)?.authoringReadOnlyReason
      if (sourceReason || targetReason) {
        return '复合工作流内部或系统节点的连线只读，不能直接删除'
      }
    }
    return null
  }, [
    canvasMutationEnabled,
    deletionSelection,
    flowEdges,
    nodeById
  ])
  /** 请求创作层删除当前选中的规范化节点与连线。 */
  const requestSelectedDeletion = useCallback((): void => {
    if (deletionDisabledReason || !onDeleteRequest) return
    onDeleteRequest(deletionSelection)
  }, [deletionDisabledReason, deletionSelection, onDeleteRequest])
  /**
   * 仅在用户明确请求时适应完整工作流（Workflow）视图。
   *
   * @returns 无返回值；不会在面板尺寸或节点选择变化时改写用户缩放。
   */
  const fitWorkflowView = useCallback((): void => {
    void flowInstanceRef.current?.fitView(WORKFLOW_FIT_VIEW_OPTIONS)
  }, [])
  const handleBeautify = useCallback(() => {
    if (!canBeautify || !onBeautify) return
    setIsBeautifying(true)
    onBeautify(layoutStrategy, swimlaneDirection)
    if (beautifyTimerRef.current !== null) {
      globalThis.clearTimeout(beautifyTimerRef.current)
    }
    beautifyTimerRef.current = globalThis.setTimeout(() => {
      setIsBeautifying(false)
      beautifyTimerRef.current = null
    }, 480)
  }, [canBeautify, layoutStrategy, onBeautify, swimlaneDirection])

  /**
   * 更新画布物料流角色（MaterialFlowRole）可见性投影。
   *
   * @param nextVisibleRoles 可见角色数组；null 表示全部可见。
   * @returns 无返回值；受控模式发布到跨面板交互所有者。
   */
  const handleVisibleMaterialRolesChange = useCallback((
    nextVisibleRoles: readonly string[] | null
  ): void => {
    if (visibleMaterialRoles === undefined) {
      setLocalVisibleMaterialRoles(nextVisibleRoles)
    }
    onVisibleMaterialRolesChange?.(nextVisibleRoles)
  }, [onVisibleMaterialRolesChange, visibleMaterialRoles])

  /**
   * 切换画布布局策略并立即刷新本地预览。
   *
   * @param event 布局策略下拉框的变更事件。
   * @returns 无返回值；主样品蛇形模式同时保证主样品保持可见。
   */
  const handleLayoutStrategyChange = useCallback((
    event: React.ChangeEvent<HTMLSelectElement>
  ): void => {
    const nextStrategy = event.target.value as WorkflowDagLayoutStrategy
    layoutStrategyInitializedRef.current = true
    setLayoutStrategy(nextStrategy)
    if (
      nextStrategy === 'primary-sample-serpentine' &&
      activeVisibleMaterialRoles &&
      !activeVisibleMaterialRoles.includes('primary_sample') &&
      materialRoleOptions.some((option) =>
        option.value === 'primary_sample'
      )
    ) {
      handleVisibleMaterialRolesChange([
        'primary_sample',
        ...activeVisibleMaterialRoles
      ])
    }
  }, [
    activeVisibleMaterialRoles,
    handleVisibleMaterialRolesChange,
    materialRoleOptions
  ])

  /**
   * 切换物料泳道的流向并立即刷新本地预览。
   *
   * @param direction 用户选择的纵向或横向物料泳道方向。
   * @returns 无返回值；只有点击“应用布局”才会写入工作流草稿。
   */
  const handleSwimlaneDirectionChange = useCallback((
    direction: WorkflowMaterialSwimlaneDirection
  ): void => {
    setSwimlaneDirection(direction)
  }, [])

  if (flowNodes.length === 0) {
    return (
      <p className="px-3.5 py-3 text-xs text-[var(--unilab-color-text-muted)]">
        当前工作流未定义节点，无法生成拓扑图
      </p>
    )
  }
  return (
    <div
      className={styles.dag}
      data-workflow-layout-strategy={layoutStrategy}
      data-workflow-layout-direction={canvasLayoutDirection}
      data-workflow-supporting-material-presentation={
        supportingMaterialPresentation
      }
      onKeyDownCapture={(event) => {
        if (
          event.key !== 'Delete' &&
          event.key !== 'Backspace'
        ) return
        if (!onDeleteRequest) return
        if (isTextEditingTarget(event.target)) return
        if (deletionDisabledReason) return
        event.preventDefault()
        event.stopPropagation()
        requestSelectedDeletion()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        const target = event.target
        if (!(target instanceof Element)) return
        const node = target.closest('.react-flow__node[data-id]')
        const nodeId = node?.getAttribute('data-id')
        if (!nodeId) return
        event.preventDefault()
        onNodeSelect(nodeId)
      }}
    >
      <ReactFlow
        className={[
          isBeautifying ? 'is-beautifying' : '',
          `wf-layout--${layoutStrategy}`,
          `wf-layout-direction--${canvasLayoutDirection}`
        ].filter(Boolean).join(' ')}
        nodes={runtimeNodes}
        edges={runtimeEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={(connection: Connection) => {
          if (
            !canvasMutationEnabled ||
            !connection.source ||
            !connection.sourceHandle ||
            !connection.target ||
            !connection.targetHandle
          ) return
          onConnectHandles?.({
            sourceNodeUuid: connection.source,
            sourceHandleUuid: connection.sourceHandle,
            targetNodeUuid: connection.target,
            targetHandleUuid: connection.targetHandle
          })
        }}
        nodeTypes={WORKFLOW_DAG_NODE_TYPES}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={WORKFLOW_FIT_VIEW_OPTIONS}
        minZoom={0.2}
        {...(
          canvasMutationEnabled
            ? CANVAS_EDIT_WORKFLOW_CANVAS
            : READ_ONLY_WORKFLOW_CANVAS
        )}
        nodesDraggable={nodePositionMutationEnabled}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          flowInstanceRef.current = instance
          if (visibleRevealNodeId) {
            scheduleCanvasNodeReveal(instance, visibleRevealNodeId)
          }
        }}
        onNodeClick={(_event, node: Node<WorkflowNodeData>) => {
          if (node.type === 'wfReactionMaterial') return
          setRetainedRevealNodeId((current) =>
            current === node.id ? current : null
          )
          onNodeSelect(node.id)
        }}
        onNodeDragStart={(_event, node: Node<WorkflowNodeData>) => {
          nodeDragOriginRef.current = {
            id: node.id,
            x: node.position.x,
            y: node.position.y
          }
        }}
        onNodeDragStop={(_event, node: Node<WorkflowNodeData>) => {
          if (!nodePositionMutationEnabled) return
          const origin = nodeDragOriginRef.current
          nodeDragOriginRef.current = null
          if (
            !origin ||
            origin.id !== node.id ||
            (origin.x === node.position.x && origin.y === node.position.y)
          ) return
          onNodePositionChange?.(node.id, node.position)
        }}
        onNodeContextMenu={(event, node: Node<WorkflowNodeData>) => {
          event.preventDefault()
          if (node.data.kind === 'material_source') return
          onSetStart?.(node.id)
        }}
        onNodeDoubleClick={(_event, node: Node<WorkflowNodeData>) => {
          if (node.data.kind === 'material_source') return
          onToggleBreakpoint?.(node.id)
        }}
      >
        <Background
          gap={24}
          size={0.75}
          color="var(--unilab-color-border-strong)"
        />
        <Controls showInteractive={false} showFitView={false} />
        <Panel position="top-right">
          <div
            className="workflow-runtime__layout-tools"
            role="toolbar"
            aria-label="画布视图与布局工具"
          >
            <div
              className="workflow-runtime__canvas-action-group"
              role="group"
              aria-label="视图与选择"
            >
              <WorkflowButton
                type="button"
                className="workflow-runtime__canvas-button workflow-runtime__fit-view"
                aria-label="适应完整工作流视图"
                title="适应完整工作流视图"
                disabledReason="工作流图尚未加载完成"
                onClick={fitWorkflowView}
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                  <path d="M7 3.5H3.5V7M13 3.5h3.5V7M7 16.5H3.5V13M13 16.5h3.5V13" />
                </svg>
                <span>适应视图</span>
              </WorkflowButton>
              {onDeleteRequest && (
                <WorkflowButton
                  type="button"
                  className="workflow-runtime__canvas-button workflow-runtime__delete-selection"
                  disabled={Boolean(deletionDisabledReason)}
                  disabledReason={deletionDisabledReason || ''}
                  aria-label={deletionSelectionCount > 0
                    ? `删除选中的 ${deletionSelectionCount} 项`
                    : '删除选中项'}
                  title={deletionSelectionCount > 0
                    ? `删除选中的 ${deletionSelectionCount} 项`
                    : undefined}
                  onClick={requestSelectedDeletion}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                    <path d="M4.5 6.5h11M8 6.5v-2h4v2M6.5 6.5l.6 9h5.8l.6-9M8.5 9v4M11.5 9v4" />
                  </svg>
                  <span>删除选中项</span>
                </WorkflowButton>
              )}
            </div>
            <div
              className="workflow-runtime__layout-control-group"
              role="group"
              aria-label="物料筛选与布局"
            >
              {materialRoleOptions.length > 0 && (
                <WorkflowMaterialVisibilityControl
                  options={materialRoleOptions}
                  visibleMaterialRoles={activeVisibleMaterialRoles}
                  primarySampleLocked={
                    layoutStrategy === 'primary-sample-serpentine'
                  }
                  onVisibleMaterialRolesChange={
                    handleVisibleMaterialRolesChange
                  }
                />
              )}
              {layoutStrategy === 'primary-sample-serpentine' && (
                <WorkflowSupportingMaterialPresentationControl
                  value={supportingMaterialPresentation}
                  onChange={setSupportingMaterialPresentation}
                />
              )}
              <label className="workflow-runtime__layout-strategy-field">
                <span aria-hidden="true">布局</span>
                <select
                  className="workflow-runtime__layout-strategy"
                  aria-label="布局策略"
                  value={layoutStrategy}
                  onChange={handleLayoutStrategyChange}
                >
                  {WORKFLOW_DAG_LAYOUT_STRATEGIES.map((strategy) => (
                    <option key={strategy.value} value={strategy.value}>
                      {strategy.label}
                    </option>
                  ))}
                </select>
              </label>
              {layoutStrategy === 'material-swimlanes' && (
                <div
                  className="workflow-runtime__swimlane-direction"
                  role="group"
                  aria-label="物料泳道方向"
                >
                  {WORKFLOW_MATERIAL_SWIMLANE_DIRECTIONS.map((direction) => (
                    <button
                      key={direction.value}
                      type="button"
                      className={swimlaneDirection === direction.value
                        ? 'is-active'
                        : undefined}
                      aria-pressed={swimlaneDirection === direction.value}
                      title={direction.description}
                      onClick={() => handleSwimlaneDirectionChange(
                        direction.value
                      )}
                    >
                      {direction.label}
                    </button>
                  ))}
                </div>
              )}
              {WORKFLOW_LAYOUT_APPLY_ACTION_VISIBLE && (
                <WorkflowButton
                  type="button"
                  className="workflow-runtime__beautify"
                  disabled={!canBeautify || isBeautifying}
                  disabledReason={isBeautifying
                    ? '正在应用工作流布局，请稍候'
                    : beautifyDisabledReason}
                  aria-busy={isBeautifying}
                  aria-label={layoutStrategy === 'material-swimlanes'
                    ? `应用${workflowMaterialSwimlaneDirectionLabel(
                        swimlaneDirection
                      )}物料泳道布局`
                    : `应用${workflowDagLayoutStrategyLabel(
                        layoutStrategy
                      )}布局`}
                  title={
                    canBeautify
                      ? WORKFLOW_DAG_LAYOUT_STRATEGIES.find(
                          (strategy) => strategy.value === layoutStrategy
                        )?.description
                      : beautifyDisabledReason
                  }
                  onClick={handleBeautify}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <path d="M5 6h14M5 12h9M5 18h6" />
                    <path d="m15.5 15.5 2 2 3-4" />
                  </svg>
                  <span>{isBeautifying ? '正在应用' : '应用布局'}</span>
                </WorkflowButton>
              )}
            </div>
          </div>
        </Panel>
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            node.type === 'wfReactionMaterial'
              ? 'transparent'
              : node.data?.color ?? 'var(--unilab-color-text-subtle)'
          }
        />
      </ReactFlow>
    </div>
  )
}

/**
 * 判断删除快捷键是否发生在需要保留原生文本编辑行为的控件内。
 *
 * @param target 键盘事件当前目标。
 * @returns 输入框、文本域、选择框或可编辑区域内返回 true。
 */
function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input, textarea, select, [contenteditable="true"]'
  ))
}

function nestedGroupStatus(
  node: WorkflowNode,
  nodeStates: Readonly<Record<string, string>>
): string {
  const statuses = [node.id, ...(node.descendantNodeIds || [])]
    .map((nodeId) => nodeStates[nodeId])
    .filter((status): status is string => Boolean(status))
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('reconciling')) return 'reconciling'
  if (statuses.includes('running')) return 'running'
  if (statuses.includes('cancelled')) return 'cancelled'
  if (
    statuses.length > 0 &&
    statuses.every((status) => ['success', 'skipped'].includes(status))
  ) {
    return 'success'
  }
  return nodeStates[node.id] || 'pending'
}
