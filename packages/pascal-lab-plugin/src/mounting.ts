import {
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type Object3D
} from 'three'

import type { LabPose } from '@unilab/material/domain'
import {
  METERS_TO_MILLIMETERS
} from './units'

export type LocalMountPose = LabPose

function clean(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value
}

/**
 * Convert a child's world transform to canonical link-local LabPose.
 */
export function calculateLocalMountPose(
  childObject: Object3D,
  parentLinkObject: Object3D
): LocalMountPose {
  childObject.updateWorldMatrix(true, false)
  parentLinkObject.updateWorldMatrix(true, false)

  const localMatrix = new Matrix4()
    .copy(parentLinkObject.matrixWorld)
    .invert()
    .multiply(childObject.matrixWorld)
  const localPosition = new Vector3()
  const localQuaternion = new Quaternion()
  const localScale = new Vector3()
  localMatrix.decompose(localPosition, localQuaternion, localScale)
  const rotation = new Euler().setFromQuaternion(localQuaternion, 'XYZ')

  return {
    positionMm: [
      clean(localPosition.x * METERS_TO_MILLIMETERS),
      clean(localPosition.y * METERS_TO_MILLIMETERS),
      clean(localPosition.z * METERS_TO_MILLIMETERS)
    ],
    rotationDegXYZ: [
      clean(rotation.x * 180 / Math.PI),
      clean(rotation.y * 180 / Math.PI),
      clean(rotation.z * 180 / Math.PI)
    ]
  }
}

export function calculateHorizontalSnapDistance(
  cursorPosition: Vector3,
  linkPosition: Vector3
): number {
  const deltaX = cursorPosition.x - linkPosition.x
  const deltaZ = cursorPosition.z - linkPosition.z
  return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ)
}

interface MountOption {
  link: string
  label: string
  mountPoint?: string | null
}

export interface HorizontalMountMatch<Node> {
  parentNode: Node
  parentLink: string
  mountPoint?: string
  linkObject: Object3D
  distance: number
}

export interface FindNearestHorizontalMountMatchOptions<
  Node extends { id?: string }
> {
  childNode: Node
  childPosition: Vector3
  candidateNodes: readonly Node[]
  threshold: number
  getNodeId?: (node: Node) => string
  getParentObject: (node: Node) => Object3D | null
  getMountOptions: (node: Node) => readonly MountOption[]
  acceptsChild: (option: MountOption, childNode: Node) => boolean
  findLinkObject: (
    parentObject: Object3D,
    linkName: string
  ) => Object3D | null
  shouldSkipCandidate?: (candidateNode: Node, childNode: Node) => boolean
}

export function findNearestHorizontalMountMatch<
  Node extends { id?: string }
>({
  childNode,
  childPosition,
  candidateNodes,
  threshold,
  getNodeId = (node) => node.id ?? '',
  getParentObject,
  getMountOptions,
  acceptsChild,
  findLinkObject,
  shouldSkipCandidate
}: FindNearestHorizontalMountMatchOptions<Node>): HorizontalMountMatch<Node> | null {
  const childId = getNodeId(childNode)
  let nearest: HorizontalMountMatch<Node> | null = null

  for (const candidateNode of candidateNodes) {
    if (getNodeId(candidateNode) === childId) continue
    if (shouldSkipCandidate?.(candidateNode, childNode)) continue

    const parentObject = getParentObject(candidateNode)
    if (!parentObject) continue

    for (const option of getMountOptions(candidateNode)) {
      if (!acceptsChild(option, childNode)) continue
      const linkObject = findLinkObject(parentObject, option.link)
      if (!linkObject) continue

      const linkPosition = new Vector3()
      linkObject.getWorldPosition(linkPosition)
      const distance = calculateHorizontalSnapDistance(
        childPosition,
        linkPosition
      )
      if (distance > threshold || (nearest && distance >= nearest.distance)) {
        continue
      }

      nearest = {
        parentNode: candidateNode,
        parentLink: option.link,
        mountPoint: option.mountPoint ?? undefined,
        linkObject,
        distance
      }
    }
  }

  return nearest
}

export function findLinkObject(
  parentObject: Object3D,
  linkName: string
): Object3D | null {
  if (typeof parentObject.traverse !== 'function') return null
  const direct = objectLinks(parentObject)?.[linkName]
  if (direct) return direct

  let match: Object3D | null = null
  parentObject.traverse((object) => {
    if (match) return
    const nested = objectLinks(object)?.[linkName]
    if (nested) {
      match = nested
      return
    }
    if (object.name === linkName) match = object
  })
  return match
}

function objectLinks(
  object: Object3D
): Record<string, Object3D> | undefined {
  const links = (object as Object3D & {
    links?: Record<string, Object3D>
  }).links
  return links && typeof links === 'object' ? links : undefined
}

/**
 * Keep a child group parented to a live URDF link so joint updates
 * propagate like ROS TF. R3F may steal the parent back between frames.
 */
export function maintainLiveParent(
  group: Object3D,
  parentObject: Object3D | null,
  parentLinkName: string | null | undefined
): void {
  if (!parentLinkName) return
  if (!parentObject || typeof parentObject.traverse !== 'function') return
  const linkObject = parentLinkName === '__root__'
    ? parentObject
    : findLinkObject(parentObject, parentLinkName)
  if (!linkObject) return
  if (group.parent !== linkObject) linkObject.add(group)
}
