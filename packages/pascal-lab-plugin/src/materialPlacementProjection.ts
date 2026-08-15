import {
  composePoses,
  IDENTITY_POSE,
  relativePose,
  type LabPose,
  type MaterialAggregate,
  type MaterialAnchor,
  type MaterialId,
  type MaterialPlacement
} from '@unilab/material/domain'
import type { LabPlacementRef } from './schema'
import {
  labLinkPoseToThree,
  labPoseToPascal,
  pascalPoseToLab,
  threePoseToLabLink,
  type Vector3Tuple
} from './units'

export function projectPlacement(
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  sceneObjectIdByMaterialId: Readonly<Record<MaterialId, string>>
): {
  position: Vector3Tuple
  rotation: Vector3Tuple
  attach: {
    parentDeviceId: string | null
    parentLinkName: string | null
    mountPoint: string | null
  }
  placementRef: LabPlacementRef
} {
  const placement = aggregate.placement
  const base = {
    attach: {
      parentDeviceId: null,
      parentLinkName: null,
      mountPoint: null
    },
    placementRef: placementRef(placement, aggregatesById)
  }

  if (placement.kind === 'unplaced' || placement.kind === 'world') {
    const pose = labPoseToPascal(
      placement.kind === 'world' ? placement.pose : IDENTITY_POSE
    )
    return { ...base, ...pose }
  }

  const parentSceneObjectId =
    sceneObjectIdByMaterialId[placement.parentId] ??
    `lab-${placement.parentId}`
  const anchor = resolvePlacementAnchor(placement, aggregatesById)
  const localPose =
    placement.kind === 'parent'
      ? placement.localPose
      : composePoses(
          findSite(aggregate, aggregatesById)?.poseInAnchor ?? IDENTITY_POSE,
          placement.offsetPose
        )
  if (
    anchor.kind === 'root' &&
    !requiresLiveParenting(aggregate.material.id, aggregatesById)
  ) {
    return {
      ...base,
      ...labPoseToPascal(
        resolveAggregateWorldPose(aggregate.material.id, aggregatesById)
      )
    }
  }
  const pose =
    anchor.kind === 'link'
      ? labLinkPoseToThree(localPose)
      : labPoseToPascal(localPose)

  return {
    ...base,
    ...pose,
    attach: {
      parentDeviceId: parentSceneObjectId,
      parentLinkName:
        anchor.kind === 'link' ? anchor.linkName : '__root__',
      mountPoint: placement.kind === 'site' ? placement.siteId : null
    }
  }
}

export function placementFromSceneNode(
  position: Vector3Tuple,
  rotation: Vector3Tuple,
  aggregate: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): MaterialPlacement {
  const current = aggregate.placement
  if (current.kind === 'unplaced' || current.kind === 'world') {
    return {
      kind: 'world',
      pose: pascalPoseToLab(position, rotation)
    }
  }

  const anchor = resolvePlacementAnchor(current, aggregatesById)
  if (
    anchor.kind === 'root' &&
    !requiresLiveParenting(aggregate.material.id, aggregatesById)
  ) {
    const worldPose = pascalPoseToLab(position, rotation)
    if (current.kind === 'parent') {
      return {
        ...current,
        localPose: relativePose(
          worldPose,
          resolveAggregateWorldPose(current.parentId, aggregatesById)
        )
      }
    }
    const site = findSite(aggregate, aggregatesById)
    const siteWorldPose = composePoses(
      resolveAggregateWorldPose(current.parentId, aggregatesById),
      site?.poseInAnchor ?? IDENTITY_POSE
    )
    return {
      ...current,
      offsetPose: relativePose(worldPose, siteWorldPose)
    }
  }
  const localPose =
    anchor.kind === 'link'
      ? threePoseToLabLink(position, rotation)
      : pascalPoseToLab(position, rotation)

  if (current.kind === 'parent') {
    return {
      ...current,
      localPose
    }
  }

  const site = findSite(aggregate, aggregatesById)
  return {
    ...current,
    offsetPose: site
      ? relativePose(localPose, site.poseInAnchor)
      : localPose
  }
}

export function resolveAggregateWorldPose(
  materialId: MaterialId,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  resolved = new Map<MaterialId, LabPose>(),
  visiting = new Set<MaterialId>()
): LabPose {
  const cached = resolved.get(materialId)
  if (cached) return cached
  if (visiting.has(materialId)) return IDENTITY_POSE
  const aggregate = aggregatesById[materialId]
  if (!aggregate) return IDENTITY_POSE
  visiting.add(materialId)
  const placement = aggregate.placement
  let pose: LabPose
  if (placement.kind === 'unplaced') {
    pose = IDENTITY_POSE
  } else if (placement.kind === 'world') {
    pose = placement.pose
  } else if (placement.kind === 'parent') {
    pose = composePoses(
      resolveAggregateWorldPose(
        placement.parentId,
        aggregatesById,
        resolved,
        visiting
      ),
      placement.localPose
    )
  } else {
    const parent = aggregatesById[placement.parentId]
    const site = parent?.sites.find(
      (candidate) => candidate.id === placement.siteId
    )
    pose = composePoses(
      composePoses(
        resolveAggregateWorldPose(
          placement.parentId,
          aggregatesById,
          resolved,
          visiting
        ),
        site?.poseInAnchor ?? IDENTITY_POSE
      ),
      placement.offsetPose
    )
  }
  visiting.delete(materialId)
  resolved.set(materialId, pose)
  return pose
}

function resolvePlacementAnchor(
  placement: MaterialPlacement,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): MaterialAnchor {
  if (placement.kind !== 'parent' && placement.kind !== 'site') {
    return { kind: 'root' }
  }
  const declared: MaterialAnchor =
    placement.kind === 'parent'
      ? placement.anchor
      : aggregatesById[placement.parentId]?.sites.find(
          (site) => site.id === placement.siteId
        )?.anchor ?? { kind: 'root' }
  if (declared.kind === 'link') return declared
  const mountLink = parentMountLinkFromConfig(
    aggregatesById[placement.parentId]?.material.config
  )
  return mountLink
    ? { kind: 'link', linkName: mountLink }
    : declared
}

function parentMountLinkFromConfig(config: unknown): string | undefined {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return undefined
  }
  const rendering = (config as { rendering?: unknown }).rendering
  if (!rendering || typeof rendering !== 'object' || Array.isArray(rendering)) {
    return undefined
  }
  const kinematics = (rendering as { kinematics?: unknown }).kinematics
  if (!kinematics || typeof kinematics !== 'object' || Array.isArray(kinematics)) {
    return undefined
  }
  const mountLink = (kinematics as { mount_link?: unknown }).mount_link
  return typeof mountLink === 'string' && mountLink.trim()
    ? mountLink.trim()
    : undefined
}

/**
 * Link-anchored subtrees stay parented in Three so high-frequency joint
 * updates propagate without rebuilding Material Graph view state. Pure
 * root-anchor chains are flattened to level/world space; this avoids
 * imperative reparenting races between independently rendered Pascal nodes.
 */
function requiresLiveParenting(
  materialId: MaterialId,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>,
  visiting = new Set<MaterialId>()
): boolean {
  if (visiting.has(materialId)) return false
  visiting.add(materialId)
  const aggregate = aggregatesById[materialId]
  const placement = aggregate?.placement
  if (!placement || placement.kind === 'unplaced' || placement.kind === 'world') {
    return false
  }
  const anchor = resolvePlacementAnchor(placement, aggregatesById)
  return (
    anchor.kind === 'link' ||
    requiresLiveParenting(placement.parentId, aggregatesById, visiting)
  )
}

function placementRef(
  placement: MaterialPlacement,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
): LabPlacementRef {
  const parentMaterialId =
    placement.kind === 'parent' || placement.kind === 'site'
      ? placement.parentId
      : null
  const anchor = resolvePlacementAnchor(placement, aggregatesById)

  return {
    kind: placement.kind,
    parentMaterialId,
    siteId: placement.kind === 'site' ? placement.siteId : null,
    anchorKind: anchor.kind,
    anchorLinkName: anchor.kind === 'link' ? anchor.linkName : null
  }
}

function findSite(
  child: MaterialAggregate,
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
) {
  const placement = child.placement
  if (placement.kind !== 'site') return undefined
  return aggregatesById[placement.parentId]?.sites.find(
    (site) => site.id === placement.siteId
  )
}

export function samePlacement(
  left: MaterialPlacement,
  right: MaterialPlacement
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'unplaced' && right.kind === 'unplaced') return true
  if (left.kind === 'world' && right.kind === 'world') {
    return samePose(left.pose, right.pose)
  }
  if (left.kind === 'parent' && right.kind === 'parent') {
    return (
      left.parentId === right.parentId &&
      JSON.stringify(left.anchor) === JSON.stringify(right.anchor) &&
      samePose(left.localPose, right.localPose)
    )
  }
  if (left.kind === 'site' && right.kind === 'site') {
    return (
      left.parentId === right.parentId &&
      left.siteId === right.siteId &&
      samePose(left.offsetPose, right.offsetPose)
    )
  }
  return false
}

function samePose(left: LabPose, right: LabPose): boolean {
  return (
    sameTuple(left.positionMm, right.positionMm) &&
    sameTuple(left.rotationDegXYZ, right.rotationDegXYZ)
  )
}

function sameTuple(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return left.every(
    (value, index) => Math.abs(value - right[index]) < 1e-6
  )
}
