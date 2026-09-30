import { describe, expect, it } from 'vitest'
import { decodeMaterialDetail, decodeMaterialGraph, decodeSiteDetail } from './codec'

describe('material site codec', () => {
  it('maps a graph while keeping cross-node Site ownership and occupancy', () => {
    const graph = decodeMaterialGraph({
      code: 0,
      data: {
        nodes: [
          {
            material: material('material-root', 'template-deck', 'Deck'),
            resource_template: template('template-deck', 'device'),
            relative_position: position('material-root'),
            sites: [site('site-a1', 'material-root', 'material-child')],
            current_site_uuid: null,
          },
          {
            material: {
              ...material('material-child', 'template-vial', 'Vial'),
              parent_uuid: 'material-root',
            },
            resource_template: template('template-vial', 'resource'),
            relative_position: null,
            sites: [],
            current_site_uuid: 'site-a1',
          },
        ],
      },
    })

    expect(graph).toMatchObject({
      kind: 'material_graph',
      nodes: [
        {
          material: { materialUuid: 'material-root' },
          sites: [
            {
              siteUuid: 'site-a1',
              ownerMaterialUuid: 'material-root',
              occupancy: { known: true, occupiedMaterialUuid: 'material-child' },
            },
          ],
        },
        {
          material: { materialUuid: 'material-child' },
          currentSiteUuid: 'site-a1',
        },
      ],
    })
  })

  it('does not turn an omitted occupancy field into an empty Site', () => {
    const site = decodeSiteDetail({
      uuid: 'site-unknown',
      material_uuid: 'material-root',
      name: 'Unknown site',
    })

    expect(site.occupancy).toEqual({
      known: false,
      occupiedMaterialUuid: null,
    })
  })

  it('rejects a Site whose owner does not match its graph node', () => {
    expect(() =>
      decodeMaterialGraph({
        nodes: [
          {
            material: material('material-root', 'template-deck', 'Deck'),
            sites: [site('site-a1', 'other-material', null)],
          },
        ],
      }),
    ).toThrow('owner does not match')
  })

  it('maps a material detail and its current Site', () => {
    const detail = decodeMaterialDetail({
      code: 0,
      data: {
        ...material('material-child', 'template-vial', 'Vial'),
        relative_position: position('material-child'),
        sites: [],
        current_site: site('site-a1', 'material-root', 'material-child'),
      },
    })

    expect(detail).toMatchObject({
      kind: 'material_detail',
      materialUuid: 'material-child',
      relativePosition: { positionMm: [10, 20, 30] },
      currentSite: { siteUuid: 'site-a1' },
    })
  })
})

function material(uuid: string, templateUuid: string, name: string) {
  return {
    uuid,
    resource_template_uuid: templateUuid,
    type: 'resource',
    class: 'sample',
    barcode: `${uuid}-barcode`,
    name,
    description: null,
    revision: 2,
    config: { rendering: { kind: 'vial' } },
    data: {},
    meta_data: { source_node_id: uuid },
    create_time: '2026-09-25T00:00:00Z',
    update_time: '2026-09-25T00:00:01Z',
  }
}

function template(uuid: string, resourceType: string) {
  return {
    uuid,
    name: `${resourceType}.template`,
    display_name: resourceType,
    resource_type: resourceType,
  }
}

function position(materialUuid: string) {
  return {
    material_uuid: materialUuid,
    position_x: 10,
    position_y: 20,
    position_z: 30,
    width: 40,
    depth: 50,
    length: 60,
    scale_x: 1,
    scale_y: 1,
    scale_z: 1,
    rotation_x: 0,
    rotation_y: 0,
    rotation_z: 0,
  }
}

function site(uuid: string, ownerUuid: string, occupiedUuid: string | null) {
  return {
    uuid,
    material_uuid: ownerUuid,
    name: 'A1',
    meta_data: { key: 'deck-A1' },
    sort_order: 0,
    allowed_resource_template_uuids: ['template-vial'],
    ...(occupiedUuid === null
      ? { occupied_material_uuid: null }
      : { occupied_material_uuid: occupiedUuid }),
    position_x: 1,
    position_y: 2,
    position_z: 3,
    width: 4,
    depth: 5,
    length: 6,
    rotation_x: 0,
    rotation_y: 0,
    rotation_z: 0,
  }
}
