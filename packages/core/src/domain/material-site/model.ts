export type Vector3 = readonly [number, number, number]

export interface MaterialResourceTemplateSummary {
  readonly uuid: string
  readonly name: string
  readonly displayName: string
  readonly resourceType: string
  readonly icon?: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface MaterialRelativePosition {
  readonly positionMm: Vector3
  readonly sizeMm: Vector3 | null
  readonly scale: Vector3 | null
  readonly rotationDegXYZ: Vector3 | null
  readonly raw: Readonly<Record<string, unknown>>
}

interface MaterialIdentity {
  readonly source: 'os' | 'fixture'
  readonly materialUuid: string
  readonly resourceTemplateUuid: string
  readonly materialType: string | null
  readonly className: string | null
  readonly parentMaterialUuid: string | null
  readonly barcode: string | null
  readonly name: string
  readonly description: string | null
  readonly revision: number | null
  readonly config: Readonly<Record<string, unknown>>
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface MaterialSummary extends MaterialIdentity {
  readonly kind: 'material_summary'
}

export interface SiteOccupancy {
  readonly known: boolean
  readonly occupiedMaterialUuid: string | null
}

export interface SiteSummary {
  readonly kind: 'site'
  readonly source: 'os' | 'fixture'
  readonly siteUuid: string
  readonly ownerMaterialUuid: string
  readonly key: string
  readonly name: string
  readonly sortOrder: number | null
  readonly allowedResourceTemplateUuids: readonly string[] | null
  readonly occupancy: SiteOccupancy
  readonly geometry: {
    readonly positionMm: Vector3
    readonly sizeMm: Vector3 | null
    readonly rotationDegXYZ: Vector3 | null
  } | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly raw: Readonly<Record<string, unknown>>
}

export interface MaterialGraphNode {
  readonly material: MaterialSummary
  readonly resourceTemplate: MaterialResourceTemplateSummary | null
  readonly relativePosition: MaterialRelativePosition | null
  readonly sites: readonly SiteSummary[]
  readonly currentSiteUuid: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface MaterialGraph {
  readonly kind: 'material_graph'
  readonly source: 'os' | 'fixture'
  readonly nodes: readonly MaterialGraphNode[]
  readonly raw: Readonly<Record<string, unknown>>
}

export interface MaterialDetail extends MaterialIdentity {
  readonly kind: 'material_detail'
  readonly relativePosition: MaterialRelativePosition | null
  readonly sites: readonly SiteSummary[]
  readonly currentSite: SiteSummary | null
}

export interface MaterialListPage {
  readonly items: readonly MaterialSummary[]
  readonly total: number | null
  readonly page: number | null
  readonly pageSize: number | null
  readonly raw: Readonly<Record<string, unknown>>
}
