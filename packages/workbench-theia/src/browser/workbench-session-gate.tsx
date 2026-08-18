import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'

import type { WorkbenchConnectionMode } from './workbench-connection-profile'
import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'
import {
  WorkbenchRuntimeLogLauncher,
  workbenchRuntimeLogPaths
} from './workbench-runtime-log-drawer'

export async function captureWorkbenchUiOperation(
  operation: () => Promise<void>,
  onError: (message: string) => void
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error))
  }
}

function opensEnvironmentManager(snapshot: WorkbenchSessionSnapshot): boolean {
  return snapshot.phase === 'failed'
    && (
      snapshot.diagnostic?.code === 'os_readiness_failed'
      || snapshot.diagnostic?.code === 'plc_connection_failed'
    )
}

function diagnosticTitle(
  code: NonNullable<WorkbenchSessionSnapshot['diagnostic']>['code']
): string {
  switch (code) {
    case 'invalid_workspace': return 'Workspace 校验失败'
    case 'invalid_os_project': return 'Uni-Lab OS 项目不可用'
    case 'python_environment_not_found': return 'Python 环境不可用'
    case 'port_conflict': return '端口不可用'
    case 'plc_connection_failed': return 'PLC 连接失败'
    case 'os_readiness_failed': return 'Uni-Lab OS 尚未就绪'
    case 'os_exited': return 'Uni-Lab OS 已退出'
    case 'os_start_failed': return 'Uni-Lab OS 未能启动'
  }
}

export async function runAndRefreshWorkbenchOperation(
  operation: () => Promise<void>,
  refresh: () => Promise<void>
): Promise<void> {
  try {
    await operation()
  } catch (error) {
    try {
      await refresh()
    } catch {
      // Preserve the actionable operation error if the follow-up refresh fails.
    }
    throw error
  }
  await refresh()
}

/** 在运行权威切换期间覆盖工作台，避免目标服务和领域组件重建时出现空白帧。 */
export function WorkbenchAuthorityLoading({
  mode
}: {
  mode: WorkbenchConnectionMode
}): React.JSX.Element {
  const workspaceBackend = mode === 'local'
  const title = workspaceBackend
    ? '正在切换到 Workspace Backend'
    : '正在切换到 Backend'
  const message = workspaceBackend
    ? '正在连接 Workspace Backend，并恢复本地工作流与设备数据…'
    : '正在验证 Backend 与 Scheduler，并加载远端工作流数据…'
  return (
    <div
      className="unilab-workbench-session-loading"
      data-loading-kind="authority-switch"
      data-authority-target={mode}
      role="status"
      aria-live="assertive"
      aria-label={title}
    >
      <div className="unilab-workbench-session-loading__content">
        <span
          className="unilab-workbench-session-loading__spinner"
          aria-hidden="true"
        />
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
    </div>
  )
}

export function WorkbenchSessionGate({
  snapshot,
  onRetry,
  onStop,
  launchMode,
  switchingTo,
  connectionSelector,
  onOpenLog,
  onReadEnvironmentLog,
  renderEnvironmentManager
}: {
  snapshot: WorkbenchSessionSnapshot
  onRetry: () => Promise<void>
  onStop: () => Promise<void>
  launchMode?: 'local' | 'backend'
  switchingTo?: WorkbenchConnectionMode | null
  connectionSelector?: React.ReactNode
  onOpenLog?: (path: string) => Promise<void>
  onReadEnvironmentLog?: (
    kind: WorkbenchEnvironmentLogKind
  ) => Promise<string>
  renderEnvironmentManager: (onClose: () => void) => React.ReactNode
}): React.JSX.Element {
  const [environmentOpen, setEnvironmentOpen] = React.useState(
    opensEnvironmentManager(snapshot)
  )
  const [operationError, setOperationError] = React.useState<string | null>(null)
  const [launchRequested, setLaunchRequested] = React.useState(false)
  const run = React.useCallback(async (operation: () => Promise<void>) => {
    setOperationError(null)
    await captureWorkbenchUiOperation(operation, setOperationError)
  }, [])
  const launchLoading = launchRequested
    || snapshot.phase === 'starting'
    || snapshot.phase === 'waiting'
  // 启动浮层描述的是用户本次选择的连接目标，而非工作区上一次保存的
  // Domain 配置；两者在切换过程中恰好可能相反。
  const switchingToBackend = (
    launchMode ?? snapshot.configuredDomainMode
  ) === 'backend'
  const launchTitle = switchingToBackend
    ? '正在启动 Workspace'
    : '正在启动 Unilab 调试工作台'
  const launchMessage = switchingToBackend
    ? '正在初始化工作区并连接 Backend…'
    : snapshot.message || '正在校验工作区并启动 Uni-Lab OS…'
  const launchCancelLabel = '取消启动'

  const start = React.useCallback(async () => {
    setLaunchRequested(true)
    setOperationError(null)
    await captureWorkbenchUiOperation(onRetry, message => {
      setOperationError(message)
      setLaunchRequested(false)
    })
  }, [onRetry])

  const stop = React.useCallback(async () => {
    await run(onStop)
    setLaunchRequested(false)
  }, [onStop, run])

  React.useEffect(() => {
    if (opensEnvironmentManager(snapshot)) {
      setEnvironmentOpen(true)
    }
  }, [snapshot.diagnostic?.code, snapshot.phase])

  return (
    <div className="unilab-workbench unilab-workbench-session-gate">
      <section className="unilab-workbench-session-card" aria-live="polite">
        <span className={`unilab-workbench-session-phase is-${snapshot.phase}`}>
          {snapshot.phase}
        </span>
        <h2>Unilab 调试工作台</h2>
        <p>{snapshot.message}</p>
        {connectionSelector}
        {snapshot.identity ? (
          <dl>
            <dt>Workspace</dt>
            <dd>{snapshot.identity.workspacePath}</dd>
            <dt>OS PID</dt>
            <dd>{snapshot.identity.pid || '—'}</dd>
            <dt>Generation</dt>
            <dd>{snapshot.identity.generation}</dd>
            <dt>Backend</dt>
            <dd>{snapshot.identity.backendUrl}</dd>
            <div className="unilab-workbench-session-log">
              <dt>Log</dt>
              <dd>
                {onOpenLog ? (
                  <button
                    type="button"
                    title="在编辑器中打开日志文件；再次点击关闭"
                    onClick={() => void run(
                      () => onOpenLog(snapshot.identity?.logPath ?? '')
                    )}
                  >
                    <span className="codicon codicon-go-to-file" aria-hidden="true" />
                    <span>{snapshot.identity.logPath}</span>
                  </button>
                ) : snapshot.identity.logPath}
              </dd>
            </div>
          </dl>
        ) : null}
        {snapshot.diagnostic ? (
          <div className="unilab-workbench-session-diagnostic" role="alert">
            <strong>{diagnosticTitle(snapshot.diagnostic.code)}</strong>
            <p>{snapshot.diagnostic.message}</p>
            <p className="unilab-workbench-session-diagnostic__recovery">
              <span>建议：</span>
              {snapshot.diagnostic.recovery}
            </p>
            <code>诊断代码：{snapshot.diagnostic.code}</code>
          </div>
        ) : null}
        {operationError ? (
          <div className="unilab-workbench-session-diagnostic" role="alert">
            <strong>操作失败</strong>
            <p>{operationError}</p>
          </div>
        ) : null}
        <footer className="unilab-workbench-session-actions">
          <div className="unilab-workbench-session-actions__main">
            {snapshot.phase === 'idle' || snapshot.phase === 'failed' ? (
              <button
                type="button"
                className="is-primary"
                onClick={() => void start()}
              >
                <span className="codicon codicon-play" aria-hidden="true" />
                校验并启动
              </button>
            ) : null}
            {snapshot.phase === 'starting' || snapshot.phase === 'waiting' ? (
              <button
                type="button"
                className="is-danger"
                onClick={() => void stop()}
              >
                <span className="codicon codicon-debug-stop" aria-hidden="true" />
                停止
              </button>
            ) : null}
            <button
              className="is-secondary"
              type="button"
              aria-expanded={environmentOpen}
              onClick={() => setEnvironmentOpen(value => !value)}
            >
              <span className="codicon codicon-settings-gear" aria-hidden="true" />
              环境管理
            </button>
            {onReadEnvironmentLog ? (
              <WorkbenchRuntimeLogLauncher
                onReadLog={onReadEnvironmentLog}
                logPaths={workbenchRuntimeLogPaths(snapshot)}
                onOpenLog={onOpenLog}
              />
            ) : null}
          </div>
          <DesktopWorkspaceSwitchButton />
        </footer>
      </section>
      {environmentOpen
        ? renderEnvironmentManager(() => setEnvironmentOpen(false))
        : null}
      {switchingTo ? (
        <WorkbenchAuthorityLoading mode={switchingTo} />
      ) : launchLoading ? (
        <div
          className="unilab-workbench-session-loading"
          role="status"
          aria-live="assertive"
          aria-label={launchTitle}
        >
          <div className="unilab-workbench-session-loading__content">
            <span
              className="unilab-workbench-session-loading__spinner"
              aria-hidden="true"
            />
            <strong>{launchTitle}</strong>
            <p>{launchMessage}</p>
            <button type="button" onClick={() => void stop()}>
              {launchCancelLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
