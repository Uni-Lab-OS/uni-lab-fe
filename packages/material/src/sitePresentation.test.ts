import { describe, expect, it } from 'vitest'

import {
  isDecorativeDeckRail,
  shouldRenderSiteBounds
} from './sitePresentation'
import { materialAggregate } from './testFixtures'
import type { MaterialSite } from './types'

describe('site presentation', () => {
  it('treats declared Hamilton R1…Rn rails as background geometry', () => {
    const deck = materialAggregate('hamilton-deck', {
      config: {
        resourceConfig: {
          type: 'HamiltonSTARDeck',
          num_rails: 32
        }
      }
    })

    for (const rail of [1, 32]) {
      expect(
        isDecorativeDeckRail(
          deck,
          site(deck.material.id, `R${rail}`, `rail-${rail}`)
        )
      ).toBe(true)
    }
  })

  it('keeps declared deck slots interactive', () => {
    const deck = materialAggregate('deck', {
      config: {
        resourceConfig: {
          num_rails: 32
        }
      }
    })

    for (const key of ['T1', 'R33']) {
      expect(
        isDecorativeDeckRail(
          deck,
          site(deck.material.id, key, `slot-${key}`)
        )
      ).toBe(false)
    }
  })

  it('keeps tip spots as inventory sites without presenting generic site bounds', () => {
    const tipBox = materialAggregate('tip-box')
    const tipSpot = site(tipBox.material.id, 'A1', 'tip-a1')
    tipSpot.kind = 'tip-spot'

    expect(shouldRenderSiteBounds(tipBox, tipSpot)).toBe(false)

    const carrierSite = site(tipBox.material.id, 'slot-1', 'slot-1')
    carrierSite.kind = 'site'
    expect(shouldRenderSiteBounds(tipBox, carrierSite)).toBe(true)
  })
})

function site(
  ownerMaterialId: string,
  key: string,
  id: string
): MaterialSite {
  return {
    id,
    ownerMaterialId,
    key,
    name: key,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm: [0, 0, 0],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [22.5, 478, 0],
    capacity: 1,
    allowedTemplateIds: [],
    occupiedMaterialIds: [],
    kind: 'deck-slot',
    shape: 'rectangle',
    visible: true
  }
}
