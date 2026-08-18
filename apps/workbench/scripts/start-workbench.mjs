import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import {
  createWorkbenchRendererUrl,
  discoverWorkbenchOsProject,
  discoverWorkbenchPythonEnvironment,
  isolateWorkbenchBackendProcessGroup,
  resolveWorkbenchLaunchConfiguration,
  workbenchEnvironmentPathEntries
} from './workbench-launch.mjs'
import { createRemoteWorkbenchController } from './remote-controller.mjs'
import { stopManagedSessionProcesses } from './managed-session-cleanup.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDirectory, '../../..')
const desktopRoot = path.join(workspaceRoot, 'apps', 'desktop')
const theiaBackend = path.join(
  workspaceRoot,
  'apps',
  'workbench',
  'lib',
  'backend',
  'main.js'
)
const launch = resolveWorkbenchLaunchConfiguration(process.argv.slice(2))
const launchMode = launch.mode
const desktopEnabled = launchMode === 'desktop' || launchMode === 'desktop-remote'
const remoteEnabled = launchMode === 'remote' || launchMode === 'desktop-remote'
const workspace = launch.workspace
const port = launch.port
const remoteConfiguration = launch.remote ?? (
  desktopEnabled
    ? resolveWorkbenchLaunchConfiguration(
        ['--remote', '--port', String(port)],
        process.env,
        process.cwd()
      ).remote
    : null
)

if (launchMode === 'remote' && launch.remote.authenticationRequired
  && !launch.remote.accessUrlFile
  && !process.stdout.isTTY) {
  throw new Error(
    'Headless remote Workbench requires --access-url-file for secret delivery'
  )
}
if (remoteConfiguration?.accessUrlFile
  && pathInside(workspace, remoteConfiguration.accessUrlFile)) {
  throw new Error('Remote access URL file must be outside the Workspace')
}

if (!existsSync(workspace)) {
  throw new Error(`Workspace does not exist: ${workspace}`)
}
const pythonEnvironment = await discoverWorkbenchPythonEnvironment({
  selected: launch.pythonEnvironment
})
const osProject = await discoverWorkbenchOsProject({
  selected: launch.osProject,
  pythonEnvironment
})

console.log(`[UniLab Workbench] workspace: ${workspace}`)
console.log(`[UniLab Workbench] OS runtime: ${osProject
  ? path.resolve(osProject)
  : 'selected Python environment'}`)
console.log('[UniLab Workbench] OS lifecycle: managed-local')
console.log(`[UniLab Workbench] shell: ${launchMode}`)
console.log(`[UniLab Workbench] Python environment: ${pythonEnvironment}`)

const activatedEnvironment = {
  ...process.env,
  CONDA_PREFIX: pythonEnvironment,
  CONDA_DEFAULT_ENV: path.basename(pythonEnvironment),
  PATH: [
    ...workbenchEnvironmentPathEntries(pythonEnvironment),
    process.env.PATH
  ].filter(Boolean).join(path.delimiter),
  PYTHONPATH: [
    osProject ? path.resolve(osProject) : null,
    workspace,
    process.env.PYTHONPATH
  ].filter(Boolean).join(path.delimiter),
  UNILAB_WORKBENCH_SKILLS: process.env.UNILAB_WORKBENCH_SKILLS ??
    path.join(
      workspaceRoot,
      'apps',
      'workbench',
      'resources',
      'workspace-skills'
    ),
  UNILAB_AGENT_ICON: process.env.UNILAB_AGENT_ICON ??
    path.join(desktopRoot, 'build', 'icon.png')
}

// Interactive zsh reads the user's startup files after inheriting this process'
// environment. A common `conda init` setup auto-activates `base` there, which
// would make the terminal disagree with Pyright and the managed OS process.
// Source the user's normal rc first, then re-activate the Workbench environment.
if (process.platform !== 'win32' && process.env.SHELL?.endsWith('/zsh')) {
  const shellRuntime = path.join(
    workspace,
    '.unilabos',
    'runtime',
    'workbench',
    'terminal',
    'zsh'
  )
  const originalZdotdir = process.env.ZDOTDIR ?? os.homedir()
  mkdirSync(shellRuntime, { recursive: true })
  writeFileSync(
    path.join(shellRuntime, '.zshrc'),
    [
      'if [[ -r "${UNILAB_ORIGINAL_ZDOTDIR}/.zshrc" ]]; then',
      '  source "${UNILAB_ORIGINAL_ZDOTDIR}/.zshrc"',
      'fi',
      'if (( ${+functions[conda]} )); then',
      '  conda activate "${UNILAB_PYTHON_ENV}"',
      'else',
      '  export PATH="${UNILAB_PYTHON_ENV}/bin:${PATH}"',
      '  export CONDA_PREFIX="${UNILAB_PYTHON_ENV}"',
      '  export CONDA_DEFAULT_ENV="${UNILAB_PYTHON_ENV:t}"',
      '  rehash',
      'fi',
      ''
    ].join('\n'),
    { mode: 0o600 }
  )
  Object.assign(activatedEnvironment, {
    ZDOTDIR: shellRuntime,
    UNILAB_ORIGINAL_ZDOTDIR: originalZdotdir,
    UNILAB_PYTHON_ENV: pythonEnvironment
  })
}

const theia = spawn(process.execPath, [
  theiaBackend,
  workspace,
  '--hostname',
  '127.0.0.1',
  '--port',
  String(port),
  '--plugins=local-dir:plugins'
], {
  stdio: 'inherit',
  detached: isolateWorkbenchBackendProcessGroup(),
  env: {
    ...activatedEnvironment,
    THEIA_WORKSPACE: workspace,
    UNILAB_WORKBENCH_RENDERER_URL: `http://127.0.0.1:${port}`,
    UNILAB_WORKBENCH_LAUNCHER_PID: String(process.pid),
    ...(osProject ? { UNILAB_OS_PROJECT: path.resolve(osProject) } : {}),
    UNILAB_PYTHON_ENV: pythonEnvironment
  }
})

const rendererUrl = createWorkbenchRendererUrl({
  port,
  workspace,
  workflowUuid: launch.workflowUuid
})
let stopping = false
let shutdownPromise = null
let desktopShell = null
let remoteController = remoteConfiguration
  ? createRemoteWorkbenchController({
      backendPort: port,
      workspacePath: workspace,
      rendererUrl,
      configuration: remoteConfiguration,
      log: message => console.log(`[UniLab Workbench] ${message}`)
    })
  : null
const stop = signal => {
  if (shutdownPromise) return shutdownPromise
  stopping = true
  shutdownPromise = (async () => {
    await closeRemoteAccess()
    await stopManagedSessionProcesses({
      workspacePath: workspace,
      launcherPid: process.pid
    })
    if (desktopShell && !desktopShell.killed) desktopShell.kill(signal)
    if (!theia.killed) theia.kill(signal)
  })()
  return shutdownPromise
}
process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
theia.once('exit', (code, signal) => {
  console.error(
    `[UniLab Workbench] Theia exited code=${code ?? 'null'} signal=${signal ?? 'null'}`
  )
  const finalize = async () => {
    await closeRemoteAccess()
    await stopManagedSessionProcesses({
      workspacePath: workspace,
      launcherPid: process.pid
    })
    if (!stopping) {
      stopping = true
      if (desktopShell && !desktopShell.killed) desktopShell.kill('SIGTERM')
    }
  }
  if (!shutdownPromise) {
    shutdownPromise = finalize()
  }
  if (process.exitCode === undefined) {
    process.exitCode = signal ? 1 : code ?? 0
  }
})

if (desktopEnabled) {
  void launchDesktop(rendererUrl).catch(error => {
    console.error(
      `[UniLab Workbench] desktop launch failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    process.exitCode = 1
    stop('SIGTERM')
  })
}
if (remoteEnabled) {
  void launchRemote(rendererUrl).catch(error => {
    console.error(
      `[UniLab Workbench] remote launch failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    process.exitCode = 1
    stop('SIGTERM')
  })
}

async function launchDesktop(rendererUrl) {
  await waitForWorkbench(rendererUrl)
  const desktopRequire = createRequire(path.join(desktopRoot, 'package.json'))
  const electronExecutable = desktopRequire('electron')
  const desktopEnvironment = {
    ...activatedEnvironment,
    UNILAB_DESKTOP_SURFACE: 'workbench',
    UNILAB_DESKTOP_RENDERER_URL: rendererUrl,
    UNILAB_DESKTOP_OPEN_DEVTOOLS:
      process.env.UNILAB_DESKTOP_OPEN_DEVTOOLS ?? '0',
    ...(remoteController
      ? { UNILAB_WORKBENCH_REMOTE_PARENT_IPC: '1' }
      : {})
  }
  delete desktopEnvironment.ELECTRON_RUN_AS_NODE
  console.log(`[UniLab Workbench] desktop renderer: ${rendererUrl}`)
  const electronArguments = []
  const remoteDebuggingPort = process.env.UNILAB_DESKTOP_REMOTE_DEBUGGING_PORT
  if (remoteDebuggingPort) {
    electronArguments.push(`--remote-debugging-port=${remoteDebuggingPort}`)
  }
  electronArguments.push(desktopRoot)
  desktopShell = spawn(electronExecutable, electronArguments, {
    cwd: desktopRoot,
    env: desktopEnvironment,
    stdio: remoteController
      ? ['inherit', 'inherit', 'inherit', 'ipc']
      : 'inherit'
  })
  if (remoteController) {
    desktopShell.on('message', message => {
      void handleDesktopRemoteRequest(message)
    })
  }
  desktopShell.once('error', error => {
    console.error(`[UniLab Workbench] Electron failed: ${error.message}`)
    process.exitCode = 1
    stop('SIGTERM')
  })
  desktopShell.once('exit', (code, signal) => {
    console.error(
      `[UniLab Workbench] Electron exited code=${code ?? 'null'} signal=${signal ?? 'null'}`
    )
    if (!stopping) {
      void stop('SIGTERM')
    }
    if (process.exitCode === undefined) {
      process.exitCode = signal ? 1 : code ?? 0
    }
  })
}

async function launchRemote(rendererUrl) {
  await waitForWorkbench(rendererUrl)
  if (!remoteController || !remoteConfiguration) {
    throw new Error('Remote Workbench controller is unavailable')
  }
  const snapshot = await remoteController.start()
  if (remoteConfiguration.accessUrlFile) {
    console.log(
      `[UniLab Workbench] remote access URL written to ${remoteConfiguration.accessUrlFile}`
    )
  } else if (desktopEnabled && remoteConfiguration.authenticationRequired) {
    console.log('[UniLab Workbench] remote access URL available in 环境管理')
  } else {
    process.stdout.write(
      `[UniLab Workbench] remote access URL${remoteConfiguration.authenticationRequired ? ' (secret)' : ''}: ${snapshot.accessUrl}\n`
    )
  }
  console.log(`[UniLab Workbench] remote origin: ${snapshot.origin}`)
}

async function handleDesktopRemoteRequest(message) {
  if (
    !message
    || typeof message !== 'object'
    || message.channel !== 'unilab-workbench-remote-request'
    || !Number.isSafeInteger(message.requestId)
    || !['getSnapshot', 'start', 'stop'].includes(message.operation)
    || !desktopShell?.connected
  ) return
  try {
    const snapshot = message.operation === 'getSnapshot'
      ? remoteController?.getSnapshot()
      : await remoteController?.[message.operation]()
    if (!snapshot) throw new Error('Remote Workbench controller is unavailable')
    desktopShell.send({
      channel: 'unilab-workbench-remote-response',
      requestId: message.requestId,
      ok: true,
      snapshot
    })
  } catch (error) {
    desktopShell.send({
      channel: 'unilab-workbench-remote-response',
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function closeRemoteAccess() {
  const controller = remoteController
  remoteController = null
  await controller?.close()
}

function pathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function waitForWorkbench(rendererUrl) {
  const deadline = Date.now() + 30_000
  const readinessUrl = new URL('/', rendererUrl)
  let lastError = 'not ready'
  while (Date.now() < deadline) {
    if (theia.exitCode !== null) {
      throw new Error(`Theia exited before readiness (${theia.exitCode})`)
    }
    try {
      const response = await fetch(readinessUrl, {
        signal: AbortSignal.timeout(1_000)
      })
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`Theia readiness timed out: ${lastError}`)
}
