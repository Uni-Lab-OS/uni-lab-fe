export interface WorkflowCanvasPoint {
  x: number
  y: number
}

/** 原生拖放和指针兼容路径共用同一画布边界，拒绝库区、面板和无效坐标。 */
export function workflowPaletteDropInside(
  bounds: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | undefined,
  clientX: number,
  clientY: number
): boolean {
  return Boolean(bounds && Number.isFinite(clientX) && Number.isFinite(clientY) &&
    clientX >= bounds.left && clientX <= bounds.right &&
    clientY >= bounds.top && clientY <= bounds.bottom)
}

/**
 * The compact action cards in the HTML prototype are 180 × 84 px.  The
 * prototype treats the pointer as the card centre while dragging, so keep the
 * same half-size offset when converting a drop point into a node position.
 */
export const WORKFLOW_PROTOTYPE_ACTION_NODE_SIZE = {
  width: 180,
  height: 84
} as const

export function workflowPaletteDropPosition(
  point: WorkflowCanvasPoint,
  size: { width: number; height: number } = WORKFLOW_PROTOTYPE_ACTION_NODE_SIZE
): WorkflowCanvasPoint {
  return {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2
  }
}

export interface WorkflowCanvasViewport {
  center: WorkflowCanvasPoint
  zoom: number
}

export interface WorkflowCanvasNavigationState {
  viewport: WorkflowCanvasViewport | null
  selectedNodeUuid: string | null
}

export interface WorkflowCanvasBreadcrumb {
  workflowUuid: string
  workflowName: string
}

export type WorkflowNodePaletteDragPayload =
  | { kind: 'manual_confirmation' }
  | { kind: 'material' }
  | { kind: 'action'; templateUuid: string }
  | { kind: 'workflow'; templateUuid: string }

export interface WorkflowHandleConnection {
  sourceNodeUuid: string
  sourceHandleUuid: string
  targetNodeUuid: string
  targetHandleUuid: string
}

export type WorkflowHandleConnectionResult =
  | { accepted: true }
  | { accepted: false; reason: string }

interface WorkflowNodePalettePointerDataset {
  workflowPaletteAction?: string
  workflowPaletteWorkflow?: string
  workflowPaletteMaterial?: string
  workflowPaletteManual?: string
}

/** 把节点库元素的数据属性解析为指针拖拽载荷，覆盖动作、子工作流和框架节点。 */
export function workflowNodePalettePointerPayload(
  dataset: WorkflowNodePalettePointerDataset
): WorkflowNodePaletteDragPayload | null {
  if (dataset.workflowPaletteManual === 'true') {
    return { kind: 'manual_confirmation' }
  }
  if (dataset.workflowPaletteMaterial === 'true') {
    return { kind: 'material' }
  }
  if (dataset.workflowPaletteWorkflow) {
    return { kind: 'workflow', templateUuid: dataset.workflowPaletteWorkflow }
  }
  if (dataset.workflowPaletteAction) {
    return { kind: 'action', templateUuid: dataset.workflowPaletteAction }
  }
  return null
}

export const WORKFLOW_NODE_PALETTE_MIME =
  'application/x-unilab-workflow-node-template'
const WORKFLOW_NODE_PALETTE_TEXT_PREFIX = 'unilab-workflow-node:'

/** 将节点库稳定身份写入浏览器拖拽载荷，不携带目录或草稿对象。 */
export function writeWorkflowNodePaletteDragPayload(
  dataTransfer: DataTransfer,
  payload: WorkflowNodePaletteDragPayload
): void {
  const serialized = JSON.stringify(payload)
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(WORKFLOW_NODE_PALETTE_MIME, serialized)
  // Electron/macOS may suppress a custom MIME type while an X6 surface owns
  // the drag target. A namespaced text fallback keeps the payload available
  // without accepting arbitrary text drops as workflow nodes.
  dataTransfer.setData(
    'text/plain',
    `${WORKFLOW_NODE_PALETTE_TEXT_PREFIX}${serialized}`
  )
}

/** 判断拖拽是否来自 UniLab 节点库；不读取受浏览器保护的载荷正文。 */
export function hasWorkflowNodePaletteDragPayload(
  dataTransfer: DataTransfer
): boolean {
  const types = Array.from(dataTransfer.types ?? [])
  return types.includes(WORKFLOW_NODE_PALETTE_MIME) ||
    types.includes('text/plain')
}

/** 关闭失败地读取节点库拖拽载荷。 */
export function readWorkflowNodePaletteDragPayload(
  dataTransfer: DataTransfer
): WorkflowNodePaletteDragPayload | null {
  const canonical = dataTransfer.getData(WORKFLOW_NODE_PALETTE_MIME)
  const textFallback = dataTransfer.getData('text/plain')
  const raw = canonical || (
    textFallback.startsWith(WORKFLOW_NODE_PALETTE_TEXT_PREFIX)
      ? textFallback.slice(WORKFLOW_NODE_PALETTE_TEXT_PREFIX.length)
      : ''
  )
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return null
    if (value.kind === 'manual_confirmation') return { kind: 'manual_confirmation' }
    if (value.kind === 'material') return { kind: 'material' }
    if (
      (value.kind === 'action' || value.kind === 'workflow') &&
      typeof value.templateUuid === 'string' &&
      value.templateUuid.length > 0
    ) {
      return { kind: value.kind, templateUuid: value.templateUuid }
    }
    return null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
