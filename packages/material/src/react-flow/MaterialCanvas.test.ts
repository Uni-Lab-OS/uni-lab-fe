import { describe, expect, it } from 'vitest'

import { materialAggregate } from '../testFixtures'
import {
  canStartMaterialHandlingDrag,
  isOperatorHandledMaterial,
  selectMaterialSiteDropTarget
} from './MaterialCanvas'

describe('2D material handling target selection', () => {
  it('blocks a second drag while an attach or detach command is pending', () => {
    expect(canStartMaterialHandlingDrag(true, false)).toBe(true)
    expect(canStartMaterialHandlingDrag(true, true)).toBe(false)
    expect(canStartMaterialHandlingDrag(false, false)).toBe(false)
  })

  it('selects a nearby available site and prefers the nearest center', () => {
    const selected = selectMaterialSiteDropTarget(
      { x: 12, y: 12 },
      [
        {
          parentId: 'parent-wide',
          siteId: 'site-wide',
          rect: { left: 0, right: 40, top: 0, bottom: 40 }
        },
        {
          parentId: 'parent-near',
          siteId: 'site-near',
          rect: { left: 10, right: 20, top: 10, bottom: 20 }
        }
      ]
    )

    expect(selected).toMatchObject({
      parentId: 'parent-near',
      siteId: 'site-near'
    })
    expect(selectMaterialSiteDropTarget({ x: 50, y: 50 }, [
      {
        parentId: 'parent',
        siteId: 'site',
        rect: { left: 0, right: 20, top: 0, bottom: 20 }
      }
    ])).toBeNull()
  })

  it('tolerates a small pointer miss around a zoomed site', () => {
    const target = {
      parentId: 'parent',
      siteId: 'site',
      rect: { left: 10, right: 20, top: 10, bottom: 20 }
    }

    expect(selectMaterialSiteDropTarget({ x: 27, y: 15 }, [target]))
      .toMatchObject({ siteId: 'site' })
    expect(selectMaterialSiteDropTarget({ x: 27, y: 15 }, [target], 0))
      .toBeNull()
  })

  it('allows placed labware to transfer but keeps storage stacks fixed', () => {
    const placedBeaker = materialAggregate('beaker', {
      placement: {
        kind: 'site',
        parentId: 'source-stack',
        siteId: 'source-site',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      config: { rendering: { kind: 'beaker' } }
    })
    const stack = materialAggregate('beaker-stack', {
      config: { rendering: { kind: 'beaker_stack' } }
    })

    expect(isOperatorHandledMaterial(placedBeaker)).toBe(true)
    expect(isOperatorHandledMaterial(stack)).toBe(false)
  })
})
