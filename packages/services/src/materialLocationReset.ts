import { requestData, type HttpClient } from './http'

export interface MaterialLocationResetPreview {
  baseline_fingerprint: string
  materials: Array<{
    material_uuid: string
    name: string
    revision: number
    parent_uuid: string | null
    site_uuid: string | null
    reset_kind: 'baseline' | 'delete_new'
    relative_position: Record<string, number> | null
    needs_reset: boolean
  }>
}
export interface MaterialLocationResetPort {
  preview: () => Promise<MaterialLocationResetPreview>
  apply: (input: {
    baseline_fingerprint: string
    expected_revisions: Record<string, number>
    physical_settlement_confirmed: boolean
  }) => Promise<{ status: 'restored'; restored_count: number; material_uuids: string[] }>
}

/** 库存位置复位沿用预览版本；冲突由调用方重新预览，不自动覆盖新状态。 */
export function createMaterialLocationResetPort(http: HttpClient): MaterialLocationResetPort {
  return {
    preview: () => requestData(http, '/api/v1/materials/reset-locations'),
    apply: input => requestData(http, '/api/v1/materials/reset-locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
  }
}
