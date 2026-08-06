import { useEffect, useMemo } from 'react'
import type { Edge, Node, OnNodesChange, OnEdgesChange } from 'reactflow'
import { MarkerType, Position, useNodesState, useEdgesState } from 'reactflow'

import type { WorkflowNodeData } from '../components/WorkflowNodeCard'
import { isReadyHandle } from '../components/WorkflowNodeCard'
import type { WorkflowRoundedStepEdgeData } from '../components/WorkflowRoundedStepEdge'
import { layoutDag, type LayoutResult } from '../utils/dagLayout'
import { getNodeColor } from '../utils/nodeColors'
import type { WorkflowLink, WorkflowNode } from '../utils/parseWorkflow'
import { layoutVisibleWorkflowDag } from '../utils/workflowDagLayout'
import {
  DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION,
  type WorkflowDagLayoutStrategy,
  type WorkflowMaterialSwimlaneDirection
} from '../utils/workflowDagLayoutStrategy'
import { layoutWorkflowMaterialSwimlanes } from '../utils/workflowMaterialSwimlaneLayout'
import { reconcileReactFlowNodeMeasurements } from '../utils/reactFlowNodeMeasurement'
import {
  materialTraceAccent,
  projectMaterialTraces
} from '../utils/workflowMaterialTrace'

interface UseWorkflowDagResult {
  nodes: Node<WorkflowNodeData>[]
  edges: Edge<WorkflowRoundedStepEdgeData>[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
}

interface WorkflowFlowElements {
  flowNodes: Node<WorkflowNodeData>[]
  flowEdges: Edge<WorkflowRoundedStepEdgeData>[]
}

const COMM_EDGE_TYPE = 'communication'
const STRUCTURAL_EDGE_COLOR = 'var(--unilab-color-text-subtle)'

/**
 * 将当前可见工作流（Workflow）投影为可交互的 ReactFlow 节点和正交边。
 *
 * @param nodes 已折叠组合工作流后的全部可见节点。
 * @param links 已重接端点的控制边与物料流（MaterialFlow）边。
 * @param strategy 当前选中的画布布局策略。
 * @param swimlaneDirection 物料泳道策略当前选中的流向。
 * @returns ReactFlow 状态以及节点、边变更入口。
 */
export function useWorkflowDag(
  nodes: WorkflowNode[],
  links: WorkflowLink[],
  strategy: WorkflowDagLayoutStrategy =
    DEFAULT_WORKFLOW_DAG_LAYOUT_STRATEGY,
  swimlaneDirection: WorkflowMaterialSwimlaneDirection =
    DEFAULT_WORKFLOW_MATERIAL_SWIMLANE_DIRECTION
): UseWorkflowDagResult {
  const fallback = useMemo(
    () => buildFlowElements(
      strategy === 'material-swimlanes'
        ? layoutWorkflowMaterialSwimlanes(nodes, links, swimlaneDirection)
        : layoutDag(nodes, links, { preserveExistingPositions: false }),
      nodes,
      links,
      strategy
    ),
    [nodes, links, strategy, swimlaneDirection]
  )
  const [flowNodes, setNodes, onNodesChange] = useNodesState(
    fallback.flowNodes
  )
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState(
    fallback.flowEdges
  )

  useEffect(
    /**
     * 同步安装当前同步布局并保留已有有效测量。
     *
     * @returns 无。
     * @throws React 状态更新异常由运行时传播。
     */
    () => {
    // `currentNodes` 是流程画布引擎当前持有、可能已完成测量的节点集合。
    setNodes(
      /**
       * 合并当前测量与同步布局节点。
       *
       * @param currentNodes 流程画布当前节点。
       * @returns 保留可靠测量的下一版节点。
       * @throws 无。
       */
      (currentNodes) => reconcileReactFlowNodeMeasurements(
        currentNodes,
        fallback.flowNodes
      )
    )
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
    void layoutVisibleWorkflowDag(
      nodes,
      links,
      strategy,
      swimlaneDirection
    ).then(
      /**
       * 安装仍有效的异步布局结果。
       *
       * @param layout 异步布局器返回的节点位置。
       * @returns 无。
       * @throws React 状态更新异常由运行时传播。
       */
      (layout) => {
      if (cancelled) return
      const elements = buildFlowElements(layout, nodes, links, strategy)
      // `currentNodes` 是异步布局完成时仍有效的最新节点与测量集合。
      setNodes(
        /**
         * 合并当前测量与异步布局节点。
         *
         * @param currentNodes 流程画布当前节点。
         * @returns 保留可靠测量的异步布局节点。
         * @throws 无。
         */
        (currentNodes) => reconcileReactFlowNodeMeasurements(
          currentNodes,
          elements.flowNodes
        )
      )
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
    [links, nodes, setEdges, setNodes, strategy, swimlaneDirection]
  )

  return {
    nodes: flowNodes,
    edges: flowEdges,
    onNodesChange,
    onEdgesChange
  }
}

/**
 * 将布局结果补充为带物料颜色、ready 语义和圆角正交路由的画布元素。
 *
 * @param layout 当前可见图的节点坐标与有效边。
 * @param sourceNodes 用于查询句柄、物料颜色和节点展示信息的源节点。
 * @param sourceLinks 用于计算物料流（MaterialFlow）追踪颜色的源边。
 * @param strategy 当前画布布局策略，用于节点样式和交互投影。
 * @returns 可直接交给 ReactFlow 的节点与边。
 */
function buildFlowElements(
  layout: LayoutResult,
  sourceNodes: readonly WorkflowNode[],
  sourceLinks: readonly WorkflowLink[],
  strategy: WorkflowDagLayoutStrategy
): WorkflowFlowElements {
  const materialTraces = projectMaterialTraces(sourceNodes, sourceLinks)
  const nodeNames = new Map(sourceNodes.map((node) => [node.id, node.name]))
  const handleByUuid = new Map(
    sourceNodes.flatMap((node) =>
      (node.handles ?? []).map((handle) => [handle.uuid, handle] as const)
    )
  )
  const flowNodes: Node<WorkflowNodeData>[] = layout.nodes.map((node) => {
    const laneLayout = layout.swimlanes?.nodeLayouts.get(node.id)
    const handleLanes = layout.swimlanes?.handleLaneIndexes.get(node.id)
    return {
      id: node.id,
      type: 'wfNode',
      focusable: node.groupKind !== 'subworkflow',
      position: { x: node.x, y: node.y },
      targetPosition: layout.direction === 'horizontal'
        ? Position.Left
        : Position.Top,
      sourcePosition: layout.direction === 'horizontal'
        ? Position.Right
        : Position.Bottom,
      ...(laneLayout
        ? { style: { width: laneLayout.width, height: laneLayout.height } }
        : {}),
      data: {
        id: node.id,
        name: node.name,
        color: getNodeColor(node.labNodeType, node.type),
        kind: node.type,
        visualKind: node.visualKind,
        groupKind: node.groupKind,
        descendantCount: node.descendantNodeIds?.length,
        handles: node.handles,
        materialSource: node.materialSource,
        traceAccent: node.type === 'material_source'
          ? materialTraces.materialSourceAccents.get(node.id) ??
            materialTraceAccent(node.id)
          : undefined,
        materialHandleAccents: Object.fromEntries(
          materialTraces.handleAccentsByNode.get(node.id) ?? []
        ),
        materialChips: materialTraces.chipsByNode.get(node.id) ?? [],
        layoutStrategy: strategy,
        materialLaneDirection: layout.swimlanes?.direction,
        materialLaneRange: laneLayout
          ? { start: laneLayout.startLane, end: laneLayout.endLane }
          : undefined,
        materialLaneByHandle: handleLanes
          ? Object.fromEntries(handleLanes)
          : undefined
      }
    }
  })

  const flowEdges: Edge<WorkflowRoundedStepEdgeData>[] = layout.links.map(
    (link, index) => {
      const communication = link.type === COMM_EDGE_TYPE
      const materialAccent = materialTraces.edgeAccents.get(index)
      const ready = !materialAccent && [
        link.sourceHandleUuid,
        link.targetHandleUuid
      ].some((uuid) => {
        const handle = uuid ? handleByUuid.get(uuid) : undefined
        return handle ? isReadyHandle(handle) : false
      })
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
          direction: ready
            ? 'TB'
            : layout.direction === 'horizontal'
              ? 'LR'
              : 'TB',
          borderRadius: 8
        },
        animated: communication || Boolean(materialAccent),
        markerEnd: materialAccent
          ? {
              type: MarkerType.ArrowClosed,
              color: materialAccent,
              width: 14,
              height: 14
            }
          : undefined,
        ariaLabel: materialAccent
          ? `物料流：${sourceName} 到 ${targetName}`
          : ready
            ? `执行顺序：${sourceName} 到 ${targetName}`
            : undefined,
        style: {
          stroke: materialAccent ?? STRUCTURAL_EDGE_COLOR,
          strokeWidth: materialAccent ? 2.4 : 1.5,
          strokeDasharray: communication && !materialAccent ? '4 4' : undefined
        },
        className: materialAccent
          ? 'wf-flow-edge--material-trace'
          : ready
            ? 'wf-flow-edge--ready'
            : undefined
      }
    }
  )

  return { flowNodes, flowEdges }
}
