/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 将解析出的工作流拓扑转为 ReactFlow 节点/边(自定义节点卡片)
 * Context: 工作流 DAG 视图数据源,分层布局 + 大 web 风格节点类型分色
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { useEffect, useMemo } from 'react'
import type { Edge, Node, OnNodesChange, OnEdgesChange } from 'reactflow'
import { MarkerType, Position, useNodesState, useEdgesState } from 'reactflow'
import { layoutDag } from '../utils/dagLayout'
import { getNodeColor } from '../utils/nodeColors'
import type { WorkflowLink, WorkflowNode } from '../utils/parseWorkflow'
import type { WorkflowNodeData } from '../components/WorkflowNodeCard'
import {
  materialTraceAccent,
  projectMaterialTraces
} from '../utils/workflowMaterialTrace'

interface UseWorkflowDagResult {
  nodes: Node<WorkflowNodeData>[]
  edges: Edge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
}

// 通信连接用虚线,物理连接用实线
const COMM_EDGE_TYPE = 'communication'

// 连接线采用工作流模块色，保持与导航、控制和状态体系一致。
const EDGE_COLOR = 'var(--unilab-color-workflow)'

/**
 * [AI-MODIFIED] useWorkflowDag
 *
 * @ai-model Claude Opus 4.8
 * @ai-date 2026-07-25
 * @ai-modifications 由「仅返回受控 nodes/edges」改为内部用 useNodesState/useEdgesState 管理状态,
 *   并暴露 onNodesChange/onEdgesChange;输入(nodes/links)变化时重新布局并同步。
 * @ai-reason 此前 ReactFlow 以受控方式传入 nodes 但缺少 onNodesChange 变更回写通道,
 *   导致拖动产生的位置变更无法应用,节点无法拖动。
 */
export function useWorkflowDag(nodes: WorkflowNode[], links: WorkflowLink[]): UseWorkflowDagResult {
  // 依据输入重新布局,生成 ReactFlow 节点/边(输入不变时结果稳定)
  const computed = useMemo(() => {
    const {
      nodes: laidOut,
      links: edges,
      direction
    } = layoutDag(nodes, links)
    const horizontal = direction === 'horizontal'
    const materialTraces = projectMaterialTraces(nodes, links)
    const nodeNames = new Map(nodes.map((node) => [node.id, node.name]))

    const flowNodes: Node<WorkflowNodeData>[] = laidOut.map((node) => ({
      id: node.id,
      type: 'wfNode',
      focusable: node.groupKind !== 'subworkflow',
      position: { x: node.x, y: node.y },
      targetPosition: horizontal ? Position.Left : Position.Top,
      sourcePosition: horizontal ? Position.Right : Position.Bottom,
      data: {
        id: node.id,
        name: node.name,
        color: getNodeColor(node.labNodeType, node.type),
        kind: node.type,
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
        materialChips: materialTraces.chipsByNode.get(node.id) ?? []
      }
    }))

    // 连线端点跟随布局主轴，曲线保持统一线色(通信边虚线)。
    const flowEdges: Edge[] = edges.map((link, index) => {
      const isComm = link.type === COMM_EDGE_TYPE
      const materialAccent = materialTraces.edgeAccents.get(index)
      return {
        id: `e-${link.source}-${link.target}-${index}`,
        source: link.source,
        target: link.target,
        sourceHandle: link.sourceHandleUuid || undefined,
        targetHandle: link.targetHandleUuid || undefined,
        label: link.branch ? (link.branch === 'true' ? 'TRUE' : 'FALSE') : undefined,
        labelStyle: {
          fill: link.branch === 'true'
            ? 'var(--unilab-color-success)'
            : 'var(--unilab-color-danger)',
          fontSize: 10,
          fontWeight: 700
        },
        type: 'default',
        animated: isComm || Boolean(materialAccent),
        markerEnd: materialAccent
          ? {
              type: MarkerType.ArrowClosed,
              color: materialAccent,
              width: 14,
              height: 14
            }
          : undefined,
        ariaLabel: materialAccent
          ? `物料流：${nodeNames.get(link.source) ?? link.source} 到 ` +
            `${nodeNames.get(link.target) ?? link.target}`
          : undefined,
        style: {
          stroke: materialAccent ?? EDGE_COLOR,
          strokeWidth: materialAccent ? 2.4 : 2,
          strokeDasharray: isComm && !materialAccent ? '4 4' : undefined
        },
        className: materialAccent
          ? 'wf-flow-edge--material-trace'
          : undefined
      }
    })

    return { flowNodes, flowEdges }
  }, [nodes, links])

  // 用 ReactFlow 内置状态管理节点/边,使拖动等交互变更可回写
  const [flowNodes, setNodes, onNodesChange] = useNodesState(computed.flowNodes)
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState(computed.flowEdges)

  // 输入(重新布局结果)变化时同步到内部状态
  useEffect(() => {
    setNodes(computed.flowNodes)
    setEdges(computed.flowEdges)
  }, [computed, setNodes, setEdges])

  return { nodes: flowNodes, edges: flowEdges, onNodesChange, onEdgesChange }
}
