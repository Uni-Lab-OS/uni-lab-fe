import {
  Euler,
  Matrix4,
  Quaternion,
  Vector3
} from 'three'

import type { LabPose } from '@unilab/material/domain'

export const MILLIMETERS_TO_METERS = 0.001
export const METERS_TO_MILLIMETERS = 1000
const DEGREES_TO_RADIANS = Math.PI / 180
const RADIANS_TO_DEGREES = 180 / Math.PI

export type Vector3Tuple = [number, number, number]

const LAB_TO_PASCAL = new Matrix4().makeRotationX(-Math.PI / 2)
const PASCAL_TO_LAB = LAB_TO_PASCAL.clone().invert()

/**
 * Convert a canonical Uni-Lab Z-up/mm/degree pose into Pascal's
 * Y-up/metre/radian frame. This basis conversion is valid for world poses and
 * for local poses whose parent is another Pascal scene object.
 */
export function labPoseToPascal(pose: LabPose): {
  position: Vector3Tuple
  rotation: Vector3Tuple
} {
  const labMatrix = poseMatrix(
    pose.positionMm.map(
      (value) => value * MILLIMETERS_TO_METERS
    ) as Vector3Tuple,
    pose.rotationDegXYZ.map(
      (value) => value * DEGREES_TO_RADIANS
    ) as Vector3Tuple
  )
  return matrixPose(
    LAB_TO_PASCAL.clone().multiply(labMatrix).multiply(PASCAL_TO_LAB)
  )
}

export function pascalPoseToLab(
  position: Vector3Tuple,
  rotation: Vector3Tuple
): LabPose {
  const pascalMatrix = poseMatrix(position, rotation)
  const lab = matrixPose(
    PASCAL_TO_LAB.clone().multiply(pascalMatrix).multiply(LAB_TO_PASCAL)
  )
  return {
    positionMm: lab.position.map(
      (value) => clean(value * METERS_TO_MILLIMETERS)
    ) as Vector3Tuple,
    rotationDegXYZ: lab.rotation.map(
      (value) => clean(value * RADIANS_TO_DEGREES)
    ) as Vector3Tuple
  }
}

/**
 * URDF link objects retain their ROS local axes inside the model. A pose
 * parented directly below such a link therefore changes units/angles only;
 * it must not run through the Pascal world-basis conversion again.
 */
export function labLinkPoseToThree(pose: LabPose): {
  position: Vector3Tuple
  rotation: Vector3Tuple
} {
  return {
    position: pose.positionMm.map(
      (value) => value * MILLIMETERS_TO_METERS
    ) as Vector3Tuple,
    rotation: pose.rotationDegXYZ.map(
      (value) => value * DEGREES_TO_RADIANS
    ) as Vector3Tuple
  }
}

/**
 * World-placed URDF models need one Z-up → Pascal Y-up basis rotation.
 * A child live-parented to a URDF link already sits inside that converted
 * subtree (same as RViz TF); applying the basis again lays the model over.
 */
export function urdfModelDisplayRotation(
  format: string,
  parentLinkName: string | null | undefined
): Vector3Tuple | undefined {
  if (format !== 'xacro' && format !== 'urdf') return undefined
  if (parentLinkName && parentLinkName !== '__root__') return undefined
  return [-Math.PI / 2, 0, 0]
}

export function threePoseToLabLink(
  position: Vector3Tuple,
  rotation: Vector3Tuple
): LabPose {
  return {
    positionMm: position.map(
      (value) => clean(value * METERS_TO_MILLIMETERS)
    ) as Vector3Tuple,
    rotationDegXYZ: rotation.map(
      (value) => clean(value * RADIANS_TO_DEGREES)
    ) as Vector3Tuple
  }
}

function poseMatrix(
  position: Vector3Tuple,
  rotation: Vector3Tuple
): Matrix4 {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(rotation[0], rotation[1], rotation[2], 'XYZ')
  )
  return new Matrix4().compose(
    new Vector3(...position),
    quaternion,
    new Vector3(1, 1, 1)
  )
}

function matrixPose(matrix: Matrix4): {
  position: Vector3Tuple
  rotation: Vector3Tuple
} {
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  matrix.decompose(position, quaternion, scale)
  const rotation = new Euler().setFromQuaternion(quaternion, 'XYZ')
  return {
    position: [
      clean(position.x),
      clean(position.y),
      clean(position.z)
    ],
    rotation: [
      clean(rotation.x),
      clean(rotation.y),
      clean(rotation.z)
    ]
  }
}

function clean(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value
}
