import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchGraphDeclaration,
  WorkbenchPlcHandshakeProfile,
  WorkbenchPlcSimulatorConfiguration,
  WorkbenchReleaseReceipt,
  WorkbenchReleaseTargetInspection,
  WorkbenchRuntimeMode,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { captureWorkbenchUiOperation } from './workbench-session-gate'
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

export interface EnvironmentManagerProps {
  session: WorkbenchSessionSnapshot
  onClose: () => void
  onRestartSession: () => Promise<void>
  onRebuildLocalData: () => Promise<void>
  onInspectReleaseTarget: (
    backendUrl: string
  ) => Promise<WorkbenchReleaseTargetInspection>
  onPublishRelease: (
    backendUrl: string,
    resetTarget?: boolean
  ) => Promise<WorkbenchReleaseReceipt>
  onReadEnvironmentLog: (kind: WorkbenchEnvironmentLogKind) => Promise<string>
  onConfigureGraph: (graphPath: string) => Promise<void>
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
  onSetSchedulerUrl: (url: string | null) => Promise<void>
  onStopSession: () => Promise<void>
}

export interface EnvironmentOperationError {
  title: string
  message: string
  technicalDetail?: string
}

/**
 * Resolve the value that the graph control is allowed to apply.
 *
 * A declared package turns the control into a closed choice.  The configured
 * value is retained when it is still declared; otherwise the package default
 * (when declared as a candidate) or the first candidate is shown.  Legacy
 * Hosts with no candidates keep the existing free-text behavior.
 *
 * @param graphPath Current configured or edited graph path.
 * @param declaration Optional Host-projected package declaration.
 * @returns A candidate path when the declaration is closed, otherwise the
 * current free-text value.
 */
export function resolveGraphPathSelection(
  graphPath: string,
  declaration: WorkbenchGraphDeclaration | null | undefined
): string {
  const candidates = declaration?.candidates ?? []
  if (candidates.length === 0) return graphPath
  if (candidates.includes(graphPath)) return graphPath
  const defaultGraphPath = declaration?.defaultGraphPath
  if (defaultGraphPath && candidates.includes(defaultGraphPath)) {
    return defaultGraphPath
  }
  return candidates[0] ?? graphPath
}

function graphPathOptionLabel(
  graphPath: string,
  defaultGraphPath: string | null | undefined
): string {
  return graphPath === defaultGraphPath
    ? `${graphPath}（包默认）`
    : graphPath
}

/**
 * 将环境操作异常转换为面向操作者的恢复提示。
 *
 * @param action 正在执行的环境操作标识，用于限定错误所属的业务入口。
 * @param message 下层服务返回的原始诊断文本。
 * @returns 分离用户提示与可选技术详情的错误展示模型。
 * @throws 不抛出异常；无法分类的错误保留原始文本作为用户消息。
 * @safety 只做确定性的字符串分类，不发起请求或改变环境状态。
 */
export function describeEnvironmentOperationError(
  action: string,
  message: string
): EnvironmentOperationError {
  if (message.includes('WorkspaceRelease 只能从 Local Authority 构建')) {
    const resetAndPublish = action === 'reset-and-publish-release'
    return {
      title: resetAndPublish
        ? '当前模式无法清空并发布'
        : '当前模式无法发布',
      message: `当前工作区由 Backend 管理，不能在这里构建发布包。` +
        `请切换到 Local 模式后，再执行“${resetAndPublish ? '清空并发布' : '发布、校验并切换'}”。` +
        (resetAndPublish ? '目标 Backend 的数据尚未被清除。' : '')
    }
  }
  const targetsBackend = [
    'inspect-release-target',
    'publish-release',
    'reset-and-publish-release'
  ].includes(action)
  const connectionUnavailable = /(?:connection refused|econnrefused|urlopen error|failed to fetch|fetch failed|networkerror)/i
    .test(message)
  if (targetsBackend && connectionUnavailable) {
    return {
      title: '无法连接 Backend',
      message: '无法访问目标 Backend。请先启动 Backend，并确认环境管理中的 ' +
        'Backend 地址和端口正确，然后重试。',
      technicalDetail: message
    }
  }
  return {
    title: '环境操作失败',
    message
  }
}

/** Manage the local OS, PLC simulator and Agent from one visible surface. */
export function EnvironmentManager({
  session,
  onClose,
  onRestartSession,
  onRebuildLocalData,
  onInspectReleaseTarget,
  onPublishRelease,
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
  onSetSchedulerUrl,
  onStopSession
}: EnvironmentManagerProps): React.JSX.Element {
  const identity = session.identity
  const edgeRuntime = session.edgeRuntime
  const plcSimulator = session.plcSimulator
  const agent = session.agent ?? identity?.agent ?? null
  const graphDeclaration = session.graphDeclaration
  const graphCandidates = graphDeclaration?.candidates
  const graphDeclarationInvalid = graphDeclaration !== null
    && Array.isArray(graphCandidates)
    && graphCandidates.length === 0
  const graphChoiceClosed = Array.isArray(graphCandidates)
    && graphCandidates.length > 0
  const graphDeclarationKey = [
    graphDeclaration?.defaultGraphPath ?? '',
    ...(graphCandidates ?? [])
  ].join('\u0000')
  const [plcProjectPath, setPlcProjectPath] = useState(plcSimulator.projectPath)
  const [plcVariableTablePath, setPlcVariableTablePath] = useState(
    plcSimulator.variableTablePath
  )
  const [plcHandshakeProfile, setPlcHandshakeProfile] =
    useState<WorkbenchPlcHandshakeProfile>(plcSimulator.handshakeProfile)
  const [graphPath, setGraphPath] = useState(() => resolveGraphPathSelection(
    session.configuredGraphPath,
    graphDeclaration
  ))
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [logKind, setLogKind] = useState<WorkbenchEnvironmentLogKind>('os')
  const [logTail, setLogTail] = useState<string | null>(null)
  const [operationError, setOperationError] =
    useState<EnvironmentOperationError | null>(null)
  const [releaseReceipt, setReleaseReceipt] =
    useState<WorkbenchReleaseReceipt | null>(null)
  const [releaseInspection, setReleaseInspection] =
    useState<WorkbenchReleaseTargetInspection | null>(null)
  const [releaseBackendUrl, setReleaseBackendUrl] = useState(
    session.configuredBackendUrl ?? 'http://127.0.0.1:8080'
  )
  const [schedulerAutomatic, setSchedulerAutomatic] = useState(
    session.configuredSchedulerUrl === null
  )
  const [schedulerUrl, setSchedulerUrl] = useState(
    session.configuredSchedulerUrl
      ?? deriveSchedulerUrl(
        session.configuredBackendUrl ?? 'http://127.0.0.1:8080'
      )
  )
  const remoteAccessApi = useMemo(desktopWorkbenchRemoteApi, [])
  const managedRuntimeApi = useMemo(desktopManagedRuntimeApi, [])
  const [runtimeInstallation, setRuntimeInstallation] =
    useState<ManagedRuntimeInstallationSnapshot>(UNAVAILABLE_MANAGED_RUNTIME)

  useEffect(() => setPlcProjectPath(plcSimulator.projectPath), [
    plcSimulator.projectPath
  ])
  useEffect(() => setPlcVariableTablePath(plcSimulator.variableTablePath), [
    plcSimulator.variableTablePath
  ])
  useEffect(() => setPlcHandshakeProfile(plcSimulator.handshakeProfile), [
    plcSimulator.handshakeProfile
  ])
  useEffect(() => setGraphPath(resolveGraphPathSelection(
    session.configuredGraphPath,
    graphDeclaration
  )), [graphDeclarationKey, session.configuredGraphPath])
  useEffect(() => {
    const configured = session.configuredSchedulerUrl
    setSchedulerAutomatic(configured === null)
    setSchedulerUrl(configured ?? deriveSchedulerUrl(
      releaseBackendUrl
    ))
  }, [session.configuredBackendUrl, session.configuredSchedulerUrl])
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

  const run = useCallback(async (
    action: string,
    operation: () => Promise<void>
  ) => {
    setBusyAction(action)
    setOperationError(null)
    try {
      await captureWorkbenchUiOperation(operation, message => {
        setOperationError(describeEnvironmentOperationError(action, message))
      })
    } finally {
      setBusyAction(null)
    }
  }, [])

  const plcConfiguration = useCallback((): WorkbenchPlcSimulatorConfiguration => ({
    projectPath: plcProjectPath,
    variableTablePath: plcVariableTablePath,
    handshakeProfile: plcHandshakeProfile
  }), [plcHandshakeProfile, plcProjectPath, plcVariableTablePath])

  const savePlcConfiguration = useCallback(async () => {
    await run('save-plc', () => onConfigurePlcSimulator(plcConfiguration()))
  }, [onConfigurePlcSimulator, plcConfiguration, run])

  const applyGraphPath = useCallback(async () => {
    await run('apply-graph', async () => {
      await onConfigureGraph(resolveGraphPathSelection(
        graphPath,
        graphDeclaration
      ))
    })
  }, [graphDeclaration, graphPath, onConfigureGraph, run])

  const saveSchedulerUrl = useCallback(async () => {
    if (schedulerAutomatic) {
      await onSetSchedulerUrl(null)
      return
    }
    const normalized = normalizeSchedulerUrl(schedulerUrl)
    setSchedulerUrl(normalized)
    await onSetSchedulerUrl(normalized)
  }, [onSetSchedulerUrl, schedulerAutomatic, schedulerUrl])

  const startPlcSimulator = useCallback(async () => {
    await run('start-plc', async () => {
      await onConfigurePlcSimulator(plcConfiguration())
      await onStartPlcSimulator()
    })
  }, [
    onConfigurePlcSimulator,
    onStartPlcSimulator,
    plcConfiguration,
    run
  ])

  const readSelectedLog = useCallback(async () => {
    await run('read-log', async () => {
      setLogTail(await onReadEnvironmentLog(logKind))
    })
  }, [logKind, onReadEnvironmentLog, run])

  const overlay = (
    <div className="unilab-environment-manager__overlay">
      <button
        type="button"
        className="unilab-environment-manager__backdrop"
        aria-label="关闭环境管理"
        onClick={onClose}
      />
      <section
        className="unilab-environment-manager"
        role="dialog"
        aria-modal="true"
        aria-label="环境管理"
        data-testid="environment-manager"
      >
      <header className="unilab-environment-manager__header">
        <div>
          <span className="unilab-environment-manager__eyebrow">MANAGED LOCAL</span>
          <strong>环境管理</strong>
        </div>
        <button type="button" aria-label="关闭环境管理" onClick={onClose}>
          <span className="codicon codicon-close" />
        </button>
      </header>

      {operationError ? (
        <div className="unilab-workbench-session-diagnostic" role="alert">
          <strong>{operationError.title}</strong>
          <p>{operationError.message}</p>
          {operationError.technicalDetail ? (
            <details>
              <summary>技术信息</summary>
              <code>{operationError.technicalDetail}</code>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="unilab-environment-manager__rail" aria-label="本地环境状态链">
        {managedRuntimeApi ? (
          <EnvironmentStatusCard
            name="UniLab Runtime"
            phase={runtimeInstallation.phase}
            message={runtimeInstallationMessage(runtimeInstallation)}
            facts={[
              ['版本', runtimeInstallation.runtimeVersion ?? '—'],
              ['平台', runtimeInstallation.platform ?? '—'],
              ['来源', runtimeInstallation.managed ? '应用内置' : '现有环境'],
              ['环境', runtimeInstallation.environmentPath ?? '—']
            ]}
            actions={runtimeInstallation.bundled && [
              'not-installed',
              'failed'
            ].includes(runtimeInstallation.phase) ? (
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => void run('install-runtime', async () => {
                  setRuntimeInstallation(await managedRuntimeApi.install())
                })}
              >安装内置 Runtime</button>
            ) : undefined}
          />
        ) : null}
        <EnvironmentStatusCard
          name="Workspace Backend"
          order={1}
          phase={session.phase}
          message={session.diagnostic?.message ?? session.message}
          facts={[
            ['PID', String(identity?.pid ?? '—')],
            ['Authority API', identity?.backendUrl ?? '—'],
            ['Generation', identity?.generation ?? '—'],
            ['本地数据', '可重建会话数据']
          ]}
          actions={(
            <button
              type="button"
              disabled={Boolean(busyAction) || ![
                'ready',
                'failed'
              ].includes(session.phase)}
              onClick={() => {
                const confirmed = globalThis.confirm(
                  '重建 Workspace Backend 会清空本地调试库存、设备状态和工作流历史。继续？'
                )
                if (confirmed) {
                  void run('rebuild-local-data', onRebuildLocalData)
                }
              }}
            >重建本地数据</button>
          )}
        />
        <EnvironmentStatusCard
          name="发布到 Backend"
          order={2}
          phase={releaseReceipt ? 'ready' : 'idle'}
          message={releaseReceipt
            ? `已校验 ${releaseReceipt.counts.templates} 个模板、${releaseReceipt.counts.materials} 个物料、${releaseReceipt.counts.workflows} 个工作流`
            : '从当前 Local Authority 构建不可变 Release，写入后回读校验'}
          facts={[
            ['Release', releaseReceipt?.releaseId ?? '—'],
            ['状态', releaseReceipt?.verified ? '已验证并切换' : '等待发布']
          ]}
          content={(
            <>
              <div className="unilab-environment-manager__backend-targets">
                <label className="unilab-environment-manager__path unilab-environment-manager__backend-target">
                  <span>Backend</span>
                  <input
                    type="url"
                    value={releaseBackendUrl}
                    disabled={Boolean(busyAction)}
                    placeholder="http://127.0.0.1:8080"
                    aria-label="Backend 发布目标地址"
                    onChange={event => {
                      const value = event.currentTarget.value
                      setReleaseBackendUrl(value)
                      if (schedulerAutomatic) {
                        setSchedulerUrl(deriveSchedulerUrl(value))
                      }
                      setReleaseInspection(null)
                      setReleaseReceipt(null)
                    }}
                  />
                </label>
                <label className="unilab-environment-manager__path unilab-environment-manager__backend-target">
                  <span>Scheduler</span>
                  <input
                    type="url"
                    value={schedulerUrl}
                    disabled={Boolean(busyAction)}
                    placeholder="http://127.0.0.1:8081"
                    aria-label="Scheduler 目标地址"
                    onChange={event => {
                      setSchedulerAutomatic(false)
                      setSchedulerUrl(event.currentTarget.value)
                    }}
                  />
                </label>
              </div>
              <p className="unilab-environment-manager__scheduler-mode">
                Scheduler：{schedulerAutomatic ? '自动推导' : '自定义地址'}
              </p>
              {releaseInspection ? (
                <p className={`unilab-environment-manager__target-summary ${
                  releaseInspection.empty ? 'is-empty' : 'is-occupied'
                }`}>
                  {releaseInspection.empty
                    ? '目标为空，可以安全发布。'
                    : `目标已有 ${releaseInspection.counts.templates} 个模板、` +
                      `${releaseInspection.counts.materials} 个物料、` +
                      `${releaseInspection.counts.workflows} 个工作流。`}
                </p>
              ) : null}
            </>
          )}
          actions={(
            <>
              <button
                type="button"
                disabled={Boolean(busyAction) || !releaseBackendUrl.trim()}
                onClick={() => void run('inspect-release-target', async () => {
                  const backendUrl = normalizeBackendUrl(releaseBackendUrl)
                  setReleaseBackendUrl(backendUrl)
                  await saveSchedulerUrl()
                  setReleaseInspection(await onInspectReleaseTarget(backendUrl))
                })}
              >检查目标数据</button>
              <button
                type="button"
                disabled={Boolean(busyAction) || !schedulerUrl.trim()}
                onClick={() => void run('save-scheduler-target', saveSchedulerUrl)}
              >保存 Scheduler 地址</button>
              <button
                type="button"
                className="is-primary"
                disabled={Boolean(busyAction) || !releaseBackendUrl.trim()}
                onClick={() => void run('publish-release', async () => {
                  const backendUrl = normalizeBackendUrl(releaseBackendUrl)
                  setReleaseBackendUrl(backendUrl)
                  await saveSchedulerUrl()
                  setReleaseReceipt(await onPublishRelease(backendUrl))
                })}
              >发布、校验并切换</button>
              {releaseInspection && !releaseInspection.empty ? (
                <button
                  type="button"
                  className="is-danger"
                  disabled={Boolean(busyAction)}
                  onClick={() => {
                    const { templates, materials, workflows } =
                      releaseInspection.counts
                    const confirmed = globalThis.confirm(
                      `将永久删除目标 Backend 的 ${templates} 个模板、` +
                      `${materials} 个物料和 ${workflows} 个工作流，然后重新发布。` +
                      '\n\n此操作不可撤销，确定继续吗？'
                    )
                    if (!confirmed) return
                    void run('reset-and-publish-release', async () => {
                      setReleaseReceipt(await onPublishRelease(
                        releaseInspection.targetAddress,
                        true
                      ))
                      setReleaseInspection(null)
                    })
                  }}
                >清空并发布</button>
              ) : null}
            </>
          )}
        />
        <EnvironmentStatusCard
          name="OS"
          order={3}
          phase={edgeRuntime.phase}
          message={edgeRuntime.diagnostic ?? edgeRuntime.message}
          facts={[
            ['PID', String(edgeRuntime.pid ?? '—')],
            ['设备图', edgeRuntime.graphPath || session.configuredGraphPath],
            ['启动模式', edgeRuntime.mode === 'dry-run'
              ? 'Dry-run'
              : '正常运行'],
            ['Authority API', identity?.backendUrl ?? '—'],
            ['Python', identity?.environmentPath ?? '—']
          ]}
          content={(
            <>
              <label className="unilab-environment-manager__path">
                <span>设备图路径</span>
                {graphDeclarationInvalid ? (
                  <>
                    <select
                      aria-label="设备图路径"
                      aria-invalid="true"
                      value=""
                      disabled
                    >
                      <option value="">启动图声明无效</option>
                    </select>
                    <small role="alert">
                      Workspace Host 返回的启动图声明无效，请检查设备包或 OS 版本。
                    </small>
                  </>
                ) : graphChoiceClosed ? (
                  <select
                    aria-label="设备图路径"
                    value={resolveGraphPathSelection(
                      graphPath,
                      graphDeclaration
                    )}
                    disabled={Boolean(busyAction)}
                    onChange={event => setGraphPath(event.currentTarget.value)}
                  >
                    {graphCandidates.map(candidate => (
                      <option key={candidate} value={candidate}>
                        {graphPathOptionLabel(
                          candidate,
                          graphDeclaration?.defaultGraphPath
                        )}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label="设备图路径"
                    value={graphPath}
                    disabled={Boolean(busyAction)}
                    placeholder="deployment/graphs/example.json"
                    onChange={event => setGraphPath(event.currentTarget.value)}
                  />
                )}
                {!graphDeclarationInvalid && graphDeclaration?.defaultGraphPath ? (
                  <small>
                    包默认设备图：{graphDeclaration.defaultGraphPath}
                  </small>
                ) : null}
              </label>
              <ExternalDevicesOnlyControl
                checked={session.configuredExternalDevicesOnly}
                disabled={Boolean(busyAction)}
                onChange={enabled => run(
                  'external-devices-only',
                  () => onSetExternalDevicesOnly(enabled)
                )}
              />
              <RuntimeModeControl
                mode={edgeRuntime.mode ?? session.configuredRuntimeMode}
                disabled={Boolean(busyAction)}
                onSetRuntimeMode={mode => run(
                  'switch-mode',
                  () => onSetRuntimeMode(mode)
                )}
              />
            </>
          )}
          actions={(
            <>
              <button
                type="button"
                className="is-primary"
                disabled={
                  Boolean(busyAction)
                  || graphDeclarationInvalid
                  || !graphPath.trim()
                }
                onClick={() => void applyGraphPath()}
              >{session.phase === 'ready' ? '应用设备图并重建本地数据' : '保存设备图'}</button>
              <button
                type="button"
                className="is-port-action"
                aria-busy={busyAction === 'restart-os'}
                disabled={Boolean(busyAction)}
                onClick={() => void run('restart-os', onRestartSession)}
              >{busyAction === 'restart-os'
                  ? edgeRuntime.phase === 'ready'
                    ? '正在重启 OS…'
                    : '正在启动 OS…'
                  : edgeRuntime.phase === 'ready'
                    ? '重启 OS'
                    : '启动 OS'}</button>
              <button
                type="button"
                className="is-danger"
                disabled={Boolean(busyAction)}
                onClick={() => void run('stop-os', onStopSession)}
              >停止 OS</button>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  if (!globalThis.confirm('将停止占用 OS 本地端口的进程，确定继续吗？')) return
                  void run('release-os-ports', () => onReleaseEnvironmentPorts('os'))
                }}
              >释放端口</button>
            </>
          )}
        />

        <EnvironmentStatusCard
          name="PLC-Sim"
          order={3}
          phase={plcSimulator.phase}
          message={plcSimulator.diagnostic ?? plcSimulator.message}
          facts={[
            ['PID', String(plcSimulator.pid ?? '—')],
            ['变量表', plcSimulator.variableTablePath || '—'],
            ['握手器', plcSimulator.handshakeProfile === 'szlab' ? 'SZLab' : 'XUSE'],
            ['GUI', plcSimulator.guiUrl],
            ['OPC UA', plcSimulator.opcUaUrl]
          ]}
          content={(
            <>
              <label className="unilab-environment-manager__path">
                <span>项目目录</span>
                <input
                  value={plcProjectPath}
                  disabled={plcSimulator.phase !== 'idle' && plcSimulator.phase !== 'failed'}
                  placeholder="/path/to/PLC-Sim"
                  onChange={event => setPlcProjectPath(event.currentTarget.value)}
                />
              </label>
              <label className="unilab-environment-manager__path">
                <span>变量表</span>
                <input
                  list="unilab-plc-variable-tables"
                  aria-label="PLC 变量表路径"
                  value={plcVariableTablePath}
                  disabled={Boolean(busyAction) || !plcConfigurationEditable(plcSimulator.phase)}
                  placeholder="从当前项目推荐 CSV，或填写本地路径"
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
                <span>握手器</span>
                <select
                  value={plcHandshakeProfile}
                  disabled={plcSimulator.phase !== 'idle' && plcSimulator.phase !== 'failed'}
                  onChange={event => setPlcHandshakeProfile(
                    event.currentTarget.value as WorkbenchPlcHandshakeProfile
                  )}
                >
                  <option value="szlab">SZLab</option>
                  <option value="xuse">XUSE 通用</option>
                </select>
              </label>
            </>
          )}
          actions={(
            <>
              <button
                type="button"
                disabled={
                  Boolean(busyAction)
                  || !plcProjectPath.trim()
                  || !plcVariableTablePath.trim()
                  || plcSimulator.phase === 'ready'
                }
                onClick={() => void startPlcSimulator()}
              >启动 PLC-Sim</button>
              <button
                type="button"
                disabled={Boolean(busyAction) || plcSimulator.phase !== 'ready'}
                onClick={() => void run('stop-plc', onStopPlcSimulator)}
              >停止</button>
              <button
                type="button"
                disabled={
                  Boolean(busyAction)
                  || (
                    plcProjectPath.trim() === plcSimulator.projectPath
                    && plcVariableTablePath.trim() === plcSimulator.variableTablePath
                    && plcHandshakeProfile === plcSimulator.handshakeProfile
                  )
                }
                onClick={() => void savePlcConfiguration()}
              >保存配置</button>
              <button
                type="button"
                disabled={Boolean(busyAction) || plcSimulator.phase === 'ready'}
                onClick={() => void run('refresh-plc-tables', onRefreshPlcVariableTables)}
              >刷新 CSV 推荐</button>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => {
                  if (!globalThis.confirm('将停止占用 PLC-Sim 18765、4855 端口的进程，确定继续吗？')) return
                  void run('release-plc-ports', () => onReleaseEnvironmentPorts('plc-sim'))
                }}
              >释放端口</button>
            </>
          )}
        />

        <EnvironmentStatusCard
          name="Agent"
          order={4}
          phase={agent?.phase ?? 'idle'}
          message={agentStatusMessage(agent)}
          facts={[
            ['PID', String(agent?.pid ?? '—')],
            ['Workdir', agent?.workDir ?? identity?.workspacePath ?? '—'],
            ['Data', agent?.dataDir ?? '—']
          ]}
          actions={(
            <>
              {agent?.phase === 'ready' ? (
                <>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void run('restart-agent', onRestartAgent)}
                  >重启</button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void run('stop-agent', onStopAgent)}
                  >停止</button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(busyAction)
                    || agent?.phase === 'starting'
                    || agent?.phase === 'stopping'}
                  onClick={() => void run('start-agent', onStartAgent)}
                >{agent?.phase === 'failed' ? '重试' : '启动 Agent'}</button>
              )}
            </>
          )}
        />
        {remoteAccessApi ? (
          <RemoteAccessCard api={remoteAccessApi} />
        ) : null}
      </div>

      <section className="unilab-environment-manager__logs">
        <header>
          <strong>日志尾部</strong>
          <div role="group" aria-label="日志来源">
            {([
              ['workspace-backend', 'Backend'],
              ['os', 'OS'],
              ['plc-sim', 'PLC-Sim'],
              ['agent', 'Agent']
            ] as const).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className={logKind === kind ? 'is-active' : ''}
                onClick={() => {
                  setLogKind(kind)
                  setLogTail(null)
                }}
              >{label}</button>
            ))}
          </div>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => void readSelectedLog()}
          >刷新</button>
        </header>
        {logTail !== null ? (
          <pre data-testid="environment-log-tail">{logTail || '暂无日志'}</pre>
        ) : (
          <p>选择来源后点击“刷新”。</p>
        )}
      </section>
    </section>
    </div>
  )

  return typeof document === 'undefined'
    ? overlay
    : createPortal(overlay, document.body)
}

export function normalizeBackendUrl(value: string): string {
  const candidate = value.trim()
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('请输入有效的 Backend 地址，例如 http://127.0.0.1:8080')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Backend 地址仅支持 http 或 https')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Backend 地址只需填写协议、IP（或主机名）和端口')
  }
  return url.origin
}

export function normalizeSchedulerUrl(value: string): string {
  const candidate = value.trim()
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('请输入有效的 Scheduler 地址，例如 http://127.0.0.1:8081')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Scheduler 地址仅支持 http 或 https')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Scheduler 地址只需填写协议、IP（或主机名）和端口')
  }
  return url.origin
}

/** PLC 就绪态支持修改配置，保存后由会话层执行受控重启。 */
export function plcConfigurationEditable(
  phase: WorkbenchSessionSnapshot['plcSimulator']['phase']
): boolean {
  return phase === 'idle' || phase === 'failed' || phase === 'ready'
}

export function deriveSchedulerUrl(backendUrl: string): string {
  try {
    const backend = new URL(backendUrl.trim())
    if (!['http:', 'https:'].includes(backend.protocol) || !backend.hostname) return ''
    if (backend.port) {
      const port = Number(backend.port)
      if (!Number.isInteger(port) || port >= 65_535) return ''
      backend.port = String(port + 1)
    }
    backend.pathname = '/'
    backend.search = ''
    backend.hash = ''
    return backend.origin
  } catch {
    return ''
  }
}

function agentStatusMessage(
  agent: WorkbenchSessionSnapshot['agent']
): string {
  if (!agent) return '工作区 Agent 尚未启动'
  if (agent.diagnostic) return agent.diagnostic
  if (agent.phase === 'starting') return '正在启动工作区 Agent…'
  if (agent.phase === 'stopping') return '正在停止工作区 Agent…'
  if (agent.phase === 'ready') return '工作区 Agent 已就绪'
  return '工作区 Agent 启动失败'
}

function runtimeInstallationMessage(
  snapshot: ManagedRuntimeInstallationSnapshot
): string {
  if (snapshot.phase === 'ready') {
    return '应用私有 Runtime 已通过 unilab -h 验证；新工作区会自动使用。'
  }
  if (snapshot.phase === 'external') {
    return snapshot.error
      ? `当前使用现有 UniLab 环境；内置载荷异常：${snapshot.error}`
      : '当前使用已安装的 UniLab 环境。'
  }
  if (snapshot.phase === 'installing') return '正在离线安装并验证，请勿退出应用。'
  if (snapshot.phase === 'not-installed') {
    return '没有检测到 unilab；可从安装包离线安装应用私有 Runtime。'
  }
  if (snapshot.phase === 'failed') {
    return snapshot.error ?? 'Runtime 安装或检查失败。'
  }
  return '浏览器访问不提供本机 Runtime 安装能力。'
}

function RemoteAccessCard({
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
      setCopyStatus('访问链接已复制；请按凭据安全传递。')
    } catch {
      setCopyStatus('无法写入剪贴板，请重新开启远程访问后再试。')
    }
  }, [snapshot?.accessUrl])

  const current = snapshot ?? pendingRemoteSnapshot()
  const transitioning = current.phase === 'starting'
    || current.phase === 'stopping'
  return (
    <EnvironmentStatusCard
      name="远程访问"
      order={5}
      phase={current.phase}
      message={copyStatus ?? remoteAccessMessage(current)}
      facts={[
        ['入口', current.origin ?? '—'],
        ['PID', String(current.pid ?? '—')],
        ['Generation', current.generation ?? '—'],
        ['有效期', formatRemoteExpiry(current.expiresAt)]
      ]}
      actions={(
        <>
          {current.phase === 'ready' ? (
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
        </>
      )}
    />
  )
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
  if (snapshot.phase === 'ready') {
    return '本地 Electron 与远程浏览器正在共享同一个 WorkbenchSession。'
  }
  if (snapshot.phase === 'starting') return '正在建立鉴权浏览器门面…'
  if (snapshot.phase === 'stopping') return '正在撤销访问链接并关闭远程连接…'
  if (snapshot.phase === 'failed') return snapshot.error ?? '远程访问启动失败。'
  if (snapshot.phase === 'unavailable') return '当前不是受支持的桌面 Workbench。'
  return '关闭；Theia 与 OS 仍只接受本机连接。'
}

function formatRemoteExpiry(expiresAt: number | null): string {
  if (!expiresAt) return '—'
  return new Date(expiresAt).toLocaleString()
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
        <strong>仅加载外部设备包</strong>
        <small>
          取消勾选后同时加载 OS 内置 Registry；下次启动 OS 时生效。
        </small>
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
    const confirmed = next === 'normal'
      ? globalThis.confirm('关闭 Dry-run？新模式将在下次启动 OS 时生效，当前 OS 不会重启。')
      : globalThis.confirm(
          '启用 Dry-run？新模式将在下次启动 OS 时生效，当前 OS 不会重启。'
        )
    if (confirmed) void onSetRuntimeMode(next)
  }
  const button = (
    value: WorkbenchRuntimeMode,
    label: string,
    description: string,
    title?: string
  ): React.JSX.Element => {
    const selected = mode === value
    return (
      <button
        type="button"
        className={selected ? 'is-active' : ''}
        aria-label={selected ? `${label}（当前）` : label}
        aria-pressed={selected}
        disabled={disabled}
        title={title}
        onClick={() => select(value)}
      >
        {selected ? (
          <span className="codicon codicon-check" aria-hidden="true" />
        ) : null}
        <span className="unilab-environment-manager__mode-copy">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
      </button>
    )
  }
  return (
    <div className="unilab-environment-manager__mode" role="group" aria-label="OS 运行模式">
      {button('normal', '正常运行', '真实执行设备动作')}
      {button(
        'dry-run',
        'Dry-run',
        '仅模拟，不下发设备；下次启动生效',
        '动作返回模拟成功；切换模式不会重启 OS 或重建本地数据'
      )}
    </div>
  )
}

function EnvironmentStatusCard({
  name,
  order,
  phase,
  message,
  facts,
  content,
  actions
}: {
  name: string
  order?: number
  phase: string
  message: string
  facts: Array<[string, string]>
  content?: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <article
      className="unilab-environment-card"
      data-phase={phase}
      style={order === undefined ? undefined : { order }}
    >
      <span className={`unilab-environment-card__dot is-${phase}`} aria-hidden="true" />
      <div className="unilab-environment-card__body">
        <header>
          <strong>{name}</strong>
          <span>{phase}</span>
        </header>
        <p className="unilab-environment-card__message">{message}</p>
        <dl>
          {facts.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
        {content}
        {actions ? <div className="unilab-environment-card__actions">{actions}</div> : null}
      </div>
    </article>
  )
}
