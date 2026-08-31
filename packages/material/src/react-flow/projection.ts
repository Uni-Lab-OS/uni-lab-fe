import type { Node, XYPosition } from 'reactflow'

import {
  composePoses,
  invertRigidMatrix,
  matrixToPose,
  multiplyMatrices,
  poseToMatrix,
  transformPoint,
  type Matrix4
} from '../geometry'
import type {
  LabPose,
  MaterialAggregate,
  MaterialId,
  MaterialPlacement
} from '../types'
import {
  materialNodeSize,
  MATERIAL_PHYSICAL_SCALE,
  readMaterial2DVisual
} from './visual'

import type { MaterialFlowNode } from './projectionTypes'
export type { MaterialFlowNode, MaterialFlowNodeData } from './projectionTypes'

export const MATERIAL_FLOW_SCALE = 0.5
const MATERIAL_REVIEW_SCALE = 0.28
const REVIEW_NODE_WIDTH = 128
const REVIEW_NODE_HEIGHT = 66
const REVIEW_NODE_GAP = 14

export function projectMaterialFlowNodes(options: {
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
  dragPreviewByMaterialId?: Readonly<Record<MaterialId, LabPose>>
  selectedMaterialIds?: readonly MaterialId[]
  highlightedMaterialIds?: readonly MaterialId[]
  draggable?: boolean
  draggableMaterialIds?: ReadonlySet<MaterialId>
  siteDropStateById?: Readonly<Record<string, import('./projectionTypes').MaterialSiteDropState>>
  reviewLayout?: boolean
  physicalLayout?: boolean
}): MaterialFlowNode[] {
  const selected = new Set(options.selectedMaterialIds ?? [])
  const highlighted = new Set(options.highlightedMaterialIds ?? [])
  const worldMatrices = resolveWorldMatrices(
    options.aggregatesById,
    options.dragPreviewByMaterialId ?? {}
  )
  const physicalRootPositions = options.physicalLayout
    ? createPhysicalRootPositions(options.aggregatesById)
    : {}

  const nodes = Object.values(options.aggregatesById)
    .map((aggregate) => {
      const materialId = aggregate.material.id
      const placement = withPreview(
        aggregate.placement,
        options.dragPreviewByMaterialId?.[materialId]
      )
      const parentId = placementParentId(placement)
      const worldMatrix = worldMatrices[materialId]
      const parentMatrix = parentId ? worldMatrices[parentId] : undefined
      const position = options.reviewLayout
        ? worldPointToReview([
            worldMatrix[3],
            worldMatrix[7],
            worldMatrix[11]
          ])
        : options.physicalLayout && parentId
          ? physicalChildPosition(
              aggregate,
              options.aggregatesById[parentId]
            )
        : options.physicalLayout && physicalRootPositions[materialId]
          ? physicalRootPositions[materialId]
        : parentMatrix
          ? worldDeltaToFlow(worldMatrix, parentMatrix)
          : worldPointToFlow([
              worldMatrix[3],
              worldMatrix[7],
              worldMatrix[11]
            ])

      const size = materialNodeSize(
        aggregate,
        options.physicalLayout ?? false
      )
      return {
        id: materialId,
        type: 'material',
        parentId: options.reviewLayout ? undefined : parentId ?? undefined,
        position,
        data: {
          materialId,
          ...(options.siteDropStateById
            ? { siteDropStateById: options.siteDropStateById }
            : {})
        },
        // React Flow uses the top-level dimensions to initialize and fit
        // controlled nodes. Keeping the same values in `style` makes the DOM
        // box deterministic, while avoiding an invisible first render when a
        // ResizeObserver has not reported yet (notably in Electron and E2E).
        width: size.width,
        height: size.height,
        style: {
          width: size.width,
          height: size.height
        },
        selected: selected.has(materialId),
        draggable:
          options.draggableMaterialIds?.has(materialId) ??
          options.draggable ??
          false,
        className: highlighted.has(materialId)
          ? 'material-flow-node--highlighted'
          : undefined
      } satisfies MaterialFlowNode
    })
    .sort((left, right) => {
      const depthDifference =
        materialDepth(left.id, options.aggregatesById) -
        materialDepth(right.id, options.aggregatesById)
      return depthDifference || left.id.localeCompare(right.id)
    })

  return options.reviewLayout ? avoidReviewCollisions(nodes) : nodes
}
function createPhysicalRootPositions(
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): Record<MaterialId, XYPosition> {
  const roots = Object.values(aggregatesById)
    .filter(
      (aggregate) =>
        aggregate.placement.kind !== 'parent' &&
        aggregate.placement.kind !== 'site'
    )
    .sort((left, right) =>
      left.material.id.localeCompare(right.material.id)
    )
  const primary =
    roots.find(
      (aggregate) =>
        readMaterial2DVisual(aggregate).kind === 'liquid-handler'
    ) ??
    roots.find((aggregate) =>
      readMaterial2DVisual(aggregate).kind.includes('deck')
    ) ??
    roots.find((aggregate) => readMaterial2DVisual(aggregate).physical)

  if (!primary) return {}
  const primarySize = materialNodeSize(primary, true)
  const result: Record<MaterialId, XYPosition> = {
    [primary.material.id]: { x: 0, y: 0 }
  }
  const secondary = roots.filter(
    (aggregate) => aggregate.material.id !== primary.material.id
  )
  secondary.forEach((aggregate, index) => {
    const column = Math.floor(index / 4)
    const row = index % 4
    result[aggregate.material.id] = {
      x: primarySize.width + 44 + column * 146,
      y: row * 82
    }
  })
  return result
}

function physicalChildPosition(
  aggregate: MaterialAggregate,
  parent: MaterialAggregate | undefined
): XYPosition {
  const placement = aggregate.placement
  if (!parent) return { x: 0, y: 0 }
  const localPose =
    placement.kind === 'parent'
      ? placement.localPose
      : placement.kind === 'site'
        ? composePoses(
            parent.sites.find(
              (site) => site.id === placement.siteId
            )?.poseInAnchor ?? {
              positionMm: [0, 0, 0],
              rotationDegXYZ: [0, 0, 0]
            },
            placement.offsetPose
          )
        : undefined
  if (!localPose) return { x: 0, y: 0 }

  const parentVisual = readMaterial2DVisual(parent)
  const childVisual = readMaterial2DVisual(aggregate)
  return {
    x: localPose.positionMm[0] * MATERIAL_PHYSICAL_SCALE,
    y:
      (
        parentVisual.footprintMm[1] -
        localPose.positionMm[1] -
        childVisual.footprintMm[1]
      ) * MATERIAL_PHYSICAL_SCALE
  }
}

export function flowPositionToPlacement(options: {
  materialId: MaterialId
  flowPosition: XYPosition
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
}): MaterialPlacement {
  const aggregate = options.aggregatesById[options.materialId]
  if (!aggregate) throw new Error(`Unknown Material: ${options.materialId}`)

  const placement = aggregate.placement
  const matrices = resolveWorldMatrices(options.aggregatesById, {})
  const currentWorld = matrices[options.materialId]
  const parentId = placementParentId(placement)
  const parentWorld = parentId ? matrices[parentId] : undefined
  const currentWorldPosition = [
    currentWorld[3],
    currentWorld[7],
    currentWorld[11]
  ] as const
  const desiredWorldPosition = parentWorld
    ? [
        parentWorld[3] + options.flowPosition.x / MATERIAL_FLOW_SCALE,
        parentWorld[7] - options.flowPosition.y / MATERIAL_FLOW_SCALE,
        currentWorldPosition[2]
      ] as const
    : flowPointToWorld(options.flowPosition, currentWorldPosition[2])

  switch (placement.kind) {
    case 'unplaced':
      return {
        kind: 'world',
        pose: {
          positionMm: desiredWorldPosition,
          rotationDegXYZ: [0, 0, 0]
        }
      }
    case 'world':
      return {
        ...placement,
        pose: {
          ...placement.pose,
          positionMm: desiredWorldPosition
        }
      }
    case 'parent': {
      const base = matrices[placement.parentId]
      const localPosition = transformPoint(
        invertRigidMatrix(base),
        desiredWorldPosition
      )
      return {
        ...placement,
        localPose: {
          ...placement.localPose,
          positionMm: localPosition
        }
      }
    }
    case 'site': {
      const parent = options.aggregatesById[placement.parentId]
      const site = parent?.sites.find(
        (candidate) => candidate.id === placement.siteId
      )
      const siteBase = site
        ? multiplyMatrices(
            matrices[placement.parentId],
            poseToMatrix(site.poseInAnchor)
          )
        : matrices[placement.parentId]
      const offsetPosition = transformPoint(
        invertRigidMatrix(siteBase),
        desiredWorldPosition
      )
      return {
        ...placement,
        offsetPose: {
          ...placement.offsetPose,
          positionMm: offsetPosition
        }
      }
    }
  }
}

export function placementPose(placement: MaterialPlacement): LabPose | null {
  switch (placement.kind) {
    case 'unplaced':
      return null
    case 'world':
      return placement.pose
    case 'parent':
      return placement.localPose
    case 'site':
      return placement.offsetPose
  }
}

export function resolveMaterialWorldPose(
  materialId: MaterialId,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  dragPreviewByMaterialId: Readonly<Record<MaterialId, LabPose>> = {}
): LabPose {
  const matrix = resolveWorldMatrices(
    aggregatesById,
    dragPreviewByMaterialId
  )[materialId]
  if (!matrix) throw new Error(`Unknown Material: ${materialId}`)
  return matrixToPose(matrix)
}

function resolveWorldMatrices(
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  dragPreviewByMaterialId: Readonly<Record<MaterialId, LabPose>>
): Record<MaterialId, Matrix4> {
  const resolved: Record<MaterialId, Matrix4> = {}
  const visiting = new Set<MaterialId>()

  const resolve = (materialId: MaterialId): Matrix4 => {
    if (resolved[materialId]) return resolved[materialId]
    if (visiting.has(materialId)) {
      throw new Error(`Material parent cycle contains ${materialId}`)
    }
    const aggregate = aggregatesById[materialId]
    if (!aggregate) throw new Error(`Unknown Material: ${materialId}`)
    visiting.add(materialId)

    const placement = withPreview(
      aggregate.placement,
      dragPreviewByMaterialId[materialId]
    )
    let matrix: Matrix4
    switch (placement.kind) {
      case 'unplaced':
        matrix = poseToMatrix({
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        })
        break
      case 'world':
        matrix = poseToMatrix(placement.pose)
        break
      case 'parent':
        matrix = multiplyMatrices(
          resolve(placement.parentId),
          poseToMatrix(placement.localPose)
        )
        break
      case 'site': {
        const parent = aggregatesById[placement.parentId]
        const site = parent?.sites.find(
          (candidate) => candidate.id === placement.siteId
        )
        const siteMatrix = site
          ? poseToMatrix(site.poseInAnchor)
          : poseToMatrix({
              positionMm: [0, 0, 0],
              rotationDegXYZ: [0, 0, 0]
            })
        matrix = multiplyMatrices(
          multiplyMatrices(resolve(placement.parentId), siteMatrix),
          poseToMatrix(placement.offsetPose)
        )
        break
      }
    }

    visiting.delete(materialId)
    resolved[materialId] = matrix
    return matrix
  }

  for (const materialId of Object.keys(aggregatesById)) resolve(materialId)
  return resolved
}

function withPreview(
  placement: MaterialPlacement,
  preview: LabPose | undefined
): MaterialPlacement {
  if (!preview) return placement
  switch (placement.kind) {
    case 'unplaced':
      return { kind: 'world', pose: preview }
    case 'world':
      return { ...placement, pose: preview }
    case 'parent':
      return { ...placement, localPose: preview }
    case 'site':
      return { ...placement, offsetPose: preview }
  }
}

function placementParentId(
  placement: MaterialPlacement
): MaterialId | null {
  return placement.kind === 'parent' || placement.kind === 'site'
    ? placement.parentId
    : null
}

function worldPointToFlow(
  point: readonly [number, number, number]
): XYPosition {
  return {
    x: point[0] * MATERIAL_FLOW_SCALE,
    y: -point[1] * MATERIAL_FLOW_SCALE
  }
}

function worldPointToReview(
  point: readonly [number, number, number]
): XYPosition {
  return {
    x: point[0] * MATERIAL_REVIEW_SCALE,
    y: -point[1] * MATERIAL_REVIEW_SCALE
  }
}

function avoidReviewCollisions(
  nodes: readonly MaterialFlowNode[]
): MaterialFlowNode[] {
  const placed: MaterialFlowNode[] = []
  for (const node of nodes) {
    let position = node.position
    for (let ring = 0; overlapsAny(position, placed); ring += 1) {
      const step = Math.floor(ring / 4) + 1
      const direction = ring % 4
      const xOffset =
        direction === 0
          ? step * (REVIEW_NODE_WIDTH + REVIEW_NODE_GAP)
          : direction === 1
            ? -step * (REVIEW_NODE_WIDTH + REVIEW_NODE_GAP)
            : 0
      const yOffset =
        direction === 2
          ? step * (REVIEW_NODE_HEIGHT + REVIEW_NODE_GAP)
          : direction === 3
            ? -step * (REVIEW_NODE_HEIGHT + REVIEW_NODE_GAP)
            : 0
      position = {
        x: node.position.x + xOffset,
        y: node.position.y + yOffset
      }
    }
    placed.push({ ...node, position })
  }
  return placed
}

function overlapsAny(
  position: XYPosition,
  nodes: readonly MaterialFlowNode[]
): boolean {
  return nodes.some(
    (node) =>
      Math.abs(node.position.x - position.x) <
        REVIEW_NODE_WIDTH + REVIEW_NODE_GAP &&
      Math.abs(node.position.y - position.y) <
        REVIEW_NODE_HEIGHT + REVIEW_NODE_GAP
  )
}

function flowPointToWorld(
  point: XYPosition,
  z: number
): readonly [number, number, number] {
  return [
    point.x / MATERIAL_FLOW_SCALE,
    -point.y / MATERIAL_FLOW_SCALE,
    z
  ]
}

function worldDeltaToFlow(
  child: Matrix4,
  parent: Matrix4
): XYPosition {
  return {
    x: (child[3] - parent[3]) * MATERIAL_FLOW_SCALE,
    y: -(child[7] - parent[7]) * MATERIAL_FLOW_SCALE
  }
}

function materialDepth(
  materialId: MaterialId,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): number {
  let depth = 0
  let current = aggregatesById[materialId]
  const visited = new Set<MaterialId>()

  while (current) {
    if (visited.has(current.material.id)) {
      throw new Error(
        `Material parent cycle contains ${current.material.id}`
      )
    }
    visited.add(current.material.id)
    const parentId = placementParentId(current.placement)
    if (!parentId) return depth
    depth += 1
    current = aggregatesById[parentId]
  }

  return depth
}
