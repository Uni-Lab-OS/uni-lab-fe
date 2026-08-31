export interface WorkflowCanvasPoint {
  x: number
  y: number
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
