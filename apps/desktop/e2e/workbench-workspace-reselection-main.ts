import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { registerWorkbenchRemoteAccessIpc } from '../src/main/workbenchRemoteIpc'
import type {
  WorkbenchWorkspaceController,
  WorkbenchWorkspaceSnapshot
} from '../src/shared/workbenchWorkspace'

const repositoryRoot = requiredEnvironment('UNILAB_E2E_REPOSITORY_ROOT')
const preloadPath = requiredEnvironment('UNILAB_E2E_PRELOAD_PATH')
const workspacePath = join(repositoryRoot, 'apps', 'desktop', 'resources', 'default-workspace')
const welcomeUrl = pathToFileURL(join(
  repositoryRoot,
  'apps',
  'workbench',
  'desktop',
  'welcome.html'
)).toString()
const readyUrl = `data:text/html,${encodeURIComponent(
  '<!doctype html><html><body data-workspace-state="ready">READY</body></html>'
)}`

let phase: WorkbenchWorkspaceSnapshot['phase'] = 'ready'
let activationCount = 0
const invocationDocuments: string[] = []

app.disableHardwareAcceleration()

const snapshot = (): WorkbenchWorkspaceSnapshot => ({
  phase,
  activeWorkspace: phase === 'ready' ? workspacePath : null,
  recentWorkspaces: [],
  error: null
})

const controller: WorkbenchWorkspaceController = {
  welcomeUrl,
  getSnapshot: snapshot,
  chooseAndOpen: async () => {
    activationCount += 1
    phase = 'starting'
    await new Promise(resolve => setTimeout(resolve, 25))
    phase = 'ready'
    return { rendererUrl: readyUrl, snapshot: snapshot() }
  },
  openRecent: async () => null,
  openExplicit: async () => null,
  deactivate: async () => {
    phase = 'stopping'
    await new Promise(resolve => setTimeout(resolve, 25))
    phase = 'welcome'
    return snapshot()
  },
  isNavigationAllowed: () => true
}

void main().catch((error: unknown) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error))
})

async function main(): Promise<void> {
  globalThis.__unilabWorkbenchWorkspaceController = controller
  await app.whenReady()

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false
    }
  })

  registerWorkbenchRemoteAccessIpc({
    observability: {
      run: async (_name, _attributes, operation) => operation()
    },
    assertSender: (event) => {
      invocationDocuments.push(event.senderFrame.url)
    },
    getMainWindow: () => window
  })

  const timeout = setTimeout(() => {
    fail('再次选择同一工作区后没有在 5 秒内进入 ready 页面')
  }, 5_000)

  window.webContents.on('did-finish-load', () => {
    if (window.webContents.getURL() !== readyUrl) return
    clearTimeout(timeout)
    const selectingWelcomeInvocations = invocationDocuments.filter(url => {
      if (!url.startsWith(welcomeUrl)) return false
      return new URL(url).searchParams.get('selectDirectory') === '1'
    })
    if (activationCount !== 1) {
      fail(`工作区启动次数应为 1，实际为 ${activationCount}`)
      return
    }
    if (selectingWelcomeInvocations.length !== 1) {
      fail([
        '目录选择必须由切换后仍存活的 welcome renderer 发起',
        `实际 IPC 来源：${JSON.stringify(invocationDocuments)}`
      ].join('\n'))
      return
    }
    process.stdout.write('WORKBENCH_WORKSPACE_RESELECTION_E2E_OK\n')
    app.exit(0)
  })

  await window.loadURL(`data:text/html,${encodeURIComponent(
    '<!doctype html><html><body data-workspace-state="ready">CURRENT</body></html>'
  )}`)
  void window.webContents.executeJavaScript(
    'window.api.workbenchWorkspace.selectDirectory()'
  )
}

function fail(message: string): void {
  process.stderr.write(`${message}\n`)
  app.exit(1)
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少测试环境变量 ${name}`)
  return value
}
