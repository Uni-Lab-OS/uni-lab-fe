import { describe, expect, it } from 'vitest'

import {
  assertCanAttach,
  assertValidMaterialGraph,
  buildMaterialGraphIndex,
  MaterialRuleError,
  readMaterialAttachTargetState
} from './rules'
import { materialAggregate } from './testFixtures'

describe('material graph rules', () => {
  it('builds derived child and Site indexes', () => {
    const parent = materialAggregate('parent', {
      sites: [
        {
          id: 'site-1',
          ownerMaterialId: 'parent',
          key: 'deck',
          name: 'Deck',
          anchor: { kind: 'root' },
          poseInAnchor: {
            positionMm: [0, 0, 0],
            rotationDegXYZ: [0, 0, 0]
          },
          sizeMm: [100, 100, 10],
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
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    expect(
      buildMaterialGraphIndex({ parent, child })
    ).toEqual({
      childrenByParentId: { parent: ['child'] },
      siteOwnerById: { 'site-1': 'parent' }
    })
  })

  it('rejects parent cycles', () => {
    const first = materialAggregate('first', {
      placement: {
        kind: 'parent',
        parentId: 'second',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const second = materialAggregate('second', {
      placement: {
        kind: 'parent',
        parentId: 'first',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    expect(() =>
      assertValidMaterialGraph({ first, second })
    ).toThrow(MaterialRuleError)
  })

  it('enforces Site capacity and template allowlists', () => {
    const parent = materialAggregate('parent', {
      sites: [
        {
          id: 'site-1',
          ownerMaterialId: 'parent',
          key: 'deck',
          name: 'Deck',
          anchor: { kind: 'root' },
          poseInAnchor: {
            positionMm: [0, 0, 0],
            rotationDegXYZ: [0, 0, 0]
          },
          sizeMm: [100, 100, 10],
          capacity: 1,
          allowedTemplateIds: ['allowed-template'],
          occupiedMaterialIds: []
        }
      ]
    })
    const child = materialAggregate('child', {
      templateId: 'other-template'
    })

    expect(() =>
      assertCanAttach(parent, child, 'site-1')
    ).toThrowError(
      expect.objectContaining({ code: 'MATERIAL_TEMPLATE_NOT_ALLOWED' })
    )
  })

  it('shares attach target states with command validation', () => {
    const child = materialAggregate('child')
    const descendant = materialAggregate('descendant', {
      placement: {
        kind: 'parent',
        parentId: 'child',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      sites: [{
        id: 'descendant-site',
        ownerMaterialId: 'descendant',
        key: 'deck',
        name: 'Deck',
        anchor: { kind: 'root' },
        poseInAnchor: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        },
        sizeMm: [100, 100, 10],
        capacity: 1,
        allowedTemplateIds: [],
        occupiedMaterialIds: []
      }]
    })
    const graph = { child, descendant }
    const site = descendant.sites[0]

    expect(readMaterialAttachTargetState(
      descendant,
      child,
      site
    )).toBe('available')
    expect(readMaterialAttachTargetState(
      descendant,
      child,
      { ...site, occupiedMaterialIds: ['occupant'] }
    )).toBe('occupied')
    expect(readMaterialAttachTargetState(
      descendant,
      child,
      { ...site, allowedTemplateIds: ['other-template'] }
    )).toBe('incompatible')
    expect(readMaterialAttachTargetState(
      descendant,
      child,
      site,
      graph
    )).toBe('cycle')
    expect(() => assertCanAttach(
      descendant,
      child,
      'descendant-site',
      graph
    )).toThrowError(
      expect.objectContaining({ code: 'MATERIAL_PARENT_CYCLE' })
    )
  })

  it('requires managed wells to be unique parent children', () => {
    const plate = materialAggregate('plate')
    const first = materialAggregate('well-a1-first', {
      component: {
        kind: 'well',
        key: 'a1',
        managedByParent: true
      },
      placement: {
        kind: 'parent',
        parentId: 'plate',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })
    const second = materialAggregate('well-a1-second', {
      component: {
        kind: 'well',
        key: 'A1',
        managedByParent: true
      },
      placement: {
        kind: 'parent',
        parentId: 'plate',
        anchor: { kind: 'root' },
        localPose: {
          positionMm: [9, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    expect(() =>
      assertValidMaterialGraph({ plate, first, second })
    ).toThrowError(
      expect.objectContaining({
        code: 'MATERIAL_COMPONENT_KEY_DUPLICATE'
      })
    )
  })

  it('does not allow managed wells to masquerade as Sites', () => {
    const plate = materialAggregate('plate')
    const well = materialAggregate('well-a1', {
      component: {
        kind: 'well',
        key: 'A1',
        managedByParent: true
      },
      placement: {
        kind: 'site',
        parentId: 'plate',
        siteId: 'fake-well-site',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    expect(() =>
      assertValidMaterialGraph({ plate, well })
    ).toThrowError(
      expect.objectContaining({
        code: 'MATERIAL_COMPONENT_PARENT_REQUIRED'
      })
    )
  })
})
