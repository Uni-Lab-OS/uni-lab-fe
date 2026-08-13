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
  type BackendConfig
} from '@unilab/services'

import type {
  ConnectionStatus,
  WorkbenchSection
} from '../data/lab'
import { DEFAULT_BACKEND_ENABLED } from './connectionPolicy'
import {
  BACKEND_PREFERENCE_STORAGE_KEY,
  hasExplicitBackendSelection,
  resolveDefaultBackend,
  resolveInitialBackend,
  serializeBackendPreference
} from './backendSelection'

interface WorkbenchContextValue {
  backend: BackendConfig
  backendEnabled: boolean
  connection: ConnectionStatus
  section: WorkbenchSection
  laboratoryId: string | null
  capabilityHealth: WorkbenchCapabilityHealth
  recoveryRevision: number
  availableBackends: readonly BackendConfig[]
  selectBackend: (backendId: string) => void
  updateBackend: (patch: Partial<BackendConfig>) => void
  setBackendEnabled: (enabled: boolean) => void
  setConnection: (status: ConnectionStatus) => void
  setSection: (section: WorkbenchSection) => void
  setLaboratoryId: (laboratoryId: string | null) => void
  reportCapabilityHealth: (
    capability: WorkbenchCapability,
    health: CapabilityHealth
  ) => void
  requestRecovery: () => void
}

export type WorkbenchCapability = 'devices' | 'materials' | 'workflows'
export type CapabilityHealthStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'

export interface CapabilityHealth {
  status: CapabilityHealthStatus
  summary: string
  technicalDetail?: string
}

export type WorkbenchCapabilityHealth = Readonly<
  Record<WorkbenchCapability, CapabilityHealth>
>

const INITIAL_CAPABILITY_HEALTH: WorkbenchCapabilityHealth = {
  devices: { status: 'idle', summary: '尚未读取' },
  materials: { status: 'idle', summary: '尚未读取' },
  workflows: { status: 'idle', summary: '尚未读取' }
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null)

export function WorkbenchProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [backend, setBackend] = useState<BackendConfig>(() =>
    initialBackend()
  )
  const [backendEnabled, setBackendEnabledState] = useState(
    initialBackendEnabled
  )
  const [connection, setConnection] =
    useState<ConnectionStatus>('disconnected')
  const [section, setSection] = useState<WorkbenchSection>(() =>
    initialSection()
  )
  const [laboratoryId, setLaboratoryId] = useState<string | null>(null)
  const [capabilityHealth, setCapabilityHealth] =
    useState<WorkbenchCapabilityHealth>(INITIAL_CAPABILITY_HEALTH)
  const [recoveryRevision, setRecoveryRevision] = useState(0)

  const selectBackend = useCallback((backendId: string) => {
    const next = resolveDefaultBackend(backendId, browserOrigin())
    persistBackendPreference(next)
    setBackend(next)
    setLaboratoryId(null)
    setCapabilityHealth(INITIAL_CAPABILITY_HEALTH)
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
      persistBackendPreference(next)
      return next
    })
    setCapabilityHealth(INITIAL_CAPABILITY_HEALTH)
    setConnection('disconnected')
  }, [])

  const setBackendEnabled = useCallback((enabled: boolean) => {
    setBackendEnabledState(enabled)
    if (!enabled) setConnection('disconnected')
  }, [])

  const reportCapabilityHealth = useCallback((
    capability: WorkbenchCapability,
    health: CapabilityHealth
  ) => {
    setCapabilityHealth((current) => {
      const previous = current[capability]
      if (
        previous.status === health.status &&
        previous.summary === health.summary &&
        previous.technicalDetail === health.technicalDetail
      ) {
        return current
      }
      return { ...current, [capability]: health }
    })
  }, [])

  const requestRecovery = useCallback(() => {
    setRecoveryRevision((revision) => revision + 1)
  }, [])

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      backend,
      backendEnabled,
      connection,
      section,
      laboratoryId,
      capabilityHealth,
      recoveryRevision,
      availableBackends: DEFAULT_BACKENDS,
      selectBackend,
      updateBackend,
      setBackendEnabled,
      setConnection,
      setSection,
      setLaboratoryId,
      reportCapabilityHealth,
      requestRecovery
    }),
    [
      backend,
      backendEnabled,
      connection,
      section,
      laboratoryId,
      capabilityHealth,
      recoveryRevision,
      selectBackend,
      updateBackend,
      setBackendEnabled,
      reportCapabilityHealth,
      requestRecovery
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
  const location = typeof globalThis.location === 'undefined'
    ? undefined
    : globalThis.location
  const storage = typeof globalThis.localStorage === 'undefined'
    ? undefined
    : globalThis.localStorage
  return resolveInitialBackend({
    search: location?.search ?? '',
    origin: location?.origin,
    managedRuntime: Boolean(globalThis.window?.api?.runtime),
    storedPreference: storage?.getItem(BACKEND_PREFERENCE_STORAGE_KEY)
  })
}

function initialBackendEnabled(): boolean {
  // Electron owns the lifecycle of its local Edge. Do not probe the managed
  // port before the operator starts that runtime; the launcher enables the
  // profile only after the Edge readiness gate succeeds. Browser deployments
  // retain the existing auto-connect policy for externally managed services.
  if (
    typeof globalThis.window !== 'undefined'
    && globalThis.window.api?.runtime
    && !hasExplicitBackendSelection(globalThis.location?.search ?? '')
  ) {
    return false
  }
  return DEFAULT_BACKEND_ENABLED
}

function initialSection(): WorkbenchSection {
  if (typeof globalThis.location === 'undefined') return 'device'
  const section = new URLSearchParams(globalThis.location.search).get('section')
  // 兼容旧的设备卡一级导航深链；卡片现已归入“仪器设备”。
  if (section === 'cards') return 'device'
  if (
    section === 'device' ||
    section === 'device-square' ||
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

/** 返回浏览器当前 Origin；SSR/测试环境没有 location 时返回 undefined。 */
function browserOrigin(): string | undefined {
  return typeof globalThis.location === 'undefined'
    ? undefined
    : globalThis.location.origin
}

/**
 * 持久化用户确认过的后端权威配置。
 *
 * @param backend 不含访问令牌的后端 profile 与地址。
 * @returns 无；浏览器禁用存储时失败开放，不影响本次连接。
 */
function persistBackendPreference(backend: BackendConfig): void {
  try {
    globalThis.localStorage?.setItem(
      BACKEND_PREFERENCE_STORAGE_KEY,
      serializeBackendPreference(backend)
    )
  } catch {
    // 本地偏好不是领域事实，浏览器禁用存储时继续使用当前会话配置。
  }
}
