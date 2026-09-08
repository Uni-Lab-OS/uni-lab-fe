import {
  MaterialStoreProvider,
  createMaterialStore,
  type MaterialStore
} from '@unilab/material'
import { jointStateSceneRuntime } from '@unilab/pascal-lab-plugin'
import {
  assertCapability,
  useServices,
  type CapabilityStatus,
  type ServerCapability
} from '@unilab/services'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode
} from 'react'

import { useWorkbench } from '../../context/WorkbenchContext'
import { recoverMaterialGraph } from './materialGraphRecovery'
import { resolveMaterialScope } from './materialScope'

interface MaterialRuntimeContextValue {
  store: MaterialStore | null
  scope: ReturnType<typeof resolveMaterialScope>
  getStatus: (capability: ServerCapability) => CapabilityStatus
}

const MaterialRuntimeContext =
  createContext<MaterialRuntimeContextValue | null>(null)

export function MaterialRuntimeProvider({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const services = useServices()
  const {
    backend,
    backendEnabled,
    connection,
    laboratoryId,
    recoveryRevision,
    reportCapabilityHealth
  } = useWorkbench()
  const scope = useMemo(
    () => resolveMaterialScope(backend, laboratoryId),
    [backend, laboratoryId]
  )
  const getStatus = useMemo(
    () => (capability: ServerCapability): CapabilityStatus => {
      if (!backendEnabled) {
        return {
          available: false,
          reason: '当前服务配置未启用连接'
        }
      }
      return services.getCapabilityStatus(capability)
    },
    [backendEnabled, services]
  )
  const store = useMemo<MaterialStore | null>(() => {
    if (!scope) return null
    return createMaterialStore({
      scope,
      graph: services.materials,
      requireCapability: (capability) => {
        assertCapability(getStatus(capability), capability)
      },
      createIdempotencyKey: () =>
        globalThis.crypto?.randomUUID?.() ??
        `material-${Date.now()}-${Math.random()}`
    })
  }, [getStatus, scope, services.materials])

  useEffect(() => {
    return () => store?.getState().reset()
  }, [store])

  useEffect(() => {
    void recoverMaterialGraph(
      store,
      backendEnabled && connection === 'connected'
    )
  }, [backendEnabled, connection, recoveryRevision, store])

  useEffect(() => {
    if (
      !backendEnabled ||
      connection !== 'connected' ||
      !getStatus('realtime.pushJointState').available
    ) {
      return
    }
    return services.realtime.subscribeJointState({
      onJointState: (frame) => {
        jointStateSceneRuntime.apply(frame)
      },
      onDiagnostic: (diagnostic) => {
        console.warn(
          `[joint-state:${diagnostic.code}] ${diagnostic.message}`
        )
      },
      onError: (message) => {
        console.warn(`[joint-state:transport] ${message}`)
      }
    })
  }, [backendEnabled, connection, getStatus, services.realtime])

  useEffect(() => {
    if (!scope) {
      reportCapabilityHealth('materials', {
        status: 'idle',
        summary: '等待实验室范围'
      })
      return
    }
    if (!store || !backendEnabled || connection !== 'connected') {
      reportCapabilityHealth('materials', {
        status: 'idle',
        summary: '等待后端连接'
      })
      return
    }

    const publish = (): void => {
      const state = store.getState()
      if (state.loadState === 'loading' || state.loadState === 'idle') {
        reportCapabilityHealth('materials', {
          status: 'loading',
          summary: '正在读取物料图'
        })
      } else if (state.loadState === 'error') {
        reportCapabilityHealth('materials', {
          status: 'error',
          summary: '物料图不可用',
          technicalDetail: state.error ?? undefined
        })
      } else {
        reportCapabilityHealth('materials', {
          status: 'ready',
          summary: `${Object.keys(state.aggregatesById).length} 项物料`
        })
      }
    }

    publish()
    return store.subscribe(publish)
  }, [
    backendEnabled,
    connection,
    reportCapabilityHealth,
    scope,
    store
  ])

  useEffect(() => {
    if (
      !store ||
      !backendEnabled ||
      connection !== 'connected' ||
      !services.materials.subscribeMoves
    ) {
      return
    }
    const subscription = services.materials.subscribeMoves((event) => {
      if (store.getState().loadState !== 'ready') return
      try {
        store.getState().applyRemoteMove(event)
      } catch (error) {
        // 当前页面图不能安全投影时保持原状，下次整页刷新再读取权威全量。
        console.warn('物料移动事件投影失败', error)
      }
    })
    return () => subscription.dispose()
  }, [backendEnabled, connection, services.materials, store])

  const value = useMemo<MaterialRuntimeContextValue>(
    () => ({ store, scope, getStatus }),
    [getStatus, scope, store]
  )
  const content = store ? (
    <MaterialStoreProvider store={store}>
      {children}
    </MaterialStoreProvider>
  ) : children

  return (
    <MaterialRuntimeContext.Provider value={value}>
      {content}
    </MaterialRuntimeContext.Provider>
  )
}

export function useMaterialRuntime(): MaterialRuntimeContextValue {
  const context = useContext(MaterialRuntimeContext)
  if (!context) {
    throw new Error(
      'useMaterialRuntime must be used within MaterialRuntimeProvider'
    )
  }
  return context
}
