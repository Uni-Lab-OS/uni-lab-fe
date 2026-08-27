import type {
  WorkbenchWorkspaceController,
  WorkbenchWorkspaceSnapshot
} from '../shared/workbenchWorkspace'

interface WorkbenchTransitionWindow {
  isDestroyed: () => boolean
  loadURL: (url: string) => Promise<unknown>
  show: () => void
  focus: () => void
}

export async function switchWorkbenchWorkspaceToWelcome(options: {
  window: WorkbenchTransitionWindow
  controller: Pick<
    WorkbenchWorkspaceController,
    'welcomeUrl' | 'getSnapshot' | 'deactivate'
  >
  selectDirectory?: boolean
  publishSnapshot: (snapshot: WorkbenchWorkspaceSnapshot) => void
}): Promise<{
  switched: boolean
  snapshot: WorkbenchWorkspaceSnapshot
}> {
  const { window, controller } = options
  if (window.isDestroyed()) {
    return { switched: false, snapshot: controller.getSnapshot() }
  }

  const switchingUrl = new URL(controller.welcomeUrl)
  switchingUrl.searchParams.set('switching', '1')
  try {
    await window.loadURL(switchingUrl.toString())
  } catch (error) {
    if (isAbortedNavigation(error)) {
      return { switched: false, snapshot: controller.getSnapshot() }
    }
    throw error
  }

  const snapshot = await controller.deactivate()
  if (window.isDestroyed()) return { switched: true, snapshot }

  // Replace the transient switching document. This guarantees the welcome
  // renderer starts from a fresh IPC subscription after the old Theia backend
  // has stopped instead of remaining on a one-shot loading screen.
  const welcomeUrl = new URL(controller.welcomeUrl)
  if (options.selectDirectory) {
    welcomeUrl.searchParams.set('selectDirectory', '1')
  }
  await window.loadURL(welcomeUrl.toString())
  if (!window.isDestroyed()) {
    options.publishSnapshot(snapshot)
    window.show()
    window.focus()
  }
  return { switched: true, snapshot }
}

function isAbortedNavigation(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'code' in error
    && error.code === 'ERR_ABORTED'
  )
}
