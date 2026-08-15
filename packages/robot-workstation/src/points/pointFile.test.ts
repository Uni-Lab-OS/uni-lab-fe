import { describe, expect, it } from 'vitest'

import { WORKSTATION_SITES } from '../fixtures'
import { nextPointVersion, parsePointDocument, parsePointFile, serializePointFile } from './pointFile'

describe('pointFile', () => {
  it('serializes the documented station, warehouses and flat points shape', () => {
    const value = JSON.parse(serializePointFile([...WORKSTATION_SITES], '1.8', 'E2E 标定说明')) as Record<string, unknown>

    expect(value.station).toEqual({ id: 'ST01', name: '机械臂工站' })
    expect(value.version).toBe('1.8')
    expect(value.versionNote).toBe('E2E 标定说明')
    expect(value.history).toEqual(expect.arrayContaining([expect.objectContaining({ version: '1.8', note: 'E2E 标定说明' })]))
    expect(value.warehouses).toHaveLength(3)
    expect(value.points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          siteId: 'A01',
          id: 'A01_PICK',
          status: 'verified',
        }),
      ]),
    )
  })

  it('parses a flat pose array and preserves point status', () => {
    const sites = parsePointFile({
      warehouses: [{ id: 'T01', name: '测试库位', category: '缓存库位' }],
      points: [
        {
          siteId: 'T01',
          id: 'T01_HOME',
          name: '待机位',
          type: 'home',
          motion: 'PTP',
          pose: [1, 2, 3, 4, 5, 6],
          status: 'pending_verification',
        },
      ],
    })

    expect(sites[0].points[0]).toMatchObject({
      id: 'T01_HOME',
      status: 'pending_verification',
      pose: { x: 1, y: 2, z: 3, rx: 4, ry: 5, rz: 6 },
    })
  })

  it('increments the latest minor version', () => {
    expect(nextPointVersion([{ version: '2.9', note: '', savedAt: '', fileHash: '' }])).toBe('2.10')
  })

  it('continues from the imported file version and rejects duplicate identities', () => {
    const document = parsePointDocument({
      version: '5.2',
      versionNote: '现场导入',
      warehouses: [{ id: 'T01', name: '测试库位' }],
      points: [{ siteId: 'T01', id: 'P01', pose: [1, 2, 3, 4, 5, 6] }],
    })
    expect(nextPointVersion(document.history)).toBe('5.3')
    expect(() =>
      parsePointFile({
        warehouses: [{ id: 'T01', name: '测试库位' }],
        points: [
          { siteId: 'T01', id: 'P01', pose: [1, 2, 3, 4, 5, 6] },
          { siteId: 'T01', id: 'P01', pose: [1, 2, 3, 4, 5, 6] },
        ],
      }),
    ).toThrow('重复点位 ID')
  })
})
