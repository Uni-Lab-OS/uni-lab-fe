type WorkspacePath = string

export interface DesktopWorkspaceSnapshot {
  phase: 'unavailable' | 'welcome' | 'starting' | 'ready' | 'stopping' | 'failed'
  activeWorkspace: WorkspacePath | null
  recentWorkspaces: Array<{
    path: WorkspacePath
    name: string
    lastOpenedAt: string
  }>
  error: string | null
}

export interface DesktopWorkspaceApi {
  getSnapshot: () => Promise<DesktopWorkspaceSnapshot>
  selectDirectory: (
    entryMode?: 'debug' | 'production'
  ) => Promise<DesktopWorkspaceSnapshot>
  switchToWelcome: () => Promise<{
    switched: boolean
    snapshot: DesktopWorkspaceSnapshot
  }>
}

/** Returns the desktop-only Workspace bridge; ordinary browsers receive none. */
export function desktopWorkspaceApi(): DesktopWorkspaceApi | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as {
    api?: { workbenchWorkspace?: DesktopWorkspaceApi }
  }).api?.workbenchWorkspace ?? null
}
