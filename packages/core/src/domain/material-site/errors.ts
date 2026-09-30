export type MaterialSiteErrorCode =
  | 'INVALID_MATERIAL_RESPONSE'
  | 'MATERIAL_NOT_FOUND'
  | 'SITE_NOT_FOUND'
  | 'OS_REQUEST_REJECTED'

export class MaterialSiteError extends Error {
  constructor(
    readonly code: MaterialSiteErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MaterialSiteError'
  }
}
