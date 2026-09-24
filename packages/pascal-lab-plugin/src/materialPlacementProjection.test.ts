import type { MaterialAggregate } from '@unilab/material/domain'
import { describe, expect, it } from 'vitest'

import { projectPlacement } from './materialPlacementProjection'

describe('material placement projection', () => {
  it('keeps a root child live-parented when its parent has kinematics', () => {
    const parent = aggregate('robot', {
      rendering: {
        kinematics: {
          device_id: 'robot',
          topology_digest: 'a'.repeat(64),
          qualified_joint_names: ['robot_joint_1'],
          stale_after_s: 1
        }
      }
    })
    const child = aggregate('gripper', {}, {
      kind: 'parent',
      parentId: 'robot',
      anchor: { kind: 'root' },
      localPose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    })
    const aggregates = { robot: parent, gripper: child }

    const projected = projectPlacement(child, aggregates, {
      robot: 'lab-robot',
      gripper: 'lab-gripper'
    })

    expect(projected.attach).toEqual({
      parentDeviceId: 'lab-robot',
      parentLinkName: '__root__',
      mountPoint: null
    })
    expect(projected.position).toEqual([0, 0, 0])
  })

  it('uses rendering.parent_link for live parenting on parent kinematics', () => {
    const parent = aggregate('rail', {
      rendering: {
        kinematics: {
          device_id: 'rail',
          topology_digest: 'b'.repeat(64),
          qualified_joint_names: ['rail_rail_joint'],
          stale_after_s: 1
        }
      }
    })
    const child = aggregate('robot', {
      rendering: {
        parent_link: 'rail_rail_carriage',
        kinematics: {
          device_id: 'robot',
          topology_digest: 'a'.repeat(64),
          qualified_joint_names: ['robot_joint_1'],
          stale_after_s: 1
        }
      }
    }, {
      kind: 'parent',
      parentId: 'rail',
      anchor: { kind: 'root' },
      localPose: {
        positionMm: [0, 0, 200],
        rotationDegXYZ: [0, 0, 180]
      }
    })
    const aggregates = { rail: parent, robot: child }

    const projected = projectPlacement(child, aggregates, {
      rail: 'lab-rail',
      robot: 'lab-robot'
    })

    expect(projected.attach).toEqual({
      parentDeviceId: 'lab-rail',
      parentLinkName: 'rail_rail_carriage',
      mountPoint: null
    })
  })
})

function aggregate(
  id: string,
  config: Record<string, unknown> = {},
  placement: MaterialAggregate['placement'] = {
    kind: 'world',
    pose: {
      positionMm: [0, 0, 0],
      rotationDegXYZ: [0, 0, 0]
    }
  }
): MaterialAggregate {
  return {
    material: {
      id,
      sourceTemplateId: `template-${id}`,
      code: id,
      name: id,
      config,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    placement,
    sites: [],
    revision: 1
  }
}
