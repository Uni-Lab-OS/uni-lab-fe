import type { DeviceCardAuthoringProfile } from '@unilab/device-card-sdk'

import {
  agentStatusLabel,
  workspaceStateLabel,
  workspaceSummary
} from './deviceCardWorkbenchSupport'
import styles from './DeviceCardWorkbench.module.scss'
import type { DeviceCardWorkbenchModel } from './DeviceCardWorkbenchView'
import { deviceInstanceOptionLabel } from './presentation'

/** 展示设备卡片项目、创建入口与 AI 助手状态。 */
export function DeviceCardWorkbenchSidebar({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element {
  return (
    <aside className={styles.sidebar}>
      <header className={styles.sidebarHeader}>
        <div>
          <h1>设备卡片</h1>
          <span>{model.cards.length} 张已安装</span>
        </div>
        <p>创建和预览设备操作界面。</p>
      </header>
      <WorkbenchMessage model={model} />
      {model.workspace
        ? <WorkspacePanel model={model} />
        : <CreationAndLibraryPanel model={model} />}
      <AgentTools model={model} />
    </aside>
  )
}

/** 展示工作台操作结果。 */
function WorkbenchMessage({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element | null {
  if (!model.message) return null
  return (
    <p
      className={`${styles.message} ${
        styles[`message_${model.message.kind}`]
      }`}
      role={model.message.kind === 'error' ? 'alert' : 'status'}
      aria-live={model.message.kind === 'error' ? 'assertive' : 'polite'}
    >
      {model.message.text}
    </p>
  )
}

/** 展示当前本地设备卡片开发工作区。 */
function WorkspacePanel({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element | null {
  const { workspace, workspaceOperation } = model
  if (!workspace) return null

  return (
    <section className={styles.workspace} aria-label="本地开发工作区">
      <div className={styles.workspaceHeading}>
        <div>
          <span>当前项目</span>
          <strong>{workspace.projectName}</strong>
        </div>
        <span
          className={`${styles.workspaceState} ${
            styles[`workspaceState_${workspace.state}`]
          }`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${workspaceStateLabel(workspace.state)}。${
            workspaceSummary(workspace)
          }`}
        >
          {workspaceStateLabel(workspace.state)}
        </span>
      </div>
      <div className={styles.projectPath}>
        <code title={workspace.projectDir}>{workspace.projectDir}</code>
      </div>
      <p className={styles.workspaceSummary}>{workspaceSummary(workspace)}</p>
      <WorkspaceDiagnostics model={model} />
      <div className={styles.projectActions}>
        <button
          type="button"
          disabled={!model.agentReady || workspaceOperation !== null}
          onClick={() => void model.copyAgentPrompt()}
        >
          {model.agentReady ? '复制 AI 指令' : '请先设置 AI 助手'}
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={model.revealWorkspace}
        >
          打开文件夹
        </button>
      </div>
      <div className={styles.workspaceActions}>
        <button
          type="button"
          className={styles.secondary}
          disabled={workspaceOperation !== null}
          onClick={() => void model.rebuildWorkspace()}
        >
          {workspaceOperation === 'rebuild' ? '检查中…' : '重新检查'}
        </button>
        <button
          type="button"
          disabled={workspace.state !== 'ready' || workspaceOperation !== null}
          onClick={() => void model.installWorkspace()}
        >
          {workspaceOperation === 'install' ? '安装中…' : '确认并安装'}
        </button>
        <button
          type="button"
          className={styles.ghost}
          disabled={workspaceOperation !== null}
          onClick={() => void model.closeWorkspace()}
        >
          关闭工作区
        </button>
      </div>
    </section>
  )
}

/** 展示设备卡片项目的前三项诊断。 */
function WorkspaceDiagnostics({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element | null {
  const diagnostics = model.workspace?.diagnostics ?? []
  if (diagnostics.length === 0) return null
  return (
    <ul className={styles.diagnostics}>
      {diagnostics.slice(0, 3).map((diagnostic, index) => (
        <li
          key={`${diagnostic.code}-${diagnostic.path ?? index}`}
          className={styles[`diagnostic_${diagnostic.severity}`]}
        >
          <strong>{diagnostic.code}</strong>
          <span>
            {diagnostic.path ? `${diagnostic.path} · ` : ''}
            {diagnostic.message}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 展示创建项目与已安装卡片预览入口。 */
function CreationAndLibraryPanel({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element {
  return (
    <>
      <CardProjectCreation model={model} />
      <InstalledCardPicker model={model} />
    </>
  )
}

/** 展示设备卡片项目创建参数。 */
function CardProjectCreation({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element {
  return (
    <section className={styles.creationFlow} aria-label="开始卡片开发">
      <h2>开始开发</h2>
      <div className={styles.fieldGroup}>
        <label>
          目标设备
          <select
            value={model.selectedDevice?.deviceId ?? ''}
            onChange={(event) => model.setSelectedDeviceId(event.target.value)}
            disabled={model.devices.length === 0}
          >
            {model.devices.length === 0
              ? <option value="">没有可用设备</option>
              : null}
            {model.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceInstanceOptionLabel(device)}
              </option>
            ))}
          </select>
        </label>
        <label>
          开发框架
          <select
            value={model.authoringProfile}
            onChange={(event) => model.setAuthoringProfile(
              event.target.value as DeviceCardAuthoringProfile
            )}
          >
            <option value="vue-web-component-v1">Vue 3</option>
            <option value="react-web-component-v1">React</option>
            <option value="web-component-lite-v1">Web Component Lite</option>
          </select>
        </label>
      </div>
      {model.selectedDevice && !model.selectedDevice.definition ? (
        <p className={styles.workspaceSummary} role="status">
          此设备尚未投影 PackageCatalog 定义，只能管理设备，不能创建或运行新版卡片。
        </p>
      ) : null}
      <CardProjectActions model={model} />
      <button
        type="button"
        className={styles.textButton}
        disabled={!model.selectedDevice?.definition || !model.fileAvailable ||
          model.exportingKit}
        onClick={() => void model.exportAuthoringKit()}
      >
        {model.exportingKit ? '正在导出…' : '导出离线开发包'}
      </button>
    </section>
  )
}

/** 展示设备卡片项目的新建与打开命令。 */
function CardProjectActions({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element {
  return (
    <div className={styles.creationActions}>
      <button
        type="button"
        disabled={!model.selectedDevice?.definition || model.workspaceOperation !== null}
        aria-busy={model.workspaceOperation === 'prepare'}
        onClick={() => void model.prepareAgentProject()}
      >
        {model.workspaceOperation === 'prepare' ? '正在创建…' : '新建项目'}
      </button>
      <button
        type="button"
        className={styles.secondary}
        disabled={!model.selectedDevice?.definition || model.workspaceOperation !== null}
        aria-busy={model.workspaceOperation === 'open'}
        onClick={() => void model.openWorkspace()}
      >
        {model.workspaceOperation === 'open' ? '正在打开…' : '打开项目'}
      </button>
    </div>
  )
}

/** 展示已安装设备卡片选择器。 */
function InstalledCardPicker({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element {
  return (
    <section className={styles.libraryPicker} aria-label="已安装卡片预览">
      <label>
        预览已安装卡片
        <select
          value={model.selectedCardKey}
          onChange={(event) => model.setSelectedCardKey(event.target.value)}
          disabled={model.cards.length === 0}
        >
          {model.cards.length === 0
            ? <option value="">尚未安装卡片</option>
            : null}
          {model.cards.map((card) => (
            <option key={card.key} value={card.key}>
              {card.title} / {card.version}
            </option>
          ))}
        </select>
      </label>
    </section>
  )
}

/** 展示本机 AI 助手桥接能力。 */
function AgentTools({
  model
}: {
  model: DeviceCardWorkbenchModel
}): React.JSX.Element | null {
  const { agentInfo, workspaceOperation } = model
  if (!agentInfo) return null
  const cliNeedsSetup = !agentInfo.cli.compatible

  return (
    <details className={styles.agentTools}>
      <summary>
        <strong>AI 助手</strong>
        <b data-ready={model.agentReady}>{agentStatusLabel(agentInfo)}</b>
      </summary>
      <div className={styles.agentToolsBody}>
        <p>供本机 AI 读取项目和检查结果，不能控制真实设备。</p>
        <div className={styles.agentActions}>
          <button
            type="button"
            disabled={workspaceOperation !== null}
            onClick={() => void (
              cliNeedsSetup ? model.toggleAgentCli() : model.toggleAgentBridge()
            )}
          >
            {agentPrimaryActionLabel(model)}
          </button>
          {agentInfo.cli.installed && agentInfo.cli.compatible ? (
            <button
              type="button"
              className={styles.secondary}
              disabled={workspaceOperation !== null}
              onClick={() => void model.toggleAgentCli()}
            >
              移除工具
            </button>
          ) : null}
        </div>
      </div>
    </details>
  )
}

/** 计算 AI 助手主操作按钮文案。 */
function agentPrimaryActionLabel(model: DeviceCardWorkbenchModel): string {
  if (model.workspaceOperation === 'cli') return '处理中…'
  if (!model.agentInfo?.cli.compatible) {
    return model.agentInfo?.cli.installed ? '更新工具' : '安装工具'
  }
  return model.agentInfo.bridge.enabled ? '停止连接' : '启用连接'
}
