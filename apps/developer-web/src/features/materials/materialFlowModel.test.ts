import { describe, expect, it, vi } from 'vitest'
import { comparePosition, compactName, gridShape, isMaterialGraphNodeHidden, isMaterialSiteSelected } from './materialFlowModel'
import type { MaterialGraphNode } from '@unilab-fe/core'

const node = (name: string, position: [number, number] | null = [0, 0], config: Record<string, unknown> = {}, materialType: string | null = 'plate', className: string | null = null): MaterialGraphNode => ({
  material: { kind: 'material_summary', source: 'os', materialUuid: name, resourceTemplateUuid: 'tpl', materialType, className, parentMaterialUuid: null, barcode: null, name, description: null, revision: null, config, metadata: {}, createdAt: null, updatedAt: null, raw: {} },
  resourceTemplate: null, relativePosition: position ? { positionMm: [position[0], position[1], 0], sizeMm: null, scale: null, rotationDegXYZ: null, raw: {} } : null, sites: [], currentSiteUuid: null, raw: {},
})

describe('material flow model', () => {
  it('identifies logical and host nodes', () => {
    expect(isMaterialGraphNodeHidden(node('virtual', null, { virtual: true }))).toBe(true)
    expect(isMaterialGraphNodeHidden(node('logical', null, { logical_mount: true }))).toBe(true)
    expect(isMaterialGraphNodeHidden(node('logical2', null, { logicalMount: true }))).toBe(true)
    expect(isMaterialGraphNodeHidden(node('deck', null, {}, 'deck'))).toBe(true)
    expect(isMaterialGraphNodeHidden(node('host', null, {}, 'plate', 'host_node'))).toBe(true)
    expect(isMaterialGraphNodeHidden(node('visible'))).toBe(false)
  })

  it('compares positions with deterministic name fallback and computes site grids', () => {
    expect(comparePosition(node('b', [0, 0]), node('a', [0, 0]))).toBeGreaterThan(0)
    expect(comparePosition(node('top', [0, 0]), node('bottom', [0, 1]))).toBeGreaterThan(0)
    expect(comparePosition(node('left', [0, 0]), node('right', [1, 0]))).toBeLessThan(0)
    expect(gridShape([{ geometry: { positionMm: [0, 0, 0] } }, { geometry: { positionMm: [1, 0, 0] } }, { geometry: { positionMm: [0, 1, 0] } }] as never)).toEqual({ columns: 2 })
    expect(gridShape([])).toEqual({ columns: 1 })
    expect(gridShape([{ geometry: null }, { geometry: null }, { geometry: null }, { geometry: null }, { geometry: null }, { geometry: null }, { geometry: null }, { geometry: null }, { geometry: null }] as never)).toEqual({ columns: 3 })
    expect(compactName('short')).toBe('short')
    expect(compactName('1234567890')).toBe('12345678…')
  })

  it('matches site selection by either site or occupant identity', () => {
    expect(isMaterialSiteSelected('site', 'material', 'material', undefined)).toBe(true)
    expect(isMaterialSiteSelected('site', undefined, 'material', undefined)).toBe(false)
    expect(isMaterialSiteSelected('site', undefined, undefined, 'site')).toBe(true)
  })
})
