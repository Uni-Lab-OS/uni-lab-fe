import { describe, expect, it } from 'vitest'

import { inspectMaterialSceneReadiness } from './materialSceneReadiness'
import { materialAggregate } from './testFixtures'

describe('material scene readiness', () => {
  /** 证明空物料图与缺失空间合同的非空图不会被混为同一种状态。 */
  it('distinguishes an empty graph from a list-only graph', () => {
    expect(inspectMaterialSceneReadiness([])).toEqual({
      state: 'empty',
      materialCount: 0,
      positionedMaterialCount: 0,
      siteCount: 0
    })

    expect(inspectMaterialSceneReadiness([
      materialAggregate('reagent-a', { placement: { kind: 'unplaced' } }),
      materialAggregate('reagent-b', { placement: { kind: 'unplaced' } })
    ])).toEqual({
      state: 'list-only',
      materialCount: 2,
      positionedMaterialCount: 0,
      siteCount: 0
    })
  })

  /** 证明任一权威放置关系可让共享视图进入空间渲染状态。 */
  it('accepts a graph carrying an authoritative spatial placement', () => {
    const readiness = inspectMaterialSceneReadiness([
      materialAggregate('deck'),
      materialAggregate('unplaced', { placement: { kind: 'unplaced' } })
    ])

    expect(readiness).toMatchObject({
      state: 'spatial',
      materialCount: 2,
      positionedMaterialCount: 1
    })
  })
})
