import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'

import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'
import { localEnvironmentTone } from './environment-manager-model'
import type {
  WorkbenchConnectionMode,
  WorkbenchConnectionTargets
} from './workbench-connection-profile'
import type { WorkbenchAuthorityTransitionPhase } from './workbench-authority-transition'
import { sessionConnectionState } from './workbench-connection-runtime'
import {
  WorkbenchConnectionSelector,
  type WorkbenchConnectionState
} from './workbench-connection-selector'
import {
  WorkbenchRuntimeLogLauncher,
  workbenchRuntimeLogPaths
} from './workbench-runtime-log-drawer'
import { workbenchViewLabel } from './workbench-surface-helpers'
import type { WorkbenchViewMode } from './workbench-view-state'

export interface WorkbenchHeaderProps {
  session: WorkbenchSessionSnapshot
  viewMode: WorkbenchViewMode
  connectionTargets: WorkbenchConnectionTargets
  connectionMode: WorkbenchConnectionMode
  connection: WorkbenchConnectionState
  backendConnection: WorkbenchConnectionState
  switchBlockedReason: string | null
  transitionPhase: WorkbenchAuthorityTransitionPhase | null
  transitionFailure: {
    target: WorkbenchConnectionMode
    message: string
    canForce: boolean
    canCancelTasks?: boolean
  } | null
  authorityWarning: string | null
  connectionRetry?: () => void
  environmentOpen: boolean
  onConnectionModeChange: (mode: WorkbenchConnectionMode) => void
  onForceConnectionModeChange: (mode: WorkbenchConnectionMode) => void
  onCancelTasksAndConnectionModeChange: (mode: WorkbenchConnectionMode) => void
  onToggleEnvironment: () => void
  onReadEnvironmentLog: (
    kind: WorkbenchEnvironmentLogKind
  ) => Promise<string>
  onOpenLog: (path: string) => Promise<void>
}

/**
 * 渲染 Workbench 会话身份、连接权威和环境操作入口。
 *
 * @param props 当前会话投影、连接选择和日志控制端口。
 * @returns 不拥有领域状态的稳定 Workbench 顶栏。
 */
export function WorkbenchHeader({
  session,
  viewMode,
  connectionTargets,
  connectionMode,
  connection,
  backendConnection,
  switchBlockedReason,
  transitionPhase,
  transitionFailure,
  authorityWarning,
  connectionRetry,
  environmentOpen,
  onConnectionModeChange,
  onForceConnectionModeChange,
  onCancelTasksAndConnectionModeChange,
  onToggleEnvironment,
  onReadEnvironmentLog,
  onOpenLog
}: WorkbenchHeaderProps): React.JSX.Element {
  const environmentTone = localEnvironmentTone(session)
  const environmentLabel = localEnvironmentStatusLabel(environmentTone)
  const runtimeMode = session.edgeRuntime.mode ?? session.configuredRuntimeMode
  return (
    <header className="unilab-workbench__bar">
      <div className="unilab-workbench__identity">
        <strong>Unilab 调试工作台</strong>
        <span>
          {environmentLabel} · {runtimeMode === 'dry-run' ? '模拟运行' : '真实运行'}
        </span>
        <span className="unilab-workbench__view-mode">
          {workbenchViewLabel(viewMode)}
        </span>
      </div>
      <div className="unilab-workbench__controls">
        <WorkbenchConnectionSelector
          targets={connectionTargets}
          selectedMode={connectionMode}
          connection={connection}
          targetConnections={{
            local: sessionConnectionState(session.phase),
            backend: backendConnection
          }}
          switchBlockedReason={switchBlockedReason}
          transitionPhase={transitionPhase}
          transitionFailure={transitionFailure}
          authorityWarning={authorityWarning}
          onRetry={connectionRetry}
          onSelect={onConnectionModeChange}
          onForceSelect={onForceConnectionModeChange}
          onCancelTasksAndSelect={onCancelTasksAndConnectionModeChange}
        />
        <nav aria-label="调试工作台页面">
          <WorkbenchRuntimeLogLauncher
            onReadLog={onReadEnvironmentLog}
            logPaths={workbenchRuntimeLogPaths(session)}
            onOpenLog={onOpenLog}
          />
          <button
            className={environmentOpen ? 'is-active' : ''}
            aria-expanded={environmentOpen}
            aria-label={`本地运行与诊断：${environmentLabel}`}
            onClick={onToggleEnvironment}
          >
            <span
              className={`unilab-environment-trigger__status is-${environmentTone}`}
              aria-hidden="true"
            />
            本地运行
          </button>
          <DesktopWorkspaceSwitchButton />
        </nav>
      </div>
    </header>
  )
}

function localEnvironmentStatusLabel(
  tone: ReturnType<typeof localEnvironmentTone>
): string {
  if (tone === 'ready') return '本地环境可运行'
  if (tone === 'attention') return '本地环境需要处理'
  if (tone === 'busy') return '正在准备本地环境'
  return '本地环境尚未启动'
}
