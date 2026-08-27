import type {
  EdgeMetadata,
  NodeMetadata
} from '@antv/x6'
import type { CSSProperties } from 'react'

import type { WorkflowNodeData } from './WorkflowNodeCard'

const DEFAULT_NODE_WIDTH = 184
const DEFAULT_NODE_HEIGHT = 92

export interface WorkflowX6Node {
  id: string
  type?: string
  position: { x: number; y: number }
  style?: CSSProperties
  className?: string
  selected?: boolean
  data: WorkflowNodeData
}

export interface WorkflowX6Edge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: React.ReactNode
  className?: string
  selected?: boolean
  animated?: boolean
  style?: CSSProperties
  data?: {
    sourceHandleUuid?: string
    targetHandleUuid?: string
    materialEmphasis?: 'primary' | 'supporting'
  }
}

/** 把框架无关节点投影为轻量 SVG 节点，避免 5000 个 React 子树。 */
export function workflowX6NodeMetadata(node: WorkflowX6Node): NodeMetadata {
  const width = numericSize(node.style?.width, DEFAULT_NODE_WIDTH)
  const height = numericSize(node.style?.height, DEFAULT_NODE_HEIGHT)
  const reaction = node.type === 'wfReactionMaterial'
  const statusColor = workflowStatusColor(node.data)
  return {
    id: node.id,
    shape: 'rect',
    x: node.position.x,
    y: node.position.y,
    width,
    height: reaction ? Math.max(34, height) : height,
    zIndex: reaction ? 0 : 2,
    data: reaction ? { ...node.data, kind: 'reaction_material' } : node.data,
    attrs: {
      root: { tabindex: reaction ? -1 : 0, role: reaction ? 'note' : 'button' },
      body: {
        rx: reaction ? 8 : 12,
        ry: reaction ? 8 : 12,
        fill: reaction ? '#fff8e8' : '#fff',
        stroke: node.selected ? '#3568ed' : reaction ? '#ead7aa' : '#d9e0ea',
        strokeWidth: node.selected ? 2.4 : 1.2,
        strokeDasharray: node.data.groupKind === 'subworkflow' ? '6 4' : undefined,
        filter: node.selected ? 'drop-shadow(0 8px 18px rgba(53,104,237,.18))' : undefined
      },
      label: {
        text: trimLabel(node.data.name, reaction ? 22 : 26),
        fill: '#172033',
        fontSize: reaction ? 10 : 12,
        fontWeight: 650,
        refX: 14,
        refY: reaction ? '50%' : 26,
        textAnchor: 'start',
        textVerticalAnchor: 'middle'
      },
      line: { stroke: statusColor }
    },
    markup: reaction ? undefined : [
      { tagName: 'rect', selector: 'body' },
      {
        tagName: 'rect',
        selector: 'status',
        attrs: {
          x: 0,
          y: 0,
          width: 5,
          height,
          rx: 3,
          fill: statusColor,
          stroke: 'none'
        }
      },
      { tagName: 'text', selector: 'label' },
      {
        tagName: 'text',
        selector: 'meta',
        attrs: {
          text: workflowNodeMeta(node.data),
          x: 14,
          y: 52,
          fill: '#738095',
          fontSize: 9,
          textAnchor: 'start'
        }
      },
      {
        tagName: 'text',
        selector: 'marker',
        attrs: {
          text: workflowNodeMarker(node.data),
          x: width - 12,
          y: 20,
          fill: statusColor,
          fontSize: 9,
          fontWeight: 700,
          textAnchor: 'end'
        }
      }
    ],
    ports: reaction ? undefined : workflowX6Ports(node.data)
  }
}

/** 把布局边投影为 X6 正交边并保留物料颜色与端口身份。 */
export function workflowX6EdgeMetadata(edge: WorkflowX6Edge): EdgeMetadata {
  const stroke = String(edge.style?.stroke ?? '#9aa5b5')
  const strokeWidth = Number(edge.style?.strokeWidth ?? 1.5)
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
      ? [{ attrs: { label: { text: edge.label, fill: '#566176', fontSize: 9 } } }]
      : undefined,
    attrs: {
      line: {
        stroke,
        strokeWidth,
        strokeDasharray: edge.style?.strokeDasharray,
        targetMarker: { name: 'block', width: 8, height: 6 },
        opacity: edge.className?.includes('before-start') ? 0.35 : 1
      }
    },
    data: edge.data,
    zIndex: 1
  }
}

/** 为每个 Canonical Handle UUID 创建同名 X6 端口。 */
function workflowX6Ports(data: WorkflowNodeData): NodeMetadata['ports'] {
  const horizontal = data.materialLaneDirection === 'horizontal'
  return {
    groups: {
      target: {
        position: horizontal ? 'left' : 'top',
        attrs: {
          circle: {
            r: 4,
            magnet: 'passive',
            stroke: '#738095',
            fill: '#fff'
          }
        }
      },
      source: {
        position: horizontal ? 'right' : 'bottom',
        attrs: {
          circle: { r: 4, magnet: true, stroke: '#3568ed', fill: '#fff' }
        }
      }
    },
    items: (data.handles ?? []).map(handle => ({
      id: handle.uuid,
      group: handle.ioType,
      attrs: {
        circle: {
          stroke: data.materialHandleAccents?.[handle.uuid] ?? (
            handle.ioType === 'source' ? '#3568ed' : '#738095'
          )
        }
      }
    }))
  }
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

/** 返回节点运行态在画布中的单一强调色。 */
function workflowStatusColor(data: WorkflowNodeData): string {
  if (data.disabled || data.beforeStart) return '#9aa5b5'
  if (data.pausedBefore) return '#3568ed'
  if (data.status === 'success') return '#2cad6f'
  if (data.status === 'failed' || data.status === 'cancelled') return '#dc4c64'
  if (data.status === 'running' || data.status === 'reconciling') return '#d88b24'
  return data.color || '#738095'
}

/** 返回节点类型、端口数和当前状态组成的紧凑副标题。 */
function workflowNodeMeta(data: WorkflowNodeData): string {
  const parts = [data.kind || 'workflow_node']
  if (data.handles?.length) parts.push(`${data.handles.length} 个端口`)
  if (data.status && data.status !== 'pending') parts.push(data.status)
  return parts.join(' · ')
}

/** 返回开始节点、断点或组合节点的紧凑标记。 */
function workflowNodeMarker(data: WorkflowNodeData): string {
  if (data.startNode) return 'START'
  if (data.breakpoint) return 'BREAK'
  if (data.groupKind === 'subworkflow') {
    return data.groupExpanded ? 'COLLAPSE' : `GROUP ${data.descendantCount ?? ''}`
  }
  return ''
}

/** 按字符上限截断 SVG 标签，完整说明仍保留在 Canonical 节点数据中。 */
function trimLabel(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}
