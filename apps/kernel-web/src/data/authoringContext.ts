import {
  buildDeviceCardAuthoringSampleState,
  createDeviceCardAuthoringContext
} from '@unilab/device-card-authoring-kit'
import type {
  DeviceCardAuthoringContext,
  DeviceCardAuthoringTarget
} from '@unilab/device-card-sdk'
import type { DeviceCatalogItem } from '@unilab/services'

/**
 * Renderer adapter from the OS catalog shape to the neutral authoring target.
 * The shared authoring-kit module remains the only Context implementation.
 */
export function createAuthoringTarget(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): DeviceCardAuthoringTarget {
  const target: DeviceCardAuthoringTarget = {
    deviceId: device.deviceId,
    deviceTypeId: device.deviceTypeId,
    title: device.label,
    online: device.online,
    actions: device.actions.map((action) => ({
      action: action.actionName,
      label: action.label,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      riskLevel: action.riskLevel,
      busy: action.isBusy
    })),
    stateSchema: device.stateSchema,
    media: []
  }
  return {
    ...target,
    sampleState: buildDeviceCardAuthoringSampleState(target, runtimeState)
  }
}

export function createAuthoringContext(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): DeviceCardAuthoringContext {
  return createDeviceCardAuthoringContext(
    createAuthoringTarget(device, runtimeState),
    runtimeState
  )
}

export function buildAuthoringSampleState(
  device: DeviceCatalogItem,
  runtimeState: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildDeviceCardAuthoringSampleState(
    createAuthoringTarget(device),
    runtimeState
  )
}
