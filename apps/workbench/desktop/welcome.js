const workspaceApi = window.api?.workbenchWorkspace
const runtimeApi = window.api?.managedRuntime
const openButton = document.querySelector('#open-workspace')
const createButton = document.querySelector('#create-workspace')
const recentList = document.querySelector('#recent-list')
const recentEmpty = document.querySelector('#recent-empty')
const recentCount = document.querySelector('#recent-count')
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
const runtimeProgressStage = document.querySelector('#runtime-progress-stage')
const runtimeProgressValue = document.querySelector('#runtime-progress-value')
const runtimeProgressTrack = document.querySelector('#runtime-progress-track')
const runtimeProgressFill = document.querySelector('#runtime-progress-fill')
const runtimeProgressBytes = document.querySelector('#runtime-progress-bytes')
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
let requestPending = switchingBootstrap || selectDirectoryBootstrap
let bootstrappedDirectorySelection = false
let runtimeRequestPending = false
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
  errorLogPath: null,
  progress: null
}

runtimeSelector.addEventListener('change', () => {
  if (!runtimeApi || !runtimeSelector.value || runtimeRequestPending) return
  runtimeRequestPending = true
  render()
  void runtimeApi.selectEnvironment(runtimeSelector.value).then(next => {
    runtimeSnapshot = next
    render()
  }).catch(error => {
    runtimeSnapshot = { ...runtimeSnapshot, error: messageOf(error) }
    render()
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
    render()
  }).catch(error => {
    runtimeSnapshot = { ...runtimeSnapshot, error: messageOf(error) }
    render()
  }).finally(() => {
    runtimeRequestPending = false
    render()
  })
})

installRuntimeButton.addEventListener('click', () => {
  if (!runtimeApi || runtimeRequestPending
    || runtimeSnapshot.phase === 'installing') return
  runtimeRequestPending = true
  render()
  void runtimeApi.install().then(next => {
    runtimeSnapshot = next
    render()
  }).catch(error => {
    runtimeSnapshot = {
      ...runtimeSnapshot,
      phase: 'failed',
      error: messageOf(error)
    }
    render()
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
  () => workspaceApi?.openDirectory(),
  '正在打开工作区',
  '校验目录、Python 环境与本地服务…'
))

createButton.addEventListener('click', () => runOperation(
  () => workspaceApi?.createDirectory(),
  '正在创建工作区',
  '创建目录并校验本地开发环境…'
))

recentList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-workspace-path]')
  if (!button) return
  void runOperation(
    () => workspaceApi?.openRecent(button.dataset.workspacePath),
    '正在恢复工作区',
    '重新校验路径与 Python 环境…'
  )
})

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
      () => workspaceApi?.openDirectory(),
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
    runtimeSnapshot = next
    render()
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
  openButton.disabled = busy || runtimeBlocked || !workspaceApi
  createButton.disabled = busy || runtimeBlocked || !workspaceApi
  statusPanel.hidden = !busy
  if (switchingBootstrap || snapshot.phase === 'stopping') {
    statusTitle.textContent = '正在切换工作区'
    statusDetail.textContent = '有界停止 OS、Agent、PLC-Sim 与 Theia 进程树…'
  }
  errorPanel.hidden = snapshot.phase !== 'failed' || !snapshot.error
  errorMessage.textContent = snapshot.error ?? ''
  renderRuntime()
  renderRecents(snapshot.recentWorkspaces, busy || runtimeBlocked)
}

function renderRuntime() {
  const downloadsRuntime = runtimeSnapshot.delivery === 'download'
  runtimePanel.hidden = runtimeSnapshot.phase === 'unavailable'
  runtimePanel.dataset.phase = runtimeSnapshot.phase
  runtimePanel.setAttribute(
    'aria-busy',
    String(runtimeSnapshot.phase === 'installing')
  )
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
  renderRuntimeProgress(downloadsRuntime)
  if (runtimeSnapshot.phase === 'ready') {
    setText(runtimeTitle, `内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''} 已就绪`)
    setText(runtimeDetail, runtimeSnapshot.error
      ? `${runtimeSnapshot.environmentPath ?? '应用私有环境'}；提示：${runtimeSnapshot.error}`
      : runtimeSnapshot.environmentPath ?? '应用私有环境')
    return
  }
  if (runtimeSnapshot.phase === 'external') {
    setText(runtimeTitle, '已检测到现有 UniLab 环境')
    setText(runtimeDetail, runtimeSnapshot.error
      ? `${runtimeSnapshot.environmentPath ?? '系统环境'}；提示：${runtimeSnapshot.error}`
      : runtimeSnapshot.environmentPath ?? '系统环境')
    return
  }
  if (runtimeSnapshot.phase === 'installing') {
    const stage = runtimeSnapshot.progress?.stage
      ?? (downloadsRuntime ? 'preparing' : 'installing')
    const copy = runtimeInstallationCopy(stage, downloadsRuntime)
    setText(runtimeTitle, copy.title)
    setText(runtimeDetail, copy.detail)
    return
  }
  if (runtimeSnapshot.phase === 'upgrade-required') {
    setText(runtimeTitle, '需要升级本地 Runtime')
    setText(
      runtimeDetail,
      runtimeSnapshot.error
        ?? `需要安装内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''}。`
    )
    return
  }
  if (runtimeSnapshot.phase === 'failed') {
    setText(runtimeTitle, '内置 Runtime 安装或检查失败')
    setText(
      runtimeDetail,
      runtimeSnapshot.error ?? '可重试安装或查看应用日志。'
    )
    return
  }
  if (runtimeSnapshot.error) {
    setText(runtimeTitle, '所选 UniLab 环境不可用')
    setText(runtimeDetail, runtimeSnapshot.error)
    return
  }
  setText(runtimeTitle, '没有检测到 UniLab 环境')
  setText(
    runtimeDetail,
    downloadsRuntime
      ? `可联网下载 Runtime ${runtimeSnapshot.runtimeVersion ?? ''}，校验通过后安装，无需另行配置 Conda。`
      : `可安装应用内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''}，无需另行配置 Conda。`
  )
}

function renderRuntimeProgress(downloadsRuntime) {
  const visible = runtimeSnapshot.phase === 'installing'
  runtimeProgress.hidden = !visible
  if (!visible) return

  const progress = runtimeSnapshot.progress ?? {
    stage: downloadsRuntime ? 'preparing' : 'installing',
    downloadedBytes: null,
    totalBytes: null,
    percentage: null
  }
  const stageCopy = runtimeProgressCopy(progress.stage)
  const determinate = progress.stage === 'downloading'
    && Number.isFinite(progress.percentage)
  const percentage = determinate
    ? Math.max(0, Math.min(100, Math.floor(progress.percentage)))
    : null

  setText(runtimeProgressStage, stageCopy.label)
  setText(runtimeProgressValue, percentage === null
    ? stageCopy.value
    : `${percentage}%`)
  setText(runtimeProgressBytes, runtimeProgressDetail(progress, stageCopy.detail))
  runtimeProgressTrack.classList.toggle('is-indeterminate', !determinate)
  runtimeProgressFill.style.width = percentage === null ? '' : `${percentage}%`
  if (percentage === null) {
    runtimeProgressTrack.removeAttribute('aria-valuenow')
    runtimeProgressTrack.setAttribute('aria-valuetext', stageCopy.label)
  } else {
    runtimeProgressTrack.setAttribute('aria-valuenow', String(percentage))
    runtimeProgressTrack.setAttribute(
      'aria-valuetext',
      `${stageCopy.label} ${percentage}%`
    )
  }
}

function runtimeInstallationCopy(stage, downloadsRuntime) {
  const version = runtimeSnapshot.runtimeVersion
    ? ` ${runtimeSnapshot.runtimeVersion}`
    : ''
  if (stage === 'downloading') return {
    title: `正在下载 Runtime${version}`,
    detail: '下载完成后将自动校验并安装，请保持 Workbench 运行。'
  }
  if (stage === 'verifying') return {
    title: '正在校验 Runtime 安装包',
    detail: '正在核对 SHA-256，确认下载内容完整且未被修改。'
  }
  if (stage === 'installing') return {
    title: '正在安装 Runtime',
    detail: '安装器正在写入应用私有环境，请勿退出 Workbench。'
  }
  if (stage === 'validating') return {
    title: '正在验证 Runtime',
    detail: '正在执行 unilab -h 与 OPC UA 依赖检查。'
  }
  return {
    title: downloadsRuntime ? '正在准备下载 Runtime' : '正在准备安装 Runtime',
    detail: downloadsRuntime
      ? '正在连接安全下载源并检查本地缓存…'
      : '正在检查应用内置安装载荷…'
  }
}

function runtimeProgressCopy(stage) {
  if (stage === 'downloading') return {
    label: '下载 Runtime', value: '下载中', detail: '正在接收安装包'
  }
  if (stage === 'verifying') return {
    label: '校验 SHA-256', value: '校验中', detail: '正在核对安装包完整性'
  }
  if (stage === 'installing') return {
    label: '安装 Runtime', value: '安装中', detail: '正在写入应用私有环境'
  }
  if (stage === 'validating') return {
    label: '验证 Runtime', value: '验证中', detail: '正在检查命令与依赖'
  }
  return {
    label: '准备下载', value: '准备中', detail: '正在连接 Runtime 下载源'
  }
}

function runtimeProgressDetail(progress, fallback) {
  if (progress.stage !== 'downloading'
    || !Number.isFinite(progress.downloadedBytes)) return fallback
  const downloaded = formatBytes(progress.downloadedBytes)
  if (!Number.isFinite(progress.totalBytes) || progress.totalBytes <= 0) {
    return `已下载 ${downloaded}`
  }
  return `${downloaded} / ${formatBytes(progress.totalBytes)}`
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${Math.floor(value)} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024
    unit = units[index]
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${unit}`
}

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value
}

function renderRecents(recentWorkspaces, busy) {
  recentList.replaceChildren()
  recentEmpty.hidden = recentWorkspaces.length > 0
  recentCount.textContent = `${recentWorkspaces.length} / 8`
  recentWorkspaces.forEach((recent, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'recent-item'
    button.dataset.workspacePath = recent.path
    button.disabled = busy
    button.title = recent.path

    const number = document.createElement('span')
    number.className = 'recent-item__number'
    number.textContent = String(index + 1).padStart(2, '0')

    const identity = document.createElement('span')
    const name = document.createElement('strong')
    const path = document.createElement('small')
    name.textContent = recent.name
    path.textContent = recent.path
    identity.append(name, path)

    const time = document.createElement('time')
    time.dateTime = recent.lastOpenedAt
    time.textContent = formatRecentTime(recent.lastOpenedAt)

    button.append(number, identity, time)
    recentList.append(button)
  })
}

function formatRecentTime(value) {
  const time = Date.parse(value)
  if (!Number.isFinite(time) || time === 0) return 'HISTORY'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(time))
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
