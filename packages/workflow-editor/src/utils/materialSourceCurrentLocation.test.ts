import { expect, it } from 'vitest'
import { materialSourceCurrentLocation } from './materialSourceCurrentLocation'

it('reports missing, ambiguous, unknown-owner and cyclic occupancy without guessing', () => {
  const material = (uuid: string) => ({ uuid, name: uuid, resourceTemplateUuid: 'template' })
  const site = (uuid: string, owner: string, occupied: string) => ({ uuid, name: uuid, sortOrder: 0, mountMaterialUuid: owner, occupiedMaterialUuid: occupied, allowedResourceTemplateUuids: [] })
  const materials = [material('plate'), material('base'), material('warehouse')]
  expect(materialSourceCurrentLocation({ materials, sites: [] }, 'plate')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('未记录') })
  expect(materialSourceCurrentLocation({ materials, sites: [site('a', 'base', 'plate'), site('b', 'warehouse', 'plate')] }, 'plate')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('多个库位') })
  expect(materialSourceCurrentLocation({ materials, sites: [site('a', 'missing', 'plate')] }, 'plate')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('不在目录') })
  expect(materialSourceCurrentLocation({ materials, sites: [site('a', 'base', 'plate'), site('b', 'plate', 'base')] }, 'plate')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('循环') })
})
