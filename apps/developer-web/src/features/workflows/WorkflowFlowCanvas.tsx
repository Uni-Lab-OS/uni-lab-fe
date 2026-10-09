import { clsx } from 'clsx'
import workflowTopologyStyles from './WorkflowTopology.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import { useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Node,
  type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { WorkflowGraph } from '@unilab-fe/core'
import { AppIcon } from '../../components/ui/Icon'
import { projectWorkflowGraphModel } from './workflowFlowProjection'

type WorkflowFlowNodeData = {
  index: number
  label: string
  typeLabel: string
  childCount: number
  selected: boolean
  disabled: boolean
  onSelect: (id: string | null) => void
}

type WorkflowFlowNode = Node<WorkflowFlowNodeData, 'workflowNode'>

const nodeTypes = { workflowNode: WorkflowNode }

export function WorkflowFlowCanvas({
  graph,
  selectedNode,
  onSelect,
}: {
  graph: WorkflowGraph
  selectedNode: string | null
  onSelect: (id: string | null) => void
}) {
  const projected = useMemo(
    () => projectWorkflowGraphModel(graph, selectedNode),
    [graph, selectedNode],
  )
  const nodes = useMemo(
    () =>
      projected.nodes.map((item) => ({
        id: item.id,
        type: 'workflowNode' as const,
        position: item.position,
        data: { ...item, onSelect },
        selectable: true,
        focusable: true,
        draggable: false,
      })),
    [onSelect, projected.nodes],
  )
  const edges = useMemo(
    () =>
      projected.edges.map((item) => ({
        ...item,
        type: 'smoothstep',
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { stroke: '#9aa9c2', strokeWidth: 1.6 },
      })),
    [projected.edges],
  )

  if (graph.nodes.length === 0) return null

  return (
    <div className={clsx(workflowTopologyStyles['workflow-flow-canvas'])} aria-label="工作流拓扑图">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.15 }}
        minZoom={0.2}
        maxZoom={1.8}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={false}
        nodesDraggable={false}
        panOnDrag
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#dce3ef" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

function WorkflowNode({ id, data }: NodeProps<WorkflowFlowNodeData>) {
  return (
    <button
      type="button"
      className={clsx(
        workflowTopologyStyles['workflow-flow-node'],
        'nodrag',
        'nopan',
        data.selected
          ? clsx(workflowTopologyStyles['is-selected'], appShellStyles['is-selected'])
          : '',
        data.disabled ? workflowTopologyStyles['is-disabled'] : '',
      )}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        data.onSelect(id)
      }}
      aria-label={`查看节点 ${data.label}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={clsx(workflowTopologyStyles['workflow-flow-handle'])}
      />
      <span className={clsx(workflowTopologyStyles['workflow-flow-node__index'])}>
        {String(data.index + 1).padStart(2, '0')}
      </span>
      <span className={clsx(workflowTopologyStyles['workflow-flow-node__body'])}>
        <strong title={data.label}>{data.label}</strong>
        <small title={data.typeLabel}>
          {data.typeLabel}
          {data.childCount > 0 ? ` · ${data.childCount} 个内部节点` : ''}
        </small>
      </span>
      <span className={clsx(workflowTopologyStyles['workflow-flow-node__icon'])}>
        <AppIcon
          name={data.disabled ? 'general/slash-circle-01' : 'development/dataflow-02'}
          size={15}
        />
      </span>
      <Handle
        type="source"
        position={Position.Right}
        className={clsx(workflowTopologyStyles['workflow-flow-handle'])}
      />
    </button>
  )
}
