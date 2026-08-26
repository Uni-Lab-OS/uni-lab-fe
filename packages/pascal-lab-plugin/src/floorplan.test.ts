import type {
  FloorplanGeometry,
  GeometryContext
} from '@pascal-app/core'
import { describe, expect, it } from 'vitest'

import { buildLabFloorplan } from './floorplan'
import { LabDeviceNodeSchema } from './schema'

describe('buildLabFloorplan', () => {
  it('projects exact footprints and preserves equal well radii', () => {
    const geometry = buildLabFloorplan(
      device({
        kind: 'plate',
        footprintMm: [127.76, 85.48],
        worldPositionMm: [100, 200, 0],
        sites: [
          site('A1', [10, 12, 0]),
          site('A2', [19, 12, 0])
        ]
      }),
      context()
    )
    const polygons = collect(geometry, 'polygon')
    const circles = collect(geometry, 'circle')

    expect(polygons[0]?.points[0]).toEqual([0.1, -0.2])
    expect(polygons[0]?.points[1]?.[0]).toBeCloseTo(0.22776, 8)
    expect(circles).toHaveLength(2)
    expect(circles[0]?.r).toBeCloseTo(0.0041, 8)
    expect(circles[1]?.r).toBeCloseTo(circles[0]?.r ?? 0, 8)
  })

  it('keeps equipment tags visible and shows labware tags on hover', () => {
    const equipment = buildLabFloorplan(
      device({ kind: 'liquid-handler' }),
      context()
    )
    const plate = buildLabFloorplan(
      device({ kind: 'plate' }),
      context()
    )
    const hoveredPlate = buildLabFloorplan(
      device({ kind: 'plate' }),
      context({ hovered: true })
    )

    expect(collect(equipment, 'text')).toHaveLength(1)
    expect(collect(plate, 'text')).toHaveLength(0)
    expect(collect(hoveredPlate, 'text')).toHaveLength(1)
  })

  it('suppresses material tags even during interaction when the layer is hidden', () => {
    const hiddenEquipment = device({ kind: 'liquid-handler' })
    hiddenEquipment.showLabel = false

    const geometry = buildLabFloorplan(
      hiddenEquipment,
      context({ hovered: true, selected: true, highlighted: true })
    )

    expect(collect(geometry, 'text')).toHaveLength(0)
  })
})

function device(
  snapshot: Partial<{
    kind: string
    footprintMm: [number, number]
    worldPositionMm: [number, number, number]
    sites: ReturnType<typeof site>[]
  }>
) {
  return LabDeviceNodeSchema.parse({
    id: 'lab-device',
    type: 'lab-device',
    object: 'node',
    materialNodeId: 'material',
    displayName: 'Material',
    deviceType: snapshot.kind ?? 'custom',
    floorplanSnapshot: {
      kind: snapshot.kind ?? 'custom',
      worldPositionMm: snapshot.worldPositionMm ?? [0, 0, 0],
      worldRotationDegXYZ: [0, 0, 0],
      footprintMm: snapshot.footprintMm ?? [100, 80],
      sites: snapshot.sites ?? []
    }
  })
}

function site(
  key: string,
  positionMm: [number, number, number]
) {
  return {
    id: `site-${key}`,
    key,
    name: key,
    kind: 'well' as const,
    shape: 'circle' as const,
    positionMm,
    sizeMm: [8.2, 8.2, 10] as [
      number,
      number,
      number
    ],
    visible: true,
    visualState: 'empty' as const
  }
}

function context(
  view: Partial<
    NonNullable<GeometryContext['viewState']>
  > = {}
): GeometryContext {
  return {
    resolve: () => undefined,
    children: [],
    siblings: [],
    parent: null,
    viewState: {
      selected: false,
      highlighted: false,
      hovered: false,
      moving: false,
      unit: 'metric',
      palette: {} as NonNullable<
        GeometryContext['viewState']
      >['palette'],
      ...view
    }
  }
}

function collect<K extends FloorplanGeometry['kind']>(
  geometry: FloorplanGeometry | null,
  kind: K
): Extract<FloorplanGeometry, { kind: K }>[] {
  if (!geometry) return []
  if (geometry.kind === kind) {
    return [
      geometry as Extract<FloorplanGeometry, { kind: K }>
    ]
  }
  return geometry.kind === 'group'
    ? geometry.children.flatMap((child) => collect(child, kind))
    : []
}
