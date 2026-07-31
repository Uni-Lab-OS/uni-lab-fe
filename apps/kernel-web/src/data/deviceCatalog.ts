import type { OnlineDevice } from '@unilab/services'

export interface ManagedDevice extends OnlineDevice {
  displayName: string
  displayDetail: string
}

export function presentEdgeDevices(
  edgeDevices: readonly OnlineDevice[]
): ManagedDevice[] {
  return edgeDevices.map((device) => ({
    ...device,
    displayName: device.id,
    displayDetail: device.machineName
  }))
}
