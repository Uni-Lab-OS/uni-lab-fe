import { spawn } from 'node:child_process'
import { appendFileSync, createWriteStream, mkdirSync } from 'node:fs'
import {
  access,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import net from 'node:net'
import { promises as originalFsPromises } from 'original-fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, dialog } from 'electron'

import {
  createWorkbenchRendererUrl,
  discoverWorkbenchOsProject,
  discoverWorkbenchPythonEnvironment,
  resolveWorkbenchLaunchConfiguration,
  workbenchEnvironmentPathEntries
} from '../scripts/workbench-launch.mjs'
import { createRemoteWorkbenchController } from '../scripts/remote-controller.mjs'
import {
  normalizeWorkbenchLaunchConfig,
  recentWorkspaceForPath,
  recordRecentWorkspace
} from '../scripts/workspace-recents.mjs'

const STARTUP_TIMEOUT_MS = 60_000
const BACKEND_STOP_TIMEOUT_MS = 5_000
const DEFAULT_WORKBENCH_LOCALE = 'zh-CN'

// Keep Chromium, embedded web surfaces and extension hosts aligned with the
// product default. Theia still owns the user's explicit display-language
// choice, while Agent language is persisted per Workspace.
if (!app.commandLine.hasSwitch('lang')) {
  app.commandLine.appendSwitch('lang', DEFAULT_WORKBENCH_LOCALE)
}

let backendProcess
let remoteAccessController

const isolatedUserData = process.env['UNILAB_WORKBENCH_USER_DATA']?.trim()
if (isolatedUserData) app.setPath('userData', path.resolve(isolatedUserData))

void startPackagedWorkbench().catch(async error => {
  await stopBackendProcess(backendProcess)
  const message = error instanceof Error ? error.message : String(error)
  const diagnostic = error instanceof Error ? error.stack ?? message : message
  await app.whenReady()
  try {
    const diagnosticDirectory = app.getPath('userData')
    mkdirSync(diagnosticDirectory, { recursive: true })
    appendFileSync(
      path.join(diagnosticDirectory, 'workbench-launcher-error.log'),
      `[${new Date().toISOString()}] ${diagnostic}\n`
    )
  } catch {
    // The native error dialog remains available if diagnostic persistence fails.
  }
  console.error(diagnostic)
  dialog.showErrorBox('UniLab Workbench 无法启动', message)
  app.exit(1)
})

async function startPackagedWorkbench() {
  await app.whenReady()
  const argumentsAfterExecutable = process.argv.slice(app.isPackaged ? 1 : 2)
  const parsed = resolveWorkbenchLaunchConfiguration(
    argumentsAfterExecutable,
    process.env,
    process.cwd()
  )
  const configPath = path.join(app.getPath('userData'), 'workbench-launch.json')
  const persisted = await readPersistedConfiguration(configPath)
  const hasExplicitWorkspace = argumentsAfterExecutable.includes('--workspace')
    || Boolean(process.env['THEIA_WORKSPACE']?.trim())
  const hasExplicitEnvironment = argumentsAfterExecutable.includes('--python-env')
    || Boolean(process.env['UNILAB_PYTHON_ENV']?.trim())
  const resources = resolvePackagedResources()
  await Promise.all([
    access(resources.backendMain),
    access(resources.desktopMain),
    access(resources.plugins),
    access(resources.nodeBinary),
    access(resources.welcomePage),
    // Electron treats any `.asar` path as a virtual archive path. Checking the
    // archive file itself through the patched fs therefore returns ENOENT even
    // when the physical package exists; original-fs bypasses that interception.
    originalFsPromises.access(resources.agentAsar),
    access(resources.agentCore),
    access(resources.workspaceSkills)
  ])
  if (process.env['UNILAB_WORKBENCH_PACKAGE_SMOKE'] === '1') {
    console.log('UNILAB_WORKBENCH_PACKAGE_SMOKE_OK')
    app.exit(0)
    return
  }
  const welcomeUrl = pathToFileURL(resources.welcomePage).toString()
  const workspaceController = createPackagedWorkspaceController({
    parsed,
    configPath,
    persisted,
    resources,
    welcomeUrl,
    explicitEnvironment: hasExplicitEnvironment
      ? parsed.pythonEnvironment
      : null,
    explicitOsProject: parsed.osProject
  })
  globalThis.__unilabWorkbenchWorkspaceController = workspaceController

  process.env['UNILAB_DESKTOP_SURFACE'] = 'workbench'
  process.env['UNILAB_DESKTOP_WELCOME_URL'] = welcomeUrl
  process.env['UNILAB_AGENT_ICON'] = resources.brandIcon
  process.env['UNILAB_AIONUI_APP'] = resources.agentRuntime
  process.env['UNILAB_AIONUI_ASAR'] = resources.agentAsar
  process.env['UNILAB_AIONCORE_PATH'] = resources.agentCore
  process.env['UNILAB_AGENT_NODE_BINARY'] = resources.nodeBinary
  process.env['UNILAB_WORKBENCH_SKILLS'] = resources.workspaceSkills
  process.env['ESBUILD_BINARY_PATH'] = resources.esbuildBinary
  if (hasExplicitWorkspace) {
    try {
      const activation = await workspaceController.openExplicit(
        parsed.workspace
      )
      process.env['UNILAB_DESKTOP_RENDERER_URL'] = activation.rendererUrl
    } catch {
      process.env['UNILAB_DESKTOP_RENDERER_URL'] = welcomeUrl
    }
  } else {
    delete process.env['THEIA_WORKSPACE']
    delete process.env['UNILAB_PYTHON_ENV']
    delete process.env['UNILAB_OS_PROJECT']
    process.env['UNILAB_DESKTOP_RENDERER_URL'] = welcomeUrl
  }

  await import(pathToFileURL(resources.desktopMain).href)
}

function resolvePackagedResources() {
  if (!app.isPackaged) {
    const workbench = app.getAppPath()
    const repositoryRoot = path.resolve(workbench, '..', '..')
    const agentRuntime = process.env['UNILAB_AIONUI_APP']
      ?? '/Applications/AionUi.app'
    const agentResources = agentRuntime.endsWith('.app')
      ? path.join(agentRuntime, 'Contents', 'Resources')
      : agentRuntime
    const agentTarget = resolveAgentCoreTarget()
    return {
      workbench,
      backendMain: path.join(workbench, 'lib', 'backend', 'main.js'),
      plugins: path.join(workbench, 'plugins'),
      desktopMain: path.join(
        repositoryRoot,
        'apps',
        'desktop',
        'out',
        'main',
        'index.js'
      ),
      welcomePage: path.join(workbench, 'desktop', 'welcome.html'),
      nodeBinary: process.env['UNILAB_NODE']
        ?? process.env['npm_node_execpath']
        ?? process.execPath,
      esbuildBinary: process.env['ESBUILD_BINARY_PATH']
        ?? path.join(repositoryRoot, 'node_modules', '.bin', 'esbuild'),
      brandIcon: path.join(
        repositoryRoot,
        'apps',
        'desktop',
        'build',
        'icon.png'
      ),
      agentRuntime,
      workspaceSkills: process.env['UNILAB_WORKBENCH_SKILLS']
        ?? path.join(workbench, 'resources', 'workspace-skills'),
      agentAsar: path.join(agentResources, 'app.asar'),
      agentCore: path.join(
        agentResources,
        'bundled-aioncore',
        agentTarget.directory,
        agentTarget.executable
      )
    }
  }
  const root = process.resourcesPath
  const workbench = path.join(root, 'workbench')
  // These short packaged names keep the bundled Node/npm tree below the
  // MAX_PATH limit used by NSIS file operations on Windows.
  const agentRuntime = path.join(root, 'a')
  const agentTarget = resolveAgentCoreTarget()
  return {
    workbench,
    backendMain: path.join(workbench, 'lib', 'backend', 'main.js'),
    plugins: path.join(workbench, 'plugins'),
    desktopMain: path.join(root, 'desktop', 'out', 'main', 'index.js'),
    welcomePage: path.join(app.getAppPath(), 'desktop', 'welcome.html'),
    nodeBinary: path.join(
      root,
      'node-runtime',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node'
    ),
    esbuildBinary: path.join(
      root,
      'device-card-builder',
      process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'
    ),
    brandIcon: path.join(root, 'branding', 'icon.png'),
    agentRuntime,
    workspaceSkills: path.join(root, 'workspace-skills'),
    agentAsar: path.join(agentRuntime, 'app.asar'),
    agentCore: path.join(
      agentRuntime,
      'c',
      agentTarget.directory,
      agentTarget.executable
    )
  }
}

function resolveAgentCoreTarget() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  return {
    directory: `${platform}-${process.arch}`,
    executable: process.platform === 'win32' ? 'aioncore.exe' : 'aioncore'
  }
}

function createPackagedWorkspaceController(options) {
  let config = options.persisted
  let phase = 'welcome'
  let activeWorkspace = null
  let activeRendererUrl = null
  let failure = null
  let operation = Promise.resolve()

  const controller = Object.freeze({
    welcomeUrl: options.welcomeUrl,
    getSnapshot,
    chooseAndOpen: kind => exclusively(() => chooseAndOpen(kind)),
    openRecent: workspacePath => exclusively(() => openRecent(workspacePath)),
    openExplicit: workspacePath => exclusively(() => activateWorkspace(
      workspacePath,
      {
        pythonEnvironment: options.explicitEnvironment,
        osProject: options.explicitOsProject
      }
    )),
    deactivate: error => exclusively(() => deactivate(error)),
    isNavigationAllowed
  })
  return controller

  function getSnapshot() {
    return {
      phase,
      activeWorkspace,
      recentWorkspaces: config.recentWorkspaces.map(entry => ({
        path: entry.path,
        name: path.basename(entry.path),
        lastOpenedAt: entry.lastOpenedAt
      })),
      error: failure
    }
  }

  function exclusively(task) {
    const next = operation.then(task, task)
    operation = next.then(() => undefined, () => undefined)
    return next
  }

  async function chooseAndOpen(kind) {
    const selection = await dialog.showOpenDialog({
      title: kind === 'create' ? '新建 UniLab 工作区' : '打开 UniLab 工作区',
      buttonLabel: kind === 'create' ? '创建并打开' : '打开',
      properties: kind === 'create'
        ? ['openDirectory', 'createDirectory', 'promptToCreate']
        : ['openDirectory', 'createDirectory']
    })
    if (selection.canceled || selection.filePaths.length !== 1) return null
    return activateWorkspace(selection.filePaths[0])
  }

  async function openRecent(workspacePath) {
    const recent = recentWorkspaceForPath(config, workspacePath)
    if (!recent) throw failWorkspaceStart('最近工作区记录不存在或已失效。')
    return activateWorkspace(recent.path)
  }

  async function activateWorkspace(workspaceCandidate, explicit = {}) {
    if (backendProcess) {
      throw failWorkspaceStart('请先返回欢迎页，再打开另一个工作区。')
    }
    phase = 'starting'
    failure = null
    let child = null
    let logStream = null
    let candidateRemoteController = null
    try {
      const workspace = await validDirectory(workspaceCandidate)
      if (!workspace) throw new Error('所选工作区不存在或不可访问。')
      const recent = recentWorkspaceForPath(config, workspace)
      const pythonEnvironment = await selectPythonEnvironment({
        explicit: explicit.pythonEnvironment ?? options.explicitEnvironment ?? null,
        persisted: recent?.pythonEnvironment ?? null
      })
      const osProject = await discoverWorkbenchOsProject({
        selected: explicit.osProject ?? options.explicitOsProject ?? null,
        pythonEnvironment
      })
      const port = await findAvailableLoopbackPort(options.parsed.port)
      const logDirectory = path.join(workspace, '.unilabos', 'logs')
      await mkdir(logDirectory, { recursive: true })
      logStream = createWriteStream(
        path.join(logDirectory, 'workbench-desktop-launcher.log'),
        { flags: 'a' }
      )
      logStream.write([
        `\n[${new Date().toISOString()}] launch port=${port}`,
        ` workspace=${workspace}`,
        ` python=${pythonEnvironment}`,
        ` osProject=${osProject ?? 'installed-environment'}`,
        '\n'
      ].join(''))
      const childEnvironment = workspaceChildEnvironment({
        workspace,
        pythonEnvironment,
        osProject,
        resources: options.resources
      })
      child = spawn(options.resources.nodeBinary, [
        options.resources.backendMain,
        workspace,
        '--hostname=127.0.0.1',
        '--port',
        String(port),
        `--plugins=local-dir:${options.resources.plugins}`
      ], {
        cwd: options.resources.workbench,
        env: childEnvironment,
        detached: process.platform !== 'win32',
        shell: false,
        windowsHide: true
      })
      backendProcess = child
      globalThis.__unilabWorkbenchBackendProcess = child
      child.stdout.pipe(logStream, { end: false })
      child.stderr.pipe(logStream, { end: false })
      child.once('close', (code, signal) => {
        logStream.end(
          `[${new Date().toISOString()}] backend exit code=${String(code)} signal=${String(signal)}\n`
        )
        if (backendProcess !== child) return
        backendProcess = undefined
        globalThis.__unilabWorkbenchBackendProcess = undefined
        void remoteAccessController?.close().catch(() => undefined)
        remoteAccessController = undefined
        globalThis.__unilabWorkbenchRemoteAccessController = undefined
        activeWorkspace = null
        activeRendererUrl = null
        phase = 'failed'
        failure = `Theia Backend 已退出（code=${String(code)}, signal=${String(signal)}）。`
        const window = BrowserWindow.getAllWindows()[0]
        if (window && !window.isDestroyed()) {
          void window.loadURL(options.welcomeUrl).catch(() => undefined)
        }
      })
      const rendererUrl = createWorkbenchRendererUrl({
        port,
        workspace,
        workflowUuid: options.parsed.workflowUuid
      })
      await waitForWorkbench(rendererUrl, child, STARTUP_TIMEOUT_MS)
      candidateRemoteController = createPackagedRemoteController({
        port,
        workspace,
        rendererUrl,
        logStream,
        parsed: options.parsed
      })
      if (remoteAutostartEnabled(options.parsed)) {
        await candidateRemoteController.start()
      }
      const nextConfig = recordRecentWorkspace(config, {
        path: workspace,
        pythonEnvironment,
        osProject,
        lastOpenedAt: new Date().toISOString()
      })
      await writePersistedConfiguration(options.configPath, nextConfig)
      config = nextConfig
      remoteAccessController = candidateRemoteController
      globalThis.__unilabWorkbenchRemoteAccessController = remoteAccessController
      activeWorkspace = workspace
      activeRendererUrl = rendererUrl
      phase = 'ready'
      applyActiveWorkspaceEnvironment({ workspace, pythonEnvironment, osProject })
      return { rendererUrl, snapshot: getSnapshot() }
    } catch (error) {
      await candidateRemoteController?.close().catch(() => undefined)
      if (backendProcess === child) {
        backendProcess = undefined
        globalThis.__unilabWorkbenchBackendProcess = undefined
      }
      await stopBackendProcess(child)
      logStream?.end()
      throw failWorkspaceStart(
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  async function deactivate(error = null) {
    phase = 'stopping'
    failure = null
    const child = backendProcess
    const controllerToClose = remoteAccessController
    backendProcess = undefined
    remoteAccessController = undefined
    globalThis.__unilabWorkbenchBackendProcess = undefined
    globalThis.__unilabWorkbenchRemoteAccessController = undefined
    await controllerToClose?.close().catch(() => undefined)
    await stopBackendProcess(child)
    activeWorkspace = null
    activeRendererUrl = null
    delete process.env['THEIA_WORKSPACE']
    delete process.env['UNILAB_PYTHON_ENV']
    delete process.env['UNILAB_OS_PROJECT']
    phase = error ? 'failed' : 'welcome'
    failure = error
    return getSnapshot()
  }

  function failWorkspaceStart(message) {
    activeWorkspace = null
    activeRendererUrl = null
    phase = 'failed'
    failure = message
    return new Error(message)
  }

  function isNavigationAllowed(targetUrl) {
    try {
      const target = new URL(targetUrl)
      const welcome = new URL(options.welcomeUrl)
      if (target.protocol === 'file:' && target.pathname === welcome.pathname) {
        return !target.hash && (
          !target.search || target.searchParams.get('switching') === '1'
        )
      }
      return Boolean(
        activeRendererUrl
        && target.origin === new URL(activeRendererUrl).origin
      )
    } catch {
      return false
    }
  }
}

function workspaceChildEnvironment({
  workspace,
  pythonEnvironment,
  osProject,
  resources
}) {
  const environment = {
    ...process.env,
    CONDA_PREFIX: pythonEnvironment,
    CONDA_DEFAULT_ENV: path.basename(pythonEnvironment),
    PATH: [
      ...workbenchEnvironmentPathEntries(pythonEnvironment),
      process.env.PATH
    ].filter(Boolean).join(path.delimiter),
    PYTHONPATH: [
      osProject,
      workspace,
      process.env.PYTHONPATH
    ].filter(Boolean).join(path.delimiter),
    THEIA_WORKSPACE: workspace,
    UNILAB_PYTHON_ENV: pythonEnvironment,
    UNILAB_DESKTOP_SURFACE: 'workbench',
    UNILAB_AGENT_ICON: resources.brandIcon,
    UNILAB_AIONUI_APP: resources.agentRuntime,
    UNILAB_AIONUI_ASAR: resources.agentAsar,
    UNILAB_AIONCORE_PATH: resources.agentCore,
    UNILAB_WORKBENCH_SKILLS: resources.workspaceSkills
  }
  if (osProject) environment.UNILAB_OS_PROJECT = osProject
  else delete environment.UNILAB_OS_PROJECT
  return environment
}

function createPackagedRemoteController({
  port,
  workspace,
  rendererUrl,
  logStream,
  parsed
}) {
  const remoteLaunch = resolveWorkbenchLaunchConfiguration(
    ['--remote', '--port', String(port)],
    process.env,
    process.cwd()
  )
  const remoteConfiguration = {
    ...remoteLaunch.remote,
    ...(parsed.remote ?? {}),
    port: parsed.remote?.port === parsed.port + 1
      ? port + 1
      : parsed.remote?.port ?? remoteLaunch.remote.port,
    accessUrlFile: parsed.remote?.accessUrlFile
      ?? remoteLaunch.remote.accessUrlFile
      ?? path.join(
        app.getPath('userData'),
        'runtime',
        'remote-access.url'
      )
  }
  return createRemoteWorkbenchController({
    backendPort: port,
    workspacePath: workspace,
    rendererUrl,
    configuration: remoteConfiguration,
    log: message => logStream.write(
      `[${new Date().toISOString()}] ${message}\n`
    )
  })
}

function remoteAutostartEnabled(parsed) {
  return parsed.mode === 'remote'
    || parsed.mode === 'desktop-remote'
    || process.env['UNILAB_REMOTE_AUTOSTART'] === '1'
}

function applyActiveWorkspaceEnvironment({
  workspace,
  pythonEnvironment,
  osProject
}) {
  process.env['THEIA_WORKSPACE'] = workspace
  process.env['UNILAB_PYTHON_ENV'] = pythonEnvironment
  if (osProject) process.env['UNILAB_OS_PROJECT'] = osProject
  else delete process.env['UNILAB_OS_PROJECT']
}

async function selectPythonEnvironment({ explicit, persisted }) {
  if (explicit) {
    return discoverWorkbenchPythonEnvironment({ selected: explicit })
  }
  // A bundled Runtime is immutable and identified by the current DMG's
  // manifest digest. Prefer it to a recent Workspace's persisted path so an
  // application upgrade cannot keep launching PLC-Sim with an older Python.
  const managed = process.env['UNILAB_MANAGED_RUNTIME_PREFIX']?.trim()
  if (managed) {
    try {
      return await discoverWorkbenchPythonEnvironment({ selected: managed })
    } catch {
      // A damaged managed prefix is surfaced by the installer controller.
    }
  }
  if (persisted) {
    try {
      return await discoverWorkbenchPythonEnvironment({ selected: persisted })
    } catch {
      // The environment may have been replaced since the previous launch.
    }
  }
  return discoverWorkbenchPythonEnvironment({ selected: null })
}

async function validDirectory(candidate) {
  if (!candidate || typeof candidate !== 'string') return null
  try {
    const resolved = await realpath(candidate)
    return (await stat(resolved)).isDirectory() ? resolved : null
  } catch {
    return null
  }
}

async function readPersistedConfiguration(configPath) {
  try {
    return normalizeWorkbenchLaunchConfig(
      JSON.parse(await readFile(configPath, 'utf8'))
    )
  } catch {
    return normalizeWorkbenchLaunchConfig(null)
  }
}

async function writePersistedConfiguration(configPath, value) {
  await mkdir(path.dirname(configPath), { recursive: true })
  const temporaryPath = `${configPath}.${process.pid}.tmp`
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  await writeFile(temporaryPath, serialized, {
    mode: 0o600
  })
  try {
    await rename(temporaryPath, configPath)
  } catch (error) {
    if (
      process.platform !== 'win32'
      || !error
      || typeof error !== 'object'
      || !['EEXIST', 'EPERM'].includes(error.code)
    ) {
      throw error
    }
    await writeFile(configPath, serialized, { mode: 0o600 })
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function findAvailableLoopbackPort(preferredPort) {
  for (let port = preferredPort; port <= Math.min(preferredPort + 20, 65_535); port += 1) {
    if (await canBindLoopback(port)) return port
  }
  throw new Error(`端口 ${preferredPort}-${preferredPort + 20} 均不可用。`)
}

function canBindLoopback(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true))
    })
  })
}

async function waitForWorkbench(rendererUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = '尚未响应'
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Theia backend 提前退出，退出码 ${child.exitCode}。`)
    }
    try {
      const response = await fetch(rendererUrl, { redirect: 'manual' })
      if (response.ok || response.status === 302) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(250)
  }
  throw new Error(`Theia backend 在 ${timeoutMs / 1000} 秒内未就绪：${lastError}`)
}

async function stopBackendProcess(child) {
  if (!child?.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    await stopWindowsProcessTree(child.pid, false)
    await Promise.race([
      new Promise(resolve => child.once('close', resolve)),
      delay(BACKEND_STOP_TIMEOUT_MS)
    ])
    if (child.exitCode === null) await stopWindowsProcessTree(child.pid, true)
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  await Promise.race([
    new Promise(resolve => child.once('close', resolve)),
    delay(BACKEND_STOP_TIMEOUT_MS)
  ])
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

function stopWindowsProcessTree(pid, force) {
  return new Promise(resolve => {
    const args = ['/PID', String(pid), '/T']
    if (force) args.push('/F')
    const killer = spawn('taskkill.exe', args, {
      windowsHide: true,
      shell: false,
      stdio: 'ignore'
    })
    killer.once('error', () => resolve())
    killer.once('close', () => resolve())
  })
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
