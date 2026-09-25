export type MaterialSiteRecord = Readonly<Record<string, unknown>>

export interface MaterialListResponse extends MaterialSiteRecord {
  readonly items?: readonly MaterialSiteRecord[]
  readonly data?: readonly MaterialSiteRecord[]
}

export interface MaterialGraphResponse extends MaterialSiteRecord {
  readonly nodes?: readonly MaterialSiteRecord[]
}

export interface MaterialDetailResponse extends MaterialSiteRecord {
  readonly relative_position?: MaterialSiteRecord | null
  readonly sites?: readonly MaterialSiteRecord[]
  readonly current_site?: MaterialSiteRecord | null
}

export interface SiteListResponse extends MaterialSiteRecord {
  readonly items?: readonly MaterialSiteRecord[]
  readonly sites?: readonly MaterialSiteRecord[]
  readonly data?: readonly MaterialSiteRecord[]
}
