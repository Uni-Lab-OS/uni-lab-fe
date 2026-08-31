import { describe, expect, it } from 'vitest'

import { materialAggregate } from '../testFixtures'
import type { MaterialAggregate } from '../types'
import {
  flowPositionToPlacement,
  MATERIAL_FLOW_SCALE,
  projectMaterialFlowNodes,
  resolveMaterialWorldPose
} from './projection'
import { MATERIAL_PHYSICAL_SCALE } from './visual'

describe('Material React Flow projection', () => {
  it('keeps entity data in the Store and projects only the Material ID', () => {
    const aggregate = materialAggregate('material-1', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [120, 40, 10],
          rotationDegXYZ: [0, 0, 30]
        }
      }
    })

    const [node] = projectMaterialFlowNodes({
      aggregatesById: { 'material-1': aggregate }
    })

    expect(node.data).toEqual({ materialId: 'material-1' })
    expect(Object.keys(node.data)).toEqual(['materialId'])
    expect(node.position).toEqual({
      x: 120 * MATERIAL_FLOW_SCALE,
      y: -40 * MATERIAL_FLOW_SCALE
    })
  })

  it('projects selection exclusively from the controlled material IDs', () => {
    const first = materialAggregate('first')
    const second = materialAggregate('second')

    const nodes = projectMaterialFlowNodes({
      aggregatesById: { first, second },
      selectedMaterialIds: ['second']
    })

    expect(nodes.map(({ id, selected }) => ({ id, selected }))).toEqual([
      { id: 'first', selected: false },
      { id: 'second', selected: true }
    ])
  })

  it('projects a rotated parent without asking React Flow to inherit rotation', () => {
    const parent = materialAggregate('parent', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [200, 100, 0],
          rotationDegXYZ: [0, 0, 90]
        }
      }
    })
    const child = materialAggregate('child', {
      placement: {
        kind: 'parent',
        parentId: 'parent',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [100, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    const nodes = projectMaterialFlowNodes({
      aggregatesById: { child, parent }
    })

    expect(nodes.map((node) => node.id)).toEqual(['parent', 'child'])
    expect(nodes[1]).toMatchObject({
      id: 'child',
      parentId: 'parent',
      position: { x: 0, y: -100 * MATERIAL_FLOW_SCALE }
    })
    expect(resolveMaterialWorldPose('child', { child, parent }).positionMm)
      .toEqual([200, 200, 0])
  })

  it('converts a dragged screen position back to the parent local frame', () => {
    const parent = materialAggregate('parent', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [200, 100, 0],
          rotationDegXYZ: [0, 0, 90]
        }
      }
    })
    const child = materialAggregate('child', {
      placement: {
        kind: 'parent',
        parentId: 'parent',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [100, 0, 0],
          rotationDegXYZ: [0, 0, 15]
        }
      }
    })

    const placement = flowPositionToPlacement({
      materialId: 'child',
      flowPosition: { x: 100 * MATERIAL_FLOW_SCALE, y: 0 },
      aggregatesById: { child, parent }
    })

    expect(placement.kind).toBe('parent')
    if (placement.kind !== 'parent') return
    expectTupleCloseTo(placement.localPose.positionMm, [0, -100, 0])
    expect(placement.localPose.rotationDegXYZ).toEqual([0, 0, 15])
  })

  it('composes a Site pose and child offset, including Site rotation', () => {
    const parent = materialAggregate('parent', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [10, 20, 30],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      sites: [
        {
          id: 'site-1',
          ownerMaterialId: 'parent',
          key: 'gripper',
          name: 'Gripper',
          anchor: { kind: 'root' },
          poseInAnchor: {
            positionMm: [100, 0, 0],
            rotationDegXYZ: [0, 0, 90]
          },
          sizeMm: [20, 20, 20],
          capacity: 1,
          allowedTemplateIds: [],
          occupiedMaterialIds: ['child']
        }
      ]
    })
    const child = materialAggregate('child', {
      placement: {
        kind: 'site',
        parentId: 'parent',
        siteId: 'site-1',
        offsetPose: {
          positionMm: [10, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    const pose = resolveMaterialWorldPose('child', { child, parent })
    const childNode = projectMaterialFlowNodes({
      aggregatesById: { child, parent }
    }).find((node) => node.id === 'child')

    expectTupleCloseTo(pose.positionMm, [110, 30, 30])
    expect(childNode).toMatchObject({
      parentId: 'parent',
      position: {
        x: 100 * MATERIAL_FLOW_SCALE,
        y: -10 * MATERIAL_FLOW_SCALE
      }
    })
  })

  it('places physical labware at its exact deck Site coordinates', () => {
    const parent = materialAggregate('deck', {
      config: {
        rendering: {
          kind: 'deck',
          footprintMm: [542, 374]
        }
      },
      sites: [
        {
          id: 'site-t16',
          ownerMaterialId: 'deck',
          key: 'T16',
          name: 'T16',
          anchor: { kind: 'root' },
          poseInAnchor: {
            positionMm: [414, 288, 0],
            rotationDegXYZ: [0, 0, 0]
          },
          sizeMm: [128, 86, 0],
          capacity: 1,
          allowedTemplateIds: [],
          occupiedMaterialIds: ['plate']
        }
      ]
    })
    const child = materialAggregate('plate', {
      config: {
        rendering: {
          kind: 'plate',
          footprintMm: [128, 86]
        }
      },
      placement: {
        kind: 'site',
        parentId: 'deck',
        siteId: 'site-t16',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    const childNode = projectMaterialFlowNodes({
      aggregatesById: { deck: parent, plate: child },
      physicalLayout: true
    }).find((node) => node.id === 'plate')

    expect(childNode?.position).toEqual({
      x: 414 * 0.7,
      y: 0
    })
  })

  it('round-trips a world position in the physical 2D layout', () => {
    const aggregate = materialAggregate('material-1', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [120, 40, 10],
          rotationDegXYZ: [0, 0, 15]
        }
      }
    })

    const [node] = projectMaterialFlowNodes({
      aggregatesById: { 'material-1': aggregate },
      physicalLayout: true
    })
    const placement = flowPositionToPlacement({
      materialId: 'material-1',
      flowPosition: node.position,
      aggregatesById: { 'material-1': aggregate },
      physicalLayout: true
    })

    expect(node.position).toEqual({
      x: 120 * MATERIAL_PHYSICAL_SCALE,
      y: -40 * MATERIAL_PHYSICAL_SCALE
    })
    expect(placement.kind).toBe('world')
    if (placement.kind !== 'world') return
    expectTupleCloseTo(placement.pose.positionMm, [120, 40, 10])
    expect(placement.pose.rotationDegXYZ).toEqual([0, 0, 15])
  })

  it('round-trips a parent-local position in the physical 2D layout', () => {
    const deck = materialAggregate('deck', {
      config: {
        rendering: { kind: 'deck', footprintMm: [542, 374] }
      }
    })
    const child = materialAggregate('child', {
      config: {
        rendering: { kind: 'plate', footprintMm: [128, 86] }
      },
      placement: {
        kind: 'parent',
        parentId: 'deck',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [100, 50, 5],
          rotationDegXYZ: [0, 0, 20]
        }
      }
    })
    const aggregates = { deck, child }

    const childNode = projectMaterialFlowNodes({
      aggregatesById: aggregates,
      physicalLayout: true
    }).find((node) => node.id === 'child')
    if (!childNode) throw new Error('child node missing')
    const placement = flowPositionToPlacement({
      materialId: 'child',
      flowPosition: childNode.position,
      aggregatesById: aggregates,
      physicalLayout: true
    })

    expect(placement).toEqual(child.placement)
  })

  it('uses physical drag previews without snapping back to the old pose', () => {
    const deck = materialAggregate('deck', {
      config: {
        rendering: { kind: 'deck', footprintMm: [542, 374] }
      }
    })
    const child = materialAggregate('child', {
      config: {
        rendering: { kind: 'plate', footprintMm: [128, 86] }
      },
      placement: {
        kind: 'parent',
        parentId: 'deck',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [0, 0, 5],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    const childNode = projectMaterialFlowNodes({
      aggregatesById: { deck, child },
      dragPreviewByMaterialId: {
        child: {
          positionMm: [100, 50, 5],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      physicalLayout: true
    }).find((node) => node.id === 'child')

    expect(childNode?.position).toEqual({
      x: 100 * MATERIAL_PHYSICAL_SCALE,
      y: (374 - 50 - 86) * MATERIAL_PHYSICAL_SCALE
    })
  })

  it('stages unplaced materials beside the physical scene until dragged', () => {
    const deck = materialAggregate('deck', {
      config: {
        rendering: { kind: 'deck', footprintMm: [542, 374] }
      }
    })
    const loose = materialAggregate('loose', {
      placement: { kind: 'unplaced' }
    })

    const staged = projectMaterialFlowNodes({
      aggregatesById: { deck, loose },
      physicalLayout: true
    }).find((node) => node.id === 'loose')
    expect(staged?.position.x).toBeGreaterThan(
      542 * MATERIAL_PHYSICAL_SCALE
    )

    const dragged = projectMaterialFlowNodes({
      aggregatesById: { deck, loose },
      dragPreviewByMaterialId: {
        loose: {
          positionMm: [900, -20, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      physicalLayout: true
    }).find((node) => node.id === 'loose')
    expect(dragged?.position).toEqual({
      x: 900 * MATERIAL_PHYSICAL_SCALE,
      y: 20 * MATERIAL_PHYSICAL_SCALE
    })
  })

  it('uses a drag preview without mutating or copying an aggregate', () => {
    const aggregate = materialAggregate('material-1')
    const aggregates: Record<string, MaterialAggregate> = {
      'material-1': aggregate
    }

    const [node] = projectMaterialFlowNodes({
      aggregatesById: aggregates,
      dragPreviewByMaterialId: {
        'material-1': {
          positionMm: [80, 20, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    expect(node.position).toEqual({
      x: 80 * MATERIAL_FLOW_SCALE,
      y: -20 * MATERIAL_FLOW_SCALE
    })
    expect(aggregate.placement).toEqual({
      kind: 'world',
      pose: {
        positionMm: [0, 0, 0],
        rotationDegXYZ: [0, 0, 0]
      }
    })
  })

  it('uses a collision-free world layout for a read-only review', () => {
    const parent = materialAggregate('parent')
    const child = materialAggregate('child', {
      placement: {
        kind: 'parent',
        parentId: 'parent',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    const nodes = projectMaterialFlowNodes({
      aggregatesById: { child, parent },
      reviewLayout: true
    })

    expect(nodes.every((node) => node.parentId === undefined)).toBe(true)
    expect(nodes[0].position).not.toEqual(nodes[1].position)
  })
})

function expectTupleCloseTo(
  actual: readonly number[],
  expected: readonly number[]
): void {
  expect(actual).toHaveLength(expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], 8)
  }
}
