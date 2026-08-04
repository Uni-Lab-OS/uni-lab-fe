/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: ReactFlow DAG 拓扑视图(节点分色 + 有向边 + 控件)
 * Context: 工作流方向拓扑连接图展示
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel
} from 'reactflow'
import type {
  Connection,
  EdgeChange,
  Node,
  NodeChange,
  ReactFlowInstance
} from 'reactflow'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkflowDag } from '../hooks/useWorkflowDag'
import WorkflowNodeCard from './WorkflowNodeCard'
import type { WorkflowNodeData } from './WorkflowNodeCard'
import type { WorkflowLink, WorkflowNode } from '../utils/parseWorkflow'
import { projectNestedWorkflow } from '../utils/canonicalWorkflow'
import {
  CANVAS_EDIT_WORKFLOW_CANVAS,
  READ_ONLY_WORKFLOW_CANVAS,
  visibleReadOnlyEdgeChanges,
  visibleReadOnlyNodeChanges
} from '../utils/workflowCanvasPolicy'
import 'reactflow/dist/style.css'
import styles from './workflow.module.scss'

interface WorkflowDagProps {
  nodes: WorkflowNode[]
  links: WorkflowLink[]
  onNodeSelect: (nodeId: string) => void
  onSetStart?: (nodeId: string) => void
  onToggleBreakpoint?: (nodeId: string) => void
  nodeStates?: Readonly<Record<string, string>>
  breakpoints?: ReadonlySet<string>
  startNodeId?: string | null
  beforeStartNodeIds?: ReadonlySet<string>
  pausedBeforeNodeId?: string | null
  canBeautify?: boolean
  onBeautify?: () => void
  canvasMutationEnabled?: boolean
  nodePositionMutationEnabled?: boolean
  onNodePositionChange?: (
    nodeId: string,
    position: { x: number; y: number }
  ) => void
  onConnectHandles?: (connection: {
    sourceNodeUuid: string
    sourceHandleUuid: string
    targetNodeUuid: string
    targetHandleUuid: string
  }) => void
}

// 注册自定义节点类型(在组件外定义,避免每次渲染重建)
const nodeTypes = { wfNode: WorkflowNodeCard }

// 拓扑 DAG:只读展示,支持缩放/平移/minimap,节点为大 web 风格卡片
export default function WorkflowDag({
  nodes,
  links,
  onNodeSelect,
  onSetStart,
  onToggleBreakpoint,
  nodeStates = {},
  breakpoints = new Set(),
  startNodeId = null,
  beforeStartNodeIds = new Set(),
  pausedBeforeNodeId = null,
  canBeautify = true,
  onBeautify,
  canvasMutationEnabled = false,
  nodePositionMutationEnabled = false,
  onNodePositionChange,
  onConnectHandles
}: WorkflowDagProps): React.JSX.Element {
  const [isBeautifying, setIsBeautifying] = useState(false)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set()
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null)
  const beautifyTimerRef = useRef<
    ReturnType<typeof globalThis.setTimeout> | null
  >(null)
  const groupSignature = useMemo(
    () => nodes
      .filter((node) => node.groupKind === 'subworkflow')
      .map((node) => `${node.id}:${node.compositeSignature || ''}`)
      .join('|'),
    [nodes]
  )
  useEffect(() => {
    setExpandedGroupIds(new Set())
  }, [groupSignature])
  useEffect(
    () => () => {
      if (beautifyTimerRef.current !== null) {
        globalThis.clearTimeout(beautifyTimerRef.current)
      }
    },
    []
  )
  const nestedProjection = useMemo(
    () => projectNestedWorkflow(nodes, links, expandedGroupIds),
    [expandedGroupIds, links, nodes]
  )
  const toggleGroup = useCallback((nodeId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])
  const { nodes: flowNodes, edges: flowEdges, onNodesChange, onEdgesChange } = useWorkflowDag(
    nestedProjection.nodes,
    nestedProjection.links
  )
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const visibleChanges = nodePositionMutationEnabled
        ? changes
        : visibleReadOnlyNodeChanges(changes)
      if (visibleChanges.length > 0) onNodesChange(visibleChanges)
    },
    [nodePositionMutationEnabled, onNodesChange]
  )
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const visibleChanges = visibleReadOnlyEdgeChanges(changes)
      if (visibleChanges.length > 0) onEdgesChange(visibleChanges)
    },
    [onEdgesChange]
  )
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes]
  )
  const runtimeNodes = useMemo(
    () => flowNodes.map((node) => {
      const sourceNode = nodeById.get(node.id)
      const status = sourceNode?.groupKind === 'subworkflow'
        ? nestedGroupStatus(sourceNode, nodeStates)
        : nodeStates[node.id] || 'pending'
      const beforeStart = beforeStartNodeIds.has(node.id)
      const pausedBefore = pausedBeforeNodeId === node.id
      const startNode = startNodeId === node.id
      return {
        ...node,
        className: [
          node.className,
          `wf-flow-node--${status}`,
          beforeStart ? 'wf-flow-node--before-start' : '',
          startNode ? 'wf-flow-node--start' : '',
          pausedBefore ? 'wf-flow-node--paused-before' : '',
          breakpoints.has(node.id) ? 'wf-flow-node--breakpoint' : '',
          sourceNode?.groupKind === 'subworkflow'
            ? 'wf-flow-node--subworkflow'
            : ''
        ].filter(Boolean).join(' '),
        data: {
          ...node.data,
          color: beforeStart
            ? 'var(--unilab-color-skipped)'
            : pausedBefore
              ? 'var(--unilab-color-paused)'
              : status === 'success'
                ? 'var(--unilab-color-success)'
                : status === 'running'
                  ? 'var(--unilab-color-warning)'
                  : 'var(--unilab-color-text-subtle)',
          status,
          breakpoint: breakpoints.has(node.id),
          startNode,
          beforeStart,
          pausedBefore,
          groupExpanded: expandedGroupIds.has(node.id),
          onToggleGroup: toggleGroup,
          onSetStart: sourceNode?.type === 'material_source'
            ? undefined
            : onSetStart,
          onToggleBreakpoint: sourceNode?.type === 'material_source'
            ? undefined
            : onToggleBreakpoint
        }
      }
    }),
    [
      beforeStartNodeIds,
      breakpoints,
      flowNodes,
      expandedGroupIds,
      nodeById,
      nodeStates,
      onSetStart,
      onToggleBreakpoint,
      pausedBeforeNodeId,
      startNodeId,
      toggleGroup
    ]
  )
  const runtimeEdges = useMemo(
    () => flowEdges.map((edge) => ({
      ...edge,
      className: [
        edge.className,
        beforeStartNodeIds.has(edge.source) ||
        beforeStartNodeIds.has(edge.target)
          ? 'wf-flow-edge--before-start'
          : ''
      ].filter(Boolean).join(' ')
    })),
    [beforeStartNodeIds, flowEdges]
  )
  const graphSignature = useMemo(
    () => JSON.stringify({
      nodes: nodes.map((node) => [node.id, node.x, node.y]),
      links: links.map((link) => [
        link.source,
        link.target,
        link.branch ?? null
      ])
    }),
    [links, nodes]
  )
  useEffect(() => {
    let fitFrame = 0
    const syncFrame = requestAnimationFrame(() => {
      fitFrame = requestAnimationFrame(() => {
        void flowInstanceRef.current?.fitView({
          padding: 0.16,
          minZoom: 0.2,
          maxZoom: 1
        })
      })
    })
    return () => {
      cancelAnimationFrame(syncFrame)
      cancelAnimationFrame(fitFrame)
    }
  }, [graphSignature])
  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    let fitFrame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => {
        void flowInstanceRef.current?.fitView({
          padding: 0.16,
          minZoom: 0.2,
          maxZoom: 1
        })
      })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(fitFrame)
    }
  }, [])
  const handleBeautify = useCallback(() => {
    if (!canBeautify || !onBeautify) return
    setIsBeautifying(true)
    onBeautify()
    if (beautifyTimerRef.current !== null) {
      globalThis.clearTimeout(beautifyTimerRef.current)
    }
    beautifyTimerRef.current = globalThis.setTimeout(() => {
      setIsBeautifying(false)
      beautifyTimerRef.current = null
    }, 480)
  }, [canBeautify, onBeautify])

  if (flowNodes.length === 0) {
    return (
      <p className="px-3.5 py-3 text-xs text-[var(--unilab-color-text-muted)]">
        当前 JSON 未定义节点，无法生成拓扑图
      </p>
    )
  }

  return (
    <div
      ref={containerRef}
      className={styles.dag}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        const target = event.target
        if (!(target instanceof Element)) return
        const node = target.closest('.react-flow__node[data-id]')
        const nodeId = node?.getAttribute('data-id')
        if (!nodeId) return
        event.preventDefault()
        onNodeSelect(nodeId)
      }}
    >
      <ReactFlow
        className={isBeautifying ? 'is-beautifying' : undefined}
        nodes={runtimeNodes}
        edges={runtimeEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={(connection: Connection) => {
          if (
            !canvasMutationEnabled ||
            !connection.source ||
            !connection.sourceHandle ||
            !connection.target ||
            !connection.targetHandle
          ) return
          onConnectHandles?.({
            sourceNodeUuid: connection.source,
            sourceHandleUuid: connection.sourceHandle,
            targetNodeUuid: connection.target,
            targetHandleUuid: connection.targetHandle
          })
        }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.16, minZoom: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        {...(
          canvasMutationEnabled
            ? CANVAS_EDIT_WORKFLOW_CANVAS
            : READ_ONLY_WORKFLOW_CANVAS
        )}
        nodesDraggable={nodePositionMutationEnabled}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => {
          flowInstanceRef.current = instance
        }}
        onNodeClick={(_event, node: Node<WorkflowNodeData>) => onNodeSelect(node.id)}
        onNodeDragStop={(_event, node: Node<WorkflowNodeData>) => {
          if (!nodePositionMutationEnabled) return
          onNodePositionChange?.(node.id, node.position)
        }}
        onNodeContextMenu={(event, node: Node<WorkflowNodeData>) => {
          event.preventDefault()
          if (node.data.kind === 'material_source') return
          onSetStart?.(node.id)
        }}
        onNodeDoubleClick={(_event, node: Node<WorkflowNodeData>) => {
          if (node.data.kind === 'material_source') return
          onToggleBreakpoint?.(node.id)
        }}
      >
        <Background
          gap={24}
          size={0.75}
          color="var(--unilab-color-border-strong)"
        />
        <Controls showInteractive={false} />
        <Panel position="top-right">
          <button
            type="button"
            className="workflow-runtime__beautify"
            disabled={!canBeautify || isBeautifying}
            aria-label="美化工作流布局"
            title={
              canBeautify
                ? '按控制流自动排列并适配画布'
                : '请先完成当前 Python 编译'
            }
            onClick={handleBeautify}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M12 3l1.35 3.65L17 8l-3.65 1.35L12 13l-1.35-3.65L7 8l3.65-1.35L12 3Z"
              />
              <path
                d="M18.5 13l.85 2.15L21.5 16l-2.15.85L18.5 19l-.85-2.15L15.5 16l2.15-.85L18.5 13Z"
              />
              <path
                d="M6 14l.65 1.35L8 16l-1.35.65L6 18l-.65-1.35L4 16l1.35-.65L6 14Z"
              />
            </svg>
            <span>{isBeautifying ? '正在美化' : '美化布局'}</span>
          </button>
        </Panel>
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) =>
            node.data?.color ?? 'var(--unilab-color-text-subtle)'
          }
        />
      </ReactFlow>
    </div>
  )
}

function nestedGroupStatus(
  node: WorkflowNode,
  nodeStates: Readonly<Record<string, string>>
): string {
  const statuses = [node.id, ...(node.descendantNodeIds || [])]
    .map((nodeId) => nodeStates[nodeId])
    .filter((status): status is string => Boolean(status))
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('reconciling')) return 'reconciling'
  if (statuses.includes('running')) return 'running'
  if (statuses.includes('cancelled')) return 'cancelled'
  if (
    statuses.length > 0 &&
    statuses.every((status) => ['success', 'skipped'].includes(status))
  ) {
    return 'success'
  }
  return nodeStates[node.id] || 'pending'
}
