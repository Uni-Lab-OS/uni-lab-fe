import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchPlcHandshakeProfile,
  WorkbenchPlcSimulatorConfiguration,
  WorkbenchRuntimeMode,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import {
  desktopWorkbenchRemoteApi,
  type DesktopWorkbenchRemoteApi,
  type WorkbenchRemoteAccessSnapshot
} from './desktop-remote-access'
import {
  desktopManagedRuntimeApi,
  UNAVAILABLE_MANAGED_RUNTIME,
  type ManagedRuntimeInstallationSnapshot
} from './desktop-managed-runtime'
import {
  deriveEnvironmentOverview,
  describeEnvironmentOperationError,
  environmentOperationSuccess,
  environmentPhaseLabel,
  type EnvironmentOperationError,
  type EnvironmentOverview,
  type EnvironmentRecommendedAction
} from './environment-manager-model'

export {
  describeEnvironmentOperationError
} from './environment-manager-model'
export type {
  EnvironmentOperationError
} from './environment-manager-model'

export interface EnvironmentManagerProps {
  session: WorkbenchSessionSnapshot
  onClose: () => void
  onRestartSession: () => Promise<void>
  onRebuildLocalData: () => Promise<void>
  onReadEnvironmentLog: (kind: WorkbenchEnvironmentLogKind) => Promise<string>
  onConfigureGraph: (
    graphPath: string,
    options?: { applyNow?: boolean }
  ) => Promise<void>
  onSetExternalDevicesOnly: (enabled: boolean) => Promise<void>
  onConfigurePlcSimulator: (
    configuration: WorkbenchPlcSimulatorConfiguration
  ) => Promise<void>
  onRefreshPlcVariableTables: () => Promise<void>
  onStartPlcSimulator: () => Promise<void>
  onStopPlcSimulator: () => Promise<void>
  onReleaseEnvironmentPorts: (target: 'os' | 'plc-sim') => Promise<void>
  onStartAgent: () => Promise<void>
  onStopAgent: () => Promise<void>
  onRestartAgent: () => Promise<void>
  onSetRuntimeMode: (mode: WorkbenchRuntimeMode) => Promise<void>
  onStopSession: () => Promise<void>
}

type EnvironmentSectionId = 'local' | 'plc' | 'tools' | 'diagnostics'

interface EnvironmentFeedback {
  message: string
}

/** 管理本地执行、PLC 与诊断；运行连接切换由顶部选择器单独负责。 */
export function EnvironmentManager({
  session,
  onClose,
  onRestartSession,
  onRebuildLocalData,
  onReadEnvironmentLog,
  onConfigureGraph,
  onSetExternalDevicesOnly,
  onConfigurePlcSimulator,
  onRefreshPlcVariableTables,
  onStartPlcSimulator,
  onStopPlcSimulator,
  onReleaseEnvironmentPorts,
  onStartAgent,
  onStopAgent,
  onRestartAgent,
  onSetRuntimeMode,
  onStopSession
}: EnvironmentManagerProps): React.JSX.Element {
  const identity = session.identity
  const edgeRuntime = session.edgeRuntime
  const plcSimulator = session.plcSimulator
  const agent = session.agent ?? identity?.agent ?? null
  const dialogRef = useRef<HTMLElement>(null)
  const dialogTitleRef = useRef<HTMLHeadingElement>(null)
  const dialogTitleId = useId()
  const [plcProjectPath, setPlcProjectPath] = useState(plcSimulator.projectPath)
  const [plcVariableTablePath, setPlcVariableTablePath] = useState(
    plcSimulator.variableTablePath
  )
  const [plcHandshakeProfile, setPlcHandshakeProfile] =
    useState<WorkbenchPlcHandshakeProfile>(plcSimulator.handshakeProfile)
  const [graphPath, setGraphPath] = useState(session.configuredGraphPath)
  const [busyActions, setBusyActions] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [logKind, setLogKind] = useState<WorkbenchEnvironmentLogKind>(
    defaultEnvironmentLogKind(session)
  )
  const [logTail, setLogTail] = useState<string | null>(null)
  const [operationError, setOperationError] =
    useState<EnvironmentOperationError | null>(null)
  const [operationFeedback, setOperationFeedback] =
    useState<EnvironmentFeedback | null>(null)
  const remoteAccessApi = useMemo(desktopWorkbenchRemoteApi, [])
  const managedRuntimeApi = useMemo(desktopManagedRuntimeApi, [])
  const [runtimeInstallation, setRuntimeInstallation] =
    useState<ManagedRuntimeInstallationSnapshot>(UNAVAILABLE_MANAGED_RUNTIME)
  const [openSections, setOpenSections] = useState<ReadonlySet<EnvironmentSectionId>>(
    () => initialOpenSections(session)
  )

  const overview = deriveEnvironmentOverview(
    session,
    managedRuntimeApi ? runtimeInstallation : null
  )
  const graphDirty = graphPath.trim() !== session.configuredGraphPath.trim()
  const plcDirty = (
    plcProjectPath.trim() !== plcSimulator.projectPath.trim()
    || plcVariableTablePath.trim() !== plcSimulator.variableTablePath.trim()
    || plcHandshakeProfile !== plcSimulator.handshakeProfile
  )

  useEffect(() => setPlcProjectPath(plcSimulator.projectPath), [
    plcSimulator.projectPath
  ])
  useEffect(() => setPlcVariableTablePath(plcSimulator.variableTablePath), [
    plcSimulator.variableTablePath
  ])
  useEffect(() => setPlcHandshakeProfile(plcSimulator.handshakeProfile), [
    plcSimulator.handshakeProfile
  ])
  useEffect(() => setGraphPath(session.configuredGraphPath), [
    session.configuredGraphPath
  ])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    document.body.classList.add('unilab-environment-manager-open')
    return () => {
      document.body.classList.remove('unilab-environment-manager-open')
    }
  }, [])

  useEffect(() => {
    if (!managedRuntimeApi) return
    let active = true
    const unsubscribe = managedRuntimeApi.onSnapshot(snapshot => {
      if (active) setRuntimeInstallation(snapshot)
    })
    void managedRuntimeApi.getSnapshot().then(snapshot => {
      if (active) setRuntimeInstallation(snapshot)
    }).catch(error => {
      if (active) setRuntimeInstallation({
        ...UNAVAILABLE_MANAGED_RUNTIME,
        phase: 'failed',
        bundled: true,
        error: error instanceof Error ? error.message : String(error)
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [managedRuntimeApi])

  useEffect(() => {
    const needsLocal = session.phase === 'failed'
      || edgeRuntime.phase === 'failed'
    const needsPlc = plcSimulator.phase === 'failed'
    const needsTools = agent?.phase === 'failed'
    if (!needsLocal && !needsPlc && !needsTools) return
    setOpenSections(current => {
      const next = new Set(current)
      if (needsLocal) next.add('local')
      if (needsPlc) next.add('plc')
      if (needsTools) next.add('tools')
      next.add('diagnostics')
      return next
    })
  }, [agent?.phase, edgeRuntime.phase, plcSimulator.phase, session.phase])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previouslyFocused = document.activeElement
    const frame = requestAnimationFrame(() => {
      const recommended = dialogRef.current?.querySelector<HTMLElement>(
        '[data-recommended-action="true"]'
      )
      ;(recommended ?? dialogTitleRef.current)?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(frame)
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [])

  const setSectionOpen = useCallback((
    section: EnvironmentSectionId,
    open: boolean
  ): void => {
    setOpenSections(current => {
      const next = new Set(current)
      if (open) next.add(section)
      else next.delete(section)
      return next
    })
  }, [])

  const isBusy = useCallback((...actions: string[]): boolean => (
    actions.some(action => busyActions.has(action))
  ), [busyActions])

  const run = useCallback(async (
    action: string,
    operation: () => Promise<void>,
    successMessage = environmentOperationSuccess(action)
  ): Promise<void> => {
    setBusyActions(current => new Set(current).add(action))
    setOperationError(null)
    setOperationFeedback(null)
    try {
      await operation()
      if (successMessage) setOperationFeedback({ message: successMessage })
    } catch (error) {
      setOperationError(describeEnvironmentOperationError(
        action,
        error instanceof Error ? error.message : String(error)
      ))
    } finally {
      setBusyActions(current => {
        const next = new Set(current)
        next.delete(action)
        return next
      })
    }
  }, [])

  const plcConfiguration = useCallback((): WorkbenchPlcSimulatorConfiguration => ({
    projectPath: plcProjectPath,
    variableTablePath: plcVariableTablePath,
    handshakeProfile: plcHandshakeProfile
  }), [plcHandshakeProfile, plcProjectPath, plcVariableTablePath])

  const savePlcConfiguration = useCallback(async (): Promise<void> => {
    if (
      plcSimulator.phase === 'ready'
      && !globalThis.confirm('保存 PLC 配置会重新启动 PLC-Sim。继续？')
    ) return
    await run('save-plc', () => onConfigurePlcSimulator(plcConfiguration()))
  }, [onConfigurePlcSimulator, plcConfiguration, plcSimulator.phase, run])

  const saveGraphConfiguration = useCallback(async (): Promise<void> => {
    await run(
      'save-graph',
      () => onConfigureGraph(graphPath.trim(), { applyNow: false })
    )
  }, [graphPath, onConfigureGraph, run])

  const rebuildLocalData = useCallback(async (): Promise<void> => {
    const confirmed = globalThis.confirm(
      '重建本地数据会清空本地调试库存、设备状态和工作流历史；工作区定义不会删除。继续？'
    )
    if (confirmed) await run('rebuild-local-data', onRebuildLocalData)
  }, [onRebuildLocalData, run])

  const startPlcSimulator = useCallback(async (): Promise<void> => {
    await run('start-plc', async () => {
      if (plcDirty) await onConfigurePlcSimulator(plcConfiguration())
      await onStartPlcSimulator()
    })
  }, [onConfigurePlcSimulator, onStartPlcSimulator, plcConfiguration, plcDirty, run])

  const readSelectedLog = useCallback(async (
    kind: WorkbenchEnvironmentLogKind = logKind
  ): Promise<void> => {
    await run('read-log', async () => {
      setLogTail(await onReadEnvironmentLog(kind))
    }, null)
  }, [logKind, onReadEnvironmentLog, run])

  const openRelatedDiagnostics = useCallback((): void => {
    setLogKind(overview.logKind)
    setSectionOpen('diagnostics', true)
    void readSelectedLog(overview.logKind)
  }, [overview.logKind, readSelectedLog, setSectionOpen])

  const runRecommendedAction = useCallback((
    action: EnvironmentRecommendedAction
  ): void => {
    if (action === 'install-runtime' && managedRuntimeApi) {
      void run('install-runtime', async () => {
        setRuntimeInstallation(await managedRuntimeApi.install())
      })
      return
    }
    if (action === 'rebuild-local-data') {
      void rebuildLocalData()
      return
    }
    if (action === 'start-plc') {
      void startPlcSimulator()
      return
    }
    if (action === 'restart-os') {
      void run('restart-os', onRestartSession)
    }
  }, [managedRuntimeApi, onRestartSession, rebuildLocalData, run, startPlcSimulator])

  const handleDialogKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLElement>
  ): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = visibleFocusableElements(event.currentTarget)
    if (focusable.length === 0) {
      event.preventDefault()
      dialogTitleRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }, [onClose])

  const overlay = (
    <div className="unilab-environment-manager__overlay">
      <button
        type="button"
        tabIndex={-1}
        className="unilab-environment-manager__backdrop"
        aria-label="关闭本地运行与诊断"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="unilab-environment-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        data-testid="environment-manager"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="unilab-environment-manager__header">
          <div>
            <h2 ref={dialogTitleRef} id={dialogTitleId} tabIndex={-1}>
              本地运行与诊断
            </h2>
            <p>运行连接切换在工作台顶部完成；这里仅管理本地执行。</p>
          </div>
          <button type="button" aria-label="关闭本地运行与诊断" onClick={onClose}>
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </header>

        <div className="unilab-environment-manager__rail">
          <EnvironmentOverviewPanel
            overview={overview}
            busy={overview.recommendedAction
              ? isBusy(overview.recommendedAction, 'restart-os', 'start-plc')
              : false}
            operationError={operationError}
            operationFeedback={operationFeedback}
            onRecommendedAction={runRecommendedAction}
            onOpenDiagnostics={openRelatedDiagnostics}
          />

          <section
            className="unilab-environment-manager__advanced"
            aria-labelledby={`${dialogTitleId}-advanced`}
          >
            <header>
              <h3 id={`${dialogTitleId}-advanced`}>高级设置与诊断</h3>
              <p>只在配置设备、接入 PLC 或排查故障时展开。</p>
            </header>

            <EnvironmentDisclosure
              title="本地执行"
              summary={environmentPhaseLabel(edgeRuntime.phase)}
              tone={serviceTone(session.phase, edgeRuntime.phase)}
              open={openSections.has('local')}
              busy={isBusy(
                'install-runtime',
                'save-graph',
                'restart-os',
                'stop-os',
                'rebuild-local-data',
                'release-os-ports',
                'switch-mode',
                'external-devices-only'
              )}
              onOpenChange={open => setSectionOpen('local', open)}
            >
              <div className="unilab-environment-manager__services">
                {managedRuntimeApi ? (
                  <EnvironmentServiceStatus
                    name="应用运行环境"
                    phase={runtimeInstallation.phase}
                    message={runtimeInstallationMessage(runtimeInstallation)}
                  />
                ) : null}
                <EnvironmentServiceStatus
                  name="Workspace 服务"
                  phase={session.phase}
                  message={session.diagnostic?.message ?? session.message}
                />
                <EnvironmentServiceStatus
                  name="本地执行服务"
                  phase={edgeRuntime.phase}
                  message={edgeRuntime.diagnostic ?? edgeRuntime.message}
                />
              </div>

              {managedRuntimeApi
                && runtimeInstallation.bundled
                && ['not-installed', 'failed'].includes(runtimeInstallation.phase) ? (
                  <div className="unilab-environment-manager__inline-action">
                    <button
                      type="button"
                      disabled={isBusy('install-runtime')}
                      onClick={() => runRecommendedAction('install-runtime')}
                    >{isBusy('install-runtime') ? '正在安装…' : '安装运行环境'}</button>
                  </div>
                ) : null}

              <div className="unilab-environment-manager__settings-group">
                <header>
                  <strong>运行方式</strong>
                  <span>切换后在下次启动本地执行时生效</span>
                </header>
                <RuntimeModeControl
                  mode={edgeRuntime.mode ?? session.configuredRuntimeMode}
                  disabled={isBusy('switch-mode')}
                  onSetRuntimeMode={mode => run(
                    'switch-mode',
                    () => onSetRuntimeMode(mode),
                    `已保存${mode === 'dry-run' ? '模拟运行' : '真实运行'}模式；下次启动生效。`
                  )}
                />
              </div>

              <div className="unilab-environment-manager__settings-group">
                <header>
                  <strong>设备配置</strong>
                  <span>保存不会重建数据</span>
                </header>
                <label className="unilab-environment-manager__path">
                  <span>配置文件</span>
                  <input
                    value={graphPath}
                    disabled={isBusy('save-graph')}
                    placeholder="deployment/graphs/example.json"
                    onChange={event => setGraphPath(event.currentTarget.value)}
                  />
                </label>
                <ExternalDevicesOnlyControl
                  checked={session.configuredExternalDevicesOnly}
                  disabled={isBusy('external-devices-only')}
                  onChange={enabled => run(
                    'external-devices-only',
                    () => onSetExternalDevicesOnly(enabled),
                    '设备目录加载范围已保存；下次启动生效。'
                  )}
                />
                <div className="unilab-environment-manager__section-actions">
                  <button
                    type="button"
                    disabled={isBusy('save-graph') || !graphDirty || !graphPath.trim()}
                    onClick={() => void saveGraphConfiguration()}
                  >{isBusy('save-graph') ? '正在保存…' : '保存设备配置'}</button>
                </div>
              </div>

              <div className="unilab-environment-manager__section-actions">
                <button
                  type="button"
                  className="is-primary"
                  disabled={isBusy('restart-os')}
                  onClick={() => void run('restart-os', onRestartSession)}
                >{isBusy('restart-os')
                    ? '正在启动…'
                    : edgeRuntime.phase === 'ready'
                      ? '重新启动本地执行'
                      : '启动本地执行'}</button>
              </div>

              <EnvironmentTechnicalDetails facts={[
                ['Workspace PID', String(identity?.pid ?? '—')],
                ['本地执行 PID', String(edgeRuntime.pid ?? '—')],
                ['服务地址', identity?.backendUrl ?? '—'],
                ['Generation', edgeRuntime.generation ?? identity?.generation ?? '—'],
                ['运行环境', identity?.environmentPath ?? runtimeInstallation.environmentPath ?? '—'],
                ['设备配置', edgeRuntime.graphPath || session.configuredGraphPath]
              ]} />

              <EnvironmentMaintenance title="本地执行维修">
                <button
                  type="button"
                  className="is-danger"
                  disabled={isBusy('stop-os')}
                  onClick={() => void run('stop-os', onStopSession)}
                >停止本地执行</button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={isBusy('rebuild-local-data')}
                  onClick={() => void rebuildLocalData()}
                >重建本地数据</button>
                <button
                  type="button"
                  className="is-port-action"
                  disabled={isBusy('release-os-ports')}
                  onClick={() => {
                    if (!globalThis.confirm('将停止占用本地执行端口的进程。继续？')) return
                    void run(
                      'release-os-ports',
                      () => onReleaseEnvironmentPorts('os')
                    )
                  }}
                >释放占用端口</button>
              </EnvironmentMaintenance>
            </EnvironmentDisclosure>

            <EnvironmentDisclosure
              title="PLC 与设备"
              summary={plcSimulator.phase === 'idle'
                ? '按需启用'
                : environmentPhaseLabel(plcSimulator.phase)}
              tone={serviceTone(plcSimulator.phase)}
              open={openSections.has('plc')}
              busy={isBusy(
                'save-plc',
                'start-plc',
                'stop-plc',
                'refresh-plc-tables',
                'release-plc-ports'
              )}
              onOpenChange={open => setSectionOpen('plc', open)}
            >
              <EnvironmentServiceStatus
                name="PLC 模拟环境"
                phase={plcSimulator.phase}
                message={plcSimulator.diagnostic ?? plcSimulator.message}
              />
              <div className="unilab-environment-manager__settings-group">
                <label className="unilab-environment-manager__path">
                  <span>项目目录</span>
                  <input
                    value={plcProjectPath}
                    disabled={isBusy('save-plc', 'start-plc')}
                    placeholder="/path/to/PLC-Sim"
                    onChange={event => setPlcProjectPath(event.currentTarget.value)}
                  />
                </label>
                <label className="unilab-environment-manager__path">
                  <span>变量表</span>
                  <input
                    list="unilab-plc-variable-tables"
                    value={plcVariableTablePath}
                    disabled={isBusy('save-plc', 'start-plc')}
                    placeholder="选择推荐 CSV，或填写本地路径"
                    onChange={event => setPlcVariableTablePath(event.currentTarget.value)}
                  />
                  <datalist id="unilab-plc-variable-tables">
                    {plcSimulator.variableTableCandidates.map(candidate => (
                      <option key={candidate.path} value={candidate.path}>
                        {candidate.recommended ? '推荐 · ' : ''}{candidate.relativePath}
                      </option>
                    ))}
                  </datalist>
                </label>
                <label className="unilab-environment-manager__path">
                  <span>通信规则</span>
                  <select
                    value={plcHandshakeProfile}
                    disabled={isBusy('save-plc', 'start-plc')}
                    onChange={event => setPlcHandshakeProfile(
                      event.currentTarget.value as WorkbenchPlcHandshakeProfile
                    )}
                  >
                    <option value="szlab">SZLab</option>
                    <option value="xuse">XUSE 通用</option>
                  </select>
                </label>
              </div>
              <div className="unilab-environment-manager__section-actions">
                <button
                  type="button"
                  className="is-primary"
                  disabled={
                    isBusy('start-plc')
                    || !plcProjectPath.trim()
                    || !plcVariableTablePath.trim()
                    || plcSimulator.phase === 'ready'
                  }
                  onClick={() => void startPlcSimulator()}
                >{isBusy('start-plc') ? '正在启动…' : '启动 PLC-Sim'}</button>
                <button
                  type="button"
                  disabled={isBusy('save-plc') || !plcDirty}
                  onClick={() => void savePlcConfiguration()}
                >{plcSimulator.phase === 'ready' ? '保存并重启' : '保存配置'}</button>
                <button
                  type="button"
                  className="is-quiet"
                  disabled={isBusy('refresh-plc-tables') || plcSimulator.phase === 'ready'}
                  onClick={() => void run(
                    'refresh-plc-tables',
                    onRefreshPlcVariableTables
                  )}
                >更新变量表推荐</button>
              </div>
              <EnvironmentTechnicalDetails facts={[
                ['PID', String(plcSimulator.pid ?? '—')],
                ['界面地址', plcSimulator.guiUrl || '—'],
                ['OPC UA', plcSimulator.opcUaUrl || '—'],
                ['变量表路径', plcSimulator.variableTablePath || '—']
              ]} />
              <EnvironmentMaintenance title="PLC-Sim 维修">
                <button
                  type="button"
                  className="is-danger"
                  disabled={isBusy('stop-plc') || plcSimulator.phase !== 'ready'}
                  onClick={() => void run('stop-plc', onStopPlcSimulator)}
                >停止 PLC-Sim</button>
                <button
                  type="button"
                  className="is-port-action"
                  disabled={isBusy('release-plc-ports')}
                  onClick={() => {
                    if (!globalThis.confirm('将停止占用 PLC-Sim 18765、4855 端口的进程。继续？')) return
                    void run(
                      'release-plc-ports',
                      () => onReleaseEnvironmentPorts('plc-sim')
                    )
                  }}
                >释放占用端口</button>
              </EnvironmentMaintenance>
            </EnvironmentDisclosure>

            <EnvironmentDisclosure
              title="工作区工具与共享"
              summary={agent?.phase === 'failed' ? '需要处理' : '按需启用'}
              tone={serviceTone(agent?.phase ?? 'idle')}
              open={openSections.has('tools')}
              busy={isBusy('start-agent', 'restart-agent', 'stop-agent')}
              onOpenChange={open => setSectionOpen('tools', open)}
            >
              <EnvironmentServiceStatus
                name="工作区助手"
                phase={agent?.phase ?? 'idle'}
                message={agentStatusMessage(agent)}
                actions={agent?.phase === 'ready' ? (
                  <>
                    <button
                      type="button"
                      disabled={isBusy('restart-agent')}
                      onClick={() => void run('restart-agent', onRestartAgent)}
                    >重启助手</button>
                    <button
                      type="button"
                      className="is-danger"
                      disabled={isBusy('stop-agent')}
                      onClick={() => void run('stop-agent', onStopAgent)}
                    >停止助手</button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy('start-agent')
                      || agent?.phase === 'starting'
                      || agent?.phase === 'stopping'}
                    onClick={() => void run('start-agent', onStartAgent)}
                  >{agent?.phase === 'failed' ? '重试启动助手' : '启动工作区助手'}</button>
                )}
              />
              <EnvironmentTechnicalDetails facts={[
                ['助手 PID', String(agent?.pid ?? '—')],
                ['工作目录', agent?.workDir ?? identity?.workspacePath ?? '—'],
                ['数据目录', agent?.dataDir ?? '—']
              ]} />
              {remoteAccessApi ? <RemoteAccessPanel api={remoteAccessApi} /> : null}
            </EnvironmentDisclosure>

            <EnvironmentDisclosure
              title="诊断日志"
              summary={operationError ? '查看失败详情' : '按需读取'}
              tone={operationError ? 'attention' : 'idle'}
              open={openSections.has('diagnostics')}
              busy={isBusy('read-log')}
              onOpenChange={open => setSectionOpen('diagnostics', open)}
            >
              <div className="unilab-environment-manager__log-controls">
                <label>
                  <span>日志来源</span>
                  <select
                    value={logKind}
                    disabled={isBusy('read-log')}
                    onChange={event => {
                      setLogKind(event.currentTarget.value as WorkbenchEnvironmentLogKind)
                      setLogTail(null)
                    }}
                  >
                    <option value="workspace-backend">Workspace 服务</option>
                    <option value="os">本地执行</option>
                    <option value="plc-sim">PLC-Sim</option>
                    <option value="agent">工作区助手</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={isBusy('read-log')}
                  onClick={() => void readSelectedLog()}
                >{isBusy('read-log') ? '正在读取…' : '读取日志'}</button>
              </div>
              {logTail !== null ? (
                <pre data-testid="environment-log-tail">{logTail || '暂无日志'}</pre>
              ) : (
                <p className="unilab-environment-manager__empty-log">
                  选择与问题相关的服务后读取最近日志。
                </p>
              )}
            </EnvironmentDisclosure>
          </section>
        </div>
      </section>
    </div>
  )

  return typeof document === 'undefined'
    ? overlay
    : createPortal(overlay, document.body)
}

function EnvironmentOverviewPanel({
  overview,
  busy,
  operationError,
  operationFeedback,
  onRecommendedAction,
  onOpenDiagnostics
}: {
  overview: EnvironmentOverview
  busy: boolean
  operationError: EnvironmentOperationError | null
  operationFeedback: EnvironmentFeedback | null
  onRecommendedAction: (action: EnvironmentRecommendedAction) => void
  onOpenDiagnostics: () => void
}): React.JSX.Element {
  return (
    <section
      className="unilab-environment-overview"
      data-tone={overview.tone}
      aria-live="polite"
    >
      <header>
        <span className="unilab-environment-overview__icon" aria-hidden="true">
          <span className={`codicon ${overviewIcon(overview.tone)}`} />
        </span>
        <div>
          <h3>{overview.title}</h3>
          <p>{overview.message}</p>
        </div>
        <span className="unilab-environment-overview__mode">
          {overview.modeLabel}
        </span>
      </header>
      {overview.issueCount > 1 ? (
        <p className="unilab-environment-overview__issue-count">
          另有 {overview.issueCount - 1} 项高级组件需要处理
        </p>
      ) : null}
      {overview.recommendedAction && overview.recommendedActionLabel ? (
        <div className="unilab-environment-overview__actions">
          <button
            type="button"
            className="is-primary"
            data-recommended-action="true"
            disabled={busy}
            onClick={() => onRecommendedAction(overview.recommendedAction)}
          >{busy ? '正在处理…' : overview.recommendedActionLabel}</button>
          <button type="button" className="is-quiet" onClick={onOpenDiagnostics}>
            查看相关日志
          </button>
        </div>
      ) : null}
      {operationFeedback ? (
        <div className="unilab-environment-notice is-success" role="status">
          <span className="codicon codicon-check" aria-hidden="true" />
          <p>{operationFeedback.message}</p>
        </div>
      ) : null}
      {operationError ? (
        <div className="unilab-environment-notice is-error" role="alert">
          <span className="codicon codicon-warning" aria-hidden="true" />
          <div>
            <strong>{operationError.title}</strong>
            <p>{operationError.message}</p>
            {operationError.technicalDetail ? (
              <details>
                <summary>技术信息</summary>
                <code>{operationError.technicalDetail}</code>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function EnvironmentDisclosure({
  title,
  summary,
  tone,
  open,
  busy,
  onOpenChange,
  children
}: {
  title: string
  summary: string
  tone: string
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <details
      className="unilab-environment-section"
      data-tone={tone}
      open={open}
      aria-busy={busy}
      onToggle={event => onOpenChange(event.currentTarget.open)}
    >
      <summary>
        <span className="unilab-environment-section__status" aria-hidden="true" />
        <strong>{title}</strong>
        <span>{busy ? '正在处理…' : summary}</span>
        <span className="codicon codicon-chevron-down" aria-hidden="true" />
      </summary>
      <div className="unilab-environment-section__content">{children}</div>
    </details>
  )
}

function EnvironmentServiceStatus({
  name,
  phase,
  message,
  actions
}: {
  name: string
  phase: string
  message: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="unilab-environment-service" data-tone={serviceTone(phase)}>
      <span className="unilab-environment-service__status" aria-hidden="true" />
      <div>
        <header>
          <strong>{name}</strong>
          <span>{environmentPhaseLabel(phase)}</span>
        </header>
        <p>{message}</p>
        {actions ? (
          <div className="unilab-environment-manager__section-actions">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function EnvironmentTechnicalDetails({
  facts
}: {
  facts: Array<[string, string]>
}): React.JSX.Element {
  return (
    <details className="unilab-environment-technical">
      <summary>技术详情</summary>
      <dl>
        {facts.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </details>
  )
}

function EnvironmentMaintenance({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="unilab-environment-maintenance">
      <header>
        <strong>{title}</strong>
        <span>仅在停止服务或排查端口冲突时使用</span>
      </header>
      <div className="unilab-environment-manager__section-actions">
        {children}
      </div>
    </div>
  )
}

function RemoteAccessPanel({
  api
}: {
  api: DesktopWorkbenchRemoteApi
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WorkbenchRemoteAccessSnapshot | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void api.getSnapshot().then(value => {
      if (active) setSnapshot(value)
    }).catch(error => {
      if (active) setSnapshot(failedRemoteSnapshot(error))
    })
    return () => { active = false }
  }, [api])

  const update = useCallback(async (
    operation: () => Promise<WorkbenchRemoteAccessSnapshot>
  ) => {
    setBusy(true)
    setCopyStatus(null)
    try {
      setSnapshot(await operation())
    } catch (error) {
      setSnapshot(failedRemoteSnapshot(error))
    } finally {
      setBusy(false)
    }
  }, [])

  const copyAccessUrl = useCallback(async () => {
    if (!snapshot?.accessUrl) return
    try {
      await navigator.clipboard.writeText(snapshot.accessUrl)
      setCopyStatus('访问链接已复制；请通过安全渠道发送。')
    } catch {
      setCopyStatus('无法写入剪贴板，请重新开启远程访问后再试。')
    }
  }, [snapshot?.accessUrl])

  const current = snapshot ?? pendingRemoteSnapshot()
  const transitioning = current.phase === 'starting' || current.phase === 'stopping'
  return (
    <div className="unilab-environment-remote-access">
      <EnvironmentServiceStatus
        name="远程访问"
        phase={current.phase}
        message={copyStatus ?? remoteAccessMessage(current)}
        actions={current.phase === 'ready' ? (
          <>
            <button
              type="button"
              disabled={busy || !current.accessUrl}
              onClick={() => void copyAccessUrl()}
            >复制访问链接</button>
            <button
              type="button"
              className="is-danger"
              disabled={busy}
              onClick={() => void update(api.stop)}
            >停止共享</button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || transitioning || current.phase === 'unavailable'}
            onClick={() => void update(api.start)}
          >允许远程访问</button>
        )}
      />
      {current.error ? (
        <EnvironmentTechnicalDetails facts={[
          ['错误详情', current.error],
          ['入口地址', current.origin ?? '—'],
          ['Generation', current.generation ?? '—'],
          ['有效期', formatRemoteExpiry(current.expiresAt)]
        ]} />
      ) : current.phase === 'ready' ? (
        <EnvironmentTechnicalDetails facts={[
          ['入口地址', current.origin ?? '—'],
          ['PID', String(current.pid ?? '—')],
          ['Generation', current.generation ?? '—'],
          ['有效期', formatRemoteExpiry(current.expiresAt)]
        ]} />
      ) : null}
    </div>
  )
}

export function ExternalDevicesOnlyControl({
  checked,
  disabled,
  onChange
}: {
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => Promise<void>
}): React.JSX.Element {
  return (
    <label className="unilab-environment-manager__external-devices-only">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => void onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>只使用工作区设备包</strong>
        <small>关闭后还会加载 OS 内置设备目录；下次启动生效。</small>
      </span>
    </label>
  )
}

export function RuntimeModeControl({
  mode,
  disabled,
  onSetRuntimeMode
}: {
  mode: WorkbenchRuntimeMode | undefined
  disabled: boolean
  onSetRuntimeMode: (mode: WorkbenchRuntimeMode) => Promise<void>
}): React.JSX.Element {
  const select = (next: WorkbenchRuntimeMode): void => {
    if (mode === next) return
    const label = next === 'normal' ? '真实运行' : '模拟运行'
    if (globalThis.confirm(`切换到${label}？新模式将在下次启动本地执行时生效。`)) {
      void onSetRuntimeMode(next)
    }
  }
  const button = (
    value: WorkbenchRuntimeMode,
    label: string,
    description: string
  ): React.JSX.Element => {
    const selected = mode === value
    return (
      <button
        type="button"
        className={selected ? 'is-active' : ''}
        aria-label={selected ? `${label}（当前）` : label}
        aria-pressed={selected}
        disabled={disabled}
        onClick={() => select(value)}
      >
        {selected ? <span className="codicon codicon-check" aria-hidden="true" /> : null}
        <span className="unilab-environment-manager__mode-copy">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
      </button>
    )
  }
  return (
    <div
      className="unilab-environment-manager__mode"
      role="group"
      aria-label="本地执行运行方式"
    >
      {button('normal', '真实运行', '向已连接设备下发动作')}
      {button('dry-run', '模拟运行', '完整运行流程，但不下发设备动作')}
    </div>
  )
}

function visibleFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>([
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled])',
    'select:not([disabled])',
    'summary',
    '[tabindex]:not([tabindex="-1"])'
  ].join(','))).filter(element => element.getClientRects().length > 0)
}

function initialOpenSections(
  session: WorkbenchSessionSnapshot
): ReadonlySet<EnvironmentSectionId> {
  const sections = new Set<EnvironmentSectionId>()
  if (session.phase === 'failed' || session.edgeRuntime.phase === 'failed') {
    sections.add('local')
    sections.add('diagnostics')
  }
  if (session.plcSimulator.phase === 'failed') {
    sections.add('plc')
    sections.add('diagnostics')
  }
  if (session.agent?.phase === 'failed') sections.add('tools')
  return sections
}

function defaultEnvironmentLogKind(
  session: WorkbenchSessionSnapshot
): WorkbenchEnvironmentLogKind {
  if (session.diagnostic?.code === 'plc_connection_failed') return 'plc-sim'
  if (session.phase === 'failed' || session.edgeRuntime.phase === 'failed') return 'os'
  return 'workspace-backend'
}

function overviewIcon(tone: EnvironmentOverview['tone']): string {
  if (tone === 'ready') return 'codicon-check'
  if (tone === 'attention') return 'codicon-warning'
  if (tone === 'busy') return 'codicon-sync'
  return 'codicon-circle-outline'
}

function serviceTone(...phases: Array<string | undefined>): string {
  if (phases.some(phase => phase === 'failed')) return 'attention'
  if (phases.some(phase => [
    'validating',
    'starting',
    'waiting',
    'installing',
    'stopping'
  ].includes(phase ?? ''))) return 'busy'
  if (phases.some(phase => phase === 'ready' || phase === 'external')) return 'ready'
  return 'idle'
}

function agentStatusMessage(
  agent: WorkbenchSessionSnapshot['agent']
): string {
  if (!agent) return '仅在需要工作区自动化助手时启动。'
  if (agent.diagnostic) return agent.diagnostic
  if (agent.phase === 'starting') return '正在启动工作区助手…'
  if (agent.phase === 'stopping') return '正在停止工作区助手…'
  if (agent.phase === 'ready') return '工作区助手已就绪。'
  return '工作区助手启动失败；请查看助手日志。'
}

function runtimeInstallationMessage(
  snapshot: ManagedRuntimeInstallationSnapshot
): string {
  if (snapshot.phase === 'ready') return '应用运行环境已经通过验证。'
  if (snapshot.phase === 'external') {
    return snapshot.error
      ? '正在使用现有运行环境；应用内置环境需要修复。'
      : '正在使用已安装的运行环境。'
  }
  if (snapshot.phase === 'installing') return '正在离线安装并验证，请勿退出应用。'
  if (snapshot.phase === 'not-installed') return '尚未检测到可用运行环境。'
  if (snapshot.phase === 'failed') return '运行环境安装或检查失败。'
  return '当前入口不提供本机运行环境安装能力。'
}

function pendingRemoteSnapshot(): WorkbenchRemoteAccessSnapshot {
  return {
    phase: 'starting',
    origin: null,
    accessUrl: null,
    pid: null,
    generation: null,
    expiresAt: null,
    error: null
  }
}

function failedRemoteSnapshot(error: unknown): WorkbenchRemoteAccessSnapshot {
  return {
    ...pendingRemoteSnapshot(),
    phase: 'failed',
    error: error instanceof Error ? error.message : String(error)
  }
}

function remoteAccessMessage(snapshot: WorkbenchRemoteAccessSnapshot): string {
  if (snapshot.phase === 'ready') return '远程浏览器正在共享当前工作台会话。'
  if (snapshot.phase === 'starting') return '正在建立安全访问链接…'
  if (snapshot.phase === 'stopping') return '正在撤销访问链接…'
  if (snapshot.phase === 'failed') return '远程访问未能开启，请查看技术详情后重试。'
  if (snapshot.phase === 'unavailable') return '当前不是受支持的桌面工作台。'
  return '默认关闭；本地服务仅接受本机连接。'
}

function formatRemoteExpiry(expiresAt: number | null): string {
  if (!expiresAt) return '—'
  return new Date(expiresAt).toLocaleString()
}
