/** [AI] Model: Claude Opus 4.8 | 2026-07-31 | 应用根:可选登录 + 统一外壳 + 模式 Provider */
import { useCallback, type ReactNode } from 'react'
import { ServicesProvider, useServices } from '@unilab/services'
import type { HttpRequestTraceEvent } from '@unilab/services'
import { WorkflowInterventions, WorkflowSessionProvider } from '@unilab/workflow-editor'
import {
  WorkbenchProvider,
  useWorkbench
} from './context/WorkbenchContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LabInteractionProvider } from './integrations/lab-workbench/LabInteractionProvider'
import { MaterialRuntimeProvider } from './integrations/lab-workbench/MaterialRuntimeProvider'
import AppShell from './components/AppShell'
import { DeviceCardAuthoringTargetConnector } from './components/device-cards/DeviceCardAuthoringTargetConnector'
import { DeviceStatusProvider } from './hooks/useDeviceStatus'

export default function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <WorkbenchProvider>
        <ActiveServices>
          <MaterialRuntimeProvider>
            <ActiveInteraction>
              <WorkflowSessionProvider>
                <AppShell />
              </WorkflowSessionProvider>
            </ActiveInteraction>
          </MaterialRuntimeProvider>
        </ActiveServices>
      </WorkbenchProvider>
    </AuthProvider>
  )
}

function ActiveInteraction({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const { backend } = useWorkbench()
  return (
    <LabInteractionProvider
      key={[
        backend.id,
        backend.apiUrl,
        backend.realtimeUrl,
        backend.workspaceMode
      ].join(':')}
    >
      {children}
    </LabInteractionProvider>
  )
}

function ActiveServices({ children }: { children: ReactNode }): React.JSX.Element {
  const { backend } = useWorkbench()
  const { session } = useAuth()
  const getAccessToken = useCallback(() => session?.token ?? null, [session?.token])
  const traceRequest = useCallback((event: HttpRequestTraceEvent) => {
    return globalThis.window?.api?.observability?.recordHttpRequest?.(event)
  }, [])

  return (
    <ServicesProvider
      backend={backend}
      getAccessToken={getAccessToken}
      traceRequest={traceRequest}
    >
      <DeviceStatusProvider>
        <ActiveWorkflowInterventions />
        <DeviceCardAuthoringTargetConnector />
        {children}
      </DeviceStatusProvider>
    </ServicesProvider>
  )
}

/** 页面和面板切换不卸载公共干预入口。 */
function ActiveWorkflowInterventions(): React.JSX.Element {
  const services = useServices()
  return <WorkflowInterventions runtime={services.workflow} />
}
