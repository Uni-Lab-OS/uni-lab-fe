export type BackendAuthKind = 'none' | 'token' | 'oauth'
export type BackendServerKind = 'backend' | 'edge'
export type BackendWorkspaceMode = 'singleton' | 'laboratory'

export interface BackendConfig {
  id: string
  name: string
  protocol: 'unilab/v1'
  apiUrl: string
  realtimeUrl?: string
  assetUrl?: string
  auth: BackendAuthKind
  serverKind: BackendServerKind
  workspaceMode: BackendWorkspaceMode
}

export const DEFAULT_BACKENDS: readonly BackendConfig[] = [
  {
    id: 'local-go',
    name: 'Local Go',
    protocol: 'unilab/v1',
    apiUrl: 'http://127.0.0.1:8000',
    auth: 'none',
    serverKind: 'backend',
    workspaceMode: 'singleton'
  },
  {
    id: 'local-python',
    name: 'Local Python OS',
    protocol: 'unilab/v1',
    // Bridge HTTP (catalog / runtime). Device status WS lives on Edge FastAPI.
    apiUrl: 'http://127.0.0.1:8014',
    realtimeUrl: 'ws://127.0.0.1:18003',
    auth: 'none',
    serverKind: 'edge',
    workspaceMode: 'singleton'
  },
  {
    id: 'cloud',
    name: 'Uni-Lab Cloud',
    protocol: 'unilab/v1',
    apiUrl: '',
    auth: 'oauth',
    serverKind: 'backend',
    workspaceMode: 'laboratory'
  }
]

export function getDefaultBackend(backendId = 'local-python'): BackendConfig {
  const backend = DEFAULT_BACKENDS.find((candidate) => candidate.id === backendId)
  if (!backend) throw new Error(`Unknown default backend: ${backendId}`)
  return { ...backend }
}
