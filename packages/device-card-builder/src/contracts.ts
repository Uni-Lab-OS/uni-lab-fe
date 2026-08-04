import type {
  DeviceCardAuthoringContext,
  DeviceCardDiagnostic,
  DeviceCardManifest
} from '@unilab/device-card-sdk'

export type DeviceCardContextAuthority = 'host' | 'project-preview'

export interface DeviceCardBuildRequest {
  projectDir: string
  outDir: string
  authoringContext?: DeviceCardAuthoringContext
  contextAuthority?: DeviceCardContextAuthority
  development?: boolean
}

export interface DeviceCardBuildMetadata {
  schemaVersion: 'device-card-artifact/v1'
  builderVersion: string
  contextAuthority: 'host' | 'project-only'
  cardId: string
  cardVersion: string
  elementName: string
  manifest: DeviceCardManifest
  sourceHash: string
  builtAt: string
}

export interface DeviceCardBuildResult {
  ok: boolean
  diagnostics: DeviceCardDiagnostic[]
  metadata?: DeviceCardBuildMetadata
  outDir: string
}

export interface DeviceCardArchiveInspection {
  manifest: DeviceCardManifest
  files: string[]
  compressedBytes: number
  uncompressedBytes: number
}
