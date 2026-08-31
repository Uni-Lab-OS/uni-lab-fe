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
import { readMaterialAttachTargetState } from '../rules'
import type { MaterialId } from '../types'
import type { MaterialTransferOverlayRoute } from '../materialTransferOverlay'
import { MaterialNode } from './MaterialNode'
import { readDefaultMaterialNodePresentation } from './defaultNodePresentation'
import {
  flowPositionToPlacement,
  placementPose,
  projectMaterialFlowNodes,
  type MaterialFlowNode
} from './projection'
import type { MaterialSiteDropState } from './projectionTypes'

const NODE_TYPES = {
  material: MaterialNode
}
const EMPTY_MATERIAL_IDS: readonly MaterialId[] = []
const MATERIAL_FIT_VIEW_OPTIONS: FitViewOptions = {
  padding: 0.12,
  maxZoom: 1.25
}
const MATERIAL_PRO_OPTIONS: ProOptions = { hideAttribution: true }
const SITE_DROP_HIT_SLOP_PX = 10
const POST_DRAG_CLICK_SUPPRESSION_MS = 500

export interface MaterialCanvasProps {
  readStatus: CapabilityStatus
  moveStatus: CapabilityStatus
  attachStatus: CapabilityStatus
  detachStatus: CapabilityStatus
  focusRequest?: MaterialFocusRequest | null
  floorplanOverlay?: boolean
  physicalLayout?: boolean
  showSites?: boolean
  showMaterialLabels?: boolean
  materialTransferRoutes?: readonly MaterialTransferOverlayRoute[]
  selectedMaterialIds?: readonly MaterialId[]
  highlightedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
  onMaterialActivate?: (materialId: MaterialId | null) => void
}

export interface MaterialFocusRequest {
  materialId: MaterialId
  revision: number
}

export interface MaterialSiteDropTarget {
  parentId: MaterialId
  siteId: string
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>
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
  attachStatus,
  detachStatus,
  focusRequest = null,
  floorplanOverlay = false,
  physicalLayout,
  showSites = true,
  showMaterialLabels = true,
  materialTransferRoutes = [],
  selectedMaterialIds = EMPTY_MATERIAL_IDS,
  highlightedMaterialIds = EMPTY_MATERIAL_IDS,
  onSelectionChange,
  onMaterialActivate
}: MaterialCanvasProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [isHandling, setIsHandling] = useState(false)
  const [activeHandlingMaterialId, setActiveHandlingMaterialId] =
    useState<MaterialId | null>(null)
  const [handlingNotice, setHandlingNotice] = useState<string | null>(null)
  const canvasRef = useRef<HTMLElement>(null)
  const suppressedNodeClickRef = useRef<{
    materialId: MaterialId
    until: number
  } | null>(null)
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
  const pendingCommandsById = useMaterialStore(
    (state) => state.pendingCommandsById
  )
  const canDrag = moveStatus.available && isEditing
  const positionDraggableMaterialIds = useMemo(
    () => new Set(
      canDrag
        ? Object.values(aggregatesById)
            .filter(isPositionDraggableMaterial)
            .map((aggregate) => aggregate.material.id)
        : []
    ),
    [aggregatesById, canDrag]
  )
  const handlingPending = Object.values(pendingCommandsById).some(
    (command) => command.kind === 'attach' || command.kind === 'detach'
  )
  const handlingDragEnabled = canStartMaterialHandlingDrag(
    isHandling,
    handlingPending
  )
  const attachDraggableMaterialIds = useMemo(
    () => new Set(
      handlingDragEnabled
        ? Object.values(aggregatesById)
            .filter(isOperatorHandledMaterial)
            .map((aggregate) => aggregate.material.id)
        : []
    ),
    [aggregatesById, handlingDragEnabled]
  )
  const siteDropStateById = useMemo(
    () => activeHandlingMaterialId
      ? buildSiteDropStates(activeHandlingMaterialId, aggregatesById)
      : undefined,
    [activeHandlingMaterialId, aggregatesById]
  )
  const selectedAggregate = selectedMaterialIds.length === 1
    ? aggregatesById[selectedMaterialIds[0]]
    : undefined
  const canDetachSelected = Boolean(
    selectedAggregate &&
    isOperatorHandledMaterial(selectedAggregate) &&
    (
      selectedAggregate.placement.kind === 'parent' ||
      selectedAggregate.placement.kind === 'site'
    )
  )

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
    if (!attachStatus.available) {
      setIsHandling(false)
      setActiveHandlingMaterialId(null)
    }
  }, [attachStatus.available])

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
        draggable: false,
        draggableMaterialIds: isHandling
          ? attachDraggableMaterialIds
          : positionDraggableMaterialIds,
        siteDropStateById,
        physicalLayout: physicalLayout ?? !moveStatus.available
      }),
    [
      aggregatesById,
      attachDraggableMaterialIds,
      canDrag,
      dragPreviewByMaterialId,
      highlightedMaterialIds,
      physicalLayout,
      selectedMaterialIds,
      isHandling,
      positionDraggableMaterialIds,
      siteDropStateById
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
    const suppressedClick = suppressedNodeClickRef.current
    suppressedNodeClickRef.current = null
    if (
      suppressedClick?.materialId === node.id &&
      Date.now() <= suppressedClick.until
    ) {
      return
    }
    publishSelection([node.id])
    onMaterialActivate?.(node.id)
  }, [onMaterialActivate, publishSelection])
  const handlePaneClick = useCallback(() => {
    publishSelection(EMPTY_MATERIAL_IDS)
    onMaterialActivate?.(null)
  }, [onMaterialActivate, publishSelection])
  const handleNodeDragStart = useCallback<NodeDragHandler>((_, node) => {
    const isHandlingDrag =
      handlingDragEnabled && attachDraggableMaterialIds.has(node.id)
    const isPositionDrag =
      canDrag && positionDraggableMaterialIds.has(node.id)
    if (!isPositionDrag && !isHandlingDrag) return
    suppressedNodeClickRef.current = {
      materialId: node.id,
      until: Number.POSITIVE_INFINITY
    }
    if (!isHandlingDrag) return
    // 上料拖拽不能改变宿主选择：选择会打开属性面板并改变画布宽度，
    // ResizeObserver 随后触发 fitView，导致当前 React Flow 拖拽被中断。
    setActiveHandlingMaterialId(node.id)
    setHandlingNotice(null)
  }, [
    attachDraggableMaterialIds,
    canDrag,
    handlingDragEnabled,
    positionDraggableMaterialIds
  ])
  const handleNodeDrag = useCallback<NodeDragHandler>((_, node) => {
    if (
      !positionDraggableMaterialIds.has(node.id) &&
      !attachDraggableMaterialIds.has(node.id)
    ) return
    const placement = flowPositionToPlacement({
      materialId: node.id,
      flowPosition: node.position,
      aggregatesById,
      physicalLayout: physicalLayout ?? !moveStatus.available
    })
    const pose = placementPose(placement)
    if (pose) store.getState().setDragPreview(node.id, pose)
  }, [
    aggregatesById,
    attachDraggableMaterialIds,
    moveStatus.available,
    physicalLayout,
    positionDraggableMaterialIds,
    store
  ])
  const handleNodeDragStop = useCallback<NodeDragHandler>((event, node) => {
    if (suppressedNodeClickRef.current?.materialId === node.id) {
      suppressedNodeClickRef.current = {
        materialId: node.id,
        until: Date.now() + POST_DRAG_CLICK_SUPPRESSION_MS
      }
    }
    if (isHandling && handlingPending) {
      setActiveHandlingMaterialId(null)
      store.getState().clearDragPreview(node.id)
      return
    }
    if (isHandling && attachDraggableMaterialIds.has(node.id)) {
      const point = pointerPoint(event) ?? nodeCenterPoint(canvasRef.current, node.id)
      const target = point
        ? selectMaterialSiteDropTarget(
            point,
            readAvailableSiteDropTargets(canvasRef.current)
          )
        : null
      setActiveHandlingMaterialId(null)
      if (!target) {
        store.getState().clearDragPreview(node.id)
        setHandlingNotice('未放入可用库位：仅绿色且未占用的库位可以上料')
        return
      }
      setHandlingNotice('正在上料…')
      void store.getState().attach(target.parentId, node.id, target.siteId)
        .then(() => setHandlingNotice('上料完成'))
        .catch((caught) => setHandlingNotice(errorMessage(caught)))
      return
    }
    if (!canDrag || !positionDraggableMaterialIds.has(node.id)) {
      store.getState().clearDragPreview(node.id)
      return
    }
    const placement = flowPositionToPlacement({
      materialId: node.id,
      flowPosition: node.position,
      aggregatesById,
      physicalLayout: physicalLayout ?? !moveStatus.available
    })
    void store.getState().move(node.id, placement).catch(() => {
      // The store owns the actionable error and preview rollback.
    })
  }, [
    aggregatesById,
    attachDraggableMaterialIds,
    canDrag,
    handlingPending,
    isHandling,
    positionDraggableMaterialIds,
    physicalLayout,
    moveStatus.available,
    store
  ])
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

  useEffect(() => {
    if (!focusRequest || loadState !== 'ready') return
    const instance = flowInstanceRef.current
    const node = instance?.getNode(focusRequest.materialId)
    if (!instance || !node) return
    const frame = window.requestAnimationFrame(() => {
      void instance.fitView({
        nodes: [node],
        padding: 0.35,
        minZoom: 0.7,
        maxZoom: 1.5,
        duration: 300
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusRequest, loadState, nodeSetKey])

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
        }${
          isHandling ? ' is-handling' : ''
        }`
      )}
      data-site-layer-visible={showSites}
      data-material-label-layer-visible={showMaterialLabels}
    >
      {error && loadState === 'error'
        ? <MaterialLoadError technicalMessage={error} />
        : null}
      {error && loadState !== 'error' ? (
        <div className="material__error" role="alert">
          <strong>物料操作失败</strong>
          <span>{error}</span>
        </div>
      ) : null}
      <div
        className="material-canvas__edit-control"
        data-move-available={moveStatus.available}
      >
        <button
          type="button"
          aria-pressed={isEditing}
          disabled={!moveStatus.available}
          onClick={() => {
            setIsHandling(false)
            setActiveHandlingMaterialId(null)
            setIsEditing((current) => !current)
          }}
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
        <button
          type="button"
          aria-pressed={isHandling}
          disabled={!attachStatus.available || handlingPending}
          onClick={() => {
            setIsEditing(false)
            setActiveHandlingMaterialId(null)
            setHandlingNotice(null)
            if (!isHandling) publishSelection(EMPTY_MATERIAL_IDS)
            setIsHandling((current) => !current)
          }}
          title={attachStatus.available
            ? '拖动物料到空闲库位；已有来源库位会原子释放'
            : attachStatus.reason}
        >
          {isHandling ? '完成上料' : '上料'}
        </button>
        <button
          type="button"
          disabled={
            !detachStatus.available ||
            !canDetachSelected ||
            handlingPending
          }
          onClick={() => {
            if (!selectedAggregate) return
            setHandlingNotice('正在下料…')
            void store.getState().detach(selectedAggregate.material.id)
              .then(() => setHandlingNotice('下料完成'))
              .catch((caught) => setHandlingNotice(errorMessage(caught)))
          }}
          title={detachStatus.available
            ? canDetachSelected
              ? '将所选物料从当前库位下料'
              : '请先选择已上料物料'
            : detachStatus.reason}
        >
          下料
        </button>
        <span role="status">
          {handlingNotice ?? (
            isHandling
              ? '拖动物料到绿色空闲库位；原库位会自动释放'
              : !attachStatus.available && !detachStatus.available
                ? attachStatus.reason ?? detachStatus.reason ?? '当前服务不支持上下料'
                : '已占用库位不可上料'
          )}
        </span>
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
        onNodeDragStart={handleNodeDragStart}
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

function buildSiteDropStates(
  childId: MaterialId,
  aggregatesById: Readonly<Record<MaterialId, import('../types').MaterialAggregate>>
): Readonly<Record<string, MaterialSiteDropState>> {
  const child = aggregatesById[childId]
  if (!child) return {}
  const result: Record<string, MaterialSiteDropState> = {}
  for (const parent of Object.values(aggregatesById)) {
    for (const site of parent.sites) {
      result[site.id] = readMaterialAttachTargetState(
        parent,
        child,
        site,
        aggregatesById
      )
    }
  }
  return result
}

export function isOperatorHandledMaterial(
  aggregate: import('../types').MaterialAggregate
): boolean {
  return aggregate.material.component?.managedByParent !== true &&
    readDefaultMaterialNodePresentation(aggregate).kind === 'material'
}

/** 位置编辑不得偏移 Site 内物料；它们只能通过上下料改变物理位置。 */
export function isPositionDraggableMaterial(
  aggregate: import('../types').MaterialAggregate
): boolean {
  return aggregate.placement.kind === 'world' ||
    aggregate.placement.kind === 'parent'
}

/** 上下料命令未完成前禁止发起第二次拖拽。 */
export function canStartMaterialHandlingDrag(
  isHandling: boolean,
  handlingPending: boolean
): boolean {
  return isHandling && !handlingPending
}

/** 从可用库位的扩展命中区中选择中心最近的目标。 */
export function selectMaterialSiteDropTarget(
  point: { x: number; y: number },
  targets: readonly MaterialSiteDropTarget[],
  hitSlop = SITE_DROP_HIT_SLOP_PX
): MaterialSiteDropTarget | null {
  return targets
    .filter(({ rect }) =>
      point.x >= rect.left - hitSlop &&
      point.x <= rect.right + hitSlop &&
      point.y >= rect.top - hitSlop &&
      point.y <= rect.bottom + hitSlop
    )
    .sort((left, right) =>
      squaredDistanceToCenter(point, left.rect) -
      squaredDistanceToCenter(point, right.rect)
    )[0] ?? null
}

function readAvailableSiteDropTargets(
  canvas: HTMLElement | null
): MaterialSiteDropTarget[] {
  if (!canvas) return []
  return Array.from(canvas.querySelectorAll<HTMLElement | SVGGraphicsElement>(
    '[data-material-site-id][data-site-drop-state="available"]'
  )).flatMap((element) => {
    const parentId = element.dataset.siteOwnerMaterialId
    const siteId = element.dataset.materialSiteId
    return parentId && siteId
      ? [{ parentId, siteId, rect: element.getBoundingClientRect() }]
      : []
  })
}

function pointerPoint(event: unknown): { x: number; y: number } | null {
  const candidate = event as {
    clientX?: unknown
    clientY?: unknown
    changedTouches?: { 0?: { clientX?: unknown; clientY?: unknown } }
  }
  const point = typeof candidate.clientX === 'number'
    ? candidate
    : candidate.changedTouches?.[0]
  return typeof point?.clientX === 'number' && typeof point.clientY === 'number'
    ? { x: point.clientX, y: point.clientY }
    : null
}

function nodeCenterPoint(
  canvas: HTMLElement | null,
  materialId: MaterialId
): { x: number; y: number } | null {
  const element = Array.from(
    canvas?.querySelectorAll<HTMLElement>('.react-flow__node[data-id]') ?? []
  ).find((candidate) => candidate.dataset.id === materialId)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
}

function squaredDistanceToCenter(
  point: { x: number; y: number },
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>
): number {
  const dx = point.x - (rect.left + rect.right) / 2
  const dy = point.y - (rect.top + rect.bottom) / 2
  return dx * dx + dy * dy
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '物料操作失败'
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
