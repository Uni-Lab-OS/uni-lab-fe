import type {
  MaterialAggregate,
  MaterialId,
  MaterialPlacement
} from '@unilab/material/domain'
import type { KinematicAttachmentFrame } from '@unilab/scene-runtime'
import { Euler, Quaternion } from 'three'

/**
 * 把 format-free 附着 latest 投影成现有 MaterialPlacement 运行时覆盖。
 * stale/uncertain/detaching 保持最后姿态；detached 立即撤销覆盖，物料图中的
 * 当前库位（Site）重新成为渲染权威。同库位放回不会产生库存 revision，不能
 * 把 revision 增加误当成解除附着的必要证据。
 */
export function attachmentFramesToRuntimePlacements(
  frames: Readonly<Record<string, KinematicAttachmentFrame>>,
  aggregates: readonly MaterialAggregate[]
): Readonly<Record<MaterialId, MaterialPlacement>> {
  const aggregateById = new Map(
    aggregates.map(aggregate => [aggregate.material.id, aggregate])
  )
  const placements: Record<MaterialId, MaterialPlacement> = {}
  for (const childRef of Object.keys(frames).sort()) {
    const frame = frames[childRef]
    const child = frame ? aggregateById.get(frame.childRef) : undefined
    if (!frame || !child || !aggregateById.has(frame.parentRef) ||
        frame.childRef === frame.parentRef) continue
    if (frame.state === 'detached') continue
    const placement: MaterialPlacement = {
      kind: 'parent',
      parentId: frame.parentRef,
      anchor: frame.anchor.kind === 'root'
        ? { kind: 'root' }
        : { kind: 'link', linkName: frame.anchor.linkName },
      localPose: {
        positionMm: frame.localPose.xyzM.map(value => value * 1000) as [
          number, number, number
        ],
        rotationDegXYZ: quaternionToDegrees(
          frame.localPose.orientationXyzw
        )
      }
    }
    placements[frame.childRef] = placement
    if (containsCycle(frame.childRef, placements)) {
      delete placements[frame.childRef]
    }
  }
  return Object.freeze(placements)
}

function quaternionToDegrees(
  value: readonly [number, number, number, number]
): [number, number, number] {
  const rotation = new Euler().setFromQuaternion(
    new Quaternion(value[0], value[1], value[2], value[3]).normalize(),
    'XYZ'
  )
  return [
    rotation.x * 180 / Math.PI,
    rotation.y * 180 / Math.PI,
    rotation.z * 180 / Math.PI
  ]
}

function containsCycle(
  childId: MaterialId,
  placements: Readonly<Record<MaterialId, MaterialPlacement>>
): boolean {
  const visited = new Set<MaterialId>()
  let current: MaterialId | null = childId
  while (current) {
    if (visited.has(current)) return true
    visited.add(current)
    const placement: MaterialPlacement | undefined = placements[current]
    current = placement?.kind === 'parent' ? placement.parentId : null
  }
  return false
}
