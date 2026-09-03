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
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import type { WorkflowNodeData } from './WorkflowNodeCard'
import {
  workflowX6EdgeMetadata,
  workflowX6NodeMetadata,
  type WorkflowX6Edge,
  type WorkflowX6Node
} from './workflowX6Projection'
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
  onConnectHandles?: (
    connection: WorkflowHandleConnection
  ) => WorkflowHandleConnectionResult
  onSelectionChange(selection: {
    nodeUuids: string[]
    edgeUuids: string[]
  }): void
  onSetStart?: (nodeId: string) => void
  onToggleBreakpoint?: (nodeId: string) => void
  onToggleGroup?: (nodeId: string) => void
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
  onConnectHandles,
  onSelectionChange,
  onSetStart,
  onToggleBreakpoint,
  onToggleGroup,
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
  const [nodeTooltip, setNodeTooltip] = useState<WorkflowX6NodeTooltip | null>(
    null
  )
  const callbacksRef = useRef({
    canvasMutationEnabled,
    nodePositionMutationEnabled,
    onNodeSelect,
    onNodePositionChange,
    onConnectHandles,
    onSelectionChange,
    onSetStart,
    onToggleBreakpoint,
    onToggleGroup,
    onOpenChildWorkflow
  })
  const initialFitPendingRef = useRef(true)

  callbacksRef.current = {
    canvasMutationEnabled,
    nodePositionMutationEnabled,
    onNodeSelect,
    onNodePositionChange,
    onConnectHandles,
    onSelectionChange,
    onSetStart,
    onToggleBreakpoint,
    onToggleGroup,
    onOpenChildWorkflow
  }
  projectionRef.current = { nodes, edges }

  useImperativeHandle(forwardedRef, () => ({
    fit: () => {
      const scroller = scrollerRef.current
      if (scroller) scroller.zoomToFit({ padding: 56, maxScale: 1.2 })
      else graphRef.current?.zoomToFit({ padding: 56, maxScale: 1.2 })
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
      const scroller = scrollerRef.current
      // Use the actual X6 scroller element rather than the React wrapper.
      // The plugin inserts its viewport next to the graph container and may
      // give it a slightly different client rect after scrollbars appear.
      const viewport = scroller?.container ?? containerRef.current
      if (!graph) {
        // The palette can be used while X6 is still loading asynchronously.
        // Keep the drop usable instead of silently falling back to (96, 96).
        if (!viewport) return null
        const bounds = viewport.getBoundingClientRect()
        return {
          x: clientX - bounds.left,
          y: clientY - bounds.top
        }
      }
      // Scroller's clientToLocalPoint expects coordinates relative to its
      // viewport (the same convention used by zoom/center internals), while
      // drag events expose window client coordinates. Subtract the viewport
      // origin before applying scroll and padding transforms.
      const point = scroller && viewport
        ? (() => {
            const bounds = viewport.getBoundingClientRect()
            return scroller.clientToLocalPoint(
              clientX - bounds.left,
              clientY - bounds.top
            )
          })()
        : graph.clientToLocal(clientX, clientY)
      return { x: point.x, y: point.y }
    },
    viewportCenter: () => {
      const container = rootRef.current
      const graph = graphRef.current
      if (!container) return null
      const bounds = container.getBoundingClientRect()
      const centerX = bounds.left + bounds.width / 2
      const centerY = bounds.top + bounds.height / 2
      const viewport = scrollerRef.current?.container ?? containerRef.current
      if (!graph) {
        if (!viewport) return null
        const viewportBounds = viewport.getBoundingClientRect()
        return {
          x: centerX - viewportBounds.left,
          y: centerY - viewportBounds.top
        }
      }
      const point = scrollerRef.current && viewport
        ? (() => {
            const viewportBounds = viewport.getBoundingClientRect()
            return scrollerRef.current.clientToLocalPoint(
              centerX - viewportBounds.left,
              centerY - viewportBounds.top
            )
          })()
        : graph.clientToLocal(centerX, centerY)
      return { x: point.x, y: point.y }
    },
    viewportSnapshot: () => {
      const container = rootRef.current
      const graph = graphRef.current
      if (!container || !graph) return null
      const bounds = container.getBoundingClientRect()
      const centerX = bounds.left + bounds.width / 2
      const centerY = bounds.top + bounds.height / 2
      const viewport = scrollerRef.current?.container ?? containerRef.current
      const center = scrollerRef.current && viewport
        ? (() => {
            const viewportBounds = viewport.getBoundingClientRect()
            return scrollerRef.current.clientToLocalPoint(
              centerX - viewportBounds.left,
              centerY - viewportBounds.top
            )
          })()
        : graph.clientToLocal(centerX, centerY)
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
      MiniMap,
      Scroller,
      Selection
    }) => {
      if (disposed) return
    let graph!: Graph
    graph = new Graph({
      container,
      async: true,
      virtual: { enabled: true, margin: 480 },
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
      panning: false,
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
      connecting: {
        allowBlank: false,
        allowLoop: false,
        allowNode: false,
        allowEdge: false,
        allowPort: () => callbacksRef.current.canvasMutationEnabled &&
          Boolean(callbacksRef.current.onConnectHandles),
        snap: { radius: 18 },
        router: { name: 'manhattan', args: { padding: 16 } },
        connector: { name: 'rounded', args: { radius: 8 } },
        createEdge: (): Edge => graph.createEdge(workflowX6EdgeMetadata({
          id: globalThis.crypto.randomUUID(),
          source: '',
          target: ''
        }))
      }
    })
    const scroller = new Scroller({
      enabled: true,
      pannable: true,
      autoResize: true,
      minVisibleWidth: 180,
      minVisibleHeight: 120,
      padding: 72
    })
    const selection = new Selection({
      enabled: true,
      multiple: true,
      rubberband: true,
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
        graphOptions: { virtual: true, async: true }
      }))
    }

    graph.on('node:click', ({ node }) => {
      if (node.getData<WorkflowNodeData>()?.kind === 'reaction_material') return
      callbacksRef.current.onNodeSelect(node.id)
    })
    // Use the rendered X6 node DOM for hover detection. X6's model events can
    // be skipped while virtual cells are mounted asynchronously; delegation
    // on the stable canvas root keeps the tooltip reliable in that window.
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
    root.addEventListener('pointerout', handleNodePointerOut)
    graph.on('node:contextmenu', ({ e, node }) => {
      e.preventDefault()
      const data = node.getData<WorkflowNodeData>()
      if (data?.kind === 'material_source') return
      callbacksRef.current.onSetStart?.(node.id)
    })
    graph.on('node:dblclick', ({ node }) => {
      const data = node.getData<WorkflowNodeData>()
      if (
        data?.openChildWorkflowUuid &&
        callbacksRef.current.onOpenChildWorkflow
      ) {
        callbacksRef.current.onOpenChildWorkflow(
          data.openChildWorkflowUuid,
          data.name
        )
        return
      }
      if (data?.groupKind === 'subworkflow') {
        callbacksRef.current.onToggleGroup?.(node.id)
        return
      }
      if (data?.kind === 'material_source') return
      callbacksRef.current.onToggleBreakpoint?.(node.id)
    })
    graph.on('node:moved', ({ node }) => {
      if (!callbacksRef.current.nodePositionMutationEnabled) return
      callbacksRef.current.onNodePositionChange?.(node.id, node.position())
    })
    graph.on('edge:connected', ({ edge, isNew }) => {
      if (!isNew) return
      const sourceNodeUuid = edge.getSourceCellId()
      const sourceHandleUuid = edge.getSourcePortId()
      const targetNodeUuid = edge.getTargetCellId()
      const targetHandleUuid = edge.getTargetPortId()
      // X6 交互边永远只是临时手势；Canonical 草稿接受后会重新投影稳定边。
      graph.removeCell(edge, { ui: false })
      if (
        !callbacksRef.current.canvasMutationEnabled ||
        !sourceNodeUuid || !sourceHandleUuid ||
        !targetNodeUuid || !targetHandleUuid
      ) return
      callbacksRef.current.onConnectHandles?.({
        sourceNodeUuid,
        sourceHandleUuid,
        targetNodeUuid,
        targetHandleUuid
      })
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
      appliedProjectionRef,
      callbacksRef.current.canvasMutationEnabled
    )
    cleanup = () => {
      setNodeTooltip(null)
      root.removeEventListener('pointerover', handleNodePointerOver)
      root.removeEventListener('pointermove', handleNodePointerMove)
      root.removeEventListener('pointerout', handleNodePointerOut)
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
    if (!graph) return
    syncWorkflowX6Projection(
      graph,
      scrollerRef.current,
      nodes,
      edges,
      initialFitPendingRef,
      appliedProjectionRef,
      canvasMutationEnabled
    )
  }, [canvasMutationEnabled, edges, nodes])

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
        graphOptions: { virtual: true, async: true }
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
      data-node-deletable="false"
      data-node-selection={nodes
        .map((node) => String(node.selected))
        .join(',')}
      data-node-classes={nodes.map((node) => node.className).join('|')}
      data-fit-max-zoom="1.2"
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
      <div className="workflow-x6__zoom" aria-label="画布缩放">
        <button
          type="button"
          aria-label="放大画布"
          onClick={() => scrollerRef.current?.zoom(0.15)}
        >＋</button>
        <button
          type="button"
          aria-label="缩小画布"
          onClick={() => scrollerRef.current?.zoom(-0.15)}
        >−</button>
        <button
          type="button"
          aria-label="适应画布"
          onClick={() => scrollerRef.current?.zoomToFit({
            padding: 56,
            maxScale: 1.2
          })}
        >⌗</button>
      </div>
      {nodeTooltip && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="workflowX6NodeTooltip"
              role="tooltip"
              data-node-id={nodeTooltip.nodeId}
              style={{ left: nodeTooltip.left, top: nodeTooltip.top }}
            >
              {nodeTooltip.text}
            </div>,
            document.body
          )
        : null}
    </div>
  )
})

interface WorkflowX6NodeTooltip {
  nodeId: string
  text: string
  left: number
  top: number
}

const WORKFLOW_X6_TOOLTIP_MAX_WIDTH = 320
const WORKFLOW_X6_TOOLTIP_MARGIN = 12
const WORKFLOW_X6_TOOLTIP_OFFSET = 14
const WORKFLOW_X6_TOOLTIP_ESTIMATED_HEIGHT = 96

/** 将节点提示放在指针附近，并在视口边缘自动翻转。 */
function workflowX6NodeTooltipPosition(
  clientX: number,
  clientY: number
): Pick<WorkflowX6NodeTooltip, 'left' | 'top'> {
  const viewportWidth = globalThis.window?.innerWidth ?? 1280
  const viewportHeight = globalThis.window?.innerHeight ?? 720
  const tooltipWidth = Math.min(
    WORKFLOW_X6_TOOLTIP_MAX_WIDTH,
    Math.max(120, viewportWidth - WORKFLOW_X6_TOOLTIP_MARGIN * 2)
  )
  const right = viewportWidth - WORKFLOW_X6_TOOLTIP_MARGIN - tooltipWidth
  const below = clientY + WORKFLOW_X6_TOOLTIP_OFFSET
  const above = clientY - WORKFLOW_X6_TOOLTIP_OFFSET -
    WORKFLOW_X6_TOOLTIP_ESTIMATED_HEIGHT
  return {
    left: Math.min(
      Math.max(
        clientX + WORKFLOW_X6_TOOLTIP_OFFSET,
        WORKFLOW_X6_TOOLTIP_MARGIN
      ),
      right
    ),
    top: below + WORKFLOW_X6_TOOLTIP_ESTIMATED_HEIGHT <=
      viewportHeight - WORKFLOW_X6_TOOLTIP_MARGIN
      ? below
      : Math.max(WORKFLOW_X6_TOOLTIP_MARGIN, above)
  }
}

/**
 * 在一个 X6 批处理中替换当前 Canonical Workflow 投影并恢复选择。
 *
 * @param graph 已挂载插件的 X6 图实例。
 * @param scroller 当前图的滚动器；未挂载时仅跳过首次适配。
 * @param nodes 当前可见工作流节点投影。
 * @param edges 当前可见工作流边投影。
 * @param initialFitPending 是否仍需执行唯一一次自动适应视图。
 * @param skipInitialFit 编辑画布不自动重排视口，保证释放坐标稳定。
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
  appliedProjection: { current: WorkflowX6ProjectionSnapshot },
  skipInitialFit = false
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
  graph.batchUpdate('workflow-projection', () => {
    for (const edgeId of diff.removeEdgeIds) graph.removeCell(edgeId, { ui: false })
    for (const nodeId of diff.removeNodeIds) graph.removeCell(nodeId, { ui: false })
    for (const nodeId of diff.updateNodeIds) {
      const cell = graph.getCellById(nodeId)
      const node = nodeById.get(nodeId)
      if (!cell?.isNode() || !node) continue
      const { id: _id, ...metadata } = workflowX6NodeMetadata(node)
      replaceWorkflowX6CellMetadata(
        cell,
        metadata as Partial<NodeProperties>
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
  // An empty authoring canvas is a valid, editable state. Mark the initial
  // fit as consumed here so the first node created by a palette drop stays at
  // the pointer location instead of triggering zoomToFit and jumping to the
  // viewport center. Non-empty workflows still receive the one-time fit.
  if (skipInitialFit) {
    initialFitPending.current = false
    return
  }
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
