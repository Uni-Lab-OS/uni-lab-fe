import { OverviewPage } from './features/overview/OverviewPage'
import { DevicesPage } from './features/devices/DevicePage'
import { ReagentsPage } from './features/reagents/ReagentPage'
import { MaterialsPage } from './features/materials/MaterialsPage'
import { WorkflowsPage } from './features/workflows/WorkflowsPage'
import { TasksPage } from './features/tasks/TasksPage'
import { SchedulePage } from './features/schedule/SchedulePage'
import { StationErrorHandling } from './features/station/StationErrorHandling'
import { BackendProvider } from './app/BackendProvider'
import { navigateTo, useStudioRoute } from './app/navigation'
import { AppShell } from './components/AppShell'
import { useState } from 'react'

function StudioRoutes() {
  const route = useStudioRoute()
  const [hasOverviewAttention, setHasOverviewAttention] = useState(false)
  const page =
    route === 'overview' ? (
      <OverviewPage onNavigate={navigateTo} onAttentionChange={setHasOverviewAttention} />
    ) : route === 'devices' ? (
      <DevicesPage />
    ) : route === 'reagents' ? (
      <ReagentsPage />
    ) : route === 'workflows' ? (
      <WorkflowsPage onNavigate={navigateTo} />
    ) : route === 'tasks' ? (
      <TasksPage />
    ) : route === 'schedule' ? (
      <SchedulePage />
    ) : (
      <MaterialsPage />
    )
  return (
    <AppShell
      route={route}
      onNavigate={navigateTo}
      hasOverviewAttention={hasOverviewAttention}
    >
      <StationErrorHandling />
      {page}
    </AppShell>
  )
}

export function App() {
  return (
    <BackendProvider>
      <StudioRoutes />
    </BackendProvider>
  )
}
