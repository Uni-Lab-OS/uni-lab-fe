import { describe, expect, it, vi } from 'vitest'
import type { HttpClient } from './http'
import { createMaterialLocationResetPort } from './materialLocationReset'

describe('material location reset adapter', () => {
  it('uses read-only preview then forwards frozen revisions and physical confirmation', async () => {
    const request = vi.fn().mockResolvedValue({ code: 0, data: {} })
    const port = createMaterialLocationResetPort({ request } as HttpClient)
    await port.preview()
    const input = { baseline_fingerprint: 'graph', expected_revisions: { original: 4, extra: 8 }, physical_settlement_confirmed: true }
    await port.apply(input)
    expect(request.mock.calls[0]).toEqual(['/api/v1/materials/reset-locations', undefined])
    expect(request.mock.calls[1][0]).toBe('/api/v1/materials/reset-locations')
    expect(request.mock.calls[1][1].method).toBe('POST')
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual(input)
  })

  it('preserves conflict errors with no implicit refresh or retry', async () => {
    const request = vi.fn().mockResolvedValue({ code: 4002, message: 'stale preview', data: null })
    const port = createMaterialLocationResetPort({ request } as HttpClient)
    await expect(port.apply({ baseline_fingerprint: 'old', expected_revisions: {}, physical_settlement_confirmed: true })).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
