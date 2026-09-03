import type { EdgeMetadata, NodeMetadata } from '@antv/x6'
import type { CSSProperties, ReactNode } from 'react'

import { isResourceSlotHandle } from '../utils/workflowMaterialTrace'
import { WORKFLOW_HORIZONTAL_MATERIAL_SOURCE_HANDLE_AXIS, WORKFLOW_HORIZONTAL_TRANSFER_NODE_HANDLE_AXIS, WORKFLOW_VERTICAL_MATERIAL_SOURCE_HANDLE_AXIS, WORKFLOW_VERTICAL_TRANSFER_NODE_HANDLE_AXIS } from '../utils/workflowMaterialSwimlaneLayout'
import type { WorkflowHandlePort } from '../utils/parseWorkflow'
import type { WorkflowReactionMaterialNodeData } from './WorkflowReactionMaterialNode'
import { isReadyHandle, workflowMaterialPortCards, workflowNodeStateLabel, type WorkflowNodeData } from './WorkflowNodeCard'
import { createWorkflowPrototypeActionMetadata } from './workflowX6PrototypeAction'

const ACTION_NODE_MIN_WIDTH = 248
const ACTION_NODE_MAX_WIDTH = 520
const ACTION_NODE_HEIGHT = 64
const SUBWORKFLOW_NODE_HEIGHT = 88
const PROTOTYPE_ACTION_NODE_WIDTH = 132
const PROTOTYPE_ACTION_NODE_HEIGHT = 66
const PROTOTYPE_SUBWORKFLOW_NODE_HEIGHT = 78
const COMPACT_ACTION_NODE_WIDTH = 184
const COMPACT_ACTION_NODE_BASE_HEIGHT = 92
const COMPACT_MATERIAL_CARD_PITCH = 33
const MATERIAL_SOURCE_WIDTH = 184
const MATERIAL_SOURCE_HEIGHT = 72
const HORIZONTAL_MATERIAL_SOURCE_WIDTH = 112
const HORIZONTAL_MATERIAL_SOURCE_HEIGHT = 126
const TRANSFER_NODE_WIDTH = 176
const TRANSFER_NODE_HEIGHT = 72
const HORIZONTAL_TRANSFER_NODE_WIDTH = 120
const HORIZONTAL_TRANSFER_NODE_HEIGHT = 126
const REACTION_MATERIAL_NODE_WIDTH = 152
const REACTION_MATERIAL_ITEM_HEIGHT = 22
const X6_TEXT_ORIGIN = {
  refX: 0,
  refY: 0,
  textAnchor: 'start',
  textVerticalAnchor: 'middle'
} as const

/** X6 默认端口是 10px 黑白圆点；隐藏兜底端口避免旧数据在 (0, 0) 绘制大圆。 */
const WORKFLOW_X6_HIDDEN_PORT_MARKUP = {
  tagName: 'circle',
  selector: 'portBody',
  attrs: {
    r: 0,
    opacity: 0,
    visibility: 'hidden',
    pointerEvents: 'none'
  }
} as const

type WorkflowX6PortSide = 'top' | 'right' | 'bottom' | 'left'

export interface WorkflowX6Node {
  id: string
  type?: string
  position: { x: number; y: number }
  targetPosition?: WorkflowX6PortSide
  sourcePosition?: WorkflowX6PortSide
  style?: CSSProperties
  className?: string
  selected?: boolean
  data: WorkflowNodeData
}

/**
 * 返回节点内容需要展开悬浮提示时使用的完整文案。
 *
 * X6 节点正文会按照原型卡片的固定宽度截断；只有确实发生截断时才
 * 返回文案，避免每个普通节点都出现无意义的提示层。
 *
 * @param node 当前工作流节点投影。
 * @returns 需要悬浮展示的完整文案；内容未溢出时返回 null。
 */
export function workflowX6NodeTooltipText(
  node: WorkflowX6Node
): string | null {
  const data = node.data
  if (node.type === 'wfReactionMaterial') {
    const reactionData = data as WorkflowReactionMaterialNodeData
    const reactionItems = reactionData.reactionMaterials ?? []
    if (!reactionItems.some((item) => item.sourceNodeName.length > 17)) {
      return null
    }
    return [
      reactionData.reactionTargetNodeName || data.name || data.id,
      `加入：${reactionItems.map((item) => item.sourceNodeName).join('、')}`
    ].filter(Boolean).join('\n')
  }

  const name = data.name?.trim() || data.id
  const detail = prototypeActionDetailText(data)
  const limits = workflowX6NodeTextLimits(node)
  const nameOverflow = name.length > limits.name
  const detailOverflow = detail.length > limits.detail
  if (!nameOverflow && !detailOverflow) return null
  return [name, detail].filter(Boolean).join('\n')
}

interface WorkflowX6NodeTextLimits {
  name: number
  detail: number
}

/** 与每类 X6 视觉节点的截断上限保持一致。 */
function workflowX6NodeTextLimits(
  node: WorkflowX6Node
): WorkflowX6NodeTextLimits {
  const data = node.data
  const horizontal = data.materialLaneDirection === 'horizontal'
  if (data.kind === 'material_source') {
    return {
      name: horizontal ? 15 : 16,
      detail: Number.POSITIVE_INFINITY
    }
  }
  if (data.visualKind === 'robot-transfer') {
    return {
      name: horizontal ? 16 : 15,
      detail: Number.POSITIVE_INFINITY
    }
  }
  if (data.layoutStrategy === 'primary-sample-serpentine') {
    return { name: 22, detail: Number.POSITIVE_INFINITY }
  }
  if (data.layoutStrategy === 'material-swimlanes') {
    const materialVariables = new Set(
      (data.handles ?? [])
        .filter(isResourceSlotHandle)
        .map((handle) => handle.dataKey?.trim() || handle.handleKey)
    ).size
    return {
      name: materialVariables > 0 ? 15 : 26,
      detail: Number.POSITIVE_INFINITY
    }
  }
  return { name: 11, detail: 20 }
}

/** 默认原型卡片第二行显示的完整文案。 */
function prototypeActionDetailText(data: WorkflowNodeData): string {
  if (data.groupKind === 'subworkflow') {
    return `${data.groupExpanded ? '▾' : '▸'} ${data.descendantCount ?? 0} 个内部节点`
  }
  return data.description?.trim() || workflowNodeStateLabel(
    data.kind,
    data.status || 'pending'
  )
}

export interface WorkflowX6Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: ReactNode
  labelStyle?: CSSProperties
  ariaLabel?: string
  className?: string
  selected?: boolean
  animated?: boolean
  style?: CSSProperties
  data?: {
    sourceHandleUuid?: string
    targetHandleUuid?: string
    materialEmphasis?: 'primary' | 'supporting'
    sequence?: boolean
  }
}

interface WorkflowX6NodeSize {
  width: number
  height: number
}

interface WorkflowX6EdgeVisual {
  material: boolean
  ready: boolean
  beforeStart: boolean
  supporting: boolean
  stroke: string
  strokeWidth: number
}

interface WorkflowX6SpecialPortGeometry {
  target: { x: number; y: number }
  source: { x: number; y: number }
}

type ArrayItem<T> = T extends readonly (infer Item)[] ? Item : never
type WorkflowX6MarkupItem = ArrayItem<NonNullable<NodeMetadata['markup']>>
type WorkflowX6Markup = WorkflowX6MarkupItem[]
type WorkflowX6PortMetadata = Extract<
  NonNullable<NodeMetadata['ports']>,
  readonly unknown[]
>[number]

interface WorkflowX6MarkupProjection {
  markup: WorkflowX6Markup
  attrs: NonNullable<NodeMetadata['attrs']>
}

/**
 * 把框架无关节点投影为与旧 React Flow 画布一致的轻量 SVG 视觉。
 *
 * 节点仍只承载 Canonical Workflow 的只读投影；类型差异通过 SVG markup
 * 表达，避免在五千节点场景创建同等数量的 React 子树。
 */
export function workflowX6NodeMetadata(node: WorkflowX6Node): NodeMetadata {
  let metadata: NodeMetadata
  if (node.type === 'wfReactionMaterial') {
    metadata = workflowReactionMaterialMetadata(node)
  } else if (node.data.kind === 'material_source') {
    metadata = workflowMaterialSourceMetadata(node)
  } else if (node.data.visualKind === 'robot-transfer') {
    metadata = workflowRobotTransferMetadata(node)
  } else {
    metadata = workflowActionMetadata(node)
  }
  // Every node kind gets the same safe fallback. Special nodes do not share
  // workflowNodeBase, so applying this at the public projection boundary
  // prevents X6 from rendering its default origin port for those nodes too.
  return metadata.portMarkup
    ? metadata
    : { ...metadata, portMarkup: WORKFLOW_X6_HIDDEN_PORT_MARKUP }
}

/** 把布局边投影为 X6 圆角正交边，并恢复 React Flow 的语义线型。 */
export function workflowX6EdgeMetadata(edge: WorkflowX6Edge): EdgeMetadata {
  const visual = workflowX6EdgeVisual(edge)
  const labelColor = String(
    edge.labelStyle?.fill ?? 'var(--unilab-color-text-muted)'
  )
  return {
    id: edge.id,
    source: edge.source
      ? { cell: edge.source, port: edge.sourceHandle || undefined }
      : undefined,
    target: edge.target
      ? { cell: edge.target, port: edge.targetHandle || undefined }
      : undefined,
    router: { name: 'manhattan', args: { padding: 16 } },
    connector: { name: 'rounded', args: { radius: 8 } },
    labels: typeof edge.label === 'string'
      ? [{
          attrs: {
            body: {
              fill: 'var(--unilab-color-surface)',
              stroke: 'var(--unilab-color-border)',
              strokeWidth: 1,
              rx: 4,
              ry: 4
            },
            label: {
              text: edge.label,
              fill: labelColor,
              fontFamily: 'var(--unilab-font-sans)',
              fontSize: 10,
              fontWeight: 700
            }
          }
        }]
      : undefined,
    attrs: {
      root: {
        role: edge.ariaLabel ? 'img' : undefined,
        'aria-label': edge.ariaLabel,
        'data-workflow-edge-kind': visual.material
          ? 'material'
          : visual.ready ? 'ready' : 'structural',
        'data-workflow-edge-animated': edge.animated ? 'true' : 'false',
        'data-workflow-edge-before-start': visual.beforeStart ? 'true' : 'false',
        'data-workflow-material-emphasis': edge.data?.materialEmphasis
      },
      line: {
        stroke: visual.stroke,
        strokeWidth: visual.strokeWidth,
        strokeDasharray: edge.style?.strokeDasharray ?? (
          visual.material ? '3 8' : undefined
        ),
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        targetMarker: visual.material
          ? {
              name: 'block',
              width: visual.supporting ? 7 : 10,
              height: visual.supporting ? 5 : 7,
              fill: visual.stroke,
              stroke: visual.stroke
            }
          : null,
        opacity: visual.beforeStart ? 0.2 : 1
      }
    },
    data: edge.data,
    zIndex: 1
  }
}

function workflowX6EdgeVisual(edge: WorkflowX6Edge): WorkflowX6EdgeVisual {
  const className = edge.className ?? ''
  const material = className.includes('wf-flow-edge--material-trace') ||
    Boolean(edge.data?.materialEmphasis)
  const ready = className.includes('wf-flow-edge--ready') ||
    Boolean(edge.data?.sequence)
  const beforeStart = className.includes('wf-flow-edge--before-start')
  const supporting = edge.data?.materialEmphasis === 'supporting'
  const fallbackWidth = material ? supporting ? 2.4 : 3.6 : 1.5
  return {
    material,
    ready,
    beforeStart,
    supporting,
    stroke: String(
      edge.style?.stroke ?? 'var(--unilab-color-text-subtle)'
    ),
    strokeWidth: Number(edge.style?.strokeWidth ?? fallbackWidth)
  }
}

function workflowActionMetadata(node: WorkflowX6Node): NodeMetadata {
  const { width, height } = workflowX6NodeSize(node)
  const data = node.data
  if (
    !data.layoutStrategy ||
    data.layoutStrategy === 'crossing-minimized'
  ) {
    const markerProjection = workflowDebugMarkerMarkup(data, width)
    const base = workflowNodeBase(node, { width, height }, 'action')
    return createWorkflowPrototypeActionMetadata({
      data,
      width,
      height,
      base,
      markerProjection,
      ports: workflowX6Ports(node),
      titleMarkup: workflowNodeTitleMarkup(data)
    })
  }
  return workflowDetailedActionMetadata(node, width, height)
}

function workflowDetailedActionMetadata(
  node: WorkflowX6Node,
  width: number,
  height: number
): NodeMetadata {
  const data = node.data
  const compact = data.layoutStrategy === 'primary-sample-serpentine'
  const materialCards = workflowMaterialPortCards(
    data.handles ?? [],
    data.materialHandleAccents,
    data.materialLaneByHandle,
    data.materialHandleRoles
  )
  const status = data.status || 'pending'
  const statusLabel = workflowNodeStateLabel(data.kind, status)
  const statusColor = workflowStatusColor(data)
  const markerProjection = workflowDebugMarkerMarkup(data, width)
  const materialProjection = compact
    ? compactMaterialCardMarkup(materialCards, width)
    : actionMaterialCardMarkup(materialCards, width)
  const labelLimit = compact ? 22 : materialCards.length > 0 ? 15 : 26
  const labelX = compact ? 10 : 12
  const labelY = compact ? 19 : height / 2 + 1
  const statusWidth = compact ? Math.min(width - 16, 76) : 68
  const statusX = compact ? 8 : width - statusWidth - 8
  const statusY = compact ? height - 22 : (height - 28) / 2
  const groupLabel = data.groupKind === 'subworkflow'
    ? `${data.groupExpanded ? '▾' : '▸'} ${data.descendantCount ?? 0} 个内部节点`
    : ''
  const base = workflowNodeBase(node, { width, height }, 'action')
  return {
    ...base,
    attrs: {
      ...base.attrs,
      label: {
        refX: 0,
        refY: 0,
        x: labelX,
        y: labelY,
        text: trimLabel(data.name || data.id, labelLimit),
        textAnchor: 'start',
        textVerticalAnchor: 'middle',
        fill: 'var(--unilab-color-text)',
        fontFamily: 'var(--unilab-font-sans)',
        fontSize: 12,
        fontWeight: 650
      },
      statusText: X6_TEXT_ORIGIN,
      ...(groupLabel ? { groupLabel: X6_TEXT_ORIGIN } : {}),
      ...materialProjection.attrs,
      ...markerProjection.attrs
    },
    markup: [
      { tagName: 'rect', selector: 'body', className: 'workflow-x6-node__body' },
      {
        tagName: 'line',
        className: 'workflow-x6-node__divider',
        attrs: compact
          ? { x1: 8, y1: 31, x2: width - 8, y2: 31 }
          : { x1: materialCards.length > 0 ? 116 : width - 84, y1: 8,
              x2: materialCards.length > 0 ? 116 : width - 84, y2: height - 8 }
      },
      {
        tagName: 'text',
        selector: 'label',
        className: 'workflow-x6-node__label',
        attrs: {
          ...X6_TEXT_ORIGIN,
          'aria-hidden': 'true'
        }
      },
      ...materialProjection.markup,
      {
        tagName: 'rect',
        className: 'workflow-x6-node__status-pill',
        attrs: {
          x: statusX,
          y: statusY,
          width: statusWidth,
          height: compact ? 17 : 28,
          rx: 4,
          ry: 4
        }
      },
      {
        tagName: 'circle',
        className: 'workflow-x6-node__status-dot',
        attrs: {
          cx: statusX + 9,
          cy: statusY + (compact ? 8.5 : 14),
          r: 3,
          fill: statusColor
        }
      },
      {
        tagName: 'text',
        selector: 'statusText',
        className: 'workflow-x6-node__status-text',
        textContent: trimLabel(statusLabel, compact ? 8 : 7),
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: statusX + 17,
          y: statusY + (compact ? 11.5 : 17.5),
          fill: statusColor
        }
      },
      ...(groupLabel ? [{
        tagName: 'text',
        selector: 'groupLabel',
        className: 'workflow-x6-node__group-label',
        textContent: groupLabel,
        attrs: { ...X6_TEXT_ORIGIN, x: 12, y: height - 10 }
      }] : []),
      ...markerProjection.markup,
      workflowNodeTitleMarkup(data)
    ],
    ports: workflowX6Ports(node)
  }
}

function workflowMaterialSourceMetadata(node: WorkflowX6Node): NodeMetadata {
  const { width, height } = workflowX6NodeSize(node)
  const data = node.data
  const horizontal = workflowNodeIsHorizontalSpecial(node, width)
  const accent = data.traceAccent || 'var(--unilab-color-workflow)'
  const visual = horizontal
    ? { left: 20, top: 59, width: 72, height: 66 }
    : { left: width - 72, top: (height - 66) / 2, width: 72, height: 66 }
  const labelX = horizontal ? width / 2 : 4
  const labelLayout = horizontal
    ? { title: 10.5, meta: 28, state: 44 }
    : { title: 20, meta: 37.5, state: 53.5 }
  const role = workflowMaterialSourceDescription(data)
  const points = hexagonPoints(visual.left, visual.top, visual.width, visual.height)
  const innerPoints = hexagonPoints(
    visual.left + 3,
    visual.top + 3,
    visual.width - 6,
    visual.height - 6
  )
  const state = data.status || 'pending'
  const markerProjection = workflowDebugMarkerMarkup(data, width)
  const base = workflowNodeBase(node, { width, height }, 'material-source')
  return {
    ...base,
    attrs: {
      ...base.attrs,
      specialLabel: {
        ...X6_TEXT_ORIGIN,
        textAnchor: horizontal ? 'middle' : 'start'
      },
      specialMeta: {
        ...X6_TEXT_ORIGIN,
        textAnchor: horizontal ? 'middle' : 'start'
      },
      specialState: {
        ...X6_TEXT_ORIGIN,
        textAnchor: horizontal ? 'middle' : 'start'
      },
      ...markerProjection.attrs
    },
    markup: [
      { tagName: 'rect', selector: 'body', className: 'workflow-x6-node__selection-target' },
      {
        tagName: 'text',
        selector: 'specialLabel',
        className: 'workflow-x6-node__special-label',
        textContent: trimLabel(data.name || data.id, horizontal ? 15 : 16),
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: labelX,
          y: labelLayout.title,
          textAnchor: horizontal ? 'middle' : 'start'
        }
      },
      {
        tagName: 'text',
        selector: 'specialMeta',
        className: 'workflow-x6-node__special-meta',
        textContent: trimLabel(role, horizontal ? 16 : 18),
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: labelX,
          y: labelLayout.meta,
          textAnchor: horizontal ? 'middle' : 'start'
        }
      },
      {
        tagName: 'g',
        className: 'workflow-x6-node__shape workflow-x6-node__material-shape',
        children: [
          {
            tagName: 'polygon',
            className: 'workflow-x6-node__shape-frame',
            attrs: { points, fill: 'var(--unilab-color-text)' }
          },
          {
            tagName: 'polygon',
            className: 'workflow-x6-node__shape-surface',
            attrs: {
              points: innerPoints,
              fill: `color-mix(in srgb, ${accent} 16%, var(--unilab-color-surface))`
            }
          },
          ...materialGlyphMarkup(visual, accent)
        ]
      },
      {
        tagName: 'text',
        selector: 'specialState',
        className: 'workflow-x6-node__special-state',
        textContent: workflowNodeStateLabel('material_source', state),
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: labelX,
          y: labelLayout.state,
          fill: workflowStatusColor(data),
          textAnchor: horizontal ? 'middle' : 'start'
        }
      },
      ...markerProjection.markup,
      workflowNodeTitleMarkup(data)
    ],
    ports: workflowX6Ports(node)
  }
}

function workflowRobotTransferMetadata(node: WorkflowX6Node): NodeMetadata {
  const { width, height } = workflowX6NodeSize(node)
  const data = node.data
  const horizontal = workflowNodeIsHorizontalSpecial(node, width)
  const handleAxis = horizontal
    ? WORKFLOW_HORIZONTAL_TRANSFER_NODE_HANDLE_AXIS
    : WORKFLOW_VERTICAL_TRANSFER_NODE_HANDLE_AXIS
  const visual = horizontal
    ? { left: (width - 54) / 2, top: handleAxis - 27, size: 54 }
    : { left: handleAxis - 27, top: (height - 54) / 2, size: 54 }
  const labelX = horizontal ? width / 2 : 4
  const labelLayout = horizontal
    ? { title: 10, meta: 26.5, state: 41 }
    : { title: 21.5, meta: 38, state: 52.5 }
  const state = data.status || 'pending'
  const markerProjection = workflowDebugMarkerMarkup(data, width)
  const diamond = [
    `${visual.left + visual.size / 2},${visual.top}`,
    `${visual.left + visual.size},${visual.top + visual.size / 2}`,
    `${visual.left + visual.size / 2},${visual.top + visual.size}`,
    `${visual.left},${visual.top + visual.size / 2}`
  ].join(' ')
  const innerDiamond = [
    `${visual.left + visual.size / 2},${visual.top + 2}`,
    `${visual.left + visual.size - 2},${visual.top + visual.size / 2}`,
    `${visual.left + visual.size / 2},${visual.top + visual.size - 2}`,
    `${visual.left + 2},${visual.top + visual.size / 2}`
  ].join(' ')
  const base = workflowNodeBase(node, { width, height }, 'robot-transfer')
  return {
    ...base,
    attrs: {
      ...base.attrs,
      specialLabel: {
        ...X6_TEXT_ORIGIN,
        textAnchor: horizontal ? 'middle' : 'start'
      },
      specialMeta: {
        ...X6_TEXT_ORIGIN,
        textAnchor: horizontal ? 'middle' : 'start'
      },
      specialState: {
        ...X6_TEXT_ORIGIN,
        textAnchor: horizontal ? 'middle' : 'start'
      },
      ...markerProjection.attrs
    },
    markup: [
      { tagName: 'rect', selector: 'body', className: 'workflow-x6-node__selection-target' },
      {
        tagName: 'text',
        selector: 'specialLabel',
        className: 'workflow-x6-node__special-label',
        textContent: trimLabel(data.name || data.id, horizontal ? 16 : 15),
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: labelX,
          y: labelLayout.title,
          textAnchor: horizontal ? 'middle' : 'start'
        }
      },
      {
        tagName: 'text',
        selector: 'specialMeta',
        className: 'workflow-x6-node__special-meta',
        textContent: '机械臂转运',
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: labelX,
          y: labelLayout.meta,
          textAnchor: horizontal ? 'middle' : 'start'
        }
      },
      {
        tagName: 'g',
        className: 'workflow-x6-node__shape workflow-x6-node__transfer-shape',
        children: [
          {
            tagName: 'polygon',
            className: 'workflow-x6-node__shape-frame',
            attrs: { points: diamond, fill: 'var(--unilab-color-text)' }
          },
          {
            tagName: 'polygon',
            className: 'workflow-x6-node__shape-surface',
            attrs: { points: innerDiamond, fill: 'var(--unilab-color-surface)' }
          },
          ...robotGlyphMarkup(visual)
        ]
      },
      {
        tagName: 'text',
        selector: 'specialState',
        className: 'workflow-x6-node__special-state',
        textContent: workflowNodeStateLabel(data.kind, state),
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: labelX,
          y: labelLayout.state,
          fill: workflowStatusColor(data),
          textAnchor: horizontal ? 'middle' : 'start'
        }
      },
      ...markerProjection.markup,
      workflowNodeTitleMarkup(data)
    ],
    ports: workflowX6Ports(node)
  }
}

function workflowReactionMaterialMetadata(node: WorkflowX6Node): NodeMetadata {
  const data = node.data as WorkflowReactionMaterialNodeData
  const { width, height } = workflowX6NodeSize(node)
  const base = workflowNodeBase(
    node,
    { width, height },
    'reaction-material',
    true
  )
  const reactionTextAttrs = Object.fromEntries(
    data.reactionMaterials.flatMap((_, index) => [
      [`reactionName${index}`, X6_TEXT_ORIGIN],
      [`reactionRole${index}`, {
        ...X6_TEXT_ORIGIN,
        textAnchor: 'end'
      }]
    ])
  )
  return {
    ...base,
    attrs: { ...base.attrs, ...reactionTextAttrs },
    zIndex: 0,
    data: { ...data, kind: 'reaction_material' },
    markup: [
      { tagName: 'rect', selector: 'body', className: 'workflow-x6-node__reaction-body' },
      ...data.reactionMaterials.flatMap((item, index) => {
        const y = index * REACTION_MATERIAL_ITEM_HEIGHT
        return [
          {
            tagName: 'line',
            className: 'workflow-x6-node__reaction-line',
            attrs: {
              x1: 2,
              y1: y + REACTION_MATERIAL_ITEM_HEIGHT - 1,
              x2: width - 2,
              y2: y + REACTION_MATERIAL_ITEM_HEIGHT - 1,
              stroke: `color-mix(in srgb, ${item.accent} 22%, var(--unilab-color-border))`
            }
          },
          {
            tagName: 'circle',
            className: 'workflow-x6-node__reaction-dot',
            attrs: { cx: 5, cy: y + 10, r: 2.5, fill: item.accent }
          },
          {
            tagName: 'text',
            selector: `reactionName${index}`,
            className: 'workflow-x6-node__reaction-name',
            textContent: trimLabel(item.sourceNodeName, 17),
            attrs: { ...X6_TEXT_ORIGIN, x: 13, y: y + 13 }
          },
          {
            tagName: 'text',
            selector: `reactionRole${index}`,
            className: 'workflow-x6-node__reaction-role',
            textContent: item.materialRoleLabel,
            attrs: {
              ...X6_TEXT_ORIGIN,
              x: width - 3,
              y: y + 13,
              textAnchor: 'end'
            }
          }
        ]
      }),
      workflowNodeTitleMarkup(data)
    ]
  }
}

function workflowNodeBase(
  node: WorkflowX6Node,
  size: WorkflowX6NodeSize,
  visualKind: string,
  annotation = false
): NodeMetadata {
  const data = node.data
  const className = node.className ?? ''
  const status = data.status || 'pending'
  const tooltipText = workflowX6NodeTooltipText(node)
  return {
    id: node.id,
    shape: 'rect',
    x: node.position.x,
    y: node.position.y,
    width: size.width,
    height: size.height,
    zIndex: annotation ? 0 : status === 'running' ? 4 : 2,
    data: node.data,
    // Keep X6's fallback port invisible. Every supported port below supplies
    // explicit markup; this prevents malformed legacy entries from rendering
    // X6's 10px black/white default circle at the node origin.
    portMarkup: WORKFLOW_X6_HIDDEN_PORT_MARKUP,
    attrs: {
      root: {
        tabindex: annotation ? -1 : 0,
        role: annotation ? 'note' : 'button',
        'aria-label': workflowNodeAriaLabel(data),
        'data-workflow-node-overflow': tooltipText ? 'true' : 'false',
        'data-workflow-node-tooltip': tooltipText || '',
        ...(tooltipText ? { title: tooltipText } : {}),
        'data-workflow-node-kind': data.kind || 'action',
        'data-workflow-node-visual-kind': visualKind,
        'data-workflow-status': status,
        'data-workflow-source-selected': data.sourceSelected ? 'true' : 'false',
        'data-workflow-runtime-selected': className.includes(
          'wf-flow-node--runtime-selected'
        ) ? 'true' : 'false',
        'data-workflow-before-start': data.beforeStart ? 'true' : 'false',
        'data-workflow-disabled': data.disabled ? 'true' : 'false',
        'data-workflow-paused-before': data.pausedBefore ? 'true' : 'false',
        'data-workflow-breakpoint': data.breakpoint ? 'true' : 'false',
        'data-workflow-start-node': data.startNode ? 'true' : 'false',
        'data-workflow-group-kind': data.groupKind,
        'data-workflow-layout-strategy': data.layoutStrategy,
        'data-workflow-layout-direction': data.materialLaneDirection
      },
      body: {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        rx: 6,
        ry: 6,
        fill: 'var(--unilab-color-surface)',
        stroke: 'var(--unilab-color-border-strong)',
        strokeWidth: 1
      },
      label: {
        refX: 0,
        refY: 0,
        textAnchor: 'start',
        textVerticalAnchor: 'middle'
      }
    }
  }
}

/** 创建 Canonical 端口身份，并为原型卡片补齐固定的左右视觉端口。 */
function workflowX6Ports(node: WorkflowX6Node): NodeMetadata['ports'] {
  const data = node.data
  const prototypeCard = !data.layoutStrategy ||
    data.layoutStrategy === 'crossing-minimized'
  const targetSide = prototypeCard ? 'left' : node.targetPosition ?? (
    data.materialLaneDirection === 'horizontal' ? 'left' : 'top'
  )
  const sourceSide = prototypeCard ? 'right' : node.sourcePosition ?? (
    data.materialLaneDirection === 'horizontal' ? 'right' : 'bottom'
  )
  const specialGeometry = workflowX6SpecialPortGeometry(node)
  const nodeSize = workflowX6NodeSize(node)
  // Canonical handles always carry one of the two supported I/O directions.
  // Older workflow snapshots can contain placeholder entries without a
  // direction; passing those through to X6 makes it fall back to its default
  // port markup at (0, 0), which appears as the oversized circle in the
  // upper-left corner of the card.
  const canonicalHandles = (data.handles ?? []).filter(
    (handle): handle is WorkflowHandlePort =>
      handle.ioType === 'target' || handle.ioType === 'source'
  )
  // HTML 原型卡片的结构端口是固定的左右一对，与 Python/OS 暴露的
  // handle 数量无关。真实 handle 仍保留在端口集合中作为连线身份，
  // 但只有每侧选中的一个端口参与视觉投影。
  const fixedPrototypeHandles = prototypeCard && !specialGeometry
  const fixedHandleByIoType = fixedPrototypeHandles
    ? new Map((['target', 'source'] as const).map((ioType) => [
        ioType,
        fixedPrototypeHandle(canonicalHandles, ioType)
      ]))
    : undefined
  return {
    groups: {
      target: { position: targetSide },
      source: { position: sourceSide },
      ...(specialGeometry ? {
        materialTarget: {
          position: {
            name: 'absolute',
            args: specialGeometry.target
          }
        },
        materialSource: {
          position: {
            name: 'absolute',
            args: specialGeometry.source
          }
        }
      } : {})
    },
    items: [
      ...canonicalHandles.map(handle => {
      const material = isResourceSlotHandle(handle)
      const ready = !material && isReadyHandle(handle)
      const fixedVisible = fixedHandleByIoType?.get(handle.ioType)?.uuid ===
        handle.uuid
      const visible = fixedPrototypeHandles ? fixedVisible : true
      const kind = visible && material
        ? 'material'
        : visible && (ready || fixedPrototypeHandles)
          ? 'ready'
          : 'structural'
      const side = handle.ioType === 'target' ? targetSide : sourceSide
      const accent = data.materialHandleAccents?.[handle.uuid] ??
        data.traceAccent ?? 'var(--unilab-color-workflow)'
      const horizontalMaterial = material &&
        data.materialLaneDirection === 'horizontal'
      const portArgs = specialGeometry && material
        ? undefined
        : fixedPrototypeHandles && visible
          ? workflowX6FixedPortArgs(
              handle,
              canonicalHandles,
              side,
              nodeSize
            )
        : workflowX6VisiblePortArgs(
            handle,
            canonicalHandles,
            side,
            nodeSize
          )
      return {
        id: handle.uuid,
        group: material && specialGeometry
          ? handle.ioType === 'target' ? 'materialTarget' : 'materialSource'
          : handle.ioType,
        markup: [{
          tagName: (ready || (fixedPrototypeHandles && visible)) &&
            !prototypeCard ? 'rect' : 'circle',
          selector: 'portBody',
          className: [
            'workflow-x6-port',
            `workflow-x6-port--${kind}`,
            `workflow-x6-port--${handle.ioType}`
          ]
        }],
        attrs: {
          portBody: visible && (ready || fixedPrototypeHandles) &&
            prototypeCard
            ? {
                r: 4,
                magnet: handle.ioType === 'source' ? true : 'passive',
                stroke: 'var(--unilab-color-text-subtle)',
                strokeWidth: 2,
                fill: 'var(--unilab-color-surface)',
                'data-workflow-handle-kind': kind
              }
            : visible && (ready || fixedPrototypeHandles)
            ? workflowReadyPortAttrs(side, handle.ioType)
            : visible && material
              ? {
                  r: horizontalMaterial
                    ? 5
                    : data.visualKind === 'robot-transfer' ? 4 : 4.5,
                  magnet: handle.ioType === 'source' ? true : 'passive',
                  stroke: accent,
                  strokeWidth: horizontalMaterial ? 2 : 3,
                  fill: horizontalMaterial && handle.ioType === 'source'
                    ? accent
                    : 'var(--unilab-color-surface)',
                'data-workflow-handle-kind': kind
              }
            : {
                  r: 4,
                  magnet: handle.ioType === 'source' ? true : 'passive',
                  stroke: 'transparent',
                  fill: 'transparent',
                  opacity: 0,
                  visibility: 'hidden',
                  pointerEvents: 'none',
                  'data-workflow-handle-kind': kind
                }
        },
        ...(portArgs ? { args: portArgs } : {})
      } as WorkflowX6PortMetadata
      }),
      fixedPrototypeHandles
        ? (['target', 'source'] as const)
            .filter((ioType) => !fixedHandleByIoType?.get(ioType))
            .map((ioType) => workflowX6SyntheticPort(
              node.id,
              ioType,
              ioType === 'target' ? targetSide : sourceSide
            ))
        : []
    ]
  }
}

/** 选择每侧唯一的视觉端口；优先执行顺序端口，其次普通结构端口。 */
function fixedPrototypeHandle(
  handles: readonly WorkflowHandlePort[] | undefined,
  ioType: 'source' | 'target'
): WorkflowHandlePort | undefined {
  const sideHandles = (handles ?? []).filter((handle) =>
    handle.ioType === ioType
  )
  return sideHandles.find((handle) =>
    !isResourceSlotHandle(handle) && isReadyHandle(handle)
  ) ?? sideHandles.find((handle) => !isResourceSlotHandle(handle)) ??
    sideHandles[0]
}

/** 将固定视觉端口在同侧的真实 handle 集合中校正到边缘中心。 */
function workflowX6FixedPortArgs(
  handle: WorkflowHandlePort,
  handles: readonly WorkflowHandlePort[],
  side: WorkflowX6PortSide,
  nodeSize: WorkflowX6NodeSize
): Record<string, number> | undefined {
  const sideHandles = handles.filter((item) => item.ioType === handle.ioType)
  const sideIndex = sideHandles.findIndex((item) => item.uuid === handle.uuid)
  if (sideIndex < 0 || sideHandles.length <= 1) return undefined
  const currentRatio = (sideIndex + 0.5) / sideHandles.length
  const delta = 0.5 - currentRatio
  if (Math.abs(delta) < Number.EPSILON) return undefined
  return side === 'left' || side === 'right'
    ? { dy: nodeSize.height * delta }
    : { dx: nodeSize.width * delta }
}

/** 无 OS handle 时仍显示固定的左右端口，但不允许伪造连线身份。 */
function workflowX6SyntheticPort(
  nodeId: string,
  ioType: 'source' | 'target',
  side: WorkflowX6PortSide
): WorkflowX6PortMetadata {
  return {
    id: `__visual_${ioType}_${nodeId}`,
    group: ioType,
    markup: [{
      tagName: 'circle',
      selector: 'portBody',
      className: [
        'workflow-x6-port',
        'workflow-x6-port--ready',
        `workflow-x6-port--${ioType}`,
        'workflow-x6-port--visual-only'
      ]
    }],
    attrs: {
      portBody: {
        r: 4,
        magnet: false,
        stroke: 'var(--unilab-color-text-subtle)',
        strokeWidth: 2,
        fill: 'var(--unilab-color-surface)',
        'data-workflow-handle-kind': 'visual-only',
        'data-workflow-handle-visual': 'fixed',
        'data-workflow-handle-side': side
      }
    }
  }
}

/**
 * 让可见端口只按可见端口数量分布，避免透明结构端口把左右轴线推偏。
 *
 * X6 默认会把同一分组内的所有端口均匀排列，包含不可见的结构端口；
 * 旧版画布只对可见的 Ready/物料端口进行视觉定位，因此这里用偏移量
 * 将可见端口恢复到各自侧面的对称位置。
 */
function workflowX6VisiblePortArgs(
  handle: WorkflowHandlePort,
  handles: readonly WorkflowHandlePort[],
  side: WorkflowX6PortSide,
  nodeSize: WorkflowX6NodeSize
): Record<string, number> | undefined {
  if (!isReadyHandle(handle) && !isResourceSlotHandle(handle)) return undefined
  const sideHandles = handles.filter(item => item.ioType === handle.ioType)
  const visibleSideHandles = sideHandles.filter(item =>
    isReadyHandle(item) || isResourceSlotHandle(item)
  )
  const sideIndex = sideHandles.findIndex(item => item.uuid === handle.uuid)
  const visibleIndex = visibleSideHandles.findIndex(
    item => item.uuid === handle.uuid
  )
  if (sideIndex < 0 || visibleIndex < 0) return undefined
  const currentRatio = (sideIndex + 0.5) / sideHandles.length
  const desiredRatio = (visibleIndex + 0.5) / visibleSideHandles.length
  const delta = desiredRatio - currentRatio
  if (Math.abs(delta) < Number.EPSILON) return undefined
  if (side === 'left' || side === 'right') {
    return { dy: nodeSize.height * delta }
  }
  return { dx: nodeSize.width * delta }
}

/**
 * 还原特殊节点在 React Flow 内部图形上的端口轴，而非 X6 选区边缘。
 */
function workflowX6SpecialPortGeometry(
  node: WorkflowX6Node
): WorkflowX6SpecialPortGeometry | null {
  const horizontal = node.data.materialLaneDirection === 'horizontal'
  if (node.data.kind === 'material_source') {
    if (horizontal) {
      return {
        target: { x: 20, y: WORKFLOW_HORIZONTAL_MATERIAL_SOURCE_HANDLE_AXIS },
        source: { x: 92, y: WORKFLOW_HORIZONTAL_MATERIAL_SOURCE_HANDLE_AXIS }
      }
    }
    return {
      target: { x: WORKFLOW_VERTICAL_MATERIAL_SOURCE_HANDLE_AXIS, y: 3 },
      source: { x: WORKFLOW_VERTICAL_MATERIAL_SOURCE_HANDLE_AXIS, y: 69 }
    }
  }
  if (node.data.visualKind !== 'robot-transfer') return null
  if (horizontal) {
    return {
      target: { x: 33, y: WORKFLOW_HORIZONTAL_TRANSFER_NODE_HANDLE_AXIS },
      source: { x: 87, y: WORKFLOW_HORIZONTAL_TRANSFER_NODE_HANDLE_AXIS }
    }
  }
  return {
    target: { x: WORKFLOW_VERTICAL_TRANSFER_NODE_HANDLE_AXIS, y: 9 },
    source: { x: WORKFLOW_VERTICAL_TRANSFER_NODE_HANDLE_AXIS, y: 63 }
  }
}

function workflowReadyPortAttrs(
  side: WorkflowX6PortSide,
  ioType: 'source' | 'target'
): Record<string, string | number | true> {
  const horizontalSide = side === 'left' || side === 'right'
  return {
    x: horizontalSide ? -1.5 : -6,
    y: horizontalSide ? -6 : -1.5,
    width: horizontalSide ? 3 : 12,
    height: horizontalSide ? 12 : 3,
    rx: 1.5,
    ry: 1.5,
    magnet: ioType === 'source' ? true : 'passive',
    stroke: 'none',
    fill: 'var(--unilab-color-text-muted)',
    'data-workflow-handle-kind': 'ready'
  }
}

function workflowX6NodeSize(node: WorkflowX6Node): WorkflowX6NodeSize {
  const data = node.data
  const reactionItems = node.type === 'wfReactionMaterial'
    ? (data as WorkflowReactionMaterialNodeData).reactionMaterials.length
    : 0
  if (reactionItems > 0) {
    return {
      width: numericSize(node.style?.width, REACTION_MATERIAL_NODE_WIDTH),
      height: numericSize(
        node.style?.height,
        Math.max(REACTION_MATERIAL_ITEM_HEIGHT,
          reactionItems * REACTION_MATERIAL_ITEM_HEIGHT)
      )
    }
  }
  const horizontal = data.materialLaneDirection === 'horizontal'
  if (data.kind === 'material_source') {
    return {
      width: numericSize(node.style?.width,
        horizontal ? HORIZONTAL_MATERIAL_SOURCE_WIDTH : MATERIAL_SOURCE_WIDTH),
      height: numericSize(node.style?.height,
        horizontal ? HORIZONTAL_MATERIAL_SOURCE_HEIGHT : MATERIAL_SOURCE_HEIGHT)
    }
  }
  if (data.visualKind === 'robot-transfer') {
    return {
      width: numericSize(node.style?.width,
        horizontal ? HORIZONTAL_TRANSFER_NODE_WIDTH : TRANSFER_NODE_WIDTH),
      height: numericSize(node.style?.height,
        horizontal ? HORIZONTAL_TRANSFER_NODE_HEIGHT : TRANSFER_NODE_HEIGHT)
    }
  }
  const materialVariables = new Set(
    (data.handles ?? [])
      .filter(isResourceSlotHandle)
      .map(handle => handle.dataKey?.trim() || handle.handleKey)
  ).size
  if (data.layoutStrategy === 'primary-sample-serpentine') {
    return {
      width: numericSize(node.style?.width, COMPACT_ACTION_NODE_WIDTH),
      height: numericSize(
        node.style?.height,
        COMPACT_ACTION_NODE_BASE_HEIGHT +
          Math.max(0, materialVariables - 1) * COMPACT_MATERIAL_CARD_PITCH
      )
    }
  }
  if (data.layoutStrategy !== 'material-swimlanes') {
    return {
      width: numericSize(node.style?.width, PROTOTYPE_ACTION_NODE_WIDTH),
      height: numericSize(
        node.style?.height,
        data.groupKind === 'subworkflow'
          ? PROTOTYPE_SUBWORKFLOW_NODE_HEIGHT
          : PROTOTYPE_ACTION_NODE_HEIGHT
      )
    }
  }
  return {
    width: numericSize(node.style?.width, Math.min(
      ACTION_NODE_MAX_WIDTH,
      Math.max(ACTION_NODE_MIN_WIDTH, 170 + materialVariables * 78)
    )),
    height: numericSize(node.style?.height,
      data.groupKind === 'subworkflow'
        ? SUBWORKFLOW_NODE_HEIGHT
        : ACTION_NODE_HEIGHT)
  }
}

function actionMaterialCardMarkup(
  cards: ReturnType<typeof workflowMaterialPortCards>,
  width: number
): WorkflowX6MarkupProjection {
  const visibleCards = cards.slice(0, 4)
  const availableWidth = Math.max(0, width - 116 - 82)
  const cardWidth = visibleCards.length > 0
    ? Math.max(42, Math.min(70, (availableWidth - 4) / visibleCards.length - 4))
    : 0
  const attrs = Object.fromEntries(visibleCards.map((_, index) => [
    `materialLabel${index}`,
    X6_TEXT_ORIGIN
  ]))
  return { attrs, markup: visibleCards.flatMap((card, index) => {
    const x = 122 + index * (cardWidth + 4)
    return [
      {
        tagName: 'rect',
        className: 'workflow-x6-node__material-card',
        attrs: {
          x,
          y: 17,
          width: cardWidth,
          height: 30,
          rx: 4,
          ry: 4,
          stroke: `color-mix(in srgb, ${card.accent} 30%, var(--unilab-color-border))`,
          fill: `color-mix(in srgb, ${card.accent} 5%, var(--unilab-color-surface))`
        }
      },
      {
        tagName: 'text',
        selector: `materialLabel${index}`,
        className: 'workflow-x6-node__material-label',
        textContent: trimLabel(card.label, Math.max(4, Math.floor(cardWidth / 10))),
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: x + 7,
          y: 35,
          fill: card.accent
        }
      }
    ]
  }) }
}

function compactMaterialCardMarkup(
  cards: ReturnType<typeof workflowMaterialPortCards>,
  width: number
): WorkflowX6MarkupProjection {
  const visibleCards = cards.slice(0, 4)
  const attrs = Object.fromEntries(visibleCards.map((_, index) => [
    `materialLabel${index}`,
    X6_TEXT_ORIGIN
  ]))
  return { attrs, markup: visibleCards.flatMap((card, index) => {
    const y = 36 + index * COMPACT_MATERIAL_CARD_PITCH
    return [
      {
        tagName: 'rect',
        className: 'workflow-x6-node__material-card',
        attrs: {
          x: 6,
          y,
          width: width - 12,
          height: 28,
          rx: 4,
          ry: 4,
          stroke: `color-mix(in srgb, ${card.accent} 30%, var(--unilab-color-border))`,
          fill: `color-mix(in srgb, ${card.accent} 5%, var(--unilab-color-surface))`
        }
      },
      {
        tagName: 'text',
        selector: `materialLabel${index}`,
        className: 'workflow-x6-node__material-label',
        textContent: trimLabel(card.label, 24),
        attrs: {
          ...X6_TEXT_ORIGIN,
          x: 14,
          y: y + 18,
          fill: card.accent
        }
      }
    ]
  }) }
}

function workflowDebugMarkerMarkup(
  data: WorkflowNodeData,
  width: number
): WorkflowX6MarkupProjection {
  const flags = [
    data.startNode
      ? { text: '⚑ 起始点', className: 'workflow-x6-node__flag--start' }
      : null,
    data.pausedBefore
      ? { text: '▶ 下一步', className: 'workflow-x6-node__flag--paused' }
      : null,
    data.beforeStart
      ? { text: '⊘ 不执行', className: 'workflow-x6-node__flag--excluded' }
      : null,
    data.disabled
      ? { text: '⊘ 已禁用', className: 'workflow-x6-node__flag--disabled' }
      : null
  ].filter((flag): flag is { text: string; className: string } => Boolean(flag))
  const attrs = Object.fromEntries(flags.map((_, index) => [
    `debugFlag${index}`,
    { ...X6_TEXT_ORIGIN, textAnchor: 'end' }
  ]))
  const markup: WorkflowX6Markup = flags.map((flag, index) => ({
    tagName: 'text',
    selector: `debugFlag${index}`,
    className: `workflow-x6-node__flag ${flag.className}`,
    textContent: flag.text,
    attrs: {
      ...X6_TEXT_ORIGIN,
      x: width - index * 58,
      y: -6,
      textAnchor: 'end'
    }
  }))
  if (data.breakpoint) {
    markup.push({
      tagName: 'circle',
      className: 'workflow-x6-node__breakpoint',
      attrs: { cx: width + 1, cy: -1, r: 6.5 }
    })
  }
  return { attrs, markup }
}

function workflowNodeTitleMarkup(data: WorkflowNodeData): WorkflowX6MarkupItem {
  return {
    tagName: 'title',
    textContent: data.description?.trim() || data.name || data.id
  }
}

function materialGlyphMarkup(
  visual: { left: number; top: number; width: number; height: number },
  accent: string
): WorkflowX6Markup {
  const centerX = visual.left + visual.width / 2
  const centerY = visual.top + visual.height / 2
  return [
    {
      tagName: 'path',
      className: 'workflow-x6-node__material-glyph',
      attrs: {
        d: `M${centerX - 9} ${centerY - 3} l9 -4.5 9 4.5 -9 4.5 -9 -4.5 Z`,
        stroke: accent
      }
    },
    {
      tagName: 'path',
      className: 'workflow-x6-node__material-glyph',
      attrs: {
        d: `M${centerX - 9} ${centerY - 3} v6 l9 4.5 9 -4.5 v-6`,
        stroke: accent
      }
    }
  ]
}

function robotGlyphMarkup(
  visual: { left: number; top: number; size: number }
): WorkflowX6Markup {
  const iconSize = 32
  const scale = iconSize / 48
  const x = visual.left + (visual.size - iconSize) / 2
  const y = visual.top + (visual.size - iconSize) / 2
  const point = (value: number): number => value * scale
  return [
    {
      tagName: 'path',
      className: 'workflow-x6-node__robot-glyph',
      attrs: {
        d: [
          `M${x + point(13)} ${y + point(39)} H${x + point(35)}`,
          `M${x + point(17)} ${y + point(39)} v${-point(6)} h${point(14)} v${point(6)}`,
          `M${x + point(21.8)} ${y + point(26.2)} l${point(7.3)} ${-point(8.2)}`,
          `M${x + point(28.6)} ${y + point(13.5)} l${-point(5.3)} ${-point(5.2)}`,
          `M${x + point(20.7)} ${y + point(6)} h${point(6)} v${point(4.7)}`,
          `M${x + point(34)} ${y + point(16)} l${point(4.2)} ${point(3.4)}`,
          `M${x + point(38.2)} ${y + point(19.4)} l${point(2.8)} ${-point(2.4)}`,
          `M${x + point(38.2)} ${y + point(19.4)} l${point(.7)} ${point(3.7)}`
        ].join(' ')
      }
    },
    {
      tagName: 'circle',
      className: 'workflow-x6-node__robot-glyph',
      attrs: { cx: x + point(19), cy: y + point(29), r: point(4) }
    },
    {
      tagName: 'circle',
      className: 'workflow-x6-node__robot-glyph',
      attrs: { cx: x + point(31), cy: y + point(16), r: point(3.5) }
    }
  ]
}

function workflowStatusColor(data: WorkflowNodeData): string {
  if (data.disabled || data.beforeStart) return 'var(--unilab-color-skipped)'
  if (data.pausedBefore) return 'var(--unilab-color-paused)'
  if (data.status === 'success' || data.status === 'succeeded') {
    return 'var(--unilab-color-success)'
  }
  if (
    data.status === 'failed' ||
    data.status === 'cancelled' ||
    data.status === 'reconciling'
  ) return 'var(--unilab-color-danger)'
  if (data.status === 'running') return 'var(--unilab-color-warning)'
  return 'var(--unilab-color-skipped)'
}

function workflowNodeAriaLabel(data: WorkflowNodeData): string {
  const status = workflowNodeStateLabel(data.kind, data.status || 'pending')
  const flags = [
    data.startNode ? '起始点' : '',
    data.breakpoint ? '断点' : '',
    data.pausedBefore ? '下一步执行' : '',
    data.beforeStart ? '不执行' : '',
    data.disabled ? '已禁用' : ''
  ].filter(Boolean)
  return [
    data.name || data.id,
    data.description?.trim(),
    status,
    ...flags
  ].filter(Boolean).join('；')
}

function workflowMaterialSourceDescription(data: WorkflowNodeData): string {
  const source = data.materialSource
  if (!source) return '物料来源'
  const role = {
    primary_sample: '主样品',
    aliquot_sample: '分装样品',
    reagent: '试剂',
    consumable: '耗材'
  }[source.flowRole] || source.flowRole
  return `${role} · ${source.mode === 'create_new' ? '新建物料' : '已有物料'}`
}

function workflowNodeIsHorizontalSpecial(
  node: WorkflowX6Node,
  width: number
): boolean {
  return node.data.materialLaneDirection === 'horizontal' && width <= 120
}

function hexagonPoints(
  x: number,
  y: number,
  width: number,
  height: number
): string {
  return [
    `${x + width * 0.25},${y + height * 0.03}`,
    `${x + width * 0.75},${y + height * 0.03}`,
    `${x + width},${y + height / 2}`,
    `${x + width * 0.75},${y + height * 0.97}`,
    `${x + width * 0.25},${y + height * 0.97}`,
    `${x},${y + height / 2}`
  ].join(' ')
}

/** 将 CSS 尺寸收敛为 X6 所需的像素数。 */
function numericSize(value: CSSProperties['width'], fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

/** 按字符上限截断 SVG 标签，完整说明保留在 title 与 ARIA 名称中。 */
function trimLabel(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}
