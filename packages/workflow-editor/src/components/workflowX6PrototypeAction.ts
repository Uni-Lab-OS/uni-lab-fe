import type { NodeMetadata } from '@antv/x6'

import {
  workflowNodeStateLabel,
  type WorkflowNodeData
} from './WorkflowNodeCard'

type ArrayItem<T> = T extends readonly (infer Item)[] ? Item : never
type MarkupItem = ArrayItem<NonNullable<NodeMetadata['markup']>>

interface WorkflowPrototypeActionMetadataInput {
  data: WorkflowNodeData
  width: number
  height: number
  base: NodeMetadata
  markerProjection: {
    attrs: NonNullable<NodeMetadata['attrs']>
    markup: MarkupItem[]
  }
  ports: NodeMetadata['ports']
  titleMarkup: MarkupItem
}

const TEXT_ORIGIN = {
  refX: 0,
  refY: 0,
  textAnchor: 'start',
  textVerticalAnchor: 'middle'
} as const

/**
 * 默认画布使用 HTML 原型的紧凑工作流卡片：类型、名称、说明三行。
 * 运行状态通过整卡边框与底色表达，不再占用独立状态胶囊。
 */
export function createWorkflowPrototypeActionMetadata({
  data,
  base,
  markerProjection,
  ports,
  titleMarkup
}: WorkflowPrototypeActionMetadataInput): NodeMetadata {
  const kind = data.groupKind === 'subworkflow' ? '子工作流' : '实验操作'
  const detail = data.groupKind === 'subworkflow'
    ? `${data.groupExpanded ? '▾' : '▸'} ${data.descendantCount ?? 0} 个内部节点`
    : data.description?.trim() || workflowNodeStateLabel(
      data.kind,
      data.status || 'pending'
    )
  return {
    ...base,
    attrs: {
      ...base.attrs,
      root: {
        ...base.attrs?.root,
        'data-workflow-card-contract': 'html-prototype'
      },
      body: {
        ...base.attrs?.body,
        rx: 10,
        ry: 10
      },
      kind: TEXT_ORIGIN,
      label: TEXT_ORIGIN,
      detail: TEXT_ORIGIN,
      ...markerProjection.attrs
    },
    markup: [
      { tagName: 'rect', selector: 'body', className: 'workflow-x6-node__body' },
      {
        tagName: 'circle',
        className: 'workflow-x6-node__kind-dot',
        attrs: { cx: 13.5, cy: 13, r: 3.5 }
      },
      {
        tagName: 'text',
        selector: 'kind',
        className: 'workflow-x6-node__kind',
        textContent: kind,
        attrs: { ...TEXT_ORIGIN, x: 20, y: 15.5 }
      },
      {
        tagName: 'text',
        selector: 'label',
        className: 'workflow-x6-node__label',
        textContent: trimLabel(data.name || data.id, 11),
        attrs: { ...TEXT_ORIGIN, x: 10, y: 35.5 }
      },
      {
        tagName: 'text',
        selector: 'detail',
        className: 'workflow-x6-node__detail',
        textContent: trimLabel(detail, 20),
        attrs: { ...TEXT_ORIGIN, x: 10, y: 51.5 }
      },
      ...markerProjection.markup,
      titleMarkup
    ],
    ports
  }
}

function trimLabel(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value
}
