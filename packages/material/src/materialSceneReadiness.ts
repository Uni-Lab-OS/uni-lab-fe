import type { MaterialAggregate } from './types'

export type MaterialSceneReadinessState = 'empty' | 'list-only' | 'spatial'

export interface MaterialSceneReadiness {
  state: MaterialSceneReadinessState
  materialCount: number
  positionedMaterialCount: number
  siteCount: number
}

/**
 * 根据规范物料聚合判断当前图能否形成可信空间场景。
 * @param aggregates 当前服务返回并完成解码的物料聚合。
 * @returns 空图、仅列表或可空间渲染状态及其可核对计数。
 */
export function inspectMaterialSceneReadiness(
  aggregates: readonly MaterialAggregate[]
): MaterialSceneReadiness {
  const positionedMaterialCount = aggregates.filter(
    (aggregate) => aggregate.placement.kind !== 'unplaced'
  ).length
  const siteCount = aggregates.reduce(
    (count, aggregate) => count + aggregate.sites.length,
    0
  )
  return {
    state: aggregates.length === 0
      ? 'empty'
      : positionedMaterialCount === 0
        ? 'list-only'
        : 'spatial',
    materialCount: aggregates.length,
    positionedMaterialCount,
    siteCount
  }
}
