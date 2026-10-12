import type { MaterialDetail, MaterialGraph, MaterialListPage, SiteSummary } from './model'

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
   * 将物料放入目标库位，或解除其当前库位占用。
   * siteUuid 省略时执行下料；OS 使用 expectedRevision 做并发保护。
   */
  changeMaterialSite(
    materialUuid: string,
    expectedRevision: number,
    siteUuid?: string,
  ): Promise<MaterialDetail>
}
