import type {
  MaterialDetail,
  MaterialGraph,
  MaterialListPage,
  SiteSummary
} from './model'

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
}
