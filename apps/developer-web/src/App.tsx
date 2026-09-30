import { OverviewPage } from './features/overview/OverviewPage'
import { DevicesPage } from './features/devices/DevicePage'
import { ReagentsPage } from './features/reagents/ReagentPage'
import { MaterialsPage } from './features/materials/MaterialsPage'
import { WorkflowsPage } from './features/workflows/WorkflowsPage'
import { TasksPage } from './features/tasks/TasksPage'
import { BackendProvider } from './app/BackendProvider'
import { navigateTo, useStudioRoute } from './app/navigation'
import { AppShell } from './components/AppShell'

function StudioRoutes() {
  const route = useStudioRoute()
  const page =
    route === 'overview' ? (
      <OverviewPage onNavigate={navigateTo} />
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
    <AppShell route={route} onNavigate={navigateTo}>
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
