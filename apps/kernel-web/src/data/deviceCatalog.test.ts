import { describe, expect, it } from 'vitest'

import { presentEdgeDevices } from './deviceCatalog'

describe('Edge device catalog', () => {
  it('does not create default devices when Edge reports nothing', () => {
    expect(presentEdgeDevices([])).toEqual([])
  })

  it('presents every Edge device without overriding its identity', () => {
    const devices = presentEdgeDevices([
      {
        id: 'robot',
        deviceKey: '/cell/robot',
        namespace: '/cell',
        machineName: 'Edge A',
        online: true,
        actions: []
      },
      {
        id: 'pump',
        deviceKey: '/cell/pump',
        namespace: '/cell',
        machineName: 'Edge A',
        online: true,
        actions: []
      }
    ])

    expect(devices.map((device) => device.id)).toEqual(['robot', 'pump'])
    expect(devices[0]).toMatchObject({
      displayName: 'robot',
      displayDetail: 'Edge A',
      online: true,
      deviceKey: '/cell/robot'
    })
    expect(devices[1]).toMatchObject({
      displayName: 'pump',
      displayDetail: 'Edge A'
    })
  })
})
