import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'

import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'
import type {
  WorkbenchConnectionMode,
  WorkbenchConnectionTargets
} from './workbench-connection-profile'
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
  connectionRetry?: () => void
  environmentOpen: boolean
  onConnectionModeChange: (mode: WorkbenchConnectionMode) => void
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
  connectionRetry,
  environmentOpen,
  onConnectionModeChange,
  onToggleEnvironment,
  onReadEnvironmentLog,
  onOpenLog
}: WorkbenchHeaderProps): React.JSX.Element {
  return (
    <header className="unilab-workbench__bar">
      <div className="unilab-workbench__identity">
        <strong>Unilab 调试工作台</strong>
        <span>
          {session.identity
            ? `Workspace Backend PID ${session.identity.pid} · ${session.identity.mode} · ${session.identity.backendUrl}`
            : 'Workspace Backend 尚未启动'}
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
          onRetry={connectionRetry}
          onSelect={onConnectionModeChange}
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
            onClick={onToggleEnvironment}
          >
            <span
              className={`unilab-environment-trigger__status is-${session.phase}`}
              aria-hidden="true"
            />
            环境管理
          </button>
          <DesktopWorkspaceSwitchButton />
        </nav>
      </div>
    </header>
  )
}
