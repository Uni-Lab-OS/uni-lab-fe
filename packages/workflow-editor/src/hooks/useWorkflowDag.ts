import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'

import type { WorkflowNodeData } from '../components/WorkflowNodeCard'
import { isReadyHandle } from '../components/WorkflowNodeCard'
import type {
  WorkflowReactionMaterialNodeData
} from '../components/WorkflowReactionMaterialNode'
import { layoutDag, type LayoutResult } from '../utils/dagLayout'
import { getNodeColor } from '../utils/nodeColors'
import type { WorkflowHandlePort, WorkflowLink, WorkflowNode } from '../utils/parseWorkflow'
import { layoutVisibleWorkflowDag } from '../utils/workflowDagLayout'
import {
  DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION,
  type WorkflowDagLayoutStrategy,
  type WorkflowMaterialSwimlaneDirection
} from '../utils/workflowDagLayoutStrategy'
import { layoutWorkflowMaterialSwimlanes } from '../utils/workflowMaterialSwimlaneLayout'
import { layoutWorkflowPrimarySampleFlow } from '../utils/workflowPrimarySampleLayout'
import { materialTraceAccent, projectMaterialTraces } from '../utils/workflowMaterialTrace'
import type { WorkflowMaterialTraceProjection } from '../utils/workflowMaterialTrace'
import {
  projectWorkflowReactionMaterialAnnotations,
  type WorkflowReactionMaterialAnnotation,
  type WorkflowSupportingMaterialPresentation
} from '../utils/workflowReactionMaterialProjection'

interface UseWorkflowDagResult {
  nodes: WorkflowDagProjectionNode[]
  edges: WorkflowDagProjectionEdge[]
}

interface WorkflowFlowElements {
  flowNodes: WorkflowDagProjectionNode[]
  flowEdges: WorkflowDagProjectionEdge[]
}

export interface WorkflowDagProjectionNode {
  id: string
  type?: string
  position: { x: number; y: number }
  targetPosition?: 'top' | 'right' | 'bottom' | 'left'
  sourcePosition?: 'top' | 'right' | 'bottom' | 'left'
  style?: CSSProperties
  selectable?: boolean
  draggable?: boolean
  focusable?: boolean
  deletable?: boolean
  selected?: boolean
  className?: string
  data: WorkflowNodeData
}

export interface WorkflowDagProjectionEdge {
  id: string
  type?: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  labelStyle?: CSSProperties
  ariaLabel?: string
  className?: string
  selected?: boolean
  animated?: boolean
  style?: CSSProperties
  data?: {
    direction?: 'TB' | 'LR'
    borderRadius?: number
    sequence?: boolean
    sourceNodeUuid?: string
    targetNodeUuid?: string
    sourceHandleUuid?: string
    targetHandleUuid?: string
    materialRole?: string
    materialEmphasis?: 'primary' | 'supporting'
  }
}

interface WorkflowFlowEdgeContext {
  link: WorkflowLink
  index: number
  layout: LayoutResult
  materialTraces: WorkflowMaterialTraceProjection
  materialRoleByLineage: ReadonlyMap<string, string>
  handleByUuid: ReadonlyMap<string, WorkflowHandlePort>
  nodeNames: ReadonlyMap<string, string>
  compactPrimarySampleLayout: boolean
}

const COMM_EDGE_TYPE = 'communication'
const STRUCTURAL_EDGE_COLOR = 'var(--unilab-color-text-subtle)'
const REACTION_MATERIAL_NODE_WIDTH = 152
const PRIMARY_SAMPLE_NODE_WIDTH = 184
const REACTION_MATERIAL_NODE_GAP = 12
const REACTION_MATERIAL_ITEM_HEIGHT = 22

/**
 * 将当前可见工作流（Workflow）投影为引擎无关节点和正交边。
 *
 * @param nodes 已折叠组合工作流后的全部可见节点。
 * @param links 已重接端点的控制边与物料流（MaterialFlow）边。
 * @param strategy 当前选中的画布布局策略。
 * @param swimlaneDirection 物料泳道策略当前选中的流向。
 * @param supportingMaterialPresentation 辅助物料使用反应式标注或完整支线展示。
 * @returns X6 适配层可直接消费的框架无关节点与边。
 */
export function useWorkflowDag(
  nodes: WorkflowNode[],
  links: WorkflowLink[],
  strategy: WorkflowDagLayoutStrategy =
    DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  swimlaneDirection: WorkflowMaterialSwimlaneDirection =
    DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION,
  supportingMaterialPresentation: WorkflowSupportingMaterialPresentation =
    'full-branches'
): UseWorkflowDagResult {
  const fallback = useMemo(
    () => buildFlowElements(
      strategy === 'material-swimlanes'
        ? layoutWorkflowMaterialSwimlanes(nodes, links, swimlaneDirection)
        : strategy === 'primary-sample-serpentine'
          ? layoutWorkflowPrimarySampleFlow(nodes, links, {
              supportingMaterialPresentation
            })
        : layoutDag(nodes, links, { preserveExistingPositions: false }),
      nodes,
      links,
      strategy,
      supportingMaterialPresentation
    ),
    [
      nodes,
      links,
      strategy,
      supportingMaterialPresentation,
      swimlaneDirection
    ]
  )
  const [flowNodes, setNodes] = useState(fallback.flowNodes)
  const [flowEdges, setEdges] = useState(fallback.flowEdges)

  useEffect(
    /**
     * 同步安装当前同步布局并保留已有有效测量。
     *
     * @returns 无。
     * @throws React 状态更新异常由运行时传播。
     */
    () => {
    setNodes(fallback.flowNodes)
    setEdges(fallback.flowEdges)
    },
    [fallback, setEdges, setNodes]
  )

  useEffect(
    /**
     * 安排异步可见工作流（Workflow）布局并管理取消标志。
     *
     * @returns 卸载或依赖变化时执行的取消回调。
     * @throws 布局失败在本效果内回退同步布局。
     */
    () => {
    let cancelled = false
    const layoutPromise = strategy === 'primary-sample-serpentine'
      ? Promise.resolve(layoutWorkflowPrimarySampleFlow(nodes, links, {
          supportingMaterialPresentation
        }))
      : layoutVisibleWorkflowDag(
          nodes,
          links,
          strategy,
          swimlaneDirection
        )
    void layoutPromise.then(
      /**
       * 安装仍有效的异步布局结果。
       *
       * @param layout 异步布局器返回的节点位置。
       * @returns 无。
       * @throws React 状态更新异常由运行时传播。
       */
      (layout) => {
      if (cancelled) return
      const elements = buildFlowElements(
        layout,
        nodes,
        links,
        strategy,
        supportingMaterialPresentation
      )
      setNodes(elements.flowNodes)
      setEdges(elements.flowEdges)
      }
    ).catch(
      /**
       * 吞掉可恢复的 ELK 布局失败并保留同步布局。
       *
       * @returns 无。
       * @throws 无。
       */
      () => {
      // ELK 不可用时保留已通过碰撞检测的同步分层布局。
      }
    )
    /**
     * 标记本轮异步布局结果不再有效。
     *
     * @returns 无。
     * @throws 无。
     */
    function cancelLayout(): void {
      cancelled = true
    }
    return cancelLayout
    },
    [
      links,
      nodes,
      setEdges,
      setNodes,
      strategy,
      supportingMaterialPresentation,
      swimlaneDirection
    ]
  )

  return {
    nodes: flowNodes,
    edges: flowEdges
  }
}

/**
 * 将布局结果补充为带物料颜色、ready 语义和圆角正交路由的画布元素。
 *
 * @param layout 当前可见图的节点坐标与有效边。
 * @param sourceNodes 用于查询句柄、物料颜色和节点展示信息的源节点。
 * @param sourceLinks 用于计算物料流（MaterialFlow）追踪颜色的源边。
 * @param strategy 当前画布布局策略，用于节点样式和交互投影。
 * @param supportingMaterialPresentation 辅助物料的画布展示方式。
 * @returns 可交给 X6 元数据适配层的节点与边。
 */
function buildFlowElements(
  layout: LayoutResult,
  sourceNodes: readonly WorkflowNode[],
  sourceLinks: readonly WorkflowLink[],
  strategy: WorkflowDagLayoutStrategy,
  supportingMaterialPresentation: WorkflowSupportingMaterialPresentation
): WorkflowFlowElements {
  const materialTraces = projectMaterialTraces(sourceNodes, sourceLinks)
  const nodeNames = new Map(sourceNodes.map((node) => [node.id, node.name]))
  const handleByUuid = new Map(
    sourceNodes.flatMap((node) =>
      (node.handles ?? []).map((handle) => [handle.uuid, handle] as const)
    )
  )
  // 主样品蛇形布局（Primary Sample Serpentine Layout）按节点内紧凑卡片排布，
  // 不继承物料泳道（Material Swimlane）的绝对坐标和节点尺寸。
  const compactPrimarySampleLayout =
    strategy === 'primary-sample-serpentine'
  const reactionFormulaPresentation = compactPrimarySampleLayout &&
    supportingMaterialPresentation === 'reaction-formula' &&
    Boolean(layout.primarySample?.hasPrimarySample)
  const backboneNodeIds = new Set(
    layout.primarySample?.backboneNodeIds ?? []
  )
  // `materialRoleByLineage` 让每条物料边以常数时间读取物料流角色。
  const materialRoleByLineage = new Map(
    materialTraces.lineages.map((lineage) => [
      lineage.key,
      lineage.materialRole
    ])
  )
  const visibleLayoutNodes = reactionFormulaPresentation
    ? layout.nodes.filter((node) => backboneNodeIds.has(node.id))
    : layout.nodes
  const flowNodes: WorkflowDagProjectionNode[] = visibleLayoutNodes.map((node) => {
    const laneLayout = layout.swimlanes?.nodeLayouts.get(node.id)
    const handleLanes = layout.swimlanes?.handleLaneIndexes.get(node.id)
    const nodePorts = layout.nodePorts?.get(node.id)
    return {
      id: node.id,
      type: 'wfNode',
      focusable: node.groupKind !== 'subworkflow',
      position: { x: node.x, y: node.y },
      targetPosition: nodePorts
        ? nodePorts.target
        : layout.direction === 'horizontal'
          ? 'left'
          : 'top',
      sourcePosition: nodePorts
        ? nodePorts.source
        : layout.direction === 'horizontal'
          ? 'right'
          : 'bottom',
      ...(laneLayout && !compactPrimarySampleLayout
        ? { style: { width: laneLayout.width, height: laneLayout.height } }
        : {}),
      data: {
        id: node.id,
        name: node.name,
        description: node.description,
        disabled: node.disabled,
        color: getNodeColor(node.labNodeType, node.type),
        kind: node.type,
        visualKind: node.visualKind,
        groupKind: node.groupKind,
        descendantCount: node.descendantNodeIds?.length,
        openChildWorkflowUuid: node.openChildWorkflowUuid,
        handles: node.handles,
        materialSource: node.materialSource,
        traceAccent: node.type === 'material_source'
          ? materialTraces.materialSourceAccents.get(node.id) ??
            materialTraceAccent(node.id)
          : undefined,
        materialHandleAccents: Object.fromEntries(
          materialTraces.handleAccentsByNode.get(node.id) ?? []
        ),
        materialHandleRoles: Object.fromEntries(
          materialTraces.handleRolesByNode.get(node.id) ?? []
        ),
        materialChips: materialTraces.chipsByNode.get(node.id) ?? [],
        layoutStrategy: strategy,
        materialLaneDirection: layout.swimlanes?.direction ?? (
          strategy === 'primary-sample-serpentine'
            ? 'horizontal'
            : undefined
        ),
        materialLaneRange: laneLayout && !compactPrimarySampleLayout
          ? { start: laneLayout.startLane, end: laneLayout.endLane }
          : undefined,
        materialLaneByHandle: handleLanes && !compactPrimarySampleLayout
          ? Object.fromEntries(handleLanes)
          : undefined
      }
    }
  })

  if (reactionFormulaPresentation) {
    const annotations = projectWorkflowReactionMaterialAnnotations(
      sourceNodes,
      sourceLinks,
      backboneNodeIds
    )
    flowNodes.push(...buildReactionMaterialNodes(layout, annotations))
  }

  const flowEdges = layout.links.flatMap((link, index) => {
    if (
      reactionFormulaPresentation &&
      (!backboneNodeIds.has(link.source) || !backboneNodeIds.has(link.target))
    ) return []
    return [buildWorkflowFlowEdge({
      link,
      index,
      layout,
      materialTraces,
      materialRoleByLineage,
      handleByUuid,
      nodeNames,
      compactPrimarySampleLayout
    })]
  })

  return { flowNodes, flowEdges }
}

/**
 * 把辅助物料反应式标注定位到实际加入的主样品（Primary Sample）步骤上方。
 *
 * @param layout 已完成主样品蛇形排布的画布布局。
 * @param annotations 按主干目标节点分组的辅助物料（Material）标注。
 * @returns 不可选择、不承载执行语义的框架无关注释节点。
 */
function buildReactionMaterialNodes(
  layout: LayoutResult,
  annotations: readonly WorkflowReactionMaterialAnnotation[]
): WorkflowDagProjectionNode[] {
  const layoutNodeById = new Map(layout.nodes.map((node) => [node.id, node]))
  return annotations.flatMap((annotation) => {
    const targetNode = layoutNodeById.get(annotation.targetNodeUuid)
    if (!targetNode) return []
    const annotationHeight = Math.max(
      REACTION_MATERIAL_ITEM_HEIGHT,
      annotation.items.length * REACTION_MATERIAL_ITEM_HEIGHT
    )
    const data: WorkflowReactionMaterialNodeData = {
      id: annotation.targetNodeUuid,
      name: annotation.targetNodeName,
      color: 'transparent',
      reactionMaterials: annotation.items,
      reactionTargetNodeName: annotation.targetNodeName,
      layoutStrategy: 'primary-sample-serpentine',
      materialLaneDirection: 'horizontal'
    }
    return [{
      id: `reaction-materials:${annotation.targetNodeUuid}`,
      type: 'wfReactionMaterial',
      position: {
        x: targetNode.x +
          (PRIMARY_SAMPLE_NODE_WIDTH - REACTION_MATERIAL_NODE_WIDTH) / 2,
        y: targetNode.y - annotationHeight - REACTION_MATERIAL_NODE_GAP
      },
      selectable: false,
      draggable: false,
      focusable: false,
      deletable: false,
      data
    }]
  })
}

/**
 * 将一条工作流边投影为带物料角色层级的框架无关正交边。
 *
 * @param context 当前边、布局、句柄和物料流（MaterialFlow）追踪索引。
 * @returns 保留执行语义、仅调整辅助物料视觉层级的边投影。
 */
function buildWorkflowFlowEdge({
  link,
  index,
  layout,
  materialTraces,
  materialRoleByLineage,
  handleByUuid,
  nodeNames,
  compactPrimarySampleLayout
}: WorkflowFlowEdgeContext): WorkflowDagProjectionEdge {
  const communication = link.type === COMM_EDGE_TYPE
  const materialAccent = materialTraces.edgeAccents.get(index)
  // `materialRole` 来自同一条已追踪物料谱系，确保辅助层级与角色筛选一致。
  const materialRole = materialRoleByLineage.get(
    materialTraces.edgeLineages.get(index) ?? ''
  )
  // `supportingMaterial` 只改变主样品蛇形画布的视觉投影，不改变边语义。
  const supportingMaterial = compactPrimarySampleLayout &&
    Boolean(materialAccent) &&
    materialRole !== 'primary_sample'
  const ready = workflowEdgeIsReady(link, materialAccent, handleByUuid)
  const sourceName = nodeNames.get(link.source) ?? link.source
  const targetName = nodeNames.get(link.target) ?? link.target
  return {
    id: link.id || `e-${link.source}-${link.target}-${index}`,
    source: link.source,
    target: link.target,
    sourceHandle: link.sourceHandleUuid || undefined,
    targetHandle: link.targetHandleUuid || undefined,
    label: link.branch
      ? (link.branch === 'true' ? 'TRUE' : 'FALSE')
      : undefined,
    labelStyle: {
      fill: link.branch === 'true'
        ? 'var(--unilab-color-success)'
        : 'var(--unilab-color-danger)',
      fontSize: 10,
      fontWeight: 700
    },
    type: 'workflowRoundedStep',
    data: {
      direction: workflowEdgeDirection(layout, index),
      borderRadius: 8,
      sequence: ready,
      sourceNodeUuid: link.source,
      targetNodeUuid: link.target,
      sourceHandleUuid: link.sourceHandleUuid || '',
      targetHandleUuid: link.targetHandleUuid || '',
      materialRole,
      materialEmphasis: workflowMaterialEmphasis(
        materialAccent,
        supportingMaterial
      )
    },
    animated: workflowEdgeAnimated(
      communication,
      materialAccent,
      supportingMaterial
    ),
    ariaLabel: workflowEdgeAriaLabel(
      materialAccent,
      ready,
      sourceName,
      targetName
    ),
    style: workflowEdgeStyle(
      materialAccent,
      communication,
      supportingMaterial
    ),
    className: workflowEdgeClassName(
      materialAccent,
      ready,
      supportingMaterial
    )
  }
}

/** 判断一条非物料边是否表达动作就绪（ready）执行顺序。 */
function workflowEdgeIsReady(
  link: WorkflowLink,
  materialAccent: string | undefined,
  handleByUuid: ReadonlyMap<string, WorkflowHandlePort>
): boolean {
  if (materialAccent) return false
  return [link.sourceHandleUuid, link.targetHandleUuid].some((uuid) => {
    const handle = uuid ? handleByUuid.get(uuid) : undefined
    return handle ? isReadyHandle(handle) : false
  })
}

/** 返回布局器为一条工作流边确定的阅读方向。 */
function workflowEdgeDirection(
  layout: LayoutResult,
  index: number
): 'TB' | 'LR' {
  const routedDirection = layout.edgeDirections?.get(index)
  if (routedDirection) return routedDirection
  return layout.direction === 'horizontal' ? 'LR' : 'TB'
}

/** 返回物料边在主样品蛇形画布中的视觉层级。 */
function workflowMaterialEmphasis(
  materialAccent: string | undefined,
  supportingMaterial: boolean
): 'primary' | 'supporting' | undefined {
  if (!materialAccent) return undefined
  return supportingMaterial ? 'supporting' : 'primary'
}

/** 判断工作流边是否播放方向动画；辅助物料加入默认保持静态。 */
function workflowEdgeAnimated(
  communication: boolean,
  materialAccent: string | undefined,
  supportingMaterial: boolean
): boolean {
  if (supportingMaterial) return false
  return communication || Boolean(materialAccent)
}

/** 返回物料边箭头；辅助物料使用更小箭头。 */
/** 返回工作流边的人类可读无障碍名称。 */
function workflowEdgeAriaLabel(
  materialAccent: string | undefined,
  ready: boolean,
  sourceName: string,
  targetName: string
): string | undefined {
  if (materialAccent) return `物料流：${sourceName} 到 ${targetName}`
  if (ready) return `执行顺序：${sourceName} 到 ${targetName}`
  return undefined
}

/**
 * 返回工作流边的线型；物料谱系颜色保持不变，仅加粗主样品主线。
 *
 * @param materialAccent 当前物料谱系的稳定强调色；非物料边为空。
 * @param communication 当前边是否为通信控制边。
 * @param supportingMaterial 当前物料边是否属于辅助物料支线。
 * @returns 画布适配层可直接使用的颜色、线宽与虚线样式。
 */
function workflowEdgeStyle(
  materialAccent: string | undefined,
  communication: boolean,
  supportingMaterial: boolean
): CSSProperties {
  return {
    stroke: materialAccent ?? STRUCTURAL_EDGE_COLOR,
    strokeWidth: materialAccent
      ? supportingMaterial ? 2.4 : 3.6
      : 1.5,
    strokeDasharray: communication && !materialAccent ? '4 4' : undefined
  }
}

/** 返回工作流边的语义样式类。 */
function workflowEdgeClassName(
  materialAccent: string | undefined,
  ready: boolean,
  supportingMaterial: boolean
): string | undefined {
  return [
    materialAccent ? 'wf-flow-edge--material-trace' : '',
    supportingMaterial ? 'wf-flow-edge--supporting-material' : '',
    ready ? 'wf-flow-edge--ready' : ''
  ].filter(Boolean).join(' ') || undefined
}

/**
 * 将布局模块的框架无关端口方位映射为 React Flow 方位枚举。
 *
 * @param side 布局模块返回的节点边缘方位。
 * @returns React Flow 可直接消费的端口方位。
 */
