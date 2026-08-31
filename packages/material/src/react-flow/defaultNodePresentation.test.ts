import { describe, expect, it } from 'vitest'

import { materialAggregate } from '../testFixtures'
import {
  readDefaultMaterialNodePresentation,
  shouldRenderDefaultEquipmentCard
} from './defaultNodePresentation'

describe('default material node presentation', () => {
  it('uses explicit control-node metadata before identifiers', () => {
    const aggregate = materialAggregate('main-computer', {
      config: {
        presentation: { category: 'control-node' },
        resourceConfig: { type: 'device' }
      }
    })

    expect(readDefaultMaterialNodePresentation(aggregate)).toEqual({
      kind: 'control',
      noun: '控制节点'
    })
  })

  it('recognises equipment from graph metadata', () => {
    const aggregate = materialAggregate('liquid-handler', {
      config: {
        source: { nodeType: 'device' }
      }
    })

    expect(readDefaultMaterialNodePresentation(aggregate)).toEqual({
      kind: 'equipment',
      noun: '仪器设备'
    })
  })

  it('treats storage stacks as equipment rather than draggable labware', () => {
    const aggregate = materialAggregate('unused-beaker-stack', {
      config: {
        rendering: { kind: 'beaker_stack' }
      }
    })

    expect(readDefaultMaterialNodePresentation(aggregate)).toEqual({
      kind: 'equipment',
      noun: '仪器设备'
    })
  })

  it('falls back safely for an unknown non-physical material', () => {
    const aggregate = materialAggregate('custom-resource')

    expect(readDefaultMaterialNodePresentation(aggregate)).toEqual({
      kind: 'material',
      noun: '物料节点'
    })
  })

  it.each([
    ['arm_slider', 'robotic-arm'],
    ['hotel', 'hotel']
  ])(
    'uses the semantic equipment card for a physical %s without a dedicated renderer',
    (id, kind) => {
      const aggregate = materialAggregate(id, {
        config: {
          source: { nodeType: 'device' },
          rendering: {
            kind,
            dimensionsMm: [200, 700, 660]
          }
        }
      })

      expect(
        shouldRenderDefaultEquipmentCard(aggregate, {
          kind,
          physical: true
        })
      ).toBe(true)
    }
  )

  it('keeps a dedicated liquid-handler renderer', () => {
    const aggregate = materialAggregate('liquid-handler', {
      config: {
        source: { nodeType: 'device' }
      }
    })

    expect(
      shouldRenderDefaultEquipmentCard(aggregate, {
        kind: 'liquid-handler',
        physical: true
      })
    ).toBe(false)
  })
})
