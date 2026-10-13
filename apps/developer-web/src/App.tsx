import { OverviewPage } from './features/overview/OverviewPage'
import { DevicesPage } from './features/devices/DevicePage'
import { ReagentsPage } from './features/reagents/ReagentPage'
import { MaterialsPage } from './features/materials/MaterialsPage'
import { WorkflowsPage } from './features/workflows/WorkflowsPage'
import { TasksPage } from './features/tasks/TasksPage'
import { BackendProvider } from './app/BackendProvider'
import {
  StationHandlingProvider,
  useStationHandling,
} from './features/station-handling/StationHandlingProvider'
import { navigateTo, useStudioRoute } from './app/navigation'
import { AppShell } from './components/AppShell'
import { useState } from 'react'

function StudioRoutes() {
  const route = useStudioRoute()
  const [hasLocalAttention, setHasLocalAttention] = useState(false)
  const { snapshot } = useStationHandling()
  const page =
    route === 'overview' ? (
      <OverviewPage onNavigate={navigateTo} onAttentionChange={setHasLocalAttention} />
    ) : route === 'devices' ? (
      <DevicesPage />
    ) : route === 'reagents' ? (
      <ReagentsPage />
    ) : route === 'workflows' ? (
      <WorkflowsPage onNavigate={navigateTo} />
    ) : route === 'tasks' ? (
      <TasksPage />
    ) : (
      <MaterialsPage />
    )
  return (
    <AppShell
      route={route}
      onNavigate={navigateTo}
      // 工站级错误会暂停整个工站，必须和任务级异常一样体现在导航上。
      hasOverviewAttention={hasLocalAttention || (snapshot?.errors.length ?? 0) > 0}
    >
      {page}
    </AppShell>
  )
}

export function App() {
  return (
    <BackendProvider>
      <StationHandlingProvider>
        <StudioRoutes />
      </StationHandlingProvider>
    </BackendProvider>
  )
}
