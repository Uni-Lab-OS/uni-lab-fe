import type {
  DeviceCardAuthoringContext,
  DeviceCardAuthoringProfile
} from '@unilab/device-card-sdk'

export interface DeviceCardAuthoringKitMetadata {
  kitVersion: 1
  generatedAt: string
  deviceTypeId: string
  deviceId?: string
  authoringProfile: DeviceCardAuthoringProfile
  authoringContextDigest: string
  sdkVersion: string
  toolingVersion: string
  hostProtocolVersion: 1
  uiCatalogVersion: string
}

export interface CreateDeviceCardAuthoringKitInput {
  context: DeviceCardAuthoringContext
  profile: DeviceCardAuthoringProfile
  generatedAt?: string
}

export interface GeneratedDeviceCardAuthoringKit {
  fileName: string
  rootDirectory: string
  archive: Uint8Array
  metadata: DeviceCardAuthoringKitMetadata
}

export type DeviceCardProjectFiles = Record<string, string>
