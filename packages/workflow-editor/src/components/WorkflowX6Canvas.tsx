import type {
  Cell,
  Graph,
  Scroller,
  Edge,
  NodeProperties,
  EdgeProperties
} from '@antv/x6'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'

import type { WorkflowNodeData } from './WorkflowNodeCard'
import { isReadyHandle } from './WorkflowNodeCard'
import {
  WORKFLOW_X6_INPUT_PORT_ID,
  WORKFLOW_X6_OUTPUT_PORT_ID,
  workflowX6EdgeMetadata,
  workflowX6NodeMetadata,
  type WorkflowX6Edge,
  type WorkflowX6Node
} from './workflowX6Projection'
import { isResourceSlotHandle } from '../utils/workflowMaterialTrace'
import type {
  WorkflowCanvasPoint,
  WorkflowCanvasViewport,
  WorkflowHandleConnection,
  WorkflowHandleConnectionResult
} from '../utils/workflowCanvasCommands'

const LARGE_GRAPH_MINIMAP_LIMIT = 2_000

export type { WorkflowX6Edge, WorkflowX6Node } from './workflowX6Projection'

export interface WorkflowX6CanvasHandle {
  fit(): void
  zoomIn(): void
  zoomOut(): void
  revealNode(nodeId: string): void
  clientToCanvasPoint(clientX: number, clientY: number): WorkflowCanvasPoint | null
  viewportCenter(): WorkflowCanvasPoint | null
  viewportSnapshot(): WorkflowCanvasViewport | null
  restoreViewport(viewport: WorkflowCanvasViewport): void
}

export interface WorkflowX6CanvasProps {
  nodes: readonly WorkflowX6Node[]
  edges: readonly WorkflowX6Edge[]
  canvasMutationEnabled: boolean
  nodePositionMutationEnabled: boolean
  onNodeSelect(nodeId: string): void
  onNodePositionChange?: (
    nodeId: string,
    position: { x: number; y: number }
  ) => void
  onNodePositionsChange?: (
    changes: ReadonlyArray<{ nodeId: string; position: { x: number; y: number } }>
  ) => void
  onNodeParentChange?: (
    nodeId: string,
    loopId: string | null,
    position: { x: number; y: number }
  ) => void
  onConnectHandles?: (
    connection: WorkflowHandleConnection
  ) => WorkflowHandleConnectionResult
  onConnectConditionBranch?: (
    conditionNodeId: string,
    branchIndex: number,
    targetNodeId: string
  ) => WorkflowHandleConnectionResult
  onConnectConditionPredecessor?: (
    sourceNodeId: string,
    conditionNodeId: string
  ) => WorkflowHandleConnectionResult
  onSelectionChange(selection: {
    nodeUuids: string[]
    edgeUuids: string[]
  }): void
  onSetStart?: (nodeId: string) => void
  onToggleBreakpoint?: (nodeId: string) => void
  onToggleGroup?: (nodeId: string) => void
  onAddNodeToLoop?: (nodeId: string) => void
  onOpenChildWorkflow?: (workflowUuid: string, workflowName: string) => void
}

/**
 * 以 X6 3.x 渲染工作流（Workflow）画布，并对大图启用虚拟可见区。
 *
 * @param props 规范化布局投影、编辑权限和稳定 ID 交互回调。
 * @param forwardedRef 供上层执行适应视图和定位节点的窄命令接口。
 * @returns X6 SVG 画布、滚动器、缩放控制和按规模降级的缩略图容器。
 * @safety 画布只投影 Canonical Workflow；连接和移动必须回调创作层后才持久化。
 */
export const WorkflowX6Canvas = forwardRef<
  WorkflowX6CanvasHandle,
  WorkflowX6CanvasProps
>(function WorkflowX6Canvas({
  nodes,
  edges,
  canvasMutationEnabled,
  nodePositionMutationEnabled,
  onNodeSelect,
  onNodePositionChange,
  onNodePositionsChange,
  onNodeParentChange,
  onConnectHandles,
  onConnectConditionBranch,
  onConnectConditionPredecessor,
  onSelectionChange,
  onSetStart,
  onToggleBreakpoint,
  onToggleGroup,
  onAddNodeToLoop,
  onOpenChildWorkflow
}, forwardedRef): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const minimapRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<Graph | null>(null)
  const scrollerRef = useRef<Scroller | null>(null)
  const projectionRef = useRef({ nodes, edges })
  const appliedProjectionRef = useRef<WorkflowX6ProjectionSnapshot>({
    nodes: [],
    edges: []
  })
  const callbacksRef = useRef({
    canvasMutationEnabled,
    nodePositionMutationEnabled,
    onNodeSelect,
    onNodePositionChange,
    onNodePositionsChange,
    onNodeParentChange,
    onConnectHandles,
    onConnectConditionBranch,
    onConnectConditionPredecessor,
    onSelectionChange,
    onSetStart,
    onToggleBreakpoint,
    onToggleGroup,
    onAddNodeToLoop,
    onOpenChildWorkflow
  })
  const initialFitPendingRef = useRef(true)
  const nodeDraggingRef = useRef(false)
  const loopDragRef = useRef<{
    nodeId: string
    start: { x: number; y: number }
    origin: { x: number; y: number }
  } | null>(null)

  callbacksRef.current = {
    canvasMutationEnabled,
    nodePositionMutationEnabled,
    onNodeSelect,
    onNodePositionChange,
    onNodePositionsChange,
    onNodeParentChange,
    onConnectHandles,
    onConnectConditionBranch,
    onConnectConditionPredecessor,
    onSelectionChange,
    onSetStart,
    onToggleBreakpoint,
    onToggleGroup,
    onAddNodeToLoop,
    onOpenChildWorkflow
  }
  projectionRef.current = { nodes, edges }

  useImperativeHandle(forwardedRef, () => ({
    fit: () => {
      const scroller = scrollerRef.current
      if (scroller) scroller.zoomToFit({ padding: 56, maxScale: 1.2 })
      else graphRef.current?.zoomToFit({ padding: 56, maxScale: 1.2 })
    },
    zoomIn: () => {
      const scroller = scrollerRef.current
      const graph = graphRef.current
      if (scroller) {
        scroller.zoom(0.1, { maxScale: 1.5 })
      } else {
        graph?.zoom(0.1, { maxScale: 1.5 })
      }
    },
    zoomOut: () => {
      const scroller = scrollerRef.current
      const graph = graphRef.current
      if (scroller) {
        scroller.zoom(-0.1, { minScale: 0.02 })
      } else {
        graph?.zoom(-0.1, { minScale: 0.02 })
      }
    },
    revealNode: (nodeId) => {
      const graph = graphRef.current
      const cell = graph?.getCellById(nodeId)
      if (!graph || !cell?.isNode()) return
      const currentZoom = scrollerRef.current?.zoom() ?? graph.zoom()
      if (currentZoom < 0.72) {
        scrollerRef.current?.zoomTo(0.72)
        if (!scrollerRef.current) graph.zoomTo(0.72)
      }
      scrollerRef.current?.centerCell(cell)
      if (!scrollerRef.current) graph.centerCell(cell)
    },
    clientToCanvasPoint: (clientX, clientY) => {
      const graph = graphRef.current
      if (!graph) return null
      const point = graph.clientToLocal(clientX, clientY)
      return { x: point.x, y: point.y }
    },
    viewportCenter: () => {
      const container = rootRef.current
      const graph = graphRef.current
      if (!container || !graph) return null
      const bounds = container.getBoundingClientRect()
      const point = graph.clientToLocal(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )
      return { x: point.x, y: point.y }
    },
    viewportSnapshot: () => {
      const container = rootRef.current
      const graph = graphRef.current
      if (!container || !graph) return null
      const bounds = container.getBoundingClientRect()
      const center = graph.clientToLocal(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )
      return {
        center: { x: center.x, y: center.y },
        zoom: scrollerRef.current?.zoom() ?? graph.zoom()
      }
    },
    restoreViewport: (viewport) => {
      const graph = graphRef.current
      if (!graph) return
      const scroller = scrollerRef.current
      if (scroller) {
        scroller.zoomTo(viewport.zoom)
        scroller.centerPoint(viewport.center.x, viewport.center.y)
      } else {
        graph.zoomTo(viewport.zoom)
        graph.centerPoint(viewport.center.x, viewport.center.y)
      }
    }
  }), [])

  useEffect(() => {
    const container = containerRef.current
    const root = rootRef.current
    if (!container || !root) return
    let disposed = false
    let cleanup: (() => void) | undefined
    void import('@antv/x6').then(({
      Graph,
      Path,
      MiniMap,
      Scroller,
      Selection
    }) => {
      if (disposed) return
      Graph.registerConnector('workflow-gentle', (source, target, _route, options) => {
        // Short outward tangents keep handles visible without a large detour.
        const reach = Math.max(24, Math.min(64, Math.abs(target.x - source.x) / 3))
        const path = new Path()
        path.appendSegment(Path.createSegment('M', source.x, source.y))
        path.appendSegment(Path.createSegment(
          'C', source.x + reach, source.y, target.x - reach, target.y, target.x, target.y
        ))
        return options.raw ? path : path.serialize()
      }, true)
    let graph!: Graph
    graph = new Graph({
      container,
      async: false,
      virtual: { enabled: projectionRef.current.nodes.length > LARGE_GRAPH_MINIMAP_LIMIT, margin: 480 },
      background: { color: 'transparent' },
      grid: {
        visible: true,
        size: 24,
        type: 'dot',
        args: {
          color: 'var(--unilab-color-border-strong)',
          thickness: 0.75
        }
      },
      scaling: { min: 0.02, max: 1.5 },
      // Keep canvas panning available even when node editing is disabled.
      // The Scroller plugin takes ownership after initialization, while this
      // fallback keeps the management/read-only canvas draggable as well.
      panning: { enabled: true },
      mousewheel: {
        enabled: true,
        modifiers: ['ctrl', 'meta'],
        zoomAtMousePosition: true
      },
      interacting: {
        nodeMovable: () => callbacksRef.current.nodePositionMutationEnabled,
        edgeMovable: false,
        edgeLabelMovable: false,
        arrowheadMovable: false,
        vertexMovable: false,
        vertexAddable: false,
        vertexDeletable: false
      },
      embedding: {
        enabled: true,
        findParent: 'center',
        frontOnly: false,
        validate: ({ child, parent }) => {
          if (!callbacksRef.current.canvasMutationEnabled) return false
          const childData = child.getData<WorkflowNodeData>()
          const parentData = parent.getData<WorkflowNodeData>()
          return parentData?.controlFlow?.kind === 'repeat_until' &&
            childData?.controlFlow == null && child.id !== parent.id
        }
      },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        allowNode: false,
        allowEdge: false,
        allowPort: () => callbacksRef.current.canvasMutationEnabled &&
          Boolean(
            callbacksRef.current.onConnectHandles ||
            callbacksRef.current.onConnectConditionBranch
          ),
        snap: { radius: 24 },
        highlight: true,
        router: { name: 'normal' },
        connector: { name: 'workflow-gentle' },
        // Connect directly to the port anchor so the curve meets the
        // visible handle instead of stopping at the node boundary.
        connectionPoint: { name: 'anchor' },
        createEdge: (): Edge => graph.createEdge(workflowX6EdgeMetadata({
          id: globalThis.crypto.randomUUID(),
          source: '',
          target: ''
        }))
      }
    })
    const scroller = new Scroller({
      enabled: true,
      pannable: {
        enabled: true,
        eventTypes: ['leftMouseDown', 'rightMouseDown']
      },
      modifiers: [],
      autoResize: false,
      minVisibleWidth: 180,
      minVisibleHeight: 120,
      padding: 72
    })
    const selection = new Selection({
      enabled: true,
      multiple: true,
      rubberband: true,
      modifiers: ['shift'],
      movable: false,
      showNodeSelectionBox: true,
      showEdgeSelectionBox: true
    })
    graph.use(scroller)
    graph.use(selection)
    if (minimapRef.current) {
      graph.use(new MiniMap({
        container: minimapRef.current,
        width: 164,
        height: 108,
        padding: 8,
        scalable: true,
        minScale: 0.01,
        maxScale: 0.35,
        graphOptions: { virtual: false, async: false }
      }))
    }

    // X6 delegates SVG child clicks to the parent node. Capture the loop
    // action at the DOM boundary so the add affordance remains clickable
    // across X6 versions and zoom levels.
    const handleLoopAddClick = (event: Event): void => {
      const target = event.target as Element | null
      const action = target?.closest?.('.workflow-x6-loop-add-node')
      if (!action) return
      const nodeId = action.closest('.x6-node')?.getAttribute('data-cell-id')
      if (!nodeId) return
      event.preventDefault()
      event.stopPropagation()
      callbacksRef.current.onAddNodeToLoop?.(nodeId)
    }
    // Some X6 versions stop the native click after dispatching the parent
    // node event. Capture the pointer gesture too so the loop affordance
    // cannot be swallowed by node selection.
    const handleLoopAddPointerDown = (event: Event): void => {
      const target = event.target as Element | null
      if (!target?.closest?.('.workflow-x6-loop-add-node')) return
      handleLoopAddClick(event)
    }
    root.addEventListener('pointerdown', handleLoopAddPointerDown, true)
    root.addEventListener('click', handleLoopAddClick, true)

    graph.on('node:click', ({ e, node }) => {
      const data = node.getData<WorkflowNodeData>()
      if (data?.kind === 'reaction_material') return
      callbacksRef.current.onNodeSelect(node.id)
      const target = e?.target as Element | null
      if (
        target?.getAttribute?.('data-selector') === 'loopAddNode' ||
        target?.getAttribute?.('data-selector') === 'loopAddNodeButton' ||
        target?.closest?.('.workflow-x6-loop-add-node')
      ) {
        e?.stopPropagation?.()
        callbacksRef.current.onAddNodeToLoop?.(node.id)
        return
      }
      if (data?.groupKind !== 'subworkflow') return
      // 点击“N 个内部节点”计数行 → 就地展开/收起；点击卡片其它区域 → 跳转实验操作调试。
      const countTarget = e?.target as Element | null
      const onCountRow = Boolean(
        countTarget?.closest?.('.workflow-x6-node__group-count')
      )
      if (onCountRow) {
        callbacksRef.current.onToggleGroup?.(node.id)
        return
      }
      if (data.openChildWorkflowUuid && callbacksRef.current.onOpenChildWorkflow) {
        callbacksRef.current.onOpenChildWorkflow(
          data.openChildWorkflowUuid,
          data.name
        )
      }
    })
    /* Delegate hover handling to the rendered X6 DOM. Virtual cells are mounted
    // asynchronously, so model-level events alone can miss a short-lived node.
    const nodeElementFromTarget = (
      target: EventTarget | null
    ): Element | null => {
      if (!(target instanceof Element)) return null
      const nodeElement = target.closest(
        '.x6-node[data-workflow-node-overflow="true"]'
      )
      return nodeElement && root.contains(nodeElement) ? nodeElement : null
    }
    const updateNodeTooltip = (event: PointerEvent): void => {
      const nodeElement = nodeElementFromTarget(event.target)
      if (!nodeElement) {
        setNodeTooltip(null)
        return
      }
      const text = nodeElement.getAttribute('data-workflow-node-tooltip') ||
        nodeElement.getAttribute('title')
      const nodeId = nodeElement.getAttribute('data-cell-id')
      if (!text || !nodeId) {
        setNodeTooltip(null)
        return
      }
      setNodeTooltip({
        nodeId,
        text,
        ...workflowX6NodeTooltipPosition(event.clientX, event.clientY)
      })
    }
    const handleNodePointerOver = (event: PointerEvent): void => {
      const nodeElement = nodeElementFromTarget(event.target)
      const related = event.relatedTarget
      if (
        nodeElement &&
        related instanceof Element &&
        nodeElement.contains(related)
      ) return
      updateNodeTooltip(event)
    }
    const handleNodePointerMove = (event: PointerEvent): void => {
      if (nodeElementFromTarget(event.target)) updateNodeTooltip(event)
    }
    const handleNodePointerOut = (event: PointerEvent): void => {
      const nodeElement = nodeElementFromTarget(event.target)
      const related = event.relatedTarget
      if (
        nodeElement &&
        related instanceof Element &&
        nodeElement.contains(related)
      ) return
      setNodeTooltip(null)
    }
    root.addEventListener('pointerover', handleNodePointerOver)
    root.addEventListener('pointermove', handleNodePointerMove)
    root.addEventListener('pointerout', handleNodePointerOut) */
    graph.on('node:contextmenu', ({ e, node }) => {
      e.preventDefault()
      const data = node.getData<WorkflowNodeData>()
      if (data?.kind === 'material_source') return
      callbacksRef.current.onSetStart?.(node.id)
    })
    graph.on('node:dblclick', ({ node }) => {
      const data = node.getData<WorkflowNodeData>()
      if (data?.groupKind === 'subworkflow') {
        callbacksRef.current.onToggleGroup?.(node.id)
        return
      }
      if (data?.kind === 'material_source') return
      callbacksRef.current.onToggleBreakpoint?.(node.id)
    })
    let dragFrame: number | null = null
    const refreshDraggedConnections = (node: import('@antv/x6').Node): void => {
      graph.findViewByCell(node)?.cleanCache()
      for (const edge of graph.getConnectedEdges(node)) {
        const view = graph.findViewByCell(edge)
        if (view?.isEdgeView()) {
          view.updateTerminalProperties('source')
          view.updateTerminalProperties('target')
          view.update()
        }
      }
    }
    // X6 的 embedding 会把循环体动作委托给父节点，某些版本在父节点
    // 已有子节点后不再触发父容器的拖动事件。循环容器使用独立的指针
    // 手势，仍按 X6 的 deep position 同步移动全部循环体成员。
    const handleLoopPointerDown = (event: PointerEvent): void => {
      if (!callbacksRef.current.nodePositionMutationEnabled) return
      const target = event.target as Element | null
      if (!target || target.closest('.workflow-x6-loop-add-node')) return
      const nodeElement = target.closest('.x6-node')
      const nodeId = nodeElement?.getAttribute('data-cell-id')
      if (!nodeId) return
      const node = graph.getCellById(nodeId)
      if (!node?.isNode()) return
      const data = node.getData<WorkflowNodeData>()
      if (data?.controlFlow?.kind !== 'repeat_until') return
      const point = graph.clientToLocal(event.clientX, event.clientY)
      loopDragRef.current = {
        nodeId,
        start: { x: point.x, y: point.y },
        origin: node.position()
      }
      nodeDraggingRef.current = true
      event.preventDefault()
      event.stopPropagation()
    }
    const handleLoopPointerMove = (event: PointerEvent): void => {
      const drag = loopDragRef.current
      if (!drag) return
      const node = graph.getCellById(drag.nodeId)
      if (!node?.isNode()) return
      const point = graph.clientToLocal(event.clientX, event.clientY)
      node.position(
        drag.origin.x + point.x - drag.start.x,
        drag.origin.y + point.y - drag.start.y,
        { deep: true, ui: true }
      )
      refreshDraggedConnections(node)
      event.preventDefault()
      event.stopPropagation()
    }
    const handleLoopPointerUp = (event: PointerEvent): void => {
      const drag = loopDragRef.current
      if (!drag) return
      loopDragRef.current = null
      nodeDraggingRef.current = false
      const node = graph.getCellById(drag.nodeId)
      if (node?.isNode() && callbacksRef.current.nodePositionMutationEnabled) {
        const changes = [node, ...node.getChildren().filter(cell => cell.isNode())]
          .map(cell => ({ nodeId: cell.id, position: cell.position() }))
        callbacksRef.current.onNodePositionsChange?.(changes)
      }
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('pointerdown', handleLoopPointerDown, true)
    document.addEventListener('pointermove', handleLoopPointerMove, true)
    document.addEventListener('pointerup', handleLoopPointerUp, true)
    document.addEventListener('pointercancel', handleLoopPointerUp, true)
    graph.on('node:moving', ({ node }) => {
      if (dragFrame !== null) cancelAnimationFrame(dragFrame)
      dragFrame = requestAnimationFrame(() => {
        dragFrame = null
        refreshDraggedConnections(node)
      })
    })
    graph.on('node:move', ({ node }) => {
      nodeDraggingRef.current = true
      // 动作节点上残留的 X6 父子会让“拖这个、另一个跟着走”。
      detachUnexpectedWorkflowX6EmbedChildren(node)
    })
    graph.on('node:moved', ({ node }) => {
      if (dragFrame !== null) cancelAnimationFrame(dragFrame)
      dragFrame = null
      refreshDraggedConnections(node)
      nodeDraggingRef.current = false
      if (!callbacksRef.current.nodePositionMutationEnabled) return
      const data = node.getData<WorkflowNodeData>()
      if (data?.controlFlow?.kind === 'repeat_until') {
        const changes = [node, ...node.getChildren().filter((cell) => cell.isNode())]
          .map((cell) => ({ nodeId: cell.id, position: cell.position() }))
        if (callbacksRef.current.onNodePositionsChange) {
          callbacksRef.current.onNodePositionsChange(changes)
          return
        }
      }
      const liveParent = node.getParent()
      const liveParentIsLoop = liveParent?.isNode() &&
        liveParent.getData<WorkflowNodeData>()?.controlFlow?.kind === 'repeat_until'
      // 只在真正改 Loop 归属时交给 node:embedded；条件 parent_uuid 不是 X6 父节点。
      if (liveParentIsLoop && (data?.parentGroupId ?? '') !== liveParent.id) return
      callbacksRef.current.onNodePositionChange?.(node.id, node.position())
    })
    graph.on('node:embedded', ({ node, currentParent, previousParent }) => {
      if (!callbacksRef.current.canvasMutationEnabled) return
      const currentData = currentParent?.getData<WorkflowNodeData>()
      const previousData = previousParent?.getData<WorkflowNodeData>()
      const loopId = currentData?.controlFlow?.kind === 'repeat_until'
        ? currentParent!.id
        : null
      if (!loopId) {
        if (currentParent?.isNode()) {
          node.removeFromParent({ ui: false })
        }
        if (previousData?.controlFlow?.kind === 'repeat_until') {
          callbacksRef.current.onNodeParentChange?.(
            node.id,
            null,
            node.position()
          )
        }
        return
      }
      callbacksRef.current.onNodeParentChange?.(node.id, loopId, node.position())
    })
    graph.on('edge:connected', ({ edge, isNew }) => {
      if (!isNew) return
      const sourceNodeUuid = edge.getSourceCellId()
      const sourcePortId = edge.getSourcePortId()
      const targetNodeUuid = edge.getTargetCellId()
      const targetPortId = edge.getTargetPortId()
      // X6 交互边永远只是临时手势；Canonical 草稿接受后会重新投影稳定边。
      graph.removeCell(edge, { ui: false })
      if (
        !callbacksRef.current.canvasMutationEnabled ||
        !sourceNodeUuid || !targetNodeUuid ||
        targetPortId !== WORKFLOW_X6_INPUT_PORT_ID
      ) return
      const conditionPort = /^workflow-condition-branch-(\d+)$/.exec(
        sourcePortId || ''
      )
      if (conditionPort) {
        callbacksRef.current.onConnectConditionBranch?.(
          sourceNodeUuid,
          Number(conditionPort[1]),
          targetNodeUuid
        )
        return
      }
      const targetNode = projectionRef.current.nodes.find(node => node.id === targetNodeUuid)
      if (sourcePortId === WORKFLOW_X6_OUTPUT_PORT_ID && targetNode?.data.controlFlow?.kind === 'condition') {
        onConnectConditionPredecessor?.(sourceNodeUuid, targetNodeUuid)
        return
      }
      if (sourcePortId !== WORKFLOW_X6_OUTPUT_PORT_ID) return
      const connect = callbacksRef.current.onConnectHandles
      if (!connect) return
      const candidates = workflowX6HandleConnectionCandidates(
        projectionRef.current.nodes,
        projectionRef.current.edges,
        sourceNodeUuid,
        targetNodeUuid
      )
      for (const connection of candidates.slice(0, 12)) {
        if (connect(connection).accepted) break
      }
    })
    graph.on('selection:changed', ({ selected }) => {
      callbacksRef.current.onSelectionChange({
        nodeUuids: selected.filter(cell => cell.isNode()).map(cell => cell.id),
        edgeUuids: selected.filter(cell => cell.isEdge()).map(cell => cell.id)
      })
    })
    graphRef.current = graph
    scrollerRef.current = scroller

    const resize = new ResizeObserver(() => {
      // Scroller 会改写内部 graph container；外层壳才是可见视口尺寸权威。
      const rect = root.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      graph.resize(rect.width, rect.height)
      scroller.resize(rect.width, rect.height)
    })
    resize.observe(root)
    syncWorkflowX6Projection(
      graph,
      scroller,
      projectionRef.current.nodes,
      projectionRef.current.edges,
      initialFitPendingRef,
      appliedProjectionRef
    )
    cleanup = () => {
      if (dragFrame !== null) cancelAnimationFrame(dragFrame)
      loopDragRef.current = null
      document.removeEventListener('pointerdown', handleLoopPointerDown, true)
      document.removeEventListener('pointermove', handleLoopPointerMove, true)
      document.removeEventListener('pointerup', handleLoopPointerUp, true)
      document.removeEventListener('pointercancel', handleLoopPointerUp, true)
      root.removeEventListener('pointerdown', handleLoopAddPointerDown, true)
      root.removeEventListener('click', handleLoopAddClick, true)
      resize.disconnect()
      graph.dispose()
      graphRef.current = null
      scrollerRef.current = null
    }
    }).catch((error: unknown) => {
      if (disposed) return
      container.dataset.x6Error = 'true'
      container.textContent = error instanceof Error
        ? `X6 画布加载失败：${error.message}`
        : 'X6 画布加载失败'
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph || nodeDraggingRef.current) return
    syncWorkflowX6Projection(
      graph,
      scrollerRef.current,
      nodes,
      edges,
      initialFitPendingRef,
      appliedProjectionRef
    )
    const frame = requestAnimationFrame(() => {
      for (const edge of graph.getEdges()) {
        const view = graph.findViewByCell(edge)
        if (!view?.isEdgeView()) continue
        view.updateTerminalProperties('source')
        view.updateTerminalProperties('target')
        view.update()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [edges, nodes])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    if (nodes.length > LARGE_GRAPH_MINIMAP_LIMIT) {
      if (graph.getPlugin('minimap')) graph.disposePlugins('minimap')
      return
    }
    const container = minimapRef.current
    if (!container || graph.getPlugin('minimap')) return
    let disposed = false
    void import('@antv/x6').then(({ MiniMap }) => {
      if (disposed || graph.getPlugin('minimap')) return
      graph.use(new MiniMap({
        container,
        width: 164,
        height: 108,
        padding: 8,
        scalable: true,
        minScale: 0.01,
        maxScale: 0.35,
        graphOptions: { virtual: false, async: false }
      }))
    })
    return () => {
      disposed = true
    }
  }, [nodes.length])

  return (
    <div
      ref={rootRef}
      className="workflow-x6"
      data-canvas-engine="x6"
      data-x6-node-count={nodes.length}
      data-x6-edge-count={edges.length}
      data-x6-virtual="true"
      data-x6-animations={nodes.length > LARGE_GRAPH_MINIMAP_LIMIT
        ? 'reduced'
        : 'enabled'}
    >
      <div ref={containerRef} className="workflow-x6__viewport" />
      {nodes.length <= LARGE_GRAPH_MINIMAP_LIMIT ? (
        <div
          ref={minimapRef}
          className="workflow-x6__minimap"
          aria-label="工作流缩略图"
        />
      ) : (
        <div className="workflow-x6__large-graph" role="status">
          X6 虚拟画布 · {nodes.length.toLocaleString()} 个节点
        </div>
      )}
    </div>
  )
})

interface RankedWorkflowHandleConnection {
  connection: WorkflowHandleConnection
  occupied: boolean
  semanticMismatch: boolean
  semanticPriority: number
  valueTypeMismatch: boolean
  sourceIndex: number
  targetIndex: number
}

/**
 * 把节点级左右端口手势解析为真实 Canonical Handle UUID 组合。
 *
 * X6 不再渲染服务端 Handle 数量；此函数只读取同一 Canonical 投影，优先选择
 * 未占用、语义相同且类型相同的输入输出，最终兼容性仍由创作命令权威校验。
 */
export function workflowX6HandleConnectionCandidates(
  nodes: readonly WorkflowX6Node[],
  edges: readonly WorkflowX6Edge[],
  sourceNodeUuid: string,
  targetNodeUuid: string
): WorkflowHandleConnection[] {
  const sourceHandles = nodes.find(node => node.id === sourceNodeUuid)
    ?.data.handles?.filter(handle => handle.ioType === 'source') ?? []
  const targetHandles = nodes.find(node => node.id === targetNodeUuid)
    ?.data.handles?.filter(handle => handle.ioType === 'target') ?? []
  const occupiedTargets = new Set(edges.flatMap(edge => {
    if (edge.target !== targetNodeUuid) return []
    const handleUuid = edge.data?.targetHandleUuid || edge.targetHandle
    return handleUuid ? [handleUuid] : []
  }))
  const ranked: RankedWorkflowHandleConnection[] = []
  sourceHandles.forEach((sourceHandle, sourceIndex) => {
    targetHandles.forEach((targetHandle, targetIndex) => {
      const sourceKind = workflowHandleSemanticKind(sourceHandle)
      const targetKind = workflowHandleSemanticKind(targetHandle)
      // 执行顺序（ready）连接点只承载先后关系，OS 永远拒绝它与数据连接点混连；
      // 节点级手势不得把它降级成“先试数据输入”的候选。
      if ((sourceKind === 'ready') !== (targetKind === 'ready')) return
      ranked.push({
        connection: {
          sourceNodeUuid,
          sourceHandleUuid: sourceHandle.uuid,
          targetNodeUuid,
          targetHandleUuid: targetHandle.uuid
        },
        // 已占用的执行顺序输入仍是合法候选（允许多路汇入），只是优先级更低。
        occupied: occupiedTargets.has(targetHandle.uuid),
        semanticMismatch: sourceKind !== targetKind,
        semanticPriority: workflowHandleSemanticPriority(sourceKind),
        valueTypeMismatch: Boolean(
          sourceHandle.valueType && targetHandle.valueType &&
          sourceHandle.valueType !== targetHandle.valueType
        ),
        sourceIndex,
        targetIndex
      })
    })
  })
  return ranked.sort((left, right) =>
    Number(left.occupied) - Number(right.occupied) ||
    Number(left.semanticMismatch) - Number(right.semanticMismatch) ||
    left.semanticPriority - right.semanticPriority ||
    Number(left.valueTypeMismatch) - Number(right.valueTypeMismatch) ||
    left.sourceIndex - right.sourceIndex ||
    left.targetIndex - right.targetIndex
  ).map(item => item.connection)
}

function workflowHandleSemanticPriority(
  kind: ReturnType<typeof workflowHandleSemanticKind>
): number {
  if (kind === 'ready') return 0
  if (kind === 'material') return 1
  return 2
}

function workflowHandleSemanticKind(
  handle: NonNullable<WorkflowNodeData['handles']>[number]
): 'ready' | 'material' | 'value' {
  if (isReadyHandle(handle)) return 'ready'
  if (isResourceSlotHandle(handle)) return 'material'
  return 'value'
}

/**
 * 在一个 X6 批处理中替换当前 Canonical Workflow 投影并恢复选择。
 *
 * @param graph 已挂载插件的 X6 图实例。
 * @param scroller 当前图的滚动器；未挂载时仅跳过首次适配。
 * @param nodes 当前可见工作流节点投影。
 * @param edges 当前可见工作流边投影。
 * @param initialFitPending 是否仍需执行唯一一次自动适应视图。
 * @returns 无返回值；更新只发生在 X6 视图模型，不写回工作流文档。
 * @safety Canonical Workflow 仍是唯一状态源，X6 JSON 不参与持久化。
 */
interface WorkflowX6ProjectionSnapshot {
  nodes: readonly WorkflowX6Node[]
  edges: readonly WorkflowX6Edge[]
}

export interface WorkflowX6ProjectionDiff {
  addNodeIds: string[]
  updateNodeIds: string[]
  removeNodeIds: string[]
  addEdgeIds: string[]
  updateEdgeIds: string[]
  removeEdgeIds: string[]
}

/** 以稳定 UUID 和可序列化投影内容计算最小 X6 Cell 变更集。 */
export function workflowX6ProjectionDiff(
  previous: WorkflowX6ProjectionSnapshot,
  next: WorkflowX6ProjectionSnapshot
): WorkflowX6ProjectionDiff {
  const previousNodes = projectionFingerprintIndex(previous.nodes)
  const nextNodes = projectionFingerprintIndex(next.nodes)
  const previousEdges = projectionFingerprintIndex(previous.edges)
  const nextEdges = projectionFingerprintIndex(next.edges)
  return {
    addNodeIds: addedProjectionIds(previousNodes, nextNodes),
    updateNodeIds: updatedProjectionIds(previousNodes, nextNodes),
    removeNodeIds: addedProjectionIds(nextNodes, previousNodes),
    addEdgeIds: addedProjectionIds(previousEdges, nextEdges),
    updateEdgeIds: updatedProjectionIds(previousEdges, nextEdges),
    removeEdgeIds: addedProjectionIds(nextEdges, previousEdges)
  }
}

function syncWorkflowX6Projection(
  graph: Graph,
  scroller: Scroller | null,
  nodes: readonly WorkflowX6Node[],
  edges: readonly WorkflowX6Edge[],
  initialFitPending: { current: boolean },
  appliedProjection: { current: WorkflowX6ProjectionSnapshot }
): void {
  const nextProjection = { nodes, edges }
  const nextCellIds = new Set([
    ...nodes.map((node) => node.id),
    ...edges.map((edge) => edge.id)
  ])
  const retainedSelectedIds = graph.getSelectedCells()
    .map((cell) => cell.id)
    .filter((id) => nextCellIds.has(id))
  const diff = workflowX6ProjectionDiff(
    appliedProjection.current,
    nextProjection
  )
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  const edgeById = new Map(edges.map(edge => [edge.id, edge]))
  const previousNodeById = new Map(appliedProjection.current.nodes.map(node => [node.id, node]))
  if (nodes.length > 0 && previousNodeById.size > 0 &&
      nodes.every(node => !previousNodeById.has(node.id))) {
    initialFitPending.current = true
  }
  const layoutChanged = nodes.some(node => {
    const previous = previousNodeById.get(node.id)
    if (!previous || (previous.position.x === node.position.x && previous.position.y === node.position.y)) return false
    const cell = graph.getCellById(node.id)
    const position = cell?.isNode() ? cell.position() : null
    // A drag has already moved the live cell; its draft echo must not rebuild it.
    return !position || position.x !== node.position.x || position.y !== node.position.y
  })
  graph.batchUpdate('workflow-projection', () => {
    if (layoutChanged) {
      graph.resetCells([
        ...nodes.map(node => graph.createNode(workflowX6NodeMetadata(node))),
        ...edges.map(edge => graph.createEdge(workflowX6EdgeMetadata(edge)))
      ], { ui: false })
      return
    }
    for (const edgeId of diff.removeEdgeIds) graph.removeCell(edgeId, { ui: false })
    for (const nodeId of diff.removeNodeIds) graph.removeCell(nodeId, { ui: false })
    for (const nodeId of diff.updateNodeIds) {
      const cell = graph.getCellById(nodeId)
      const node = nodeById.get(nodeId)
      if (!cell?.isNode() || !node) continue
      const { id: _id, x, y, width, height, ...metadata } = workflowX6NodeMetadata(node)
      // Constructor aliases x/y and width/height must use the live node APIs.
      if (typeof x === 'number' && typeof y === 'number') cell.position(x, y, { ui: false })
      if (typeof width === 'number' && typeof height === 'number') cell.resize(width, height, { ui: false })
      const previousNode = previousNodeById.get(nodeId)
      const previousMetadata = previousNode ? workflowX6NodeMetadata(previousNode) : null
      const changedMetadata = Object.fromEntries(Object.entries(metadata).filter(([key, value]) =>
        !previousMetadata || JSON.stringify(previousMetadata[key as keyof typeof previousMetadata]) !== JSON.stringify(value)
      ))
      replaceWorkflowX6CellMetadata(
        cell,
        changedMetadata as Partial<NodeProperties>
      )
    }
    for (const nodeId of diff.addNodeIds) {
      const node = nodeById.get(nodeId)
      if (node) graph.addNode(workflowX6NodeMetadata(node), { ui: false })
    }
    for (const edgeId of diff.updateEdgeIds) {
      const cell = graph.getCellById(edgeId)
      const edge = edgeById.get(edgeId)
      if (!cell?.isEdge() || !edge) continue
      const { id: _id, ...metadata } = workflowX6EdgeMetadata(edge)
      replaceWorkflowX6CellMetadata(
        cell,
        metadata as Partial<EdgeProperties>
      )
    }
    for (const edgeId of diff.addEdgeIds) {
      const edge = edgeById.get(edgeId)
      if (edge) graph.addEdge(workflowX6EdgeMetadata(edge), { ui: false })
    }
  }, { ui: false })
  syncWorkflowX6LoopEmbeddings(graph, nodes)
  appliedProjection.current = nextProjection
  const selectedIds = [
    ...nodes.filter(node => node.selected).map(node => node.id),
    ...edges.filter(edge => edge.selected).map(edge => edge.id)
  ]
  const effectiveSelectedIds = selectedIds.length > 0
    ? selectedIds
    : retainedSelectedIds
  if (effectiveSelectedIds.length > 0) graph.select(effectiveSelectedIds)
  else graph.cleanSelection()
  // An empty draft is a valid initial state; consume the one-shot fit marker so
  // adding the first node later does not unexpectedly recenter the editor.
  if (nodes.length === 0) {
    initialFitPending.current = false
    return
  }
  if (!initialFitPending.current || !scroller) return
  initialFitPending.current = false
  globalThis.requestAnimationFrame(() => {
    scroller.zoomToFit({ padding: 56, maxScale: 1.2 })
  })
}

/**
 * X6 embedding 只服务 Loop 容器。条件分支的 parent_uuid 是语义分组，
 * 不能变成拖动父子，否则拖一个动作会把另一个动作一起带走。
 */
export function workflowX6DesiredEmbedParentId(
  node: WorkflowX6Node,
  nodesById: ReadonlyMap<string, WorkflowX6Node>
): string | null {
  const parentId = node.data.parentGroupId
  if (!parentId) return null
  return nodesById.get(parentId)?.data.controlFlow?.kind === 'repeat_until'
    ? parentId
    : null
}

function detachUnexpectedWorkflowX6EmbedChildren(
  node: import('@antv/x6').Node
): void {
  if (node.getData<WorkflowNodeData>()?.controlFlow?.kind === 'repeat_until') {
    return
  }
  for (const child of [...node.getChildren()]) {
    if (child.isNode()) child.removeFromParent({ ui: false })
  }
}

function syncWorkflowX6LoopEmbeddings(
  graph: Graph,
  nodes: readonly WorkflowX6Node[]
): void {
  const projectionById = new Map(nodes.map((node) => [node.id, node]))
  for (const projection of nodes) {
    const cell = graph.getCellById(projection.id)
    if (!cell?.isNode()) continue
    const desiredParentId = workflowX6DesiredEmbedParentId(
      projection,
      projectionById
    )
    const desiredParent = desiredParentId
      ? graph.getCellById(desiredParentId)
      : null
    const currentParent = cell.getParent()
    if (desiredParent?.isNode()) {
      if (currentParent?.id !== desiredParent.id) {
        if (currentParent?.isNode()) {
          cell.removeFromParent({ ui: false })
        }
        desiredParent.addChild(cell, { ui: false })
      }
      desiredParent.setZIndex(0, { ui: false })
      cell.setZIndex(1, { ui: false })
      continue
    }
    if (currentParent?.isNode()) {
      cell.removeFromParent({ ui: false })
    }
  }
}

/**
 * 逐个替换 X6 Cell 的顶层投影属性，避免整对象 setProp 深合并 markup 数组。
 *
 * X6 的整对象 setProp 会递归合并旧、新 JSON；当节点卡片随 Canonical 草稿
 * 更新时，这会把 SVG markup 合成重复 selector。稳定 Cell 必须保留，但每个
 * 顶层投影值（特别是 markup、attrs、ports）需要以新快照完整替换。
 */
function replaceWorkflowX6CellMetadata(
  cell: Cell,
  metadata: Partial<NodeProperties> | Partial<EdgeProperties>
): void {
  for (const [key, value] of Object.entries(metadata)) {
    // Keep unchanged port/markup views alive when only the layout moves.
    if (JSON.stringify(cell.getProp(key)) === JSON.stringify(value)) continue
    cell.setProp(key, value, { ui: false })
  }
}

function projectionFingerprintIndex<T extends { id: string }>(
  projections: readonly T[]
): Map<string, string> {
  return new Map(projections.map((projection) => [
    projection.id,
    JSON.stringify(projection)
  ]))
}

function addedProjectionIds(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>
): string[] {
  return [...next.keys()].filter((id) => !previous.has(id)).sort()
}

function updatedProjectionIds(
  previous: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>
): string[] {
  return [...next.entries()]
    .filter(([id, fingerprint]) => previous.get(id) !== undefined &&
      previous.get(id) !== fingerprint)
    .map(([id]) => id)
    .sort()
}
