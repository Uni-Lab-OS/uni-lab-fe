export type WorkbenchWorkspacePhase =
  | 'unavailable'
  | 'welcome'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'failed'

export type WorkbenchEntryMode = 'debug' | 'production'

export interface RecentWorkbenchWorkspace {
  path: string
  name: string
  lastOpenedAt: string
}

export interface WorkbenchWorkspaceSnapshot {
  phase: WorkbenchWorkspacePhase
  activeWorkspace: string | null
  recentWorkspaces: RecentWorkbenchWorkspace[]
  error: string | null
}

export interface WorkbenchWorkspaceActivation {
  rendererUrl: string
  snapshot: WorkbenchWorkspaceSnapshot
}

export interface WorkbenchWorkspaceController {
  welcomeUrl: string
  getSnapshot: () => WorkbenchWorkspaceSnapshot
  chooseAndOpen: (
    kind: 'open' | 'create',
    entryMode?: WorkbenchEntryMode
  ) => Promise<WorkbenchWorkspaceActivation | null>
  openRecent: (
    path: string,
    entryMode?: WorkbenchEntryMode
  ) => Promise<WorkbenchWorkspaceActivation>
  deactivate: (error?: string | null) => Promise<WorkbenchWorkspaceSnapshot>
  isNavigationAllowed: (targetUrl: string) => boolean
}

export interface DesktopWorkbenchWorkspaceApi {
  getSnapshot: () => Promise<WorkbenchWorkspaceSnapshot>
  openDirectory: (entryMode?: WorkbenchEntryMode) => Promise<WorkbenchWorkspaceSnapshot>
  createDirectory: (entryMode?: WorkbenchEntryMode) => Promise<WorkbenchWorkspaceSnapshot>
  openRecent: (
    path: string,
    entryMode?: WorkbenchEntryMode
  ) => Promise<WorkbenchWorkspaceSnapshot>
  selectDirectory: (entryMode?: WorkbenchEntryMode) => Promise<WorkbenchWorkspaceSnapshot>
  switchToWelcome: () => Promise<{
    switched: boolean
    snapshot: WorkbenchWorkspaceSnapshot
  }>
  onSnapshot: (
    listener: (snapshot: WorkbenchWorkspaceSnapshot) => void
  ) => () => void
}

export const UNAVAILABLE_WORKBENCH_WORKSPACE:
WorkbenchWorkspaceSnapshot = Object.freeze({
  phase: 'unavailable',
  activeWorkspace: null,
  recentWorkspaces: [],
  error: null
})
