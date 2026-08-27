import type {
  Graph,
  Scroller,
  Cell,
  Edge
} from '@antv/x6'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'

import type { WorkflowNodeData } from './WorkflowNodeCard'
import {
  workflowX6EdgeMetadata,
  workflowX6NodeMetadata,
  type WorkflowX6Edge,
  type WorkflowX6Node
} from './workflowX6Projection'
import './workflow-x6.css'

const LARGE_GRAPH_MINIMAP_LIMIT = 2_000

export type { WorkflowX6Edge, WorkflowX6Node } from './workflowX6Projection'

export interface WorkflowX6CanvasHandle {
  fit(): void
  revealNode(nodeId: string): void
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
  onConnectHandles?: (connection: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  }) => void
  onSelectionChange(selection: {
    nodeUuids: string[]
    edgeUuids: string[]
  }): void
  onSetStart?: (nodeId: string) => void
  onToggleBreakpoint?: (nodeId: string) => void
  onToggleGroup?: (nodeId: string) => void
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
  onToggleGroup
}, forwardedRef): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const minimapRef = useRef<HTMLDivElement | null>(null)
  const graphRef = useRef<Graph | null>(null)
  const scrollerRef = useRef<Scroller | null>(null)
  const projectionRef = useRef({ nodes, edges })
  const callbacksRef = useRef({
    canvasMutationEnabled,
    nodePositionMutationEnabled,
    onNodeSelect,
    onNodePositionChange,
    onConnectHandles,
    onSelectionChange,
    onSetStart,
    onToggleBreakpoint,
    onToggleGroup
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
    onToggleGroup
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
    }
  }), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
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
      background: { color: '#f4f7fb' },
      grid: {
        visible: true,
        size: 24,
        type: 'dot',
        args: { color: '#d9e0ea', thickness: 1 }
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
        width: 180,
        height: 112,
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
    graph.on('node:moved', ({ node }) => {
      if (!callbacksRef.current.nodePositionMutationEnabled) return
      callbacksRef.current.onNodePositionChange?.(node.id, node.position())
    })
    graph.on('edge:connected', ({ edge, isNew }) => {
      if (!isNew || !callbacksRef.current.canvasMutationEnabled) return
      const sourceNodeUuid = edge.getSourceCellId()
      const sourceHandleUuid = edge.getSourcePortId()
      const targetNodeUuid = edge.getTargetCellId()
      const targetHandleUuid = edge.getTargetPortId()
      if (
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
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      graph.resize(rect.width, rect.height)
      scroller.resize(rect.width, rect.height)
    })
    resize.observe(container)
    syncWorkflowX6Projection(
      graph,
      scroller,
      projectionRef.current.nodes,
      projectionRef.current.edges,
      initialFitPendingRef
    )
    cleanup = () => {
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
      initialFitPendingRef
    )
  }, [edges, nodes])

  return (
    <div
      className="workflow-x6"
      data-canvas-engine="x6"
      data-x6-node-count={nodes.length}
      data-x6-edge-count={edges.length}
      data-x6-virtual="true"
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
      </div>
    </div>
  )
})

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
function syncWorkflowX6Projection(
  graph: Graph,
  scroller: Scroller | null,
  nodes: readonly WorkflowX6Node[],
  edges: readonly WorkflowX6Edge[],
  initialFitPending: { current: boolean }
): void {
  const cells: Cell[] = [
    ...nodes.map(node => graph.createNode(workflowX6NodeMetadata(node))),
    ...edges.map(edge => graph.createEdge(workflowX6EdgeMetadata(edge)))
  ]
  graph.batchUpdate('workflow-projection', () => {
    graph.resetCells(cells)
  }, { ui: false })
  const selectedIds = [
    ...nodes.filter(node => node.selected).map(node => node.id),
    ...edges.filter(edge => edge.selected).map(edge => edge.id)
  ]
  if (selectedIds.length > 0) graph.select(selectedIds)
  else graph.cleanSelection()
  if (!initialFitPending.current || nodes.length === 0 || !scroller) return
  initialFitPending.current = false
  globalThis.requestAnimationFrame(() => {
    scroller.zoomToFit({ padding: 56, maxScale: 1.2 })
  })
}
