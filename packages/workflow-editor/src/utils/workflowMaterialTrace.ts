import type {
  WorkflowHandlePort,
  WorkflowLink,
  WorkflowNode
} from './parseWorkflow'

export interface WorkflowMaterialChip {
  handleUuid: string
  sourceNodeUuid: string
  sourceNodeName: string
  sourceHandleName: string
  accent: string
}

export interface WorkflowMaterialTraceProjection {
  edgeAccents: Map<number, string>
  handleAccentsByNode: Map<string, Map<string, string>>
  materialSourceAccents: Map<string, string>
  chipsByNode: Map<string, WorkflowMaterialChip[]>
}

interface MaterialLineage {
  key: string
  sourceNodeUuid: string
  sourceNodeName: string
  sourceHandleName: string
  accent: string
}

interface MaterialEdge {
  index: number
  sourceNode: WorkflowNode
  sourceHandle: WorkflowHandlePort
  targetNode: WorkflowNode
  targetHandle: WorkflowHandlePort
}

const MATERIAL_TRACE_ACCENTS = [
  '#6657c7',
  '#8056a8',
  '#4f69b8',
  '#785aa6',
  '#5364a3',
  '#6d5a9d',
  '#465fa8',
  '#7451a1'
] as const

export function materialTraceAccent(identity: string): string {
  let hash = 2166136261
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return MATERIAL_TRACE_ACCENTS[(hash >>> 0) % MATERIAL_TRACE_ACCENTS.length]
}

export function projectMaterialTraces(
  nodes: readonly WorkflowNode[],
  links: readonly WorkflowLink[]
): WorkflowMaterialTraceProjection {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const handleByNode = new Map(nodes.map((node) => [
    node.id,
    new Map((node.handles ?? []).map((handle) => [handle.uuid, handle]))
  ]))
  const materialEdges = links.flatMap((link, index) => {
    const sourceNode = nodeById.get(link.source)
    const targetNode = nodeById.get(link.target)
    const sourceHandle = link.sourceHandleUuid
      ? handleByNode.get(link.source)?.get(link.sourceHandleUuid)
      : undefined
    const targetHandle = link.targetHandleUuid
      ? handleByNode.get(link.target)?.get(link.targetHandleUuid)
      : undefined
    if (
      !sourceNode ||
      !targetNode ||
      !sourceHandle ||
      !targetHandle ||
      sourceHandle.ioType !== 'source' ||
      targetHandle.ioType !== 'target' ||
      !isResourceSlotHandle(sourceHandle) ||
      !isResourceSlotHandle(targetHandle)
    ) return []
    return [{
      index,
      sourceNode,
      sourceHandle,
      targetNode,
      targetHandle
    } satisfies MaterialEdge]
  })
  const outgoingByHandle = new Map<string, MaterialEdge[]>()
  for (const edge of materialEdges) {
    const key = handleIdentity(edge.sourceNode.id, edge.sourceHandle.uuid)
    const outgoing = outgoingByHandle.get(key) ?? []
    outgoing.push(edge)
    outgoingByHandle.set(key, outgoing)
  }

  const edgeAccents = new Map<number, string>()
  const handleAccentsByNode = new Map<string, Map<string, string>>()
  const materialSourceAccents = new Map<string, string>()
  const chipsByNode = new Map<string, WorkflowMaterialChip[]>()
  const visited = new Set<string>()
  const usedAccents = new Set<string>()
  const accentsByLineage = new Map<string, string>()
  const accentFor = (lineageKey: string): string => {
    const existing = accentsByLineage.get(lineageKey)
    if (existing) return existing
    const preferred = materialTraceAccent(lineageKey)
    const start = MATERIAL_TRACE_ACCENTS.findIndex(
      (accent) => accent === preferred
    )
    let accent = preferred
    for (let offset = 0; offset < MATERIAL_TRACE_ACCENTS.length; offset += 1) {
      const candidate = MATERIAL_TRACE_ACCENTS[
        (start + offset) % MATERIAL_TRACE_ACCENTS.length
      ]
      if (usedAccents.has(candidate)) continue
      accent = candidate
      break
    }
    accentsByLineage.set(lineageKey, accent)
    usedAccents.add(accent)
    return accent
  }

  const traceFrom = (
    sourceNode: WorkflowNode,
    sourceHandle: WorkflowHandlePort,
    lineage: MaterialLineage
  ): void => {
    const queue: Array<{
      node: WorkflowNode
      handle: WorkflowHandlePort
    }> = [{ node: sourceNode, handle: sourceHandle }]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      const currentIdentity = handleIdentity(current.node.id, current.handle.uuid)
      const visitKey = `${lineage.key}:${currentIdentity}`
      if (visited.has(visitKey)) continue
      visited.add(visitKey)
      setHandleAccent(
        handleAccentsByNode,
        current.node.id,
        current.handle.uuid,
        lineage.accent
      )
      for (const edge of outgoingByHandle.get(currentIdentity) ?? []) {
        edgeAccents.set(edge.index, lineage.accent)
        setHandleAccent(
          handleAccentsByNode,
          edge.targetNode.id,
          edge.targetHandle.uuid,
          lineage.accent
        )
        addMaterialChip(chipsByNode, edge.targetNode.id, {
          handleUuid: edge.targetHandle.uuid,
          sourceNodeUuid: lineage.sourceNodeUuid,
          sourceNodeName: lineage.sourceNodeName,
          sourceHandleName: lineage.sourceHandleName,
          accent: lineage.accent,
        })

        for (const nextHandle of passThroughHandles(
          edge.targetNode,
          edge.targetHandle
        )) {
          setHandleAccent(
            handleAccentsByNode,
            edge.targetNode.id,
            nextHandle.uuid,
            lineage.accent
          )
          queue.push({ node: edge.targetNode, handle: nextHandle })
        }
      }
    }
  }

  for (const node of nodes) {
    if (node.type !== 'material_source') continue
    for (const handle of node.handles ?? []) {
      if (handle.ioType !== 'source' || !isResourceSlotHandle(handle)) continue
      const lineage = rootLineage(node, handle, true, accentFor)
      materialSourceAccents.set(node.id, lineage.accent)
      traceFrom(node, handle, lineage)
    }
  }

  // A typed ResourceSlot output can start a new material identity even when it
  // is not an implicit pass-through from a MaterialSource root.
  for (const edge of materialEdges) {
    if (edgeAccents.has(edge.index)) continue
    traceFrom(
      edge.sourceNode,
      edge.sourceHandle,
      rootLineage(edge.sourceNode, edge.sourceHandle, false, accentFor)
    )
  }

  return {
    edgeAccents,
    handleAccentsByNode,
    materialSourceAccents,
    chipsByNode
  }
}

function passThroughHandles(
  node: WorkflowNode,
  targetHandle: WorkflowHandlePort
): WorkflowHandlePort[] {
  const targetKey = targetHandle.dataKey ?? targetHandle.handleKey
  return (node.handles ?? []).filter((handle) =>
    handle.ioType === 'source' &&
    handle.implicitPassthrough === true &&
    isResourceSlotHandle(handle) &&
    (handle.dataKey ?? handle.handleKey) === targetKey
  )
}

function isResourceSlotHandle(handle: WorkflowHandlePort): boolean {
  if (handle.valueType === 'ResourceSlot') return true
  return isResourceSlotSchema(handle.valueSchema)
}

function isResourceSlotSchema(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.$slot === 'ResourceSlot') return true
  if (!Array.isArray(value.anyOf)) return false
  return value.anyOf.some((candidate) =>
    isRecord(candidate) && candidate.$slot === 'ResourceSlot'
  )
}

function rootLineage(
  node: WorkflowNode,
  handle: WorkflowHandlePort,
  materialSource: boolean,
  accentFor: (lineageKey: string) => string
): MaterialLineage {
  const key = materialSource ? node.id : `${node.id}:${handle.uuid}`
  return {
    key,
    sourceNodeUuid: node.id,
    sourceNodeName: node.name,
    sourceHandleName: handle.displayName || handle.handleKey,
    accent: accentFor(key),
  }
}

function setHandleAccent(
  accents: Map<string, Map<string, string>>,
  nodeUuid: string,
  handleUuid: string,
  accent: string
): void {
  const nodeAccents = accents.get(nodeUuid) ?? new Map<string, string>()
  if (!nodeAccents.has(handleUuid)) nodeAccents.set(handleUuid, accent)
  accents.set(nodeUuid, nodeAccents)
}

function addMaterialChip(
  chipsByNode: Map<string, WorkflowMaterialChip[]>,
  nodeUuid: string,
  chip: WorkflowMaterialChip
): void {
  const chips = chipsByNode.get(nodeUuid) ?? []
  if (!chips.some((candidate) =>
    candidate.handleUuid === chip.handleUuid &&
    candidate.sourceNodeUuid === chip.sourceNodeUuid
  )) chips.push(chip)
  chipsByNode.set(nodeUuid, chips)
}

function handleIdentity(nodeUuid: string, handleUuid: string): string {
  return `${nodeUuid}:${handleUuid}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
