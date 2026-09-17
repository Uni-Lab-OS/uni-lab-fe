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
  width,
  height,
  base,
  markerProjection,
  ports,
  titleMarkup
}: WorkflowPrototypeActionMetadataInput): NodeMetadata {
  const isSubworkflow = data.groupKind === 'subworkflow'
  const kind = data.kind === 'manual_confirm' ? '人工确认' : isSubworkflow ? '子工作流' : '实验操作'
  const detail = isSubworkflow
    ? `${data.groupExpanded ? '▾' : '▸'} ${data.descendantCount ?? 0} 个内部节点`
    : data.description?.trim() || workflowNodeStateLabel(
      data.kind,
      data.status || 'pending'
    )
  const detailLines = wrapDetail(detail, 22)

  // 方案 A · Dify 分组容器：子工作流卡片使用顶部类型栏 + 左侧强调竖条，
  // 与叶子实验操作节点在视觉上明显区分；折叠计数放在正文行。
  if (isSubworkflow) {
    return {
      ...base,
      attrs: {
        ...base.attrs,
        root: {
          ...base.attrs?.root,
          'data-workflow-card-contract': 'html-prototype'
        },
        body: { ...base.attrs?.body, rx: 10, ry: 10 },
        kind: TEXT_ORIGIN,
        label: {
          ...TEXT_ORIGIN,
          text: data.name || data.id,
          textWrap: { width: Math.max(1, width - 24), height: 18, ellipsis: true, breakWord: true }
        },
        detail: TEXT_ORIGIN,
        ...markerProjection.attrs
      },
      markup: [
        { tagName: 'rect', selector: 'body', className: 'workflow-x6-node__body' },
        // 顶部类型栏底色
        {
          tagName: 'path',
          className: 'workflow-x6-node__group-header',
          attrs: { d: `M0,10 A10,10 0 0 1 10,0 H${width - 10} A10,10 0 0 1 ${width},10 V28 H0 Z` }
        },
        // 左侧强调竖条贯穿整张容器卡片。
        {
          tagName: 'rect',
          className: 'workflow-x6-node__group-accent',
          attrs: { x: 0, y: 0, width: 4, height, rx: 2, ry: 2 }
        },
        {
          tagName: 'rect',
          className: 'workflow-x6-node__group-badge',
          attrs: { x: 10, y: 8, width: 14, height: 14, rx: 4, ry: 4 }
        },
        {
          tagName: 'text',
          className: 'workflow-x6-node__group-glyph',
          textContent: '⧉',
          attrs: { ...TEXT_ORIGIN, x: 17, y: 15.5, textAnchor: 'middle' }
        },
        {
          tagName: 'text',
          selector: 'kind',
          className: 'workflow-x6-node__group-kind',
          textContent: kind,
          attrs: { ...TEXT_ORIGIN, x: 30, y: 15.5 }
        },
        {
          tagName: 'text',
          selector: 'label',
          className: 'workflow-x6-node__group-name',
          attrs: { ...TEXT_ORIGIN, x: 12, y: 48 }
        },
        {
          tagName: 'text',
          selector: 'detail',
          className: 'workflow-x6-node__group-count',
          textContent: detailLines[0],
          attrs: { ...TEXT_ORIGIN, x: 12, y: 68 }
        },
        ...markerProjection.markup,
        titleMarkup
      ],
      ports
    }
  }

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
      label: {
        ...TEXT_ORIGIN,
        text: data.name || data.id,
        textWrap: { width: Math.max(1, width - 20), height: 20, ellipsis: true, breakWord: true }
      },
      detail: TEXT_ORIGIN,
      detailSecondary: TEXT_ORIGIN,
      ...markerProjection.attrs
    },
    markup: [
      { tagName: 'rect', selector: 'body', className: 'workflow-x6-node__body' },
      {
        tagName: 'circle',
        className: 'workflow-x6-node__kind-dot',
        attrs: { cx: 13.5, cy: 15, r: 3.5 }
      },
      {
        tagName: 'text',
        selector: 'kind',
        className: 'workflow-x6-node__kind',
        textContent: kind,
        attrs: { ...TEXT_ORIGIN, x: 20, y: 17.5 }
      },
      {
        tagName: 'text',
        selector: 'label',
        className: 'workflow-x6-node__label',
        attrs: { ...TEXT_ORIGIN, x: 10, y: 40 }
      },
      {
        tagName: 'text',
        selector: 'detail',
        className: 'workflow-x6-node__detail',
        textContent: detailLines[0],
        attrs: { ...TEXT_ORIGIN, x: 10, y: 58 }
      },
      ...(detailLines[1] ? [{
        tagName: 'text' as const,
        selector: 'detailSecondary',
        className: 'workflow-x6-node__detail',
        textContent: detailLines[1],
        attrs: { ...TEXT_ORIGIN, x: 10, y: 71 }
      }] : []),
      ...markerProjection.markup,
      titleMarkup
    ],
    ports
  }
}

function wrapDetail(value: string, lineLimit: number): [string, string?] {
  if (value.length <= lineLimit) return [value]
  if (value.length <= lineLimit * 2) {
    return [value.slice(0, lineLimit), value.slice(lineLimit)]
  }
  return [value.slice(0, lineLimit), value.slice(lineLimit, lineLimit * 2 - 1) + '…']
}

