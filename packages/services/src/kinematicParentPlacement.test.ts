import { describe, expect, it } from 'vitest'

import { mapBackendMaterialGraph } from './materialBackendGraphCodec'

describe('运动学父设备放置投影', () => {
  it('keeps configured rendering dimensions when relative_position sizes are zero', () => {
    const graph = mapBackendMaterialGraph({
      nodes: [
        {
          ...graphNode('rail', null, {
            rendering: {
              kind: 'rail',
              dimensionsMm: [2300, 180, 150]
            }
          }),
          relative_position: {
            ...graphNode('rail', null, {}).relative_position as Record<
              string,
              unknown
            >,
            width: 0,
            length: 0,
            depth: 0
          }
        }
      ]
    })

    expect(graph[0]?.material.config.rendering).toEqual({
      kind: 'rail',
      dimensionsMm: [2300, 180, 150]
    })
  })

  it('uses the OS-projected rail mount link for live child parenting', () => {
    const graph = mapBackendMaterialGraph({
      nodes: [
        graphNode('rail', null, {
          rendering: {
            kind: 'rail',
            kinematics: {
              device_id: 'rail',
              topology_digest: 'a'.repeat(64),
              qualified_joint_names: ['rail_rail_joint'],
              stale_after_s: 1
            }
          }
        }),
        graphNode('robot', 'rail', {
          rendering: {
            kind: 'robot',
            parent_link: 'rail_rail_carriage'
          }
        })
      ]
    })

    expect(graph[1]?.placement).toEqual({
      kind: 'parent',
      parentId: 'rail',
      anchor: { kind: 'link', linkName: 'rail_rail_carriage' },
      localPose: {
        positionMm: [0, 0, 150],
        rotationDegXYZ: [0, 0, 0]
      }
    })
  })
})

function graphNode(
  id: string,
  parentId: string | null,
  config: Record<string, unknown>
): Record<string, unknown> {
  return {
    material: {
      uuid: id,
      resource_template_uuid: `template-${id}`,
      revision: 1,
      type: 'device',
      parent_uuid: parentId,
      class: id,
      barcode: '',
      name: id,
      create_time: '2026-08-16T00:00:00Z',
      update_time: '2026-08-16T00:00:00Z',
      meta_data: {},
      config,
      data: {}
    },
    resource_template: {
      uuid: `template-${id}`,
      name: `community.${id}`,
      display_name: id,
      resource_type: 'device'
    },
    relative_position: {
      uuid: `position-${id}`,
      material_uuid: id,
      create_time: '2026-08-16T00:00:00Z',
      update_time: '2026-08-16T00:00:00Z',
      meta_data: {},
      position_x: 0,
      position_y: 0,
      position_z: id === 'robot' ? 150 : 0,
      width: 900,
      length: 900,
      depth: 1200,
      scale_x: 1,
      scale_y: 1,
      scale_z: 1,
      rotation_x: 0,
      rotation_y: 0,
      rotation_z: 0
    },
    sites: [],
    current_site_uuid: null,
    handles: []
  }
}
