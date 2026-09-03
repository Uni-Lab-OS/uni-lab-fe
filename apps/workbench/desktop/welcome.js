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
  render()
  void runtimeApi.install().then(next => {
    runtimeSnapshot = next
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
    runtimeTitle.textContent = '已选择现有 UniLab 环境'
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
  runtimeDetail.textContent = `可安装应用内置 Runtime ${runtimeSnapshot.runtimeVersion ?? ''}，无需另行配置 Conda。`
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

function selectedEntryMode() {
  return entryModeInputs.find(input => input.checked)?.value === 'production'
    ? 'production'
    : 'debug'
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
