import {
  DeviceManagementPanel,
  type DeviceManagementConnection
} from '@unilab/device-management'
import type { DeviceCardAuthoringProfile } from '@unilab/device-card-sdk'
import type { Services } from '@unilab/services'
import { useState, type KeyboardEvent } from 'react'

import {
  workbenchDeviceCardWorkspaceSummary,
  type WorkbenchDeviceMode
} from './workbench-device-card-support'
import { WorkbenchDeviceCardAgentTools } from './workbench-device-card-agent-tools'
import { useWorkbenchDeviceCards } from './use-workbench-device-cards'

export { WorkbenchDeviceCardAgentTools } from './workbench-device-card-agent-tools'

export {
  buildWorkbenchDeviceCardAgentPrompt
} from './use-workbench-device-card-actions'

export {
  buildWorkbenchDeviceCardAuthoringContext,
  buildWorkbenchDeviceCardRuntimeState
} from './workbench-device-card-support'

interface WorkbenchDeviceSurfaceProps {
  services: Services
  backend: {
    id: string
    name: string
    apiUrl: string
  }
  backendEnabled: boolean
  connection: DeviceManagementConnection
  active: boolean
}

/**
 * 在仪器设备域内编排原有设备控制和设备自定义卡片两个工作面。
 *
 * @param props OS 服务、设备管理后端和当前域可见状态。
 * @returns 带持久页签语义的仪器设备工作面。
 */
export function WorkbenchDeviceSurface({
  services,
  backend,
  backendEnabled,
  connection,
  active
}: WorkbenchDeviceSurfaceProps): React.JSX.Element {
  const [mode, setMode] = useState<WorkbenchDeviceMode>('control')
  return (
    <div className="unilab-workbench-device-shell">
      <WorkbenchDeviceModeSwitcher mode={mode} onChange={setMode} />
      <div
        id="unilab-workbench-device-control-panel"
        role="tabpanel"
        aria-labelledby="unilab-workbench-device-control-tab"
        hidden={mode !== 'control'}
        className="unilab-workbench-device-shell__panel"
      >
        {mode === 'control' ? (
          <DeviceManagementPanel
            services={services}
            backend={backend}
            backendEnabled={backendEnabled}
            connection={connection}
          />
        ) : null}
      </div>
      <div
        id="unilab-workbench-device-cards-panel"
        role="tabpanel"
        aria-labelledby="unilab-workbench-device-cards-tab"
        hidden={mode !== 'cards'}
        className="unilab-workbench-device-shell__panel"
      >
        {mode === 'cards' ? (
          <WorkbenchDeviceCardPanel services={services} active={active} />
        ) : null}
      </div>
    </div>
  )
}

/**
 * 渲染仪器设备域的可键盘访问页签。
 *
 * @param props 当前模式和模式变更回调。
 * @returns “设备控制 / 自定义卡片”页签组。
 */
export function WorkbenchDeviceModeSwitcher({
  mode,
  onChange
}: {
  mode: WorkbenchDeviceMode
  onChange: (mode: WorkbenchDeviceMode) => void
}): React.JSX.Element {
  /** 用方向键、Home 和 End 在设备域页签间移动焦点。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const next = event.key === 'ArrowLeft' || event.key === 'Home'
      ? 'control'
      : event.key === 'ArrowRight' || event.key === 'End'
        ? 'cards'
        : null
    if (!next) return
    event.preventDefault()
    onChange(next)
    requestAnimationFrame(() => {
      document.getElementById(`unilab-workbench-device-${next}-tab`)?.focus()
    })
  }
  return (
    <div className="unilab-workbench-device-switcher" role="tablist" aria-label="仪器设备功能">
      <button
        id="unilab-workbench-device-control-tab"
        type="button"
        role="tab"
        aria-selected={mode === 'control'}
        aria-controls="unilab-workbench-device-control-panel"
        tabIndex={mode === 'control' ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={() => onChange('control')}
      >
        设备控制
      </button>
      <button
        id="unilab-workbench-device-cards-tab"
        type="button"
        role="tab"
        aria-selected={mode === 'cards'}
        aria-controls="unilab-workbench-device-cards-panel"
        tabIndex={mode === 'cards' ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={() => onChange('cards')}
      >
        自定义卡片
      </button>
    </div>
  )
}

/**
 * 把设备卡视图模型投影为 Workbench 侧栏和受控原生预览区域。
 *
 * @param props 当前 OS 服务组合根和仪器设备域可见状态。
 * @returns 完整设备卡管理与预览界面。
 */
function WorkbenchDeviceCardPanel({
  services,
  active
}: {
  services: Services
  active: boolean
}): React.JSX.Element {
  const model = useWorkbenchDeviceCards({ services, active })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  if (!model.desktopAvailable) {
    return (
      <section className="unilab-device-cards-unavailable" aria-label="自定义卡片不可用">
        <span className="codicon codicon-device-desktop" aria-hidden="true" />
        <h2>设备自定义卡片仅在桌面 Workbench 中可用</h2>
        <p>请使用 <code>npm run workbench:desktop</code> 启动完整工作台，以访问本机卡片包和受控预览进程。</p>
      </section>
    )
  }

  return (
    <section
      className={`unilab-device-card-workbench${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
      aria-label="设备自定义卡片"
    >
      <aside
        id="unilab-device-card-development-sidebar"
        className="unilab-device-card-sidebar"
        hidden={sidebarCollapsed}
      >
        <header className="unilab-device-card-sidebar__header">
          <div>
            <h1>设备自定义卡片</h1>
            <span>{model.cards.length} 张已安装</span>
          </div>
          <p>在 Mock 中验证界面，确认后再明确绑定真实设备。</p>
        </header>
        {model.message ? (
          <p
            className="unilab-device-card-notice"
            data-kind={model.message.kind}
            role={model.message.kind === 'error' ? 'alert' : 'status'}
            aria-live={model.message.kind === 'error' ? 'assertive' : 'polite'}
          >
            {model.message.text}
          </p>
        ) : null}
        {model.workspace ? (
          <WorkbenchDeviceCardWorkspace model={model} />
        ) : (
          <WorkbenchDeviceCardLibrary model={model} />
        )}
        <WorkbenchDeviceCardAgentTools
          info={model.agentInfo}
          loading={model.agentLoading}
          error={model.agentError}
          ready={model.agentReady}
          operation={model.operation}
          workspaceOpen={Boolean(model.workspace)}
          onRetry={model.refreshAgentInfo}
          onToggleCli={model.toggleAgentCli}
          onToggleBridge={model.toggleAgentBridge}
          onCopyPrompt={model.copyAgentPrompt}
        />
      </aside>
      <WorkbenchDeviceCardPreview
        model={model}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(value => !value)}
      />
    </section>
  )
}

type WorkbenchDeviceCardModel = ReturnType<typeof useWorkbenchDeviceCards>

/**
 * 展示已安装卡片、设备实例和导入入口。
 *
 * @param props 当前设备卡视图模型。
 * @returns 卡片库和源码开发入口。
 */
function WorkbenchDeviceCardLibrary({
  model
}: {
  model: WorkbenchDeviceCardModel
}): React.JSX.Element {
  return (
    <>
      <section className="unilab-device-card-section" aria-labelledby="device-card-library-title">
        <div className="unilab-device-card-section__heading">
          <h2 id="device-card-library-title">卡片库</h2>
          <button
            type="button"
            className="is-primary"
            disabled={model.operation !== null}
            aria-busy={model.operation === 'import'}
            onClick={() => void model.importCard()}
          >
            <span className="codicon codicon-cloud-upload" aria-hidden="true" />
            {model.operation === 'import' ? '导入中…' : '导入卡片'}
          </button>
        </div>
        <label>
          已安装卡片
          <select
            value={model.selectedCardKey}
            onChange={event => model.setSelectedCardKey(event.target.value)}
            disabled={model.loading || model.cards.length === 0}
          >
            {model.cards.length === 0 ? (
              <option value="">{model.loading ? '正在加载…' : '尚未安装卡片'}</option>
            ) : null}
            {model.cards.map(card => (
              <option key={card.key} value={card.key}>
                {card.title} · {card.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          目标设备实例
          <select
            value={model.selectedDevice?.deviceId ?? ''}
            onChange={event => model.setSelectedDeviceId(event.target.value)}
            disabled={model.devices.length === 0}
          >
            {model.devices.length === 0 ? <option value="">没有可用设备</option> : null}
            {model.devices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label} · {device.deviceId} · {device.online ? '在线' : '离线'}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="unilab-device-card-section" aria-labelledby="device-card-development-title">
        <h2 id="device-card-development-title">源码开发</h2>
        {model.selectedDevice && !model.selectedDevice.definition ? (
          <p role="status">
            此设备尚未投影 PackageCatalog 定义，只能管理设备，不能创建或运行新版卡片。
          </p>
        ) : null}
        <label>
          开发框架
          <select
            value={model.authoringProfile}
            onChange={event => model.setAuthoringProfile(
              event.target.value as DeviceCardAuthoringProfile
            )}
          >
            <option value="vue-web-component-v1">Vue 3</option>
            <option value="react-web-component-v1">React</option>
            <option value="web-component-lite-v1">Web Component Lite</option>
          </select>
        </label>
        <div className="unilab-device-card-actions">
          <button
            type="button"
            className="is-primary"
            disabled={!model.selectedDevice?.definition || model.operation !== null}
            onClick={() => void model.prepareWorkspace()}
          >
            {model.operation === 'prepare' ? '创建中…' : '新建项目'}
          </button>
          <button
            type="button"
            disabled={!model.selectedDevice?.definition || model.operation !== null}
            onClick={() => void model.openWorkspace()}
          >
            {model.operation === 'open' ? '打开中…' : '打开项目'}
          </button>
        </div>
        <button
          type="button"
          className="is-text"
          disabled={!model.fileAvailable || !model.selectedDevice?.definition || model.operation !== null}
          onClick={() => void model.exportAuthoringKit()}
        >
          {model.operation === 'export' ? '正在导出…' : '导出离线开发包'}
        </button>
      </section>
    </>
  )
}

/**
 * 展示当前源码工作区状态、诊断和安装命令。
 *
 * @param props 当前设备卡视图模型。
 * @returns 源码工作区侧栏。
 */
function WorkbenchDeviceCardWorkspace({
  model
}: {
  model: WorkbenchDeviceCardModel
}): React.JSX.Element | null {
  const workspace = model.workspace
  if (!workspace) return null
  return (
    <section className="unilab-device-card-section unilab-device-card-workspace" aria-label="当前设备卡项目">
      <div className="unilab-device-card-section__heading">
        <div>
          <h2>{workspace.projectName}</h2>
          <span className="unilab-device-card-state" data-state={workspace.state}>
            {workspace.state === 'ready' ? '检查通过' : workspace.state === 'building' ? '检查中' : '需要修复'}
          </span>
        </div>
        <button type="button" className="is-text" onClick={model.revealWorkspace}>
          打开目录
        </button>
      </div>
      <code className="unilab-device-card-workspace__path" title={workspace.projectDir}>
        {workspace.projectDir}
      </code>
      <p>{workbenchDeviceCardWorkspaceSummary(workspace)}</p>
      {workspace.diagnostics.length > 0 ? (
        <ul className="unilab-device-card-diagnostics" aria-label="源码诊断">
          {workspace.diagnostics.slice(0, 4).map((diagnostic, index) => (
            <li key={`${diagnostic.code}-${diagnostic.path ?? index}`} data-severity={diagnostic.severity}>
              <strong>{diagnostic.code}</strong>
              <span>{diagnostic.path ? `${diagnostic.path} · ` : ''}{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="unilab-device-card-actions">
        <button
          type="button"
          disabled={model.operation !== null}
          onClick={() => void model.rebuildWorkspace()}
        >
          {model.operation === 'rebuild' ? '检查中…' : '重新检查'}
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={workspace.state !== 'ready' || model.operation !== null}
          onClick={() => void model.installWorkspace()}
        >
          {model.operation === 'install' ? '安装中…' : '确认并安装'}
        </button>
      </div>
      <button
        type="button"
        className="is-text"
        disabled={model.operation !== null}
        onClick={() => void model.closeWorkspace()}
      >
        {model.operation === 'close' ? '关闭中…' : '关闭源码工作区'}
      </button>
    </section>
  )
}

/**
 * 展示卡片来源、Mock/Live 安全边界和原生预览挂载点。
 *
 * @param props 当前设备卡视图模型。
 * @returns 占据剩余工作区的设备卡预览。
 */
function WorkbenchDeviceCardPreview({
  model,
  sidebarCollapsed,
  onToggleSidebar
}: {
  model: WorkbenchDeviceCardModel
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}): React.JSX.Element {
  return (
    <main className="unilab-device-card-preview-shell">
      <header className="unilab-device-card-preview-header">
        <div className="unilab-device-card-preview-heading">
          <button
            type="button"
            className="unilab-device-card-sidebar-toggle"
            aria-expanded={!sidebarCollapsed}
            aria-controls="unilab-device-card-development-sidebar"
            title={sidebarCollapsed ? '展开设备卡片开发面板' : '收起设备卡片开发面板'}
            onClick={onToggleSidebar}
          >
            <span
              className={`codicon codicon-chevron-${sidebarCollapsed ? 'right' : 'left'}`}
              aria-hidden="true"
            />
            {sidebarCollapsed ? '展开开发面板' : '收起开发面板'}
          </button>
          <div>
            <strong>{model.previewCard?.title ?? '卡片预览'}</strong>
            <span>{model.previewDescription}</span>
          </div>
        </div>
        {model.previewCard && model.previewDevice ? (
          <div className="unilab-device-card-live-controls">
            <span className="unilab-device-card-mode" data-live={model.liveMode}>
              {model.liveMode ? 'LIVE' : 'MOCK'}
            </span>
            <button
              type="button"
              className={model.liveMode ? 'is-danger' : 'is-primary'}
              disabled={!model.liveMode && !model.previewDevice.online}
              aria-pressed={model.liveMode}
              onClick={model.toggleLiveBinding}
            >
              {model.liveMode ? '退出 Live' : `应用到 ${model.previewDevice.deviceId}`}
            </button>
          </div>
        ) : null}
      </header>
      <div ref={model.previewRef} className="unilab-device-card-preview">
        {!model.previewCard ? (
          <div className="unilab-device-card-empty">
            <span className="codicon codicon-preview" aria-hidden="true" />
            <strong>还没有可预览的设备卡</strong>
            <p>{model.workspace
              ? '修复左侧诊断并重新检查，预览会自动更新。'
              : '从左侧导入卡片，或为当前设备新建一个源码项目。'}</p>
          </div>
        ) : null}
      </div>
    </main>
  )
}
