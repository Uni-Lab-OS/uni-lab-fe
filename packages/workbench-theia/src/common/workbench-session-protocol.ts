import type {
  WorkbenchSession,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'

export const WORKBENCH_SESSION_PATH = '/services/unilab-workbench-session'
export const WorkbenchSessionServer = Symbol('WorkbenchSessionServer')
export const WorkbenchSessionClient = Symbol('WorkbenchSessionClient')

export const MATERIAL_RENDERER_CONTRACT = 'unilab-material-renderer/v1' as const

export type MaterialRendererViewMode = '2d' | '2.5d' | '3d' | 'split'

export interface MaterialRendererViewport {
  width: number
  height: number
  pixelRatio?: number
}

export interface MaterialRendererOptions {
  view?: MaterialRendererViewMode
  showSites?: boolean
  showMaterialTransfers?: boolean
  selectedMaterialIds?: readonly string[]
  hiddenMaterialIds?: readonly string[]
  cameraPreset?: 'default' | 'top'
  viewport?: MaterialRendererViewport
  layoutOverrides?: readonly MaterialRendererLayoutOverride[]
  timeoutMs?: number
}

export interface MaterialRendererLayoutOverride {
  sourceNodeId: string
  positionMm?: readonly [number, number, number]
  rotationDegXYZ?: readonly [number, number, number]
  assetRef?: Readonly<Record<string, unknown>>
}

export type MaterialRendererRequest =
  | {
      requestId: string
      kind: 'inspect'
      options: MaterialRendererOptions
    }
  | {
      requestId: string
      kind: 'capture'
      options: MaterialRendererOptions
    }
  | {
      requestId: string
      kind: 'reload'
      options: MaterialRendererOptions
    }

export interface MaterialRendererError {
  code: string
  message: string
  details?: unknown
}

export interface MaterialRendererResponse {
  schemaVersion: typeof MATERIAL_RENDERER_CONTRACT
  requestId: string
  ok: boolean
  result?: unknown
  error?: MaterialRendererError
}

export interface WorkbenchSessionClient {
  onDidChange(snapshot: WorkbenchSessionSnapshot): void | Promise<void>
  onMaterialRendererRequest(
    request: MaterialRendererRequest
  ): void | Promise<void>
}

type WorkbenchSessionRemoteOperations = Pick<
  WorkbenchSession,
  | 'start'
  | 'startWorkspaceBackend'
  | 'stopWorkspaceBackend'
  | 'stop'
  | 'restart'
  | 'rebuildLocalData'
  | 'startAgent'
  | 'stopAgent'
  | 'restartAgent'
  | 'readLogTail'
  | 'readEnvironmentLog'
  | 'configureGraph'
  | 'setExternalDevicesOnly'
  | 'configurePlcSimulator'
  | 'refreshPlcVariableTables'
  | 'startPlcSimulator'
  | 'stopPlcSimulator'
  | 'releaseEnvironmentPorts'
  | 'setRuntimeMode'
  | 'setDomainAuthority'
  | 'setSchedulerUrl'
  | 'configureProductionConnection'
  | 'probeProductionConnection'
  | 'publishRelease'
  | 'inspectReleaseTarget'
>

export interface WorkbenchSessionServer
extends WorkbenchSessionRemoteOperations {
  setClient(client: WorkbenchSessionClient): void
  getSnapshot(): Promise<WorkbenchSessionSnapshot>
  prepareReadableLog(logPath: string): Promise<string>
  completeMaterialRendererRequest(
    response: MaterialRendererResponse
  ): Promise<void>
}
