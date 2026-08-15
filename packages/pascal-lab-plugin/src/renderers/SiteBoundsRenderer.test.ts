import { describe, expect, it } from 'vitest'

import { LabFloorplanSiteSchema } from '../schema'
import {
  createSiteOutlineGeometry,
  selectRenderableSiteBounds,
  siteBoundsGeometry,
  siteBoundsTransform
} from './SiteBoundsRenderer'

describe('SiteBoundsRenderer', () => {
  it('centers a Site-sized box in Pascal Y-up metres', () => {
    const site = LabFloorplanSiteSchema.parse({
      id: 'site-a',
      key: 'A1',
      name: 'A1',
      positionMm: [100, 200, 300],
      sizeMm: [40, 50, 60],
      visible: true,
      occupied: false,
      visualState: 'empty'
    })

    const transform = siteBoundsTransform(site)
    expect(transform.position[0]).toBeCloseTo(0.12)
    expect(transform.position[1]).toBeCloseTo(0.33)
    expect(transform.position[2]).toBeCloseTo(-0.225)
    expect(transform.scale).toEqual([0.04, 0.06, 0.05])
  })

  it('rotates the lower-corner offset and preserves Site yaw in 3D', () => {
    const site = LabFloorplanSiteSchema.parse({
      id: 'site-rotated',
      key: 'rotated',
      name: 'rotated',
      positionMm: [100, 200, 300],
      rotationDegXYZ: [0, 0, 90],
      sizeMm: [40, 50, 60],
      visible: true,
      occupied: false,
      visualState: 'empty'
    })

    const transform = siteBoundsTransform(site)
    expect(transform.position[0]).toBeCloseTo(0.075)
    expect(transform.position[1]).toBeCloseTo(0.33)
    expect(transform.position[2]).toBeCloseTo(-0.22)
    expect(transform.rotation[0]).toBeCloseTo(0)
    expect(transform.rotation[1]).toBeCloseTo(Math.PI / 2)
    expect(transform.rotation[2]).toBeCloseTo(0)
  })

  it('uses a box for rectangle Sites and a cylinder for circle Sites', () => {
    const rectangle = LabFloorplanSiteSchema.parse({
      id: 'site-rectangle',
      key: 'rectangle',
      name: 'rectangle',
      shape: 'rectangle',
      positionMm: [100, 200, 300],
      sizeMm: [40, 50, 60],
      occupied: false
    })
    const circle = LabFloorplanSiteSchema.parse({
      ...rectangle,
      id: 'site-circle',
      key: 'circle',
      name: 'circle',
      shape: 'circle'
    })

    expect(siteBoundsGeometry(rectangle)).toMatchObject({
      kind: 'box',
      size: [0.04, 0.06, 0.05]
    })
    expect(siteBoundsGeometry(circle)).toMatchObject({
      kind: 'cylinder',
      radius: 0.02,
      height: 0.06
    })
  })

  it('builds native finite-count outlines that cannot poison WebGPU draws', () => {
    const site = LabFloorplanSiteSchema.parse({
      id: 'site-outline',
      key: 'outline',
      name: 'outline',
      shape: 'rectangle',
      positionMm: [0, 0, 0],
      sizeMm: [40, 50, 60],
      occupied: false
    })

    const outline = createSiteOutlineGeometry(siteBoundsGeometry(site))
    expect('isInstancedBufferGeometry' in outline).toBe(false)
    expect(outline.index?.count ?? outline.attributes.position?.count).toBe(
      24
    )
    outline.dispose()
  })

  it('shows all empty Sites when enabled and only the hovered one when disabled', () => {
    const emptyRectangle = LabFloorplanSiteSchema.parse({
      id: 'site-empty-rectangle',
      key: 'empty-rectangle',
      name: 'empty rectangle',
      shape: 'rectangle',
      positionMm: [0, 0, 0],
      sizeMm: [40, 50, 60],
      occupied: false
    })
    const emptyCircle = LabFloorplanSiteSchema.parse({
      ...emptyRectangle,
      id: 'site-empty-circle',
      key: 'empty-circle',
      name: 'empty circle',
      shape: 'circle'
    })
    const occupied = LabFloorplanSiteSchema.parse({
      ...emptyRectangle,
      id: 'site-occupied',
      key: 'occupied',
      name: 'occupied',
      occupied: true,
      visualState: 'occupied'
    })
    const sites = [emptyRectangle, emptyCircle, occupied]

    expect(
      selectRenderableSiteBounds(sites, true, null).map((site) => site.id)
    ).toEqual(['site-empty-rectangle', 'site-empty-circle'])
    expect(selectRenderableSiteBounds(sites, false, null)).toEqual([])
    expect(
      selectRenderableSiteBounds(sites, false, 'site-empty-circle').map(
        (site) => site.id
      )
    ).toEqual(['site-empty-circle'])
    expect(
      selectRenderableSiteBounds(sites, false, 'site-occupied')
    ).toEqual([])
  })
})
