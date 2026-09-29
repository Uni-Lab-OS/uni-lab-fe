import type { WorkflowGraph } from "@unilab-fe/core";
import { nodeLabel, nodeUuid, readString } from "./workflowPresentation";

export interface WorkflowFlowProjectionNode {
  id: string;
  index: number;
  label: string;
  typeLabel: string;
  childCount: number;
  selected: boolean;
  disabled: boolean;
  position: { x: number; y: number };
}

export interface WorkflowFlowProjectionEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowFlowProjection {
  nodes: WorkflowFlowProjectionNode[];
  edges: WorkflowFlowProjectionEdge[];
}

/**
 * 把 Published Workflow Graph 投影成画布可见节点和边。
 *
 * 这里不返回 ReactFlow 的 Node/Edge，也不接受点击回调；它只负责拓扑归并、
 * 可见性和确定性布局。执行载荷仍来自 canonical revision，不能从这个投影反向生成。
 */
export function projectWorkflowGraphModel(
  graph: WorkflowGraph,
  selectedNode: string | null,
): WorkflowFlowProjection {
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

  const nodes = visibleEntries.map(({ node: item, index, id }, visibleIndex) => ({
    id,
    index: visibleIndex,
    label: nodeLabel(item, index),
    typeLabel: readString(item, ["executor_kind", "executorKind", "type"]) ?? "节点",
    childCount: childCountById.get(id) ?? 0,
    selected: id === selectedVisibleId,
    disabled: item.disabled === true,
    position: positions.get(id) ?? { x: 0, y: index * 145 },
  }));

  const edges = normalizedEdges
    .filter((item, index, items) =>
      items.findIndex((candidate) => candidate.source === item.source && candidate.target === item.target) === index,
    )
    .map(({ edge, index, source, target }) => ({
      id: readString(edge, ["uuid", "id"]) ?? `edge-${index}`,
      source,
      target,
    }));

  return { nodes, edges };
}
