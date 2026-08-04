export interface DeviceCardLiveBinding {
  previewId: string
  deviceId: string
}

export function deviceCardActionContractSignature(
  actions: readonly DeviceCatalogAction[]
): string {
  return JSON.stringify(actions.map((action) => ({
    action: action.actionName,
    label: action.label,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    riskLevel: action.riskLevel
  } satisfies DeviceCardActionContract)))
}

export function isDeviceCardLiveBinding(
  binding: DeviceCardLiveBinding | null,
  previewId: string,
  deviceId: string
): boolean {
  return Boolean(
    binding &&
    previewId &&
    deviceId &&
    binding.previewId === previewId &&
    binding.deviceId === deviceId
  )
}
import type { DeviceCatalogAction } from '@unilab/services'
import type { DeviceCardActionContract } from '@unilab/device-card-sdk'
