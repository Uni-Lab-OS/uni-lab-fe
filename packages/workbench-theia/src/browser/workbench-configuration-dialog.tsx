import type {
  WorkbenchPlcHandshakeProfile,
  WorkbenchPlcSimulatorConfiguration,
  WorkbenchProductionConnectionConfiguration,
  WorkbenchProductionConnectionProbe,
  WorkbenchRuntimeMode,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'

export type WorkbenchConfigurationKind =
  | 'simulation'
  | 'hardware'
  | 'production'

export interface WorkbenchConfigurationOperations {
  configureGraph(graphPath: string): Promise<void>
  setExternalDevicesOnly(enabled: boolean): Promise<void>
  configurePlcSimulator(
    configuration: WorkbenchPlcSimulatorConfiguration
  ): Promise<void>
  setRuntimeMode(mode: WorkbenchRuntimeMode): Promise<void>
  startOs(): Promise<void>
  stopOs(): Promise<void>
  restartOs(): Promise<void>
  startPlcSimulator(): Promise<void>
  stopPlcSimulator(): Promise<void>
  resetRuntimeData(): Promise<void>
  configureProductionConnection(
    configuration: WorkbenchProductionConnectionConfiguration
  ): Promise<void>
  probeProductionConnection(
    configuration: WorkbenchProductionConnectionConfiguration
  ): Promise<WorkbenchProductionConnectionProbe>
  enterMode(mode: 'local' | 'backend'): void
}

/**
 * 渲染仿真调试、真实设备调试或生产模式的专用配置面板。
 *
 * @param props 当前权威快照、配置类型和 Workbench Session 操作集合。
 * @returns 不直接访问网络、由 Node 会话接缝执行配置与探测的模态面板。
 * @safety 停止、重启和重置操作均保留显式按钮，不随模式切换自动执行。
 */
export function WorkbenchConfigurationDialog({
  kind,
  session,
  operations,
  onClose
}: {
  kind: WorkbenchConfigurationKind
  session: WorkbenchSessionSnapshot
  operations: WorkbenchConfigurationOperations
  onClose: () => void
}): React.JSX.Element {
  const [graphPath, setGraphPath] = React.useState(
    session.configuredGraphPath
  )
  const [externalDevicesOnly, setExternalDevicesOnly] = React.useState(
    session.configuredExternalDevicesOnly
  )
  const [plcProjectPath, setPlcProjectPath] = React.useState(
    session.plcSimulator.projectPath
  )
  const [variableTablePath, setVariableTablePath] = React.useState(
    session.plcSimulator.variableTablePath
  )
  const [handshakeProfile, setHandshakeProfile] =
    React.useState<WorkbenchPlcHandshakeProfile>(
      session.plcSimulator.handshakeProfile
    )
  const [backendUrl, setBackendUrl] = React.useState(
    session.configuredBackendUrl ?? ''
  )
  const [schedulerUrl, setSchedulerUrl] = React.useState(
    session.configuredSchedulerUrl ?? ''
  )
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [probe, setProbe] =
    React.useState<WorkbenchProductionConnectionProbe | null>(null)

  const run = React.useCallback(async (
    action: string,
    operation: () => Promise<void>
  ): Promise<boolean> => {
    if (busyAction) return false
    setBusyAction(action)
    setError(null)
    try {
      await operation()
      return true
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : String(operationError)
      )
      return false
    } finally {
      setBusyAction(null)
    }
  }, [busyAction])

  const productionConfiguration = React.useMemo(() => ({
    backendUrl,
    schedulerUrl
  }), [backendUrl, schedulerUrl])

  const saveDebugConfiguration = React.useCallback(async (): Promise<void> => {
    const saved = await run('save', async () => {
      await operations.configureGraph(graphPath)
      await operations.setExternalDevicesOnly(externalDevicesOnly)
      await operations.setRuntimeMode(kind === 'simulation' ? 'dry-run' : 'normal')
    })
    if (saved) {
      operations.enterMode('local')
      onClose()
    }
  }, [
    externalDevicesOnly,
    graphPath,
    kind,
    onClose,
    operations,
    run
  ])

  const saveSimulationConfiguration = React.useCallback(
    async (): Promise<void> => {
      const saved = await run('save', async () => {
        await operations.configureGraph(graphPath)
        await operations.setExternalDevicesOnly(externalDevicesOnly)
        await operations.setRuntimeMode('dry-run')
        await operations.configurePlcSimulator({
          projectPath: plcProjectPath,
          variableTablePath,
          handshakeProfile
        })
      })
      if (saved) {
        operations.enterMode('local')
        onClose()
      }
    },
    [
      externalDevicesOnly,
      graphPath,
      handshakeProfile,
      onClose,
      operations,
      plcProjectPath,
      run,
      variableTablePath
    ]
  )

  const saveProductionConfiguration = React.useCallback(
    async (): Promise<void> => {
      const saved = await run('save', () =>
        operations.configureProductionConnection(productionConfiguration)
      )
      if (saved) {
        operations.enterMode('backend')
        onClose()
      }
    }, [onClose, operations, productionConfiguration, run]
  )

  const testProductionConnection = React.useCallback(async (): Promise<void> => {
    if (busyAction) return
    setBusyAction('probe')
    setError(null)
    setProbe(null)
    try {
      setProbe(await operations.probeProductionConnection(
        productionConfiguration
      ))
    } catch (operationError) {
      setError(
        operationError instanceof Error
          ? operationError.message
          : String(operationError)
      )
    } finally {
      setBusyAction(null)
    }
  }, [busyAction, operations, productionConfiguration])

  const copy = configurationCopy(kind)
  const debug = kind !== 'production'
  const plcReady = session.plcSimulator.phase === 'ready'
  const plcCanStart = canStartRuntime(session.plcSimulator.phase)
  const osReady = session.edgeRuntime.phase === 'ready'
  const osCanStart = canStartRuntime(session.edgeRuntime.phase)

  return (
    <div
      className="unilab-config-dialog__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyAction) onClose()
      }}
    >
      <section
        className="unilab-config-dialog"
        data-kind={kind}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unilab-config-dialog-title"
      >
        <header className="unilab-config-dialog__header">
          <span className={`codicon ${copy.icon}`} aria-hidden="true" />
          <div>
            <span>{copy.eyebrow}</span>
            <h2 id="unilab-config-dialog-title">{copy.title}</h2>
            <p>{copy.description}</p>
          </div>
          <button
            type="button"
            className="unilab-config-dialog__close"
            disabled={Boolean(busyAction)}
            aria-label="关闭配置"
            onClick={onClose}
          >
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </header>

        <div className="unilab-config-dialog__body">
          {debug ? (
            <>
              <div className="unilab-config-dialog__status-grid">
                {kind === 'simulation' ? (
                  <>
                    <RuntimeStatus
                      label="PLC-Sim"
                      phase={session.plcSimulator.phase}
                      detail={session.plcSimulator.message}
                    />
                    <RuntimeStatus
                      label="Uni-Lab OS"
                      phase={session.edgeRuntime.phase}
                      detail={session.edgeRuntime.message}
                    />
                  </>
                ) : (
                  <>
                    <RuntimeStatus
                      label="Uni-Lab OS"
                      phase={session.edgeRuntime.phase}
                      detail={session.edgeRuntime.message}
                    />
                    <RuntimeStatus
                      label="设备来源"
                      phase={session.phase}
                      detail="使用当前工作区设备包与设备图"
                    />
                  </>
                )}
              </div>

              {kind === 'simulation' ? (
                <fieldset>
                  <legend>PLC-Sim 配置</legend>
                  <label>
                    <span>PLC-Sim 项目路径</span>
                    <input
                      value={plcProjectPath}
                      onChange={(event) => setPlcProjectPath(
                        event.currentTarget.value
                      )}
                    />
                  </label>
                  <label>
                    <span>变量表路径</span>
                    <input
                      value={variableTablePath}
                      onChange={(event) => setVariableTablePath(
                        event.currentTarget.value
                      )}
                    />
                  </label>
                  <label>
                    <span>握手配置</span>
                    <select
                      value={handshakeProfile}
                      onChange={(event) => setHandshakeProfile(
                        event.currentTarget.value as WorkbenchPlcHandshakeProfile
                      )}
                    >
                      <option value="szlab">SZLab</option>
                      <option value="xuse">XUSE</option>
                    </select>
                  </label>
                  <div className="unilab-config-dialog__module-actions">
                    <button
                      type="button"
                      className={plcCanStart ? 'is-primary' : undefined}
                      disabled={Boolean(busyAction) || !plcCanStart}
                      onClick={() => void run(
                        'start-plc',
                        operations.startPlcSimulator
                      )}
                    >启动 PLC-Sim</button>
                    <button
                      type="button"
                      className={plcReady ? 'is-runtime-stop' : undefined}
                      disabled={Boolean(busyAction) || !plcReady}
                      onClick={() => void run(
                        'stop-plc',
                        operations.stopPlcSimulator
                      )}
                    >停止 PLC-Sim</button>
                  </div>
                </fieldset>
              ) : null}

              <fieldset>
                <legend>{kind === 'simulation' ? 'Uni-Lab OS 配置' : '设备图'}</legend>
                <label>
                  <span>设备图路径</span>
                  <input
                    value={graphPath}
                    onChange={(event) => setGraphPath(event.currentTarget.value)}
                    placeholder="deployment/graphs/device-graph.json"
                  />
                </label>
                <label className="unilab-config-dialog__check">
                  <input
                    type="checkbox"
                    checked={externalDevicesOnly}
                    onChange={(event) => setExternalDevicesOnly(
                      event.currentTarget.checked
                    )}
                  />
                  <span>仅加载工作区安装的设备包</span>
                </label>
                <div className="unilab-config-dialog__module-actions">
                  <button
                    type="button"
                    className={osCanStart ? 'is-primary' : undefined}
                    disabled={Boolean(busyAction) || !osCanStart}
                    onClick={() => void run('start-os', operations.startOs)}
                  >启动 OS</button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction) || !osReady}
                    onClick={() => void run('restart-os', operations.restartOs)}
                  >重启 OS</button>
                  <button
                    type="button"
                    className={osReady ? 'is-runtime-stop' : undefined}
                    disabled={Boolean(busyAction) || !osReady}
                    onClick={() => void run('stop-os', operations.stopOs)}
                  >停止 OS</button>
                  <button
                    type="button"
                    className="is-danger"
                    disabled={Boolean(busyAction)}
                    onClick={() => void run(
                      'reset-data',
                      operations.resetRuntimeData
                    )}
                  >重置运行数据</button>
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <div className="unilab-config-dialog__notice">
                生产模式只切换数据与调度权威。连接测试验证网络可达性，
                不会发布工作区数据或创建任务。
              </div>
              <fieldset>
                <legend>生产连接</legend>
                <label>
                  <span>Backend 地址</span>
                  <input
                    type="url"
                    value={backendUrl}
                    onChange={(event) => {
                      setBackendUrl(event.currentTarget.value)
                      setProbe(null)
                    }}
                    placeholder="https://backend.example.com"
                  />
                </label>
                <label>
                  <span>调度器（Scheduler）地址</span>
                  <input
                    type="url"
                    value={schedulerUrl}
                    onChange={(event) => {
                      setSchedulerUrl(event.currentTarget.value)
                      setProbe(null)
                    }}
                    placeholder="https://scheduler.example.com"
                  />
                </label>
                <button
                  type="button"
                  className="unilab-config-dialog__probe"
                  disabled={Boolean(busyAction)}
                  onClick={() => void testProductionConnection()}
                >
                  <span className="codicon codicon-debug-disconnect" aria-hidden="true" />
                  {busyAction === 'probe' ? '正在测试…' : '一键测试连接'}
                </button>
              </fieldset>
              {probe ? <ConnectionProbeResult probe={probe} /> : null}
            </>
          )}

          {error ? (
            <div className="unilab-config-dialog__error" role="alert">
              <strong>操作未完成</strong>
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <footer className="unilab-config-dialog__footer">
          <button type="button" disabled={Boolean(busyAction)} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={Boolean(busyAction)}
            onClick={() => void (
              kind === 'production'
                ? saveProductionConfiguration()
                : kind === 'simulation'
                  ? saveSimulationConfiguration()
                  : saveDebugConfiguration()
            )}
          >
            {busyAction === 'save' ? '正在保存…' : copy.saveLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}

/** 只有稳定停止或失败态允许再次启动，避免过渡态重复提交生命周期命令。 */
function canStartRuntime(phase: string): boolean {
  return phase === 'idle' || phase === 'failed'
}

/** 以会话事实渲染一个运行组件状态摘要。 */
function RuntimeStatus({
  label,
  phase,
  detail
}: {
  label: string
  phase: string
  detail: string
}): React.JSX.Element {
  return (
    <article className="unilab-config-dialog__status" data-phase={phase}>
      <span aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <em>{phase}</em>
    </article>
  )
}

/** 展示连接检测的传输层结果，并避免把可达性描述成服务已就绪。 */
function ConnectionProbeResult({
  probe
}: {
  probe: WorkbenchProductionConnectionProbe
}): React.JSX.Element {
  return (
    <section className="unilab-config-dialog__probe-result" aria-live="polite">
      {[['Backend', probe.backend], ['调度器（Scheduler）', probe.scheduler]]
        .map(([label, result]) => {
          const endpoint = result as WorkbenchProductionConnectionProbe['backend']
          return (
            <article key={label as string} data-reachable={endpoint.reachable}>
              <span className={`codicon ${
                endpoint.reachable ? 'codicon-pass-filled' : 'codicon-error'
              }`} aria-hidden="true" />
              <div>
                <strong>{label as string}</strong>
                <small>{endpoint.message} · {endpoint.latencyMs} ms</small>
              </div>
            </article>
          )
        })}
      <p>以上仅表示网络可达性；业务权限和调度能力在进入生产模式后继续校验。</p>
    </section>
  )
}

/** 返回配置类型对应的固定产品文案。 */
function configurationCopy(kind: WorkbenchConfigurationKind): {
  eyebrow: string
  title: string
  description: string
  saveLabel: string
  icon: string
} {
  if (kind === 'simulation') return {
    eyebrow: 'SIMULATION DEBUG',
    title: '仿真调试配置',
    description: '配置设备图、PLC-Sim，并显式控制 OS 与仿真进程。',
    saveLabel: '保存并进入仿真调试',
    icon: 'codicon-beaker'
  }
  if (kind === 'hardware') return {
    eyebrow: 'HARDWARE DEBUG',
    title: '真实设备调试配置',
    description: '使用当前工作区设备包与设备图连接真实设备。',
    saveLabel: '保存并进入真实设备调试',
    icon: 'codicon-plug'
  }
  return {
    eyebrow: 'PRODUCTION',
    title: '生产模式配置',
    description: '配置生产 Backend 与调度器（Scheduler）权威。',
    saveLabel: '保存并进入生产模式',
    icon: 'codicon-server-process'
  }
}
