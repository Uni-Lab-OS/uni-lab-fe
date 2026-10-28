import type { MaterialDetail, MaterialGraph, MaterialListPage, SiteSummary } from './model'

/**
 * 人工上下料：place 把物料放入（或从原库位换到）目标库位，remove 解除物料当前库位占用。
 * expectedRevision 是读到的物料修订版本；只改库存记录，不驱动任何设备。
 */
export interface MaterialSitePlacementInput {
  readonly materialUuid: string
  readonly placement:
    | { readonly action: 'place'; readonly siteUuid: string }
    | { readonly action: 'remove' }
  readonly expectedRevision: number | null
}

export interface MaterialSitePort {
  listMaterials(input?: {
    readonly page?: number
    readonly pageSize?: number
    readonly name?: string
    readonly barcode?: string
    readonly resourceTemplateUuid?: string
  }): Promise<MaterialListPage>

  getGraph(): Promise<MaterialGraph>

  getMaterial(materialUuid: string): Promise<MaterialDetail>

  listSites(materialUuid: string): Promise<readonly SiteSummary[]>

  getSite(siteUuid: string): Promise<SiteSummary>

  /**
   * OS PUT /materials/{uuid} 的 site_placement；修订已变化、物料或库位被运行中任务占用、目标库位已被占用时
   * OS 拒绝。没有幂等键：调用方失败或超时后不得自动重发，应重读物料图确认结果。
   */
  updateSitePlacement(input: MaterialSitePlacementInput): Promise<MaterialDetail>
}
