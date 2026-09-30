import { describe, expect, it } from 'vitest'
import { resolveMaterialSiteAction } from './materialSiteActions'

describe('resolveMaterialSiteAction', () => {
  it('为已占用库位提供下料方向', () => {
    expect(resolveMaterialSiteAction({ known: true, occupiedMaterialUuid: 'material-1' })).toBe(
      'unload',
    )
  })

  it('为已知空库位提供上料方向', () => {
    expect(resolveMaterialSiteAction({ known: true, occupiedMaterialUuid: null })).toBe('load')
  })

  it('占用未知时不提供上下料方向', () => {
    expect(resolveMaterialSiteAction({ known: false, occupiedMaterialUuid: null })).toBe(
      'unavailable',
    )
  })
})
