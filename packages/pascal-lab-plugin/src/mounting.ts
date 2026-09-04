import {
  Euler,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
  type Object3D
} from 'three'

import type { LabPose } from '@unilab/material/domain'
import type { LabAttachPoint } from './schema'
import {
  labPoseToPascal,
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
  const robot = parentObject as Object3D & {
    links?: Record<string, Object3D>
  }
  if (robot.links?.[linkName]) return robot.links[linkName]

  let match: Object3D | null = null
  parentObject.traverse((object) => {
    if (!match && object.name === linkName) match = object
  })
  return match
}

/**
 * 解析子物体在父模型上的附着连杆（link）。
 *
 * @param parentObject 父物体的场景根对象，其中可以包含带命名空间前缀的 URDF 连杆。
 * @param requestedLinkName 物理图（Graph）通过 ``extra.parent_link`` 声明的目标连杆；可空。
 * @returns 依次命中显式目标、``attach_link``、``tool_0``、``tool0``；均不存在时返回父根对象。
 */
export function findChildAttachLink(
  parentObject: Object3D,
  requestedLinkName?: string | null
): Object3D {
  const requested = requestedLinkName === '__root__'
    ? null
    : requestedLinkName?.trim()
  const candidates = [requested, 'attach_link', 'tool_0', 'tool0']
    .filter((value): value is string => Boolean(value))

  for (const candidate of [...new Set(candidates)]) {
    const match = findSemanticLinkObject(parentObject, candidate)
    if (match) return match
  }
  return parentObject
}

/**
 * 在父模型中按完整名称或命名空间后缀查找语义连杆。
 *
 * @param parentObject 父模型场景对象。
 * @param semanticName 未带设备前缀的连杆语义名，或已经限定的完整连杆名。
 * @returns 唯一遍历顺序中的首个匹配连杆；不存在时返回 ``null``。
 */
function findSemanticLinkObject(
  parentObject: Object3D,
  semanticName: string
): Object3D | null {
  const exact = findLinkObject(parentObject, semanticName)
  if (exact) return exact

  let match: Object3D | null = null
  parentObject.traverse((object) => {
    if (!match && hasSemanticLinkName(object.name, semanticName)) {
      match = object
    }
  })
  return match
}

function hasSemanticLinkName(actual: string, semantic: string): boolean {
  return (
    actual === semantic ||
    actual.endsWith(`_${semantic}`) ||
    actual.endsWith(`/${semantic}`)
  )
}

const VIRTUAL_ATTACH_POINT = 'unilabVirtualAttachPoint'

/**
 * 给没有 link 拓扑的 STL/GLB 设备创建稳定虚拟 frame。
 * 若模型本身已含同名 URDF/GLTF 节点则直接复用，不创建第二个锚点。
 */
export function syncVirtualAttachPointFrames(
  root: Object3D,
  attachPoints: readonly LabAttachPoint[]
): void {
  const expected = new Set(attachPoints.map(point => point.link))
  for (const child of [...root.children]) {
    if (child.userData[VIRTUAL_ATTACH_POINT] === true &&
        !expected.has(child.name)) root.remove(child)
  }
  for (const point of attachPoints) {
    const existing = findLinkObject(root, point.link)
    if (existing && existing.userData[VIRTUAL_ATTACH_POINT] !== true) continue
    const frame = existing ?? new Group()
    frame.name = point.link
    frame.userData[VIRTUAL_ATTACH_POINT] = true
    const pose = labPoseToPascal({
      positionMm: point.position ?? [0, 0, 0],
      rotationDegXYZ: point.rotation ?? [0, 0, 0]
    })
    frame.position.set(...pose.position)
    frame.rotation.set(...pose.rotation, 'XYZ')
    if (!existing) root.add(frame)
  }
}
