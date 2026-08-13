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
const installRuntimeButton = document.querySelector('#install-runtime')
const chooseRuntimeButton = document.querySelector('#choose-runtime')
const runtimeSelector = document.querySelector('#runtime-selector')
const runtimeSelectorLabel = document.querySelector('#runtime-selector-label')

let snapshot = {
  phase: 'welcome',
  activeWorkspace: null,
  recentWorkspaces: [],
  error: null
}
let switchingBootstrap = new URLSearchParams(location.search)
  .get('switching') === '1'
let requestPending = switchingBootstrap
let runtimeRequestPending = false
let runtimeSnapshot = {
  phase: 'unavailable',
  bundled: false,
  managed: false,
  runtimeVersion: null,
  platform: null,
  environmentPath: null,
  availableEnvironments: [],
  error: null
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
  workspaceApi.onSnapshot((next) => {
    if (switchingBootstrap) {
      history.replaceState(null, '', location.pathname)
    }
    switchingBootstrap = false
    requestPending = false
    snapshot = next
    render()
  })
  workspaceApi.getSnapshot().then((next) => {
    if (!switchingBootstrap) requestPending = false
    snapshot = next
    render()
  }).catch((error) => {
    requestPending = false
    snapshot = { ...snapshot, phase: 'failed', error: messageOf(error) }
    render()
  })
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
  runtimePanel.hidden = runtimeSnapshot.phase === 'unavailable'
  runtimePanel.dataset.phase = runtimeSnapshot.phase
  runtimeIndicator.className = `runtime-panel__indicator is-${runtimeSnapshot.phase}`
  installRuntimeButton.hidden = !runtimeSnapshot.bundled
    || !['not-installed', 'failed'].includes(runtimeSnapshot.phase)
  installRuntimeButton.disabled = runtimeRequestPending
    || runtimeSnapshot.phase === 'installing'
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
  if (runtimeSnapshot.phase === 'ready') {
    runtimeTitle.textContent = `内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''} 已就绪`
    runtimeDetail.textContent = runtimeSnapshot.error
      ? `${runtimeSnapshot.environmentPath ?? '应用私有环境'}；提示：${runtimeSnapshot.error}`
      : runtimeSnapshot.environmentPath ?? '应用私有环境'
    return
  }
  if (runtimeSnapshot.phase === 'external') {
    runtimeTitle.textContent = '已检测到现有 UniLab 环境'
    runtimeDetail.textContent = runtimeSnapshot.error
      ? `${runtimeSnapshot.environmentPath ?? '系统环境'}；提示：${runtimeSnapshot.error}`
      : runtimeSnapshot.environmentPath ?? '系统环境'
    return
  }
  if (runtimeSnapshot.phase === 'installing') {
    runtimeTitle.textContent = '正在安装内置 Runtime'
    runtimeDetail.textContent = '离线解包并执行 unilab -h 验证，请勿退出应用…'
    return
  }
  if (runtimeSnapshot.phase === 'failed') {
    runtimeTitle.textContent = '内置 Runtime 安装或检查失败'
    runtimeDetail.textContent = runtimeSnapshot.error ?? '可重试安装或查看应用日志。'
    return
  }
  if (runtimeSnapshot.error) {
    runtimeTitle.textContent = '所选 UniLab 环境不可用'
    runtimeDetail.textContent = runtimeSnapshot.error
    return
  }
  runtimeTitle.textContent = '没有检测到 UniLab 环境'
  runtimeDetail.textContent = `可安装应用内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''}，无需另行配置 Conda。`
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
