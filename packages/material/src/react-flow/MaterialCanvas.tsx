import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  type Edge,
  type FitViewOptions,
  type NodeDragHandler,
  type NodeMouseHandler,
  type OnInit,
  type ProOptions,
  type ReactFlowInstance
} from 'reactflow'
import 'reactflow/dist/style.css'

import type { CapabilityStatus } from '../MaterialCapabilityNotice'
import { MaterialCapabilityNotice } from '../MaterialCapabilityNotice'
import { materialScopeClassName } from '../materialStyles'
import {
  useMaterialStore,
  useMaterialStoreApi
} from '../MaterialStoreProvider'
import type { MaterialId } from '../types'
import type { MaterialTransferOverlayRoute } from '../materialTransferOverlay'
import { MaterialNode } from './MaterialNode'
import {
  flowPositionToPlacement,
  placementPose,
  projectMaterialFlowNodes,
  type MaterialFlowNode
} from './projection'

const NODE_TYPES = {
  material: MaterialNode
}
const EMPTY_MATERIAL_IDS: readonly MaterialId[] = []
const MATERIAL_FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: 0.12,
  maxZoom: 1.25
}
const MATERIAL_PRO_OPTIONS: ProOptions = { hideAttribution: true }

export interface MaterialCanvasProps {
  readStatus: CapabilityStatus
  moveStatus: CapabilityStatus
  floorplanOverlay?: boolean
  physicalLayout?: boolean
  showSites?: boolean
  showMaterialLabels?: boolean
  materialTransferRoutes?: readonly MaterialTransferOverlayRoute[]
  selectedMaterialIds?: readonly MaterialId[]
  highlightedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}

/**
 * 渲染由物料图（Material Graph）投影得到的二维画布。
 *
 * @param props 读取、移动、选择与高亮等画布能力。
 * @returns 受控选择且支持物料移动的 ReactFlow 画布。
 */
export function MaterialCanvas({
  readStatus,
  moveStatus,
  floorplanOverlay = false,
  physicalLayout,
  showSites = true,
  showMaterialLabels = true,
  materialTransferRoutes = [],
  selectedMaterialIds = EMPTY_MATERIAL_IDS,
  highlightedMaterialIds = EMPTY_MATERIAL_IDS,
  onSelectionChange
}: MaterialCanvasProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const canvasRef = useRef<HTMLElement>(null)
  const flowInstanceRef = useRef<ReactFlowInstance<
    MaterialFlowNode['data']
  > | null>(null)
  const store = useMaterialStoreApi()
  const aggregatesById = useMaterialStore(
    (state) => state.aggregatesById
  )
  const dragPreviewByMaterialId = useMaterialStore(
    (state) => state.dragPreviewByMaterialId
  )
  const loadState = useMaterialStore((state) => state.loadState)
  const error = useMaterialStore((state) => state.error)
  const canDrag = moveStatus.available && isEditing

  /** 只在受控选择确实变化时通知宿主，避免 ReactFlow 空选择反馈循环。 */
  const publishSelection = useCallback((materialIds: readonly MaterialId[]) => {
    if (
      materialIds.length === selectedMaterialIds.length &&
      materialIds.every((materialId, index) =>
        materialId === selectedMaterialIds[index]
      )
    ) return
    onSelectionChange?.(materialIds)
  }, [onSelectionChange, selectedMaterialIds])

  useEffect(() => {
    if (!moveStatus.available) setIsEditing(false)
  }, [moveStatus.available])

  useEffect(() => {
    if (!readStatus.available || loadState !== 'idle') return
    void store.getState().loadGraph().catch(() => undefined)
  }, [loadState, readStatus.available, store])

  const nodes = useMemo(
    () =>
      projectMaterialFlowNodes({
        aggregatesById,
        dragPreviewByMaterialId,
        selectedMaterialIds,
        highlightedMaterialIds,
        draggable: canDrag,
        physicalLayout: physicalLayout ?? !moveStatus.available
      }),
    [
      aggregatesById,
      canDrag,
      dragPreviewByMaterialId,
      highlightedMaterialIds,
      physicalLayout,
      selectedMaterialIds
    ]
  )
  const nodeSetKey = nodes.map((node) => node.id).sort().join('|')
  const transferEdges = useMemo(
    () => projectMaterialTransferFlowEdges(materialTransferRoutes, nodes),
    [materialTransferRoutes, nodes]
  )
  const handleInit = useCallback<OnInit<MaterialFlowNode['data']>>((instance) => {
    flowInstanceRef.current = instance
  }, [])
  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => {
    publishSelection([node.id])
  }, [publishSelection])
  const handlePaneClick = useCallback(() => {
    publishSelection(EMPTY_MATERIAL_IDS)
  }, [publishSelection])
  const handleNodeDrag = useCallback<NodeDragHandler>((_, node) => {
    if (!canDrag) return
    const placement = flowPositionToPlacement({
      materialId: node.id,
      flowPosition: node.position,
      aggregatesById
    })
    const pose = placementPose(placement)
    if (pose) store.getState().setDragPreview(node.id, pose)
  }, [aggregatesById, canDrag, store])
  const handleNodeDragStop = useCallback<NodeDragHandler>((_, node) => {
    if (!canDrag) {
      store.getState().clearDragPreview(node.id)
      return
    }
    const placement = flowPositionToPlacement({
      materialId: node.id,
      flowPosition: node.position,
      aggregatesById
    })
    void store.getState().move(node.id, placement).catch(() => {
      // The store owns the actionable error and preview rollback.
    })
  }, [aggregatesById, canDrag, store])
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || loadState !== 'ready') return
    let frame = 0
    const fitVisibleViewport = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        if (canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return
        void flowInstanceRef.current?.fitView({
          padding: 0.12,
          maxZoom: 1.25
        })
      })
    }
    const observer = new ResizeObserver(fitVisibleViewport)
    observer.observe(canvas)
    fitVisibleViewport()
    return () => {
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [loadState, nodeSetKey])

  if (!readStatus.available) {
    return (
      <section
        className={materialScopeClassName(
          'material-canvas is-unavailable'
        )}
      >
        <MaterialCapabilityNotice
          title="物料图不可用"
          status={readStatus}
        />
      </section>
    )
  }

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <section
        className={materialScopeClassName(
          'material-canvas is-loading'
        )}
      >
        正在加载物料图…
      </section>
    )
  }

  return (
    <section
      ref={canvasRef}
      className={materialScopeClassName(
        `material-canvas${
          floorplanOverlay ? ' is-floorplan-overlay' : ''
        }${
          showSites ? '' : ' is-sites-hidden'
        }`
      )}
      data-site-layer-visible={showSites}
      data-material-label-layer-visible={showMaterialLabels}
    >
      {error ? <MaterialLoadError technicalMessage={error} /> : null}
      <div
        className="material-canvas__edit-control"
        data-move-available={moveStatus.available}
      >
        <button
          type="button"
          aria-pressed={isEditing}
          disabled={!moveStatus.available}
          onClick={() => setIsEditing((current) => !current)}
          title={
            moveStatus.available
              ? isEditing
                ? '退出物料位置编辑'
                : '进入物料位置编辑'
              : moveStatus.reason
          }
        >
          {isEditing ? '完成移动' : '移动物料'}
        </button>
        {!moveStatus.available ? (
          <span>{moveStatus.reason ?? '当前服务仅提供只读物料图'}</span>
        ) : null}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={transferEdges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={MATERIAL_FIT_VIEW_OPTIONS}
        minZoom={0.15}
        maxZoom={2}
        proOptions={MATERIAL_PRO_OPTIONS}
        nodesConnectable={false}
        elementsSelectable={false}
        onInit={handleInit}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
      >
        {!floorplanOverlay && <Background gap={24} size={1} />}
        {!floorplanOverlay && <MiniMap pannable zoomable />}
        {!floorplanOverlay && <Controls />}
      </ReactFlow>
    </section>
  )
}

/** 将已解析路线连接到 2D 画布中的规范 warehouse/material 节点。 */
export function projectMaterialTransferFlowEdges(
  routes: readonly MaterialTransferOverlayRoute[],
  nodes: readonly Pick<MaterialFlowNode, 'id'>[]
): Edge[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  return routes.flatMap((route) => {
    if (
      !nodeIds.has(route.sourceMaterialId) ||
      !nodeIds.has(route.targetMaterialId)
    ) return []
    return [{
      id: `material-transfer-${route.id}`,
      source: route.sourceMaterialId,
      sourceHandle: 'material-transfer-source',
      target: route.targetMaterialId,
      targetHandle: 'material-transfer-target',
      type: 'smoothstep',
      className: 'material-transfer-edge',
      label: `${route.sourceLabel} → ${route.targetLabel}`,
      ariaLabel: `${route.label}：${route.sourceLabel} 到 ${route.targetLabel}`,
      animated: route.status === 'running',
      focusable: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: route.accent
      },
      style: {
        stroke: route.accent,
        strokeDasharray:
          route.status === 'planned' || route.status === 'pending'
            ? '8 6'
            : undefined,
        strokeWidth: 2
      },
      zIndex: 20
    } satisfies Edge]
  })
}

/** 渲染物料图（Material Graph）加载失败的可操作提示。 */
function MaterialLoadError({
  technicalMessage
}: {
  technicalMessage: string
}): React.JSX.Element {
  const sessionUnavailable = technicalMessage.includes(
    'has not published its current in-memory material snapshot'
  )

  return (
    <div className="material__error" role="alert">
      <strong>
        {sessionUnavailable ? '物料数据尚未就绪' : '物料图加载失败'}
      </strong>
      <span>
        {sessionUnavailable
          ? '当前实验室会话尚未发布物料快照，请确认服务已启动并稍后重试。'
          : '请检查服务连接，恢复后重新打开物料页面。'}
      </span>
      <details>
        <summary>查看技术信息</summary>
        <code>{technicalMessage}</code>
      </details>
    </div>
  )
}
