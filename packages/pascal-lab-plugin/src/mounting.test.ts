import { describe, expect, it } from 'vitest'
import { Group, Vector3 } from 'three'

import {
  calculateHorizontalSnapDistance,
  calculateLocalMountPose,
  findLinkObject,
  findNearestHorizontalMountMatch,
  syncVirtualAttachPointFrames
} from './mounting'

describe('lab mounting', () => {
  it('uses X/Z distance so elevated links can snap in top view', () => {
    expect(
      calculateHorizontalSnapDistance(
        new Vector3(1, 0, 1),
        new Vector3(1.3, 4, 1.4)
      )
    ).toBeCloseTo(0.5)
  })

  it('calculates a parent-link local pose', () => {
    const parent = new Group()
    parent.position.set(1, 0, 0)
    const child = new Group()
    child.position.set(1.2, 0.4, 0.6)
    child.rotation.z = Math.PI / 2
    parent.updateMatrixWorld(true)
    child.updateMatrixWorld(true)

    const pose = calculateLocalMountPose(child, parent)
    expect(pose.positionMm[0]).toBeCloseTo(200)
    expect(pose.positionMm[1]).toBeCloseTo(400)
    expect(pose.positionMm[2]).toBeCloseTo(600)
    expect(pose.rotationDegXYZ[2]).toBeCloseTo(90)
  })

  it('chooses the nearest accepted mount option', () => {
    const near = new Group()
    near.position.set(0.1, 2, 0.1)
    const far = new Group()
    far.position.set(0.8, 0, 0.8)
    near.updateMatrixWorld(true)
    far.updateMatrixWorld(true)

    const nodes = [
      { id: 'near', object: near },
      { id: 'far', object: far }
    ]
    const result = findNearestHorizontalMountMatch({
      childNode: { id: 'child', object: new Group() },
      childPosition: new Vector3(0, 0, 0),
      candidateNodes: nodes,
      threshold: 1,
      getParentObject: (node) => node.object,
      getMountOptions: () => [
        { link: 'base', label: 'Base' }
      ],
      acceptsChild: () => true,
      findLinkObject: (object) => object
    })

    expect(result?.parentNode.id).toBe('near')
  })

  it('为 mesh 创建 grasp_frame，但不覆盖真实模型 link', () => {
    const root = new Group()
    syncVirtualAttachPointFrames(root, [{
      link: 'grasp_frame',
      position: [0, 0, 120],
      rotation: [0, 0, 0]
    }])
    expect(findLinkObject(root, 'grasp_frame')?.position.y).toBeCloseTo(0.12)

    const real = new Group()
    real.name = 'tool0'
    root.add(real)
    syncVirtualAttachPointFrames(root, [{ link: 'tool0', position: [1000, 2000, 3000] }])
    expect(findLinkObject(root, 'tool0')).toBe(real)
    expect(real.position.toArray()).toEqual([0, 0, 0])
  })
})
