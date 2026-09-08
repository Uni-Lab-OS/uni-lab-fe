import { describe, expect, it } from 'vitest'

import { mapBackendMaterialGraph } from './materialBackendGraphCodec'

describe('OS Material Graph codec runtime seams', () => {
  it('preserves runtime UUIDs and decodes link anchors with root fallback', () => {
    const [root, child] = mapBackendMaterialGraph({
      nodes: [
        node('material-root', {
          metaData: {
            source_node_id: 'turntable-a',
            source_runtime_uuid: '11111111-1111-4111-8111-111111111111'
          },
          sites: [
            site('site-link', 'material-root', {
              anchor: {
                kind: 'link',
                link_name: 'turntable_plate_link'
              }
            }),
            site('site-root', 'material-root', {})
          ]
        }),
        node('material-child', {
          parentUuid: 'material-root',
          positionMetaData: {
            anchor: {
              kind: 'link',
              link_name: 'turntable_plate_link'
            }
          }
        })
      ]
    })

    expect(root.material.config).toMatchObject({
      sourceIdentity: 'turntable-a',
      sourceNodeUuid: '11111111-1111-4111-8111-111111111111'
    })
    expect(root.sites.map((entry) => entry.anchor)).toEqual([
      { kind: 'link', linkName: 'turntable_plate_link' },
      { kind: 'root' }
    ])
    expect(child.placement).toMatchObject({
      kind: 'parent',
      parentId: 'material-root',
      anchor: { kind: 'link', linkName: 'turntable_plate_link' }
    })
  })

  it('rejects malformed anchors instead of guessing a root placement', () => {
    expect(() => mapBackendMaterialGraph({
      nodes: [node('material-child', {
        parentUuid: 'material-root',
        positionMetaData: {
          anchor: { kind: 'link' }
        }
      })]
    })).toThrow(/link_name/)
  })
})

function node(
  materialUuid: string,
  options: {
    metaData?: Record<string, unknown>
    parentUuid?: string
    positionMetaData?: Record<string, unknown>
    sites?: Record<string, unknown>[]
  } = {}
): Record<string, unknown> {
  return {
    material: {
      uuid: materialUuid,
      resource_template_uuid: 'template-device',
      parent_uuid: options.parentUuid,
      barcode: '',
      name: materialUuid,
      create_time: '2026-08-31T00:00:00Z',
      update_time: '2026-08-31T00:00:00Z',
      meta_data: options.metaData ?? {},
      config: { rendering: { kind: 'device' } },
      data: {}
    },
    relative_position: {
      uuid: `position-${materialUuid}`,
      material_uuid: materialUuid,
      meta_data: options.positionMetaData ?? {},
      position_x: 0,
      position_y: 0,
      position_z: 0,
      width: 100,
      length: 100,
      depth: 100,
      rotation_x: 0,
      rotation_y: 0,
      rotation_z: 0
    },
    sites: options.sites ?? [],
    current_site_uuid: null,
    handles: []
  }
}

function site(
  siteUuid: string,
  materialUuid: string,
  metaData: Record<string, unknown>
): Record<string, unknown> {
  return {
    uuid: siteUuid,
    material_uuid: materialUuid,
    name: siteUuid,
    meta_data: metaData,
    sort_order: 0,
    allowed_resource_template_uuids: [],
    occupied_material_uuid: null,
    position_x: 0,
    position_y: 0,
    position_z: 0,
    width: 10,
    length: 10,
    depth: 10
  }
}
