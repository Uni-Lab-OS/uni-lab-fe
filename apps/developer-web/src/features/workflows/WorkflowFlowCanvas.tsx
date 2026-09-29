import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { WorkflowGraph } from "@unilab-fe/core";
import { AppIcon } from "../../components/ui/Icon";
import { nodeLabel, nodeUuid, readString } from "./workflowPresentation";

type WorkflowFlowNodeData = {
  index: number;
  label: string;
  typeLabel: string;
  childCount: number;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string | null) => void;
};

type WorkflowFlowNode = Node<WorkflowFlowNodeData, "workflowNode">;

const nodeTypes = { workflowNode: WorkflowNode };

export function WorkflowFlowCanvas({
  graph,
  selectedNode,
  onSelect,
}: {
  graph: WorkflowGraph;
  selectedNode: string | null;
  onSelect: (id: string | null) => void;
}) {
  const projected = useMemo(
    () => projectWorkflowGraph(graph, selectedNode, onSelect),
    [graph, onSelect, selectedNode],
  );

  if (graph.nodes.length === 0) return null;

  return (
    <div className="workflow-flow-canvas" aria-label="工作流拓扑图">
      <ReactFlow
        nodes={projected.nodes}
        edges={projected.edges}
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
  );
}

function WorkflowNode({ id, data }: NodeProps<WorkflowFlowNodeData>) {
  return (
    <button
      type="button"
      className={`workflow-flow-node nodrag nopan ${data.selected ? "is-selected" : ""} ${data.disabled ? "is-disabled" : ""}`}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect(id);
      }}
      aria-label={`查看节点 ${data.label}`}
    >
      <Handle type="target" position={Position.Left} className="workflow-flow-handle" />
      <span className="workflow-flow-node__index">
        {String(data.index + 1).padStart(2, "0")}
      </span>
      <span className="workflow-flow-node__body">
        <strong title={data.label}>{data.label}</strong>
        <small title={data.typeLabel}>
          {data.typeLabel}
          {data.childCount > 0 ? ` · ${data.childCount} 个内部节点` : ""}
        </small>
      </span>
      <span className="workflow-flow-node__icon">
        <AppIcon name={data.disabled ? "general/slash-circle-01" : "development/dataflow-02"} size={15} />
      </span>
      <Handle type="source" position={Position.Right} className="workflow-flow-handle" />
    </button>
  );
}

export function projectWorkflowGraph(
  graph: WorkflowGraph,
  selectedNode: string | null,
  onSelect: (id: string | null) => void,
): { nodes: WorkflowFlowNode[]; edges: Edge[] } {
  const allIds = graph.nodes.map((node, index) => nodeUuid(node, index));
  const nodeById = new Map(allIds.map((id, index) => [id, graph.nodes[index]]));
  const parentById = new Map<string, string>();
  allIds.forEach((id, index) => {
    const parent = readString(graph.nodes[index], ["parent_uuid", "parentUuid"]);
    if (parent && nodeById.has(parent)) parentById.set(id, parent);
  });
  const topLevelId = (id: string): string => {
    const visited = new Set<string>();
    let current = id;
    while (parentById.has(current) && !visited.has(current)) {
      visited.add(current);
      current = parentById.get(current) as string;
    }
    return current;
  };
  const visibleEntries = graph.nodes
    .map((node, index) => ({ node, index, id: allIds[index] }))
    .filter(({ id }) => topLevelId(id) === id);
  const ids = visibleEntries.map(({ id }) => id);
  const knownIds = new Set(ids);
  const childCountById = new Map<string, number>();
  allIds.forEach((id) => {
    const root = topLevelId(id);
    if (root !== id) childCountById.set(root, (childCountById.get(root) ?? 0) + 1);
  });
  const selectedVisibleId = selectedNode ? topLevelId(selectedNode) : null;
  const rawEdges = graph.edges
    .map((edge, index) => ({
      edge,
      index,
      source: readString(edge, ["source", "source_node_uuid", "sourceNodeUuid", "from"]),
      target: readString(edge, ["target", "target_node_uuid", "targetNodeUuid", "to"]),
    }))
    .filter(
      (item): item is typeof item & { source: string; target: string } => {
        if (!item.source || !item.target) return false;
        const source = topLevelId(item.source);
        const target = topLevelId(item.target);
        return knownIds.has(source) && knownIds.has(target) && source !== target;
      },
    );
  const normalizedEdges = rawEdges.map((item) => ({
    ...item,
    source: topLevelId(item.source),
    target: topLevelId(item.target),
  }));

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  ids.forEach((id) => {
    outgoing.set(id, []);
    incoming.set(id, 0);
  });
  normalizedEdges.forEach(({ source, target }) => {
    outgoing.get(source)?.push(target);
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
  });

  const rank = new Map<string, number>();
  const queue = ids.filter((id) => (incoming.get(id) ?? 0) === 0);
  queue.forEach((id) => rank.set(id, 0));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const currentRank = rank.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, currentRank + 1));
      const nextIncoming = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, nextIncoming);
      if (nextIncoming === 0) queue.push(next);
    }
  }
  // Cycles and disconnected nodes still get a deterministic position.
  ids.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, Math.max(0, Math.floor(index / 4)));
  });

  const byRank = new Map<number, string[]>();
  ids.forEach((id) => {
    const level = rank.get(id) ?? 0;
    const bucket = byRank.get(level) ?? [];
    bucket.push(id);
    byRank.set(level, bucket);
  });
  const positions = new Map<string, { x: number; y: number }>();
  [...byRank.entries()].forEach(([level, bucket]) => {
    bucket.forEach((id, index) => {
      positions.set(id, { x: level * 280, y: index * 145 });
    });
  });

  const nodes = visibleEntries.map(({ node: item, index, id }, visibleIndex) => {
    const type = readString(item, ["executor_kind", "executorKind", "type"]) ?? "节点";
    const disabled = item.disabled === true;
    return {
      id,
      type: "workflowNode" as const,
      position: positions.get(id) ?? { x: 0, y: index * 145 },
      data: {
        index: visibleIndex,
        label: nodeLabel(item, index),
        typeLabel: type,
        childCount: childCountById.get(id) ?? 0,
        selected: id === selectedVisibleId,
        disabled,
        onSelect,
      },
      selectable: true,
      focusable: true,
      draggable: false,
    };
  });

  const edges = normalizedEdges.filter((item, index, items) =>
    items.findIndex((candidate) => candidate.source === item.source && candidate.target === item.target) === index,
  ).map(({ edge, index, source, target }) => ({
    id: readString(edge, ["uuid", "id"]) ?? `edge-${index}`,
    source,
    target,
    type: "smoothstep",
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { stroke: "#9aa9c2", strokeWidth: 1.6 },
  }));

  return { nodes, edges };
}
