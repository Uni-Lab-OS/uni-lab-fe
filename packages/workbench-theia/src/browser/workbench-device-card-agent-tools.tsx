import type { DeviceCardAgentEnvironmentInfo } from '@unilab/device-card-sdk'

import type {
  WorkbenchDeviceCardOperation
} from './workbench-device-card-support'

interface WorkbenchDeviceCardAgentToolsProps {
  info: DeviceCardAgentEnvironmentInfo | null
  loading: boolean
  error: string | null
  ready: boolean
  operation: WorkbenchDeviceCardOperation
  workspaceOpen: boolean
  onRetry: () => void
  onToggleCli: () => void
  onToggleBridge: () => void
  onCopyPrompt: () => void
}

/**
 * 展示 Workbench 本机 Agent CLI、Bridge 和复制开发指令入口。
 *
 * @param props Agent 环境快照、互斥操作状态和用户命令。
 * @returns 不阻塞卡片库的独立 Agent 工具区。
 */
export function WorkbenchDeviceCardAgentTools({
  info,
  loading,
  error,
  ready,
  operation,
  workspaceOpen,
  onRetry,
  onToggleCli,
  onToggleBridge,
  onCopyPrompt
}: WorkbenchDeviceCardAgentToolsProps): React.JSX.Element {
  const busy = operation !== null
  return (
    <section
      className="unilab-device-card-section unilab-device-card-agent"
      aria-labelledby="device-card-agent-title"
    >
      <div className="unilab-device-card-section__heading">
        <h2 id="device-card-agent-title">AI 助手</h2>
        <span
          className="unilab-device-card-agent__state"
          data-ready={ready}
          role="status"
        >
          {workbenchAgentStatusLabel(info, loading, error)}
        </span>
      </div>
      {loading ? (
        <p>正在读取本机 Agent CLI 与 Bridge 状态…</p>
      ) : error ? (
        <div className="unilab-device-card-agent__error" role="alert">
          <p>{error}</p>
          <button type="button" disabled={busy} onClick={onRetry}>
            重新读取
          </button>
        </div>
      ) : info ? (
        <>
          <dl className="unilab-device-card-agent__facts">
            <div>
              <dt>Agent CLI</dt>
              <dd>{workbenchAgentCliLabel(info)}</dd>
            </div>
            <div>
              <dt>本机桥接</dt>
              <dd>{info.bridge.enabled ? '已启用' : '未启用'}</dd>
            </div>
          </dl>
          {info.cli.installed && !info.cli.onPath ? (
            <p>
              CLI 已安装到 <code title={info.cli.installPath}>{info.cli.installPath}</code>，
              但所在目录尚未加入 PATH。
            </p>
          ) : (
            <p>通过本机受控桥接让 AI 检查源码，不向卡片开放终端或网络。</p>
          )}
          <div className="unilab-device-card-actions">
            <button
              type="button"
              className="is-primary"
              disabled={busy}
              aria-busy={operation === 'agent'}
              onClick={info.cli.compatible ? onToggleBridge : onToggleCli}
            >
              {workbenchAgentPrimaryActionLabel(info, operation)}
            </button>
            {info.cli.installed && info.cli.compatible ? (
              <button
                type="button"
                disabled={busy}
                onClick={onToggleCli}
              >
                移除 Agent CLI
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="unilab-device-card-agent__copy"
            disabled={!workspaceOpen || !ready || busy}
            aria-busy={operation === 'copy'}
            title={!workspaceOpen
              ? '请先新建或打开设备卡源码项目'
              : !ready
                ? '请先安装 Agent CLI 并启用连接'
                : undefined}
            onClick={onCopyPrompt}
          >
            <span className="codicon codicon-copy" aria-hidden="true" />
            {workbenchAgentCopyActionLabel(operation)}
          </button>
        </>
      ) : (
        <p>当前桌面环境没有返回 Agent CLI 信息。</p>
      )}
    </section>
  )
}

/**
 * 投影 Agent CLI 的安装兼容状态。
 *
 * @param info 桌面端返回的 Agent 环境快照。
 * @returns 供侧栏展示的 CLI 安装与 PATH 状态。
 */
function workbenchAgentCliLabel(info: DeviceCardAgentEnvironmentInfo): string {
  if (!info.cli.installed) return '未安装'
  if (!info.cli.compatible) return '需要更新'
  return info.cli.onPath ? '已安装并在 PATH 中' : '已安装，PATH 未配置'
}

/**
 * 汇总 Agent CLI 与本机桥接的可用状态。
 *
 * @param info 桌面端返回的 Agent 环境快照。
 * @param loading 当前是否正在读取本机状态。
 * @param error 独立 Agent 状态读取错误。
 * @returns 供状态标签展示的简短文案。
 */
function workbenchAgentStatusLabel(
  info: DeviceCardAgentEnvironmentInfo | null,
  loading: boolean,
  error: string | null
): string {
  if (loading) return '读取中'
  if (error || !info) return '不可用'
  if (!info.cli.installed) return 'CLI 未安装'
  if (!info.cli.compatible) return 'CLI 需更新'
  return info.bridge.enabled ? '已连接' : '连接未启用'
}

/**
 * 选择 Agent CLI 或 Bridge 的主要操作文案。
 *
 * @param info 桌面端返回的 Agent 环境快照。
 * @param operation 当前互斥操作。
 * @returns 安装、更新、启用或停止连接文案。
 */
function workbenchAgentPrimaryActionLabel(
  info: DeviceCardAgentEnvironmentInfo,
  operation: WorkbenchDeviceCardOperation
): string {
  if (operation === 'agent') return '处理中…'
  if (!info.cli.installed) return '安装 Agent CLI'
  if (!info.cli.compatible) return '更新 Agent CLI'
  return info.bridge.enabled ? '停止连接' : '启用连接'
}

/**
 * 投影复制开发指令按钮的操作文案。
 *
 * @param operation 当前互斥操作。
 * @returns 空闲或复制中状态的按钮文案。
 */
function workbenchAgentCopyActionLabel(
  operation: WorkbenchDeviceCardOperation
): string {
  if (operation === 'copy') return '复制中…'
  return '复制 AI 指令'
}
