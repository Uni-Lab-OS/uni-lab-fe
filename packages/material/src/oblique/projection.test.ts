import { describe, expect, it } from 'vitest'

import type {
  MaterialAggregate,
  MaterialSite
} from '../types'
import {
  buildMaterialObliqueScene,
  projectObliquePoint
} from './projection'
import {
  parseShapeLibrary,
  resolveShapePrimitives,
  resolveShapeSpec,
  type MaterialShapeLibrary
} from './shapeSpec'

describe('oblique material projection', () => {
  it('uses a generic 45 degree half-depth cabinet projection', () => {
    const [x, y] = projectObliquePoint([100, 200, 300])

    expect(x).toBeCloseTo(170.710678, 6)
    expect(y).toBeCloseTo(-370.710678, 6)
  })

  it('fits bounds from geometry and keeps the plan as an affine top plane', () => {
    const scene = buildMaterialObliqueScene([
      aggregate('plate', [100, 200, 30])
    ])
    const object = scene.objects[0]

    expect(object?.widthMm).toBe(127.76)
    expect(object?.depthMm).toBe(85.48)
    expect(object?.heightMm).toBe(14.4)
    expect(object?.topTransform).toHaveLength(6)
    for (const point of [...(object?.base ?? []), ...(object?.top ?? [])]) {
      expect(point[0]).toBeGreaterThanOrEqual(scene.bounds.minX)
      expect(point[0]).toBeLessThanOrEqual(
        scene.bounds.minX + scene.bounds.width
      )
      expect(point[1]).toBeGreaterThanOrEqual(scene.bounds.minY)
      expect(point[1]).toBeLessThanOrEqual(
        scene.bounds.minY + scene.bounds.height
      )
    }
  })

  it('falls back to a solid envelope when no bundle declares the category', () => {
    const scene = buildMaterialObliqueScene([
      aggregate('s07', [0, 0, 0], {
        kind: 'carousel_feeder',
        dimensionsMm: [770, 654.5, 503]
      }),
      aggregate('beaker', [900, 0, 0], { kind: 'beaker_500ml' })
    ])

    expect(scene.objects.map((object) => object.renderStyle)).toEqual([
      'solid',
      'solid'
    ])
    expect(scene.objects.map((object) => object.fidelity)).toEqual([
      'envelope',
      'envelope'
    ])
    expect(scene.diagnostics).toEqual({
      declaredShapeCount: 0,
      envelopeApproximationCount: 2,
      inferredStructureCount: 0,
      invalidObjectCount: 0
    })
    expect(scene.objects.every((object) => object.shape === undefined)).toBe(
      true
    )
  })

  it('paints declared parts back to front with the declared shadow', () => {
    const scene = buildMaterialObliqueScene(
      [
        aggregate('s05', [1105, 185, 0], {
          kind: 'vision_cell',
          dimensionsMm: [340, 510, 329]
        })
      ],
      library([
        {
          id: 'vision_cell',
          applies_to: [{ category: 'vision_cell' }],
          parts: [
            { type: 'box', style: 'frame', from: [0, 27.5, 0], to: [10, 227.5, 500] },
            { type: 'cylinder', style: 'gear', center: [170, 127.5], z: [130, 148], d: 234 },
            { type: 'disc', style: 'bore', center: [170, 127.5], z: 162, d: 90 }
          ]
        }
      ])
    )
    const object = scene.objects[0]

    expect(object?.renderStyle).toBe('spec')
    expect(object?.fidelity).toBe('declared')
    expect(object?.shape?.id).toBe('vision_cell')
    expect(object?.shape?.bundle).toBe('test-bundle')
    expect(object?.shape?.shadow).toBe('box')
    expect(object?.shape?.primitives.map((part) => part.kind)).toEqual([
      'box',
      'cylinder',
      'disc'
    ])
    // mm 声明原样落到本地坐标，不跟着包络缩放
    expect(object?.shape?.primitives[1]).toMatchObject({
      centerXMm: 170,
      centerYMm: 127.5,
      radiusMm: 117,
      fromZMm: 130,
      toZMm: 148
    })
  })

  it('scales ratio parts against each instance envelope', () => {
    const spec = library([
      {
        id: 'beaker',
        applies_to: [{ category_contains: 'beaker' }],
        units: 'ratio',
        shadow: 'round',
        parts: [
          {
            type: 'lathe',
            style: 'glass',
            center: [0.5, 0.5],
            d: 1,
            z: [0, 1],
            spout: true,
            rings: [
              { z: 0, r: 0.93 },
              { z: 1, r: 1 }
            ]
          }
        ]
      }
    ])[0]!
    const primitives = resolveShapePrimitives(spec, {
      widthMm: 90,
      depthMm: 80,
      heightMm: 130
    })

    expect(primitives[0]).toMatchObject({
      kind: 'lathe',
      centerXMm: 45,
      centerYMm: 40,
      // 直径按 min(宽, 深) 归一，杯子不会被压成椭圆
      radiusMm: 40,
      fromZMm: 0,
      toZMm: 130,
      spout: true,
      mouth: false
    })
  })

  it('repeats a grid part across rows and columns', () => {
    const spec = library([
      {
        id: 'tip_box',
        applies_to: [{ category: 'tip_box' }],
        parts: [
          {
            type: 'grid',
            style: 'hole',
            count: [3, 2],
            pitch: [18, 18],
            part: { type: 'disc', style: 'hole', center: [9, 9], z: 113, d: 8 }
          }
        ]
      }
    ])[0]!
    const primitives = resolveShapePrimitives(spec, {
      widthMm: 86,
      depthMm: 136,
      heightMm: 128
    })

    expect(primitives).toHaveLength(6)
    expect(
      primitives.map((part) =>
        part.kind === 'disc' ? [part.centerXMm, part.centerYMm] : null
      )
    ).toEqual([
      [9, 9],
      [27, 9],
      [45, 9],
      [9, 27],
      [27, 27],
      [45, 27]
    ])
  })

  it('lets an exact category beat a substring rule, and priority break substring ties', () => {
    const shapes = library([
      { id: 'bottle', applies_to: [{ category_contains: 'reagent' }], parts: [box()] },
      {
        id: 'powder_container',
        applies_to: [{ category_contains: 'powder_reagent' }],
        priority: 10,
        parts: [box()]
      },
      { id: 'vision_cell', applies_to: [{ category: 'vision_cell' }], parts: [box()] }
    ])

    expect(resolveShapeSpec(shapes, 'liquid_reagent')?.id).toBe('bottle')
    expect(resolveShapeSpec(shapes, 'powder_reagent')?.id).toBe(
      'powder_container'
    )
    expect(resolveShapeSpec(shapes, 'vision-cell')?.id).toBe('vision_cell')
    expect(resolveShapeSpec(shapes, 'device')).toBeUndefined()
  })

  it('groups rack sites per shelf board and sorts the rack on its rear edge', () => {
    const shapes = library([
      {
        id: 'beaker_stack',
        applies_to: [{ category: 'beaker_stack' }],
        sort: 'rear-edge',
        parts: [{ type: 'sites', style: 'board', generator: 'open-rack', board_thickness: 10 }]
      }
    ])
    const scene = buildMaterialObliqueScene(
      [
        aggregate('beaker-stack', [0, 190, 0], {
          kind: 'beaker_stack',
          dimensionsMm: [790, 560, 200],
          sites: [
            rackSite('L1A1', [52, 7, 80]),
            rackSite('L1B1', [52, 107, 80]),
            rackSite('L2A1', [52, 7, 320]),
            rackSite('L3A1', [52, 7, 560])
          ]
        })
      ],
      shapes
    )
    const rack = scene.objects[0]

    expect(rack?.renderStyle).toBe('spec')
    expect(rack?.shape?.primitives).toEqual([
      { kind: 'open-rack', boardThicknessMm: 10 }
    ])
    expect(rack?.levels.map((level) => level.zMm)).toEqual([80, 320, 560])
    expect(rack?.levels[0]?.sites).toHaveLength(2)
    expect(rack?.sortDepth).toBe(390)
  })

  it('keeps a single-level rack solid so its contents stay readable', () => {
    const scene = buildMaterialObliqueScene(
      [
        aggregate('vial-rack', [0, 0, 0], {
          kind: 'beaker_stack',
          dimensionsMm: [370, 250, 130],
          sites: [rackSite('A1', [20, 20, 60]), rackSite('A2', [120, 20, 60])]
        })
      ],
      library([
        {
          id: 'beaker_stack',
          applies_to: [{ category: 'beaker_stack' }],
          parts: [{ type: 'sites', style: 'board', generator: 'open-rack' }]
        }
      ])
    )

    expect(scene.objects[0]?.renderStyle).toBe('solid')
    expect(scene.objects[0]?.levels).toHaveLength(0)
  })

  it('draws empty declared racks without inventing durable Sites', () => {
    const scene = buildMaterialObliqueScene(
      [
        aggregate('empty-rack', [0, 0, 0], {
          kind: 'sample_vial_stack',
          dimensionsMm: [790, 560, 200],
          sites: []
        })
      ],
      library([
        {
          id: 'sample_vial_stack',
          applies_to: [{ category: 'sample_vial_stack' }],
          parts: [
            { type: 'sites', style: 'board', generator: 'open-rack' }
          ]
        }
      ])
    )

    expect(scene.objects[0]?.renderStyle).toBe('spec')
    expect(scene.objects[0]?.levels).toHaveLength(3)
    expect(scene.objects[0]?.levels.every((level) => level.sites.length === 0)).toBe(true)
  })

  it('reads stack shelves from authoritative sites when the generator asks for them', () => {
    const shapes = library([
      {
        id: 'stack',
        applies_to: [{ category: 'hotel' }],
        parts: [{ type: 'sites', style: 'board', generator: 'stack-shelves' }]
      }
    ])
    const scene = buildMaterialObliqueScene(
      [
        aggregate('hotel', [0, 0, 0], {
          kind: 'hotel',
          dimensionsMm: [200, 700, 660],
          sites: [
            stackSite('slot-1', 120, false),
            stackSite('slot-2', 240, true)
          ]
        })
      ],
      shapes
    )
    const shelves = scene.objects[0]?.shelves

    expect(shelves).toHaveLength(2)
    expect(shelves?.map((shelf) => shelf.heightMm)).toEqual([120, 240])
    expect(shelves?.map((shelf) => shelf.occupied)).toEqual([false, true])
    expect(shelves?.map((shelf) => shelf.label)).toEqual(['slot-1', 'slot-2'])
    expect(shelves?.map((shelf) => shelf.siteKey)).toEqual([
      'slot-1',
      'slot-2'
    ])
  })

  it('infers empty visual shelves for a site-less stack', () => {
    const scene = buildMaterialObliqueScene(
      [
        aggregate('hotel', [0, 0, 0], {
          kind: 'hotel',
          dimensionsMm: [200, 700, 660]
        })
      ],
      library([
        {
          id: 'stack',
          applies_to: [{ category: 'hotel' }],
          parts: [{ type: 'sites', style: 'board', generator: 'stack-shelves' }]
        }
      ])
    )
    const hotel = scene.objects[0]

    expect(hotel?.shelves).toHaveLength(11)
    expect(hotel?.shelves.every((shelf) => !shelf.occupied)).toBe(true)
    expect(hotel?.fidelity).toBe('inferred')
    expect(scene.diagnostics.inferredStructureCount).toBe(1)
  })

  it('hands tip-spot levels to the perforated plate generator', () => {
    const scene = buildMaterialObliqueScene(
      [
        aggregate('tip-box', [0, 0, 0], {
          kind: 'tip_box',
          dimensionsMm: [86, 136, 128],
          sites: [
            rackSite('T11-tip-101', [8.85, 14.05, 113]),
            rackSite('T11-tip-102', [26.85, 14.05, 113])
          ]
        })
      ],
      library([
        {
          id: 'tip_box',
          applies_to: [{ category: 'tip_box' }],
          parts: [
            {
              type: 'sites',
              style: 'hole',
              generator: 'site-holes',
              plate_top_z: 113,
              collar_top_z: 128
            }
          ]
        }
      ])
    )
    const box = scene.objects[0]

    expect(box?.renderStyle).toBe('spec')
    expect(box?.shape?.primitives).toEqual([
      { kind: 'site-holes', plateTopZMm: 113, collarTopZMm: 128 }
    ])
    expect(box?.levels).toHaveLength(1)
    expect(box?.levels[0]?.zMm).toBe(113)
    expect(box?.levels[0]?.sites).toHaveLength(2)
  })

  it('drops a whole declaration when one of its parts cannot be drawn', () => {
    const shapes = library([
      {
        id: 'broken',
        applies_to: [{ category: 'device' }],
        parts: [box(), { type: 'sites', style: 'board', generator: 'teleport' }]
      }
    ])

    expect(shapes).toHaveLength(0)
  })

  it('paints the deck first so it never veils equipment behind it', () => {
    const scene = buildMaterialObliqueScene([
      aggregate('mixer', [400, 1400, 0], {
        kind: 'device',
        dimensionsMm: [420, 850, 420]
      }),
      aggregate('deck', [0, 0, 0], {
        kind: 'deck',
        dimensionsMm: [3634, 80, 1674]
      }),
      aggregate('vial', [100, 100, 80], {
        kind: 'sample_vial',
        dimensionsMm: [86, 175, 86]
      })
    ])

    expect(scene.objects.map((object) => object.materialId)).toEqual([
      'deck',
      'mixer',
      'vial'
    ])
    expect(scene.objects.map((object) => object.sortLayer)).toEqual([0, 1, 1])
  })

  it('omits non-finite objects and reports them without breaking the scene', () => {
    const scene = buildMaterialObliqueScene([
      aggregate('valid', [0, 0, 0]),
      aggregate('invalid', [Number.NaN, 0, 0])
    ])

    expect(scene.objects.map((object) => object.materialId)).toEqual([
      'valid'
    ])
    expect(scene.diagnostics.invalidObjectCount).toBe(1)
  })
})

function box(): Record<string, unknown> {
  return { type: 'box', style: 'body', from: [0, 0, 0], to: [1, 1, 1] }
}

/** 走一遍真实链路的解析：入参与 `/api/v1/material-shapes` 的返回同构。 */
function library(
  shapes: readonly Record<string, unknown>[]
): MaterialShapeLibrary {
  return parseShapeLibrary(
    shapes.map((shape) => ({
      id: shape.id,
      bundle: 'test-bundle',
      categories: appliesTo(shape, 'category'),
      categoryTokens: appliesTo(shape, 'category_contains'),
      priority: shape.priority ?? 0,
      units: shape.units ?? 'mm',
      shadow: shape.shadow ?? 'box',
      sort: shape.sort ?? 'center',
      parts: shape.parts
    }))
  )
}

function appliesTo(
  shape: Record<string, unknown>,
  key: 'category' | 'category_contains'
): string[] {
  const rules = Array.isArray(shape.applies_to) ? shape.applies_to : []
  return rules
    .map((rule) => (rule as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === 'string')
}

function rackSite(
  key: string,
  positionMm: readonly [number, number, number]
): MaterialSite {
  return {
    ...stackSite(key, positionMm[2], false),
    poseInAnchor: {
      positionMm: [...positionMm] as [number, number, number],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [86, 86, 86],
    shape: 'circle'
  }
}

function aggregate(
  id: string,
  positionMm: readonly [number, number, number],
  options: {
    kind?: string
    dimensionsMm?: readonly [number, number, number]
    sites?: readonly MaterialSite[]
  } = {}
): MaterialAggregate {
  const kind = options.kind ?? 'plate'
  const dimensionsMm = options.dimensionsMm ?? [127.76, 14.4, 85.48]
  return {
    material: {
      id,
      sourceTemplateId: `template-${id}`,
      code: id,
      name: id,
      config: {
        rendering: {
          kind,
          dimensionsMm
        }
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    placement: {
      kind: 'world',
      pose: {
        positionMm,
        rotationDegXYZ: [0, 0, 0]
      }
    },
    sites: options.sites ?? [],
    revision: 1
  }
}

function stackSite(
  key: string,
  heightMm: number,
  occupied: boolean
): MaterialSite {
  return {
    id: `site-${key}`,
    ownerMaterialId: 'hotel',
    key,
    name: `Shelf ${key}`,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm: [0, 0, heightMm],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [120, 80, 10],
    capacity: 1,
    allowedTemplateIds: [],
    occupiedMaterialIds: occupied ? ['plate-1'] : [],
    kind: 'site',
    shape: 'rectangle',
    visible: true,
    visual: {
      state: occupied ? 'occupied' : 'empty',
      fillFraction: 0
    }
  }
}
