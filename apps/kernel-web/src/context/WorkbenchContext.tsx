import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  DEFAULT_BACKENDS,
  getDefaultBackend,
  type BackendConfig
} from '@unilab/services'

import type {
  ConnectionStatus,
  WorkbenchSection
} from '../data/lab'
import { DEFAULT_BACKEND_ENABLED } from './connectionPolicy'

interface WorkbenchContextValue {
  backend: BackendConfig
  backendEnabled: boolean
  connection: ConnectionStatus
  section: WorkbenchSection
  laboratoryId: string | null
  availableBackends: readonly BackendConfig[]
  selectBackend: (backendId: string) => void
  updateBackend: (patch: Partial<BackendConfig>) => void
  setBackendEnabled: (enabled: boolean) => void
  setConnection: (status: ConnectionStatus) => void
  setSection: (section: WorkbenchSection) => void
  setLaboratoryId: (laboratoryId: string | null) => void
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null)

export function WorkbenchProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [backend, setBackend] = useState<BackendConfig>(() =>
    initialBackend()
  )
  const [backendEnabled, setBackendEnabledState] = useState(
    DEFAULT_BACKEND_ENABLED
  )
  const [connection, setConnection] =
    useState<ConnectionStatus>('disconnected')
  const [section, setSection] = useState<WorkbenchSection>(() =>
    initialSection()
  )
  const [laboratoryId, setLaboratoryId] = useState<string | null>(null)

  const selectBackend = useCallback((backendId: string) => {
    setBackend(getDefaultBackend(backendId))
    setLaboratoryId(null)
    setConnection('disconnected')
  }, [])

  const updateBackend = useCallback((patch: Partial<BackendConfig>) => {
    setBackend((current) => {
      const next = { ...current, ...patch }
      if (
        current.id === 'local-python' &&
        patch.apiUrl &&
        patch.realtimeUrl === undefined
      ) {
        next.realtimeUrl = realtimeUrlFor(patch.apiUrl)
      }
      return next
    })
    setConnection('disconnected')
  }, [])

  const setBackendEnabled = useCallback((enabled: boolean) => {
    setBackendEnabledState(enabled)
    if (!enabled) setConnection('disconnected')
  }, [])

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      backend,
      backendEnabled,
      connection,
      section,
      laboratoryId,
      availableBackends: DEFAULT_BACKENDS,
      selectBackend,
      updateBackend,
      setBackendEnabled,
      setConnection,
      setSection,
      setLaboratoryId
    }),
    [
      backend,
      backendEnabled,
      connection,
      section,
      laboratoryId,
      selectBackend,
      updateBackend,
      setBackendEnabled
    ]
  )

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  )
}

export function useWorkbench(): WorkbenchContextValue {
  const contextValue = useContext(WorkbenchContext)
  if (!contextValue) {
    throw new Error('useWorkbench must be used within WorkbenchProvider')
  }
  return contextValue
}

function initialBackend(): BackendConfig {
  const backend = getDefaultBackend('local-python')
  if (typeof globalThis.location === 'undefined') return backend
  const override = new URLSearchParams(globalThis.location.search)
    .get('localOsUrl')
  if (!override) return backend
  try {
    const url = new URL(override)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ) {
      return backend
    }
    const apiUrl = url.toString().replace(/\/$/, '')
    return {
      ...backend,
      apiUrl,
      realtimeUrl: realtimeUrlFor(apiUrl)
    }
  } catch {
    return backend
  }
}

function initialSection(): WorkbenchSection {
  if (typeof globalThis.location === 'undefined') return 'device'
  const section = new URLSearchParams(globalThis.location.search).get('section')
  if (
    section === 'device' ||
    section === 'cards' ||
    section === 'material' ||
    section === 'scene' ||
    section === 'workflow'
  ) {
    return section
  }
  return 'device'
}

function realtimeUrlFor(apiUrl: string): string {
  try {
    const url = new URL(apiUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString().replace(/\/$/, '')
  } catch {
    return apiUrl
  }
}
