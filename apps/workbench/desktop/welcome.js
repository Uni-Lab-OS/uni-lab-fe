const workspaceApi = window.api?.workbenchWorkspace
const runtimeApi = window.api?.managedRuntime
const entryForm = document.querySelector('#mode-entry-form')
const entryModeInputs = [...document.querySelectorAll('input[name="entry-mode"]')]
const enterButton = document.querySelector('#enter-workbench')
const openButton = document.querySelector('#open-workspace')
const createButton = document.querySelector('#create-workspace')
const workspaceSelect = document.querySelector('#workspace-select')
const workspacePathInput = document.querySelector('#workspace-path-input')
const openPathButton = document.querySelector('#open-workspace-path')
const workspacePath = document.querySelector('#workspace-path')
const recentCount = document.querySelector('#recent-count')
const serviceStatus = document.querySelector('#service-status')
const statusPanel = document.querySelector('#status-panel')
const statusTitle = document.querySelector('#status-title')
const statusDetail = document.querySelector('#status-detail')
const errorPanel = document.querySelector('#error-panel')
const errorMessage = document.querySelector('#error-message')
const runtimePanel = document.querySelector('#runtime-panel')
const runtimeIndicator = document.querySelector('#runtime-indicator')
const runtimeTitle = document.querySelector('#runtime-title')
const runtimeDetail = document.querySelector('#runtime-detail')
const runtimeProgress = document.querySelector('#runtime-progress')
const runtimeProgressBar = document.querySelector('#runtime-progress-bar')
const runtimeProgressLabel = document.querySelector('#runtime-progress-label')
const installRuntimeButton = document.querySelector('#install-runtime')
const chooseRuntimeButton = document.querySelector('#choose-runtime')
const openRuntimeLogButton = document.querySelector('#open-runtime-log')
const runtimeSelector = document.querySelector('#runtime-selector')
const runtimeSelectorLabel = document.querySelector('#runtime-selector-label')

let snapshot = {
  phase: 'welcome',
  activeWorkspace: null,
  recentWorkspaces: [],
  error: null
}
const bootstrapSearch = new URLSearchParams(location.search)
let switchingBootstrap = bootstrapSearch.get('switching') === '1'
let selectDirectoryBootstrap = bootstrapSearch.get('selectDirectory') === '1'
const entryModeBootstrap = bootstrapSearch.get('entryMode') === 'production'
  ? 'production'
  : 'debug'
let requestPending = switchingBootstrap || selectDirectoryBootstrap
let bootstrappedDirectorySelection = false
let runtimeRequestPending = false
let continueAfterRuntimeInstall = false
let runtimeProgressSample = null
let runtimeSnapshot = {
  phase: 'unavailable',
  bundled: false,
  delivery: null,
  managed: false,
  runtimeVersion: null,
  platform: null,
  environmentPath: null,
  availableEnvironments: [],
  error: null,
  previousRuntimeVersion: null,
  previousEnvironmentPath: null,
  errorCode: null,
  errorLogPath: null
}

if (entryModeBootstrap === 'production') {
  const productionInput = entryModeInputs.find(input => input.value === 'production')
  if (productionInput) productionInput.checked = true
  entryForm.dataset.mode = 'production'
  enterButton.textContent = '进入生产模式'
}

entryModeInputs.forEach(input => input.addEventListener('change', () => {
  entryForm.dataset.mode = selectedEntryMode()
  enterButton.textContent = selectedEntryMode() === 'production'
    ? '进入生产模式'
    : '进入调试模式'
}))

entryForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const selectedWorkspace = workspaceSelect.value
  const typedWorkspace = workspacePathInput.value.trim()
  void runOperation(
    () => typedWorkspace
      ? workspaceApi?.openPath(typedWorkspace, selectedEntryMode())
      : selectedWorkspace
      ? workspaceApi?.openRecent(selectedWorkspace, selectedEntryMode())
      : workspaceApi?.openDirectory(selectedEntryMode()),
    typedWorkspace || selectedWorkspace ? '正在打开工作区' : '正在选择工作区',
    '校验设备包目录并启动工作区服务…'
  )
})

workspaceSelect.addEventListener('change', () => {
  workspacePathInput.value = workspaceSelect.value
  renderSelectedWorkspacePath()
})

workspacePathInput.addEventListener('input', () => {
  workspaceSelect.value = ''
  renderSelectedWorkspacePath()
})

workspacePathInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  openTypedWorkspace()
})

runtimeSelector.addEventListener('change', () => {
  if (!runtimeApi || !runtimeSelector.value || runtimeRequestPending) return
  runtimeRequestPending = true
  render()
  void runtimeApi.selectEnvironment(runtimeSelector.value).then(next => {
    runtimeSnapshot = next
  }).catch(error => {
    runtimeSnapshot = { ...runtimeSnapshot, error: messageOf(error) }
  }).finally(() => {
    runtimeRequestPending = false
    render()
  })
})

chooseRuntimeButton.addEventListener('click', () => {
  if (!runtimeApi || runtimeRequestPending
    || runtimeSnapshot.phase === 'installing') return
  runtimeRequestPending = true
  render()
  void runtimeApi.chooseEnvironment().then(next => {
    runtimeSnapshot = next
  }).catch(error => {
    runtimeSnapshot = { ...runtimeSnapshot, error: messageOf(error) }
  }).finally(() => {
    runtimeRequestPending = false
    render()
  })
})

installRuntimeButton.addEventListener('click', () => {
  if (!runtimeApi || runtimeRequestPending
    || runtimeSnapshot.phase === 'installing') return
  runtimeRequestPending = true
  continueAfterRuntimeInstall = true
  render()
  void runtimeApi.install().then(next => {
    runtimeSnapshot = next
    if (continueAfterRuntimeInstall && next.phase === 'ready') {
      continueAfterRuntimeInstall = false
      render()
      continueIntoWorkspace()
      return
    }
  }).catch(error => {
    runtimeSnapshot = {
      ...runtimeSnapshot,
      phase: 'failed',
      error: messageOf(error)
    }
  }).finally(() => {
    runtimeRequestPending = false
    render()
  })
})

openRuntimeLogButton.addEventListener('click', () => {
  if (!runtimeApi || runtimeRequestPending || !runtimeSnapshot.errorLogPath) return
  runtimeRequestPending = true
  render()
  void runtimeApi.openDiagnosticLog().catch(error => {
    runtimeSnapshot = { ...runtimeSnapshot, error: messageOf(error) }
  }).finally(() => {
    runtimeRequestPending = false
    render()
  })
})

openButton.addEventListener('click', () => runOperation(
  () => workspaceApi?.openDirectory(selectedEntryMode()),
  '正在打开工作区',
  '校验目录并启动工作区服务…'
))

openPathButton.addEventListener('click', openTypedWorkspace)

createButton.addEventListener('click', () => runOperation(
  () => workspaceApi?.createDirectory(selectedEntryMode()),
  '正在创建工作区',
  '创建目录并准备工作台…'
))

if (!workspaceApi) {
  snapshot = {
    ...snapshot,
    phase: 'failed',
    error: '当前窗口没有桌面工作区权限。请从 UniLab Workbench 桌面应用打开。'
  }
  render()
} else {
  workspaceApi.onSnapshot(handleBootstrapSnapshot)
  workspaceApi.getSnapshot().then(handleBootstrapSnapshot).catch((error) => {
    requestPending = false
    snapshot = { ...snapshot, phase: 'failed', error: messageOf(error) }
    render()
  })
  render()
}

function handleBootstrapSnapshot(next) {
  snapshot = next
  if (switchingBootstrap || selectDirectoryBootstrap) {
    history.replaceState(null, '', location.pathname)
  }
  switchingBootstrap = false
  if (selectDirectoryBootstrap) {
    selectDirectoryBootstrap = false
    bootstrappedDirectorySelection = true
    requestPending = false
    void runOperation(
      () => workspaceApi?.openDirectory(entryModeBootstrap),
      '正在打开工作区',
      '校验目录、Python 环境与本地服务…'
    )
    return
  }
  if (bootstrappedDirectorySelection) {
    render()
    return
  }
  requestPending = false
  render()
}

if (runtimeApi) {
  runtimeApi.onSnapshot(next => {
    const wasInstalling = runtimeSnapshot.phase === 'installing'
    runtimeSnapshot = next
    render()
    if (continueAfterRuntimeInstall && wasInstalling && next.phase === 'ready') {
      continueAfterRuntimeInstall = false
      continueIntoWorkspace()
    }
  })
  runtimeApi.getSnapshot().then(next => {
    runtimeSnapshot = next
    render()
  }).catch(error => {
    runtimeSnapshot = {
      ...runtimeSnapshot,
      phase: 'failed',
      error: messageOf(error)
    }
    render()
  })
}

async function runOperation(operation, title, detail) {
  if (!workspaceApi || requestPending) return
  requestPending = true
  statusTitle.textContent = title
  statusDetail.textContent = detail
  render()
  try {
    const next = await operation()
    if (next) snapshot = next
  } catch (error) {
    snapshot = { ...snapshot, phase: 'failed', error: messageOf(error) }
  } finally {
    requestPending = false
    render()
  }
}

function render() {
  const busy = requestPending
    || snapshot.phase === 'starting'
    || snapshot.phase === 'stopping'
  const runtimeBlocked = runtimeRequestPending || (
    runtimeSnapshot.bundled && [
      'not-installed',
      'upgrade-required',
      'installing',
      'failed'
    ].includes(runtimeSnapshot.phase)
  )
  enterButton.disabled = busy || runtimeBlocked || !workspaceApi
  openButton.disabled = busy || runtimeBlocked || !workspaceApi
  openPathButton.disabled = busy || runtimeBlocked || !workspaceApi
  createButton.disabled = busy || runtimeBlocked || !workspaceApi
  workspaceSelect.disabled = busy || runtimeBlocked || !workspaceApi
  workspacePathInput.disabled = busy || runtimeBlocked || !workspaceApi
  statusPanel.hidden = !busy
  if (switchingBootstrap || snapshot.phase === 'stopping') {
    statusTitle.textContent = '正在切换工作区'
    statusDetail.textContent = '有界停止 OS、Agent、PLC-Sim 与 Theia 进程树…'
  }
  errorPanel.hidden = snapshot.phase !== 'failed' || !snapshot.error
  errorMessage.textContent = snapshot.error ?? ''
  serviceStatus.dataset.tone = snapshot.phase === 'failed'
    ? 'attention'
    : busy
      ? 'idle'
      : 'online'
  serviceStatus.lastChild.textContent = snapshot.phase === 'failed'
    ? ' SERVICE ATTENTION'
    : busy
      ? ' SERVICE STARTING'
      : ' WORKSPACE READY'
  renderRuntime()
  renderWorkspaceOptions(snapshot.recentWorkspaces)
}

function renderRuntime() {
  const downloadsRuntime = runtimeSnapshot.delivery === 'download'
  runtimePanel.hidden = runtimeSnapshot.phase === 'unavailable'
  runtimePanel.dataset.phase = runtimeSnapshot.phase
  runtimeIndicator.className = `runtime-panel__indicator is-${runtimeSnapshot.phase}`
  installRuntimeButton.hidden = !runtimeSnapshot.bundled
    || ![
      'not-installed',
      'upgrade-required',
      'failed'
    ].includes(runtimeSnapshot.phase)
  installRuntimeButton.textContent = runtimeSnapshot.phase === 'upgrade-required'
    ? `${downloadsRuntime ? '下载并升级到' : '升级到'} Runtime ${runtimeSnapshot.runtimeVersion ?? ''}`
    : downloadsRuntime ? '下载并安装 Runtime' : '安装内置 Runtime'
  installRuntimeButton.disabled = runtimeRequestPending
    || runtimeSnapshot.phase === 'installing'
  openRuntimeLogButton.hidden = !runtimeSnapshot.errorLogPath
  openRuntimeLogButton.disabled = runtimeRequestPending
  chooseRuntimeButton.disabled = runtimeRequestPending
    || runtimeSnapshot.phase === 'installing'
  const environments = runtimeSnapshot.availableEnvironments ?? []
  runtimeSelector.replaceChildren(...environments.map(environment => {
    const option = document.createElement('option')
    option.value = environment.path
    option.textContent = `${environment.label} — ${environment.path}`
    return option
  }))
  runtimeSelector.value = runtimeSnapshot.environmentPath ?? ''
  runtimeSelector.disabled = runtimeRequestPending
    || runtimeSnapshot.phase === 'installing'
  runtimeSelectorLabel.hidden = environments.length === 0
  // 先复位前一次安装留下的下载状态；只有 installing 分支会重新显示真实进度。
  // 否则安装后切换到已选择的本机环境时，旧的“准备下载”条会残留在 external 面板中。
  hideRuntimeProgress()
  if (runtimeSnapshot.phase === 'ready') {
    runtimeTitle.textContent = `内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''} 已就绪`
    runtimeDetail.textContent = runtimeSnapshot.error
      ? `${runtimeSnapshot.environmentPath ?? '应用私有环境'}；提示：${runtimeSnapshot.error}`
      : runtimeSnapshot.environmentPath ?? '应用私有环境'
    return
  }
  if (runtimeSnapshot.phase === 'external') {
    runtimeTitle.textContent = '已选择现有 UniLab 环境'
    runtimeDetail.textContent = runtimeSnapshot.error
      ? `${runtimeSnapshot.environmentPath ?? '系统环境'}；提示：${runtimeSnapshot.error}`
      : runtimeSnapshot.environmentPath ?? '系统环境'
    return
  }
  if (runtimeSnapshot.phase === 'installing') {
    runtimeTitle.textContent = downloadsRuntime
      ? '正在下载并安装 Runtime'
      : '正在安装内置 Runtime'
    runtimeDetail.textContent = downloadsRuntime
      ? '下载完成后会校验 SHA-256、静默安装并执行 unilab -h 验证，请勿退出应用…'
      : '离线解包并执行 unilab -h 验证，请勿退出应用…'
    renderRuntimeProgress(runtimeSnapshot.progress)
    return
  }
  hideRuntimeProgress()
  if (runtimeSnapshot.phase === 'upgrade-required') {
    runtimeTitle.textContent = '需要升级本地 Runtime'
    runtimeDetail.textContent = runtimeSnapshot.error
      ?? `需要安装内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''}。`
    return
  }
  if (runtimeSnapshot.phase === 'failed') {
    runtimeTitle.textContent = 'UniLab 环境检查失败'
    runtimeDetail.textContent = runtimeSnapshot.error ?? '可重新选择或安装应用内置 Runtime。'
    return
  }
  if (runtimeSnapshot.error) {
    runtimeTitle.textContent = '所选 UniLab 环境不可用'
    runtimeDetail.textContent = runtimeSnapshot.error
    return
  }
  runtimeTitle.textContent = '没有检测到 UniLab 环境'
  runtimeDetail.textContent = downloadsRuntime
    ? `可联网下载 Runtime ${runtimeSnapshot.runtimeVersion ?? ''}，校验通过后安装，无需另行配置 Conda。`
    : `可安装应用内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''}，无需另行配置 Conda。`
}

function hideRuntimeProgress() {
  runtimeProgress.hidden = true
  runtimeProgress.style.display = 'none'
}

function showRuntimeProgress() {
  runtimeProgress.hidden = false
  runtimeProgress.style.removeProperty('display')
}

function renderRuntimeProgress(progress) {
  if (!progress || progress.stage === 'preparing') {
    hideRuntimeProgress()
    return
  }
  showRuntimeProgress()
  const percentage = Number.isFinite(progress.percentage) ? progress.percentage : null
  runtimeProgressBar.style.width = `${percentage ?? 0}%`
  runtimeProgressBar.dataset.stage = progress.stage
  const downloaded = formatBytes(progress.downloadedBytes)
  const total = formatBytes(progress.totalBytes)
  const size = downloaded && total ? `${downloaded} / ${total}` : downloaded ?? '处理中…'
  const speed = progress.stage === 'downloading' ? runtimeDownloadSpeed(progress.downloadedBytes) : null
  runtimeProgressLabel.textContent = percentage === null
    ? `${progressStageLabel(progress.stage)} · ${size}${speed ? ` · ${speed}` : ''}`
    : `${progressStageLabel(progress.stage)} · ${percentage}% · ${size}${speed ? ` · ${speed}` : ''}`
}

function runtimeDownloadSpeed(downloadedBytes) {
  if (!Number.isFinite(downloadedBytes)) return null
  const now = performance.now()
  const previous = runtimeProgressSample
  runtimeProgressSample = { bytes: downloadedBytes, at: now }
  if (!previous || now <= previous.at || downloadedBytes <= previous.bytes) return null
  const bytesPerSecond = (downloadedBytes - previous.bytes) / ((now - previous.at) / 1000)
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
}

function progressStageLabel(stage) {
  return {
    downloading: '下载中',
    verifying: '校验中',
    installing: '安装中',
    validating: '验证中'
  }[stage] ?? '处理中'
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return null
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function renderWorkspaceOptions(recentWorkspaces) {
  const previous = workspaceSelect.value
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = recentWorkspaces.length
    ? '选择最近使用的工作区'
    : '选择设备包工作区'
  workspaceSelect.replaceChildren(placeholder, ...recentWorkspaces.map(recent => {
    const option = document.createElement('option')
    option.value = recent.path
    option.textContent = recent.name
    option.title = recent.path
    return option
  }))
  workspaceSelect.value = recentWorkspaces.some(recent => recent.path === previous)
    ? previous
    : recentWorkspaces[0]?.path ?? ''
  workspacePathInput.value = workspaceSelect.value
  recentCount.textContent = `${recentWorkspaces.length} 个最近工作区`
  renderSelectedWorkspacePath()
}

function renderSelectedWorkspacePath() {
  const selected = workspacePathInput.value.trim() || workspaceSelect.value
  workspacePath.textContent = selected || '请选择一个设备包工作区'
  workspacePath.title = selected
}

function openTypedWorkspace() {
  const typedWorkspace = workspacePathInput.value.trim()
  if (!typedWorkspace) {
    snapshot = { ...snapshot, phase: 'failed', error: '请输入工作区目录' }
    render()
    return
  }
  return runOperation(
    () => workspaceApi?.openPath(typedWorkspace, selectedEntryMode()),
    '正在打开工作区',
    '校验设备包目录并启动工作区服务…'
  )
}

function continueIntoWorkspace() {
  const selectedWorkspace = workspaceSelect.value
  const typedWorkspace = workspacePathInput.value.trim()
  if (!selectedWorkspace && !typedWorkspace) return
  void runOperation(
    () => typedWorkspace
      ? workspaceApi?.openPath(typedWorkspace, selectedEntryMode())
      : workspaceApi?.openRecent(selectedWorkspace, selectedEntryMode()),
    'Runtime 已更新，正在进入工作台',
    'Runtime 校验完成，继续启动工作区服务…'
  )
}

function selectedEntryMode() {
  return entryModeInputs.find(input => input.checked)?.value === 'production'
    ? 'production'
    : 'debug'
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
