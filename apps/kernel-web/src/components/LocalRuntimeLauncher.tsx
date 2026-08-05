import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import type {
  DesktopRuntimeApi,
  LocalRuntimeLaunchConfig,
  LocalRuntimeLogBatch,
  LocalRuntimeLogCursor,
  LocalRuntimeLogsSnapshot,
  LocalRuntimePathKind,
  LocalRuntimeProcessKind,
  LocalRuntimeSnapshot
} from '../types/electron'

import LocalRuntimeEdgeCommandEditor from './LocalRuntimeEdgeCommandEditor'
import styles from './LocalRuntimeLauncher.module.scss'

const STORAGE_KEY = 'unilab.local-runtime-launch-config.v3'
const LEGACY_STORAGE_KEYS = [
  'unilab.local-runtime-launch-config.v2',
  'unilab.local-runtime-launch-config.v1'
] as const
const EMPTY_CONFIG: LocalRuntimeLaunchConfig = {
  graphPath: '',
  osProjectPath: '',
  szlabProjectPath: '',
  environmentPath: '',
  simulatorProjectPath: '',
  edgeCommandMode: 'generated',
  customEdgeCommand: {
    executable: '',
    args: []
  }
}
const IDLE_SNAPSHOT: LocalRuntimeSnapshot = {
  phase: 'idle',
  message: 'PLC-Sim 与领域侧 Edge 均未启动',
  simulatorRunning: false,
  bridgeRunning: false,
  edgeRunning: false
}
const OBSERVABILITY_LOG_CHECK_INTERVAL_MS = 2_000
const OBSERVABILITY_LOG_CHECK_LIMIT = 15
const LOCAL_RUNTIME_LOG_MAX_LINES = 2_000

/** 合并一个游标批次，并把每个来源的内存内容限制在最近固定行数。 */
function mergeLocalRuntimeLogBatch(
  current: LocalRuntimeLogsSnapshot | null,
  batch: LocalRuntimeLogBatch
): LocalRuntimeLogsSnapshot {
  const previous = current?.entries.find((entry) => entry.kind === batch.kind)
  const combined = batch.reset
    ? batch.content
    : `${previous?.content ?? ''}${batch.content}`
  const lines = combined.split(/\r?\n/)
  const hasTrailingNewline = /\r?\n$/.test(combined)
  if (hasTrailingNewline) lines.pop()
  const dropped = lines.length > LOCAL_RUNTIME_LOG_MAX_LINES
  const retainedLines = dropped
    ? lines.slice(-LOCAL_RUNTIME_LOG_MAX_LINES)
    : lines
  const content = retainedLines.join('\n') + (hasTrailingNewline ? '\n' : '')
  const nextEntry = {
    kind: batch.kind,
    content,
    available: batch.available,
    truncated: batch.truncated || dropped || (!batch.reset && Boolean(previous?.truncated))
  }
  const entries = [
    ...(current?.entries.filter((entry) => entry.kind !== batch.kind) ?? []),
    nextEntry
  ].sort((left, right) => (
    Number(left.kind !== 'simulator') - Number(right.kind !== 'simulator')
  ))
  return { readAt: batch.readAt, entries }
}

interface LocalRuntimeLauncherProps {
  runtimeApi?: DesktopRuntimeApi
  onReady?: () => void
  onStopping?: () => void | Promise<void>
}

interface LocalRuntimeLogLauncherProps {
  runtimeApi?: DesktopRuntimeApi
  variant?: 'toolbar' | 'dialog'
  onOpenChange?: (open: boolean) => void
}

export function LocalRuntimeLogLauncher({
  runtimeApi = desktopRuntimeApi(),
  variant = 'toolbar',
  onOpenChange
}: LocalRuntimeLogLauncherProps): React.JSX.Element | null {
  const instanceId = useId()
  const drawerId = `local-runtime-log-drawer-${instanceId}`
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] =
    useState<LocalRuntimeLogsSnapshot | null>(null)
  const [activeKind, setActiveKind] =
    useState<LocalRuntimeProcessKind>('edge')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [following, setFollowing] = useState(true)
  const readSequenceRef = useRef(0)
  const snapshotRef = useRef<LocalRuntimeLogsSnapshot | null>(null)
  const cursorRef = useRef<Partial<Record<
    LocalRuntimeProcessKind,
    LocalRuntimeLogCursor | null
  >>>({})

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])
  useDeviceCardSurfaceOcclusion(`local-runtime-log-${variant}`, open)

  const closeLogs = useCallback((): void => {
    setOpen(false)
    onOpenChange?.(false)
  }, [onOpenChange])

  const refresh = useCallback(async (
    kind: LocalRuntimeProcessKind = activeKind
  ): Promise<void> => {
    if (!runtimeApi) return
    const requestSequence = ++readSequenceRef.current
    setLoading(true)
    setError(null)
    try {
      let nextSnapshot: LocalRuntimeLogsSnapshot
      let nextCursor: LocalRuntimeLogCursor | null | undefined
      if (runtimeApi.readLog) {
        const batch = await runtimeApi.readLog({
          kind,
          cursor: cursorRef.current[kind] ?? null
        })
        nextSnapshot = mergeLocalRuntimeLogBatch(snapshotRef.current, batch)
        nextCursor = batch.cursor
      } else {
        nextSnapshot = await runtimeApi.readLogs()
      }
      if (requestSequence !== readSequenceRef.current) return
      if (nextCursor !== undefined) cursorRef.current[kind] = nextCursor
      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
    } catch (readError) {
      if (requestSequence === readSequenceRef.current) {
        setError(errorMessage(readError))
      }
    } finally {
      if (requestSequence === readSequenceRef.current) {
        setLoading(false)
      }
    }
  }, [activeKind, runtimeApi])

  useEffect(() => {
    if (!open || !following) return
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      void refresh(activeKind)
    }
    const refreshTimer = globalThis.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refresh(activeKind)
      }
    }, 2_000)
    return () => {
      globalThis.clearInterval(refreshTimer)
      readSequenceRef.current += 1
    }
  }, [activeKind, following, open, refresh])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeLogs()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeLogs, open])

  if (!runtimeApi) return null

  const openLogs = (): void => {
    cursorRef.current = {}
    snapshotRef.current = null
    setSnapshot(null)
    setFollowing(true)
    setError(null)
    setOpen(true)
    onOpenChange?.(true)
  }

  return (
    <>
      <button
        type="button"
        className={variant === 'dialog'
          ? `${styles.secondaryButton} ${styles.headerLogButton}`
          : styles.launcherButton}
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={openLogs}
      >
        查看日志
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <LocalRuntimeLogDrawer
              instanceId={instanceId}
              snapshot={snapshot}
              activeKind={activeKind}
              loading={loading}
              error={error}
              following={following}
              onFollowChange={setFollowing}
              onSelect={(kind) => {
                setActiveKind(kind)
                setFollowing(true)
              }}
              onRefresh={() => void refresh()}
              onOpenFile={() => {
                if (!runtimeApi.openLogFile) return
                setError(null)
                void runtimeApi.openLogFile(activeKind).then((result) => {
                  if (!result.opened) setError(result.error ?? '无法打开日志文件')
                }).catch((openError: unknown) => {
                  setError(errorMessage(openError))
                })
              }}
              onClose={closeLogs}
            />,
            document.body
          )
        : null}
    </>
  )
}

/**
 * 组合桌面端本地调试入口、配置持久化和 PLC-Sim/领域侧 Edge 启停交互。
 *
 * @param props Electron 本地运行接口与启停通知回调。
 * @returns 桌面环境中的启动按钮和按需渲染的配置弹窗；Web 环境返回 null。
 */
export default function LocalRuntimeLauncher({
  runtimeApi = desktopRuntimeApi(),
  onReady,
  onStopping
}: LocalRuntimeLauncherProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState(readStoredConfig)
  const [snapshot, setSnapshot] = useState(IDLE_SNAPSHOT)
  const [localError, setLocalError] = useState<string | null>(null)
  const [simulatorSubmitted, setSimulatorSubmitted] = useState(false)
  const [edgeSubmitted, setEdgeSubmitted] = useState(false)
  const [resolvingGeneratedEdgeCommand, setResolvingGeneratedEdgeCommand] =
    useState(false)
  const [dialogLogsOpen, setDialogLogsOpen] = useState(false)
  const [phoenixDependencyMissing, setPhoenixDependencyMissing] = useState(false)
  const readyNotificationSentRef = useRef(false)
  useDeviceCardSurfaceOcclusion('local-runtime-dialog', open)

  useEffect(() => {
    if (!runtimeApi) return
    let active = true
    void runtimeApi.getSnapshot().then((nextSnapshot) => {
      if (active) setSnapshot(nextSnapshot)
    }).catch((error: unknown) => {
      if (active) setLocalError(errorMessage(error))
    })
    const unsubscribe = runtimeApi.onSnapshot((nextSnapshot) => {
      if (active) setSnapshot(nextSnapshot)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [runtimeApi])

  useEffect(() => {
    const edgeReady = snapshot.phase === 'ready' && snapshot.edgeRunning
    if (!edgeReady) {
      readyNotificationSentRef.current = false
      return
    }
    if (readyNotificationSentRef.current) return
    readyNotificationSentRef.current = true
    onReady?.()
  }, [onReady, snapshot.edgeRunning, snapshot.phase])

  useEffect(() => {
    const edgeReady = snapshot.phase === 'ready' && snapshot.edgeRunning
    if (!runtimeApi || !edgeReady) {
      setPhoenixDependencyMissing(false)
      return
    }
    if (phoenixDependencyMissing) return

    let active = true
    let checksRemaining = OBSERVABILITY_LOG_CHECK_LIMIT
    let nextCheckTimer: ReturnType<typeof globalThis.setTimeout> | undefined

    const inspectEdgeLogs = async (): Promise<void> => {
      try {
        const logs = await runtimeApi.readLogs()
        if (!active) return
        const edgeLog = logs.entries.find((entry) => entry.kind === 'edge')
        if (detectPhoenixObservabilityDependencyIssue(edgeLog?.content ?? '')) {
          setPhoenixDependencyMissing(true)
          return
        }
      } catch {
        // 日志读取失败已有日志抽屉负责呈现；这里仅做非阻塞的依赖提示检测。
      }

      checksRemaining -= 1
      if (active && checksRemaining > 0) {
        nextCheckTimer = globalThis.setTimeout(
          () => void inspectEdgeLogs(),
          OBSERVABILITY_LOG_CHECK_INTERVAL_MS
        )
      }
    }

    void inspectEdgeLogs()
    return () => {
      active = false
      if (nextCheckTimer !== undefined) {
        globalThis.clearTimeout(nextCheckTimer)
      }
    }
  }, [phoenixDependencyMissing, runtimeApi, snapshot.edgeRunning, snapshot.phase])

  useEffect(() => {
    if (!runtimeApi || config.environmentPath.trim()) return
    let active = true
    void runtimeApi.getDefaultEnvironmentPath().then((environmentPath) => {
      if (!active || !environmentPath) return
      setConfig((current) => current.environmentPath.trim()
        ? current
        : { ...current, environmentPath })
    }).catch(() => {
      // 自动识别是非阻塞增强，失败时保留系统目录选择入口。
    })
    return () => {
      active = false
    }
  }, [config.environmentPath, runtimeApi])

  useEffect(() => {
    if (typeof globalThis.localStorage === 'undefined') return
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (!dialogLogsOpen && !isTransitioning(snapshot)) setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [dialogLogsOpen, open, snapshot])

  if (!runtimeApi) return null

  const simulatorValidation = validateSimulatorConfig(config)
  const edgeValidation = validateEdgeConfig(config)
  const transitioning = isTransitioning(snapshot)

  const closeDialog = (): void => {
    setDialogLogsOpen(false)
    setOpen(false)
  }

  /**
   * 打开受控系统路径选择器，并把结果写入对应的平面路径或自定义命令字段。
   *
   * @param kind 共享合同声明的路径类别。
   */
  const choosePath = async (kind: LocalRuntimePathKind): Promise<void> => {
    setLocalError(null)
    try {
      const path = await runtimeApi.selectPath(kind)
      if (!path) return
      setConfig((current) => kind === 'edgeExecutable'
        ? {
            ...current,
            customEdgeCommand: {
              ...current.customEdgeCommand,
              executable: path
            }
          }
        : {
            ...current,
            [pathField(kind)]: path
          })
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  const startSimulator = async (): Promise<void> => {
    setSimulatorSubmitted(true)
    setLocalError(null)
    if (!simulatorValidation.valid) return
    try {
      setSnapshot(await runtimeApi.startSimulator(config))
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  const stopSimulator = async (): Promise<void> => {
    setLocalError(null)
    try {
      setSnapshot(await runtimeApi.stopSimulator())
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  const startEdge = async (): Promise<void> => {
    setEdgeSubmitted(true)
    setLocalError(null)
    if (!edgeValidation.valid) return
    try {
      setSnapshot(await runtimeApi.startEdge(config))
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }

  const stopEdge = async (): Promise<void> => {
    setLocalError(null)
    try {
      await onStopping?.()
      setSnapshot(await runtimeApi.stopEdge())
    } catch (error) {
      onReady?.()
      setLocalError(errorMessage(error))
    }
  }

  /**
   * 请求 Electron 主进程解析当前系统默认 Edge 计划，并显式复制为可编辑自定义参数。
   *
   * @returns 解析成功后更新配置；路径无效或旧 preload 不支持时保留用户输入并显示错误。
   */
  const loadGeneratedEdgeCommand = async (): Promise<void> => {
    setEdgeSubmitted(true)
    setLocalError(null)
    const generatedValidation = validateEdgeConfig({
      ...config,
      edgeCommandMode: 'generated'
    })
    if (!generatedValidation.valid) return
    if (!runtimeApi.resolveGeneratedEdgeCommand) {
      setLocalError('当前桌面端版本不支持解析系统默认 Edge 命令')
      return
    }
    setResolvingGeneratedEdgeCommand(true)
    try {
      const preview = await runtimeApi.resolveGeneratedEdgeCommand(config)
      setConfig((current) => ({
        ...current,
        edgeCommandMode: 'custom',
        customEdgeCommand: {
          executable: preview.executable,
          args: [...preview.args]
        }
      }))
    } catch (error) {
      setLocalError(errorMessage(error))
    } finally {
      setResolvingGeneratedEdgeCommand(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.launcherButton}
        data-runtime-phase={snapshot.phase}
        data-observability-degraded={phoenixDependencyMissing || undefined}
        onClick={() => setOpen(true)}
      >
        <span className={styles.launcherDot} aria-hidden="true" />
        {launcherLabel(snapshot)}
        {phoenixDependencyMissing ? ' · Trace 降级' : ''}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <LocalRuntimeDialog
              config={config}
              snapshot={snapshot}
              error={localError ?? snapshot.error ?? null}
              simulatorSubmitted={simulatorSubmitted}
              edgeSubmitted={edgeSubmitted}
              resolvingGeneratedEdgeCommand={resolvingGeneratedEdgeCommand}
              simulatorValidation={simulatorValidation}
              edgeValidation={edgeValidation}
              phoenixDependencyMissing={phoenixDependencyMissing}
              onChange={setConfig}
              onChoosePath={(kind) => void choosePath(kind)}
              onClose={closeDialog}
              onStartSimulator={() => void startSimulator()}
              onStopSimulator={() => void stopSimulator()}
              onStartEdge={() => void startEdge()}
              onStopEdge={() => void stopEdge()}
              onLoadGeneratedEdgeCommand={loadGeneratedEdgeCommand}
              transitioning={transitioning}
              logControl={(
                <LocalRuntimeLogLauncher
                  runtimeApi={runtimeApi}
                  variant="dialog"
                  onOpenChange={setDialogLogsOpen}
                />
              )}
            />,
            document.body
          )
        : null}
    </>
  )
}

interface LocalRuntimeDialogProps {
  config: LocalRuntimeLaunchConfig
  snapshot: LocalRuntimeSnapshot
  error: string | null
  simulatorSubmitted: boolean
  edgeSubmitted: boolean
  resolvingGeneratedEdgeCommand: boolean
  simulatorValidation: ValidationResult
  edgeValidation: ValidationResult
  phoenixDependencyMissing?: boolean
  transitioning: boolean
  onChange: (config: LocalRuntimeLaunchConfig) => void
  onChoosePath: (kind: LocalRuntimePathKind) => void
  onClose: () => void
  onStartSimulator: () => void
  onStopSimulator: () => void
  onStartEdge: () => void
  onStopEdge: () => void
  onLoadGeneratedEdgeCommand: () => void
  logControl?: ReactNode
}

/**
 * 呈现本地调试配置与两个独立服务的权威进程状态。
 *
 * @param props 当前配置、进程快照、校验结果和受控启停回调。
 * @returns 可通过键盘操作的桌面端配置对话框。
 */
export function LocalRuntimeDialog({
  config,
  snapshot,
  error,
  simulatorSubmitted,
  edgeSubmitted,
  resolvingGeneratedEdgeCommand,
  simulatorValidation,
  edgeValidation,
  phoenixDependencyMissing = false,
  transitioning,
  onChange,
  onChoosePath,
  onClose,
  onStartSimulator,
  onStopSimulator,
  onStartEdge,
  onStopEdge,
  onLoadGeneratedEdgeCommand,
  logControl
}: LocalRuntimeDialogProps): React.JSX.Element {
  const simulatorTransitioning = isSimulatorTransitioning(snapshot)
  const edgeTransitioning = isEdgeTransitioning(snapshot)
  const simulatorActive = snapshot.simulatorRunning
  const edgeActive = snapshot.bridgeRunning || snapshot.edgeRunning
  const environmentDisabled = simulatorActive || edgeActive || transitioning
  const simulatorDisabled = simulatorActive
    || edgeActive
    || simulatorTransitioning
    || edgeTransitioning
  const edgeDisabled = edgeActive || edgeTransitioning

  return (
    <div className={styles.backdrop}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-runtime-title"
        aria-describedby="local-runtime-description"
      >
        <header className={styles.header}>
          <div>
            <h2 id="local-runtime-title">
              启动领域侧本地调试环境（以 sz_lab 为例）
            </h2>
            <p id="local-runtime-description">
              分别启动 PLC-Sim 和领域侧 Edge，由你决定是否使用本地 PLC。
            </p>
          </div>
          <div className={styles.headerActions}>
            {logControl}
            <button
              type="button"
              className={styles.closeButton}
              aria-label="关闭本地环境配置"
              disabled={transitioning}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <div className={styles.fields}>
            <PathField
              id="runtime-environment-path"
              label="unilab Conda 环境目录"
              value={config.environmentPath}
              placeholder="自动识别，或选择 Conda 环境目录"
              buttonLabel="选择目录"
              disabled={environmentDisabled}
              invalid={Boolean(
                (simulatorSubmitted
                  && simulatorValidation.errors.environmentPath)
                || (edgeSubmitted
                  && edgeValidation.errors.environmentPath)
              )}
              error={simulatorSubmitted
                ? simulatorValidation.errors.environmentPath
                : edgeSubmitted
                  ? edgeValidation.errors.environmentPath
                  : undefined}
              autoFocus
              onChoose={() => onChoosePath('environment')}
            />
          </div>

          <section
            className={styles.serviceSection}
            aria-labelledby="local-plc-title"
          >
            <header className={styles.serviceHeader}>
              <div>
                <h3 id="local-plc-title">PLC-Sim（可选）</h3>
                <p>启动本地 OPC UA，监听 127.0.0.1:18765。</p>
              </div>
              <button
                type="button"
                className={simulatorActive
                  ? styles.stopButton
                  : styles.primaryButton}
                disabled={simulatorTransitioning
                  || edgeActive
                  || edgeTransitioning}
                onClick={simulatorActive
                  ? onStopSimulator
                  : onStartSimulator}
              >
                {simulatorControlLabel(snapshot, simulatorActive)}
              </button>
            </header>
            <PathField
              id="runtime-simulator-path"
              label="PLC-Sim 项目根目录"
              value={config.simulatorProjectPath}
              placeholder="选择包含 OpcUaSim 的 PLC-Sim 项目根目录"
              buttonLabel="选择目录"
              disabled={simulatorDisabled}
              invalid={simulatorSubmitted
                && Boolean(simulatorValidation.errors.simulatorProjectPath)}
              error={simulatorSubmitted
                ? simulatorValidation.errors.simulatorProjectPath
                : undefined}
              editable
              onValueChange={(simulatorProjectPath) => onChange({
                ...config,
                simulatorProjectPath
              })}
              onChoose={() => onChoosePath('simulator')}
            />
          </section>

          <section
            className={styles.serviceSection}
            aria-labelledby="local-edge-title"
          >
            <header className={styles.serviceHeader}>
              <div>
                <h3 id="local-edge-title">
                  领域侧 Edge（以 sz_lab 为例）
                </h3>
                <p>启动领域设备图、本地服务和 Edge 运行时。</p>
              </div>
              <button
                type="button"
                className={edgeActive
                  ? styles.stopButton
                  : styles.primaryButton}
                disabled={edgeTransitioning || simulatorTransitioning}
                onClick={edgeActive ? onStopEdge : onStartEdge}
              >
                {edgeControlLabel(snapshot, edgeActive)}
              </button>
            </header>

            {phoenixDependencyMissing ? (
              <PhoenixDependencyRecoveryNotice
                osProjectPath={config.osProjectPath}
              />
            ) : null}

            <div className={styles.dependencyNotice} role="note">
              <strong>使用 PLC 时，请先上传变量表</strong>
              <span>
                先启动 PLC-Sim，在 PLC-Sim 中上传 PLC 变量表，确认完成后再启动领域侧 Edge。
              </span>
            </div>

            <div className={styles.fields}>
              <PathField
                id="runtime-os-path"
                label="Uni-Lab-OS 项目根目录"
                value={config.osProjectPath}
                placeholder="选择 Uni-Lab-OS 项目根目录"
                buttonLabel="选择目录"
                disabled={edgeDisabled}
                invalid={edgeSubmitted
                  && Boolean(edgeValidation.errors.osProjectPath)}
                error={edgeSubmitted
                  ? edgeValidation.errors.osProjectPath
                  : undefined}
                editable
                onValueChange={(osProjectPath) => onChange({
                  ...config,
                  osProjectPath
                })}
                onChoose={() => onChoosePath('os')}
              />
              <PathField
                id="runtime-szlab-path"
                label="领域项目根目录（可选，以 Uni-Lab-SZLab 为例）"
                value={config.szlabProjectPath}
                placeholder="可留空，或选择领域项目根目录"
                buttonLabel="选择目录"
                disabled={edgeDisabled}
                invalid={edgeSubmitted
                  && Boolean(edgeValidation.errors.szlabProjectPath)}
                error={edgeSubmitted
                  ? edgeValidation.errors.szlabProjectPath
                  : undefined}
                editable
                onValueChange={(szlabProjectPath) => onChange({
                  ...config,
                  szlabProjectPath
                })}
                onChoose={() => onChoosePath('szlab')}
              />
              <p className={styles.fieldHint}>
                留空时仅加载 Uni-Lab-OS 内置设备能力；填写后同时加载该领域设备包。
              </p>
              <PathField
                id="runtime-graph-path"
                label="领域设备图 JSON（以 sz_lab 为例）"
                value={config.graphPath}
                placeholder="选择领域设备图，例如 szlab-ideawit-sim"
                buttonLabel="选择文件"
                disabled={edgeDisabled}
                invalid={edgeSubmitted
                  && Boolean(edgeValidation.errors.graphPath)}
                error={edgeSubmitted
                  ? edgeValidation.errors.graphPath
                  : undefined}
                onChoose={() => onChoosePath('graph')}
              />
              <LocalRuntimeEdgeCommandEditor
                config={config}
                disabled={edgeDisabled}
                submitted={edgeSubmitted}
                executableError={edgeValidation.errors.customEdgeExecutable}
                loadingGeneratedCommand={resolvingGeneratedEdgeCommand}
                onChange={onChange}
                onChooseExecutable={() => onChoosePath('edgeExecutable')}
                onLoadGeneratedCommand={onLoadGeneratedEdgeCommand}
              />
            </div>
          </section>

          <RuntimeStatus snapshot={snapshot} />

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={transitioning}
            onClick={onClose}
          >
            关闭
          </button>
        </footer>
      </section>
    </div>
  )
}

function PhoenixDependencyRecoveryNotice({
  osProjectPath
}: {
  osProjectPath: string
}): React.JSX.Element {
  const titleId = useId()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const commands = phoenixRecoveryCommands(osProjectPath)

  const copyCommands = async (): Promise<void> => {
    try {
      await globalThis.navigator.clipboard.writeText(commands)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <section
      className={styles.observabilityNotice}
      role="status"
      aria-labelledby={titleId}
    >
      <div className={styles.observabilityNoticeHeader}>
        <div>
          <strong id={titleId}>链路追踪（Trace）功能已降级</strong>
          <p>
            设备与业务运行不受影响；Phoenix 未安装，OTLP Trace 上报会持续返回 503。
          </p>
        </div>
        <span>不影响业务</span>
      </div>
      <p>
        在本机当前 Edge 使用的 Conda 环境中执行以下命令。若环境名不是
        <code>unilab</code>，请替换第二行。
      </p>
      <div className={styles.recoveryCommand}>
        <pre aria-label="Phoenix 依赖修复命令"><code>{commands}</code></pre>
        <button type="button" onClick={() => void copyCommands()}>
          {copyState === 'copied' ? '已复制' : '复制命令'}
        </button>
      </div>
      <small className={styles.dependencySummary}>
        将安装 arize-phoenix==17.5.0、arize-phoenix-otel==0.16.1，并提供
        <code>phoenix</code>命令。
      </small>
      <p>
        安装完成后，在桌面端停止并重新启动 Edge。每台机器都需要在各自实际使用的
        Conda 环境中安装一次。
      </p>
      <span className={styles.copyFeedback} aria-live="polite">
        {copyState === 'failed' ? '复制失败，请手动选择命令。' : ''}
      </span>
    </section>
  )
}

interface LocalRuntimeLogDrawerProps {
  instanceId?: string
  snapshot: LocalRuntimeLogsSnapshot | null
  activeKind: LocalRuntimeProcessKind
  loading: boolean
  error: string | null
  following?: boolean
  onFollowChange?: (following: boolean) => void
  onSelect: (kind: LocalRuntimeProcessKind) => void
  onRefresh: () => void
  onOpenFile?: () => void
  onClose: () => void
}

const LOG_TABS: Array<{
  kind: LocalRuntimeProcessKind
  label: string
}> = [
  { kind: 'simulator', label: 'PLC-Sim' },
  { kind: 'edge', label: 'Edge 运行时' }
]

const LOG_BOTTOM_TOLERANCE_PX = 4
/** 日志正文允许换行；窗口化列表先估算，再用浏览器实测行高修正坐标。 */
const LOG_ROW_ESTIMATED_HEIGHT_PX = 28
const LOG_ROW_OVERSCAN_PX = LOG_ROW_ESTIMATED_HEIGHT_PX * 8

/**
 * 展示本地运行日志，并在用户位于底部时持续跟随最新一行。
 *
 * @param props 日志快照、当前来源、加载状态及抽屉交互回调。
 * @returns 支持动态行高和窗口化渲染的日志抽屉。
 */
export function LocalRuntimeLogDrawer({
  instanceId,
  snapshot,
  activeKind,
  loading,
  error,
  following = true,
  onFollowChange = () => undefined,
  onSelect,
  onRefresh,
  onOpenFile,
  onClose
}: LocalRuntimeLogDrawerProps): React.JSX.Element {
  const outputRef = useRef<HTMLDivElement>(null)
  const activeLogKindRef = useRef(activeKind)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({})
  const idSuffix = instanceId ? `-${instanceId}` : ''
  const drawerId = `local-runtime-log-drawer${idSuffix}`
  const titleId = `local-runtime-log-title${idSuffix}`
  const outputId = `local-runtime-log-output${idSuffix}`
  const activeEntry = snapshot?.entries.find(
    (entry) => entry.kind === activeKind
  )
  const hasActiveOutput = Boolean(activeEntry?.available && activeEntry.content)
  const formattedRows = useMemo(
    () => formatLocalRuntimeLog(activeEntry?.content ?? ''),
    [activeEntry?.content]
  )
  const formattedRowEntries = useMemo(
    () => formattedRows.map((row, index) => ({
      row,
      index,
      measurementKey: localRuntimeLogRowMeasurementKey(row)
    })),
    [formattedRows]
  )
  const rowLayout = useMemo(() => {
    let top = 0
    const rows = formattedRowEntries.map((entry) => {
      const height = rowHeights[entry.measurementKey]
        ?? LOG_ROW_ESTIMATED_HEIGHT_PX
      const layoutEntry = { ...entry, height, top }
      top += height
      return layoutEntry
    })
    return { rows, totalHeight: top }
  }, [formattedRowEntries, rowHeights])
  // 自动跟随时直接以最新布局的底部计算可视范围，避免实测行高更新后沿用旧 scrollTop。
  const visibleScrollTop = following
    ? Math.max(0, rowLayout.totalHeight - viewportHeight)
    : scrollTop
  const visibleRows = useMemo(() => {
    const visibleTop = Math.max(0, visibleScrollTop - LOG_ROW_OVERSCAN_PX)
    const visibleBottom = visibleScrollTop
      + viewportHeight
      + LOG_ROW_OVERSCAN_PX
    return rowLayout.rows.filter((entry) => (
      entry.top + entry.height >= visibleTop && entry.top <= visibleBottom
    ))
  }, [rowLayout.rows, viewportHeight, visibleScrollTop])

  useEffect(() => {
    const activeKeys = new Set(
      formattedRowEntries.map((entry) => entry.measurementKey)
    )
    setRowHeights((current) => {
      const keys = Object.keys(current)
      if (keys.every((key) => activeKeys.has(key))) return current
      return Object.fromEntries(
        keys
          .filter((key) => activeKeys.has(key))
          .map((key) => [key, current[key]])
      )
    })
  }, [formattedRowEntries])

  // 日志内容异步出现后重新绑定尺寸观察器，不能只在抽屉首次挂载时检查空 ref。
  useEffect(() => {
    const output = outputRef.current
    if (!output || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setViewportHeight(entry.contentRect.height)
      setRowHeights({})
    })
    observer.observe(output)
    return () => observer.disconnect()
  }, [hasActiveOutput])

  useLayoutEffect(() => {
    const output = outputRef.current
    if (!output) return
    const measuredRows = output.querySelectorAll<HTMLElement>(
      '[data-log-row-index]'
    )
    setRowHeights((current) => {
      let next = current
      measuredRows.forEach((element) => {
        const index = Number(element.dataset.logRowIndex)
        const entry = formattedRowEntries[index]
        if (!entry) return
        const height = Math.ceil(element.getBoundingClientRect().height)
        if (height <= 0 || current[entry.measurementKey] === height) return
        if (next === current) next = { ...current }
        next[entry.measurementKey] = height
      })
      return next
    })
  }, [formattedRowEntries, visibleRows])

  useEffect(() => {
    const activeKindChanged = activeLogKindRef.current !== activeKind
    activeLogKindRef.current = activeKind
    if (activeKindChanged) onFollowChange(true)

    const output = outputRef.current
    if (output && following) {
      output.scrollTop = output.scrollHeight
      setScrollTop(output.scrollTop)
    }
  }, [
    activeEntry?.content,
    activeKind,
    following,
    onFollowChange,
    rowLayout.totalHeight
  ])

  return (
    <div className={styles.logDrawerLayer}>
      <button
        type="button"
        className={styles.logDrawerScrim}
        aria-label="关闭运行日志"
        onClick={onClose}
      />
      <aside
        id={drawerId}
        className={styles.logDrawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.logDrawerHeader}>
          <div>
            <h3 id={titleId}>本地运行日志</h3>
            <p>
              {following
                ? '显示当前来源的最新输出，每 2 秒增量刷新。'
                : '已暂停自动刷新，便于保持当前阅读位置。'}
            </p>
          </div>
          <div className={styles.logDrawerActions}>
            {onOpenFile ? (
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={!activeEntry?.available}
                title="使用系统默认应用打开当前日志文件"
                onClick={onOpenFile}
              >
                打开日志文件
              </button>
            ) : null}
            {!following ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => onFollowChange(true)}
              >
                继续跟随
              </button>
            ) : null}
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={loading}
              onClick={onRefresh}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="关闭运行日志"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className={styles.logTabs} role="tablist" aria-label="日志来源">
          {LOG_TABS.map((tab) => {
            const entry = snapshot?.entries.find(
              (candidate) => candidate.kind === tab.kind
            )
            const hasOutput = Boolean(entry?.available && entry.content)
            return (
              <button
                key={tab.kind}
                id={`local-runtime-log-tab-${tab.kind}${idSuffix}`}
                type="button"
                role="tab"
                aria-selected={activeKind === tab.kind}
                aria-controls={outputId}
                data-available={hasOutput || undefined}
                onClick={() => onSelect(tab.kind)}
              >
                <span>{tab.label}</span>
                <small>
                  {hasOutput ? '有输出' : entry?.available ? '等待输出' : '暂无'}
                </small>
              </button>
            )
          })}
        </div>

        <div
          id={outputId}
          className={styles.logDrawerBody}
          role="tabpanel"
          aria-labelledby={`local-runtime-log-tab-${activeKind}${idSuffix}`}
          aria-busy={loading}
        >
          {error ? (
            <p className={styles.logError} role="alert">
              日志操作失败：{error}
            </p>
          ) : null}
          {loading && !snapshot ? (
            <div className={styles.logEmpty} role="status">
              正在读取日志…
            </div>
          ) : activeEntry?.available && activeEntry.content ? (
            <>
              {activeEntry.truncated ? (
                <p className={styles.logNotice}>
                  界面保留最近 {LOCAL_RUNTIME_LOG_MAX_LINES.toLocaleString()} 行；
                  当前文件可通过“打开日志文件”查看，轮转历史保留在同一目录。
                </p>
              ) : null}
              <div
                ref={outputRef}
                className={styles.logOutput}
                role="list"
                aria-label="格式化运行日志"
                onPointerDown={() => {
                  onFollowChange(false)
                }}
                onWheel={(event) => {
                  if (event.deltaY < 0) onFollowChange(false)
                }}
                onScroll={(event) => {
                  const output = event.currentTarget
                  setScrollTop(output.scrollTop)
                  onFollowChange(
                    output.scrollHeight - output.clientHeight - output.scrollTop
                    <= LOG_BOTTOM_TOLERANCE_PX
                  )
                }}
              >
                <div
                  className={styles.logVirtualSpace}
                  style={{ height: rowLayout.totalHeight }}
                >
                  {visibleRows.map((entry) => {
                    const { row, index: rowIndex } = entry
                    return (
                      <div
                        key={`${rowIndex}-${row.message}`}
                        className={styles.logRow}
                        role="listitem"
                        aria-posinset={rowIndex + 1}
                        aria-setsize={formattedRows.length}
                        data-level={row.level}
                        data-log-row-index={rowIndex}
                        style={{ transform: `translateY(${entry.top}px)` }}
                      >
                        <span className={styles.logRowMeta}>
                          {row.time ? <time>{row.time}</time> : <span>—</span>}
                          <span className={styles.logLevel}>{logLevelLabel(row.level)}</span>
                          {row.source ? <code>{row.source}</code> : null}
                        </span>
                        <span className={styles.logMessage} title={row.message}>
                          {row.message || '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className={styles.logEmpty} role="status">
              <strong>
                {activeEntry?.available ? '暂时没有日志输出' : '尚未生成日志'}
              </strong>
              <span>启动相应服务后，输出会自动显示在这里。</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

type LocalRuntimeLogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warning'
  | 'error'
  | 'critical'
  | 'system'
  | 'plain'

interface FormattedLocalRuntimeLogRow {
  time: string
  level: LocalRuntimeLogLevel
  source: string
  message: string
}

function localRuntimeLogRowMeasurementKey(
  row: FormattedLocalRuntimeLogRow
): string {
  return [row.time, row.level, row.source, row.message].join('\u0000')
}

const ANSI_CSI_PATTERN = new RegExp(
  `(?:${String.fromCharCode(27)}\\[|${String.fromCharCode(155)})[0-?]*[ -/]*[@-~]`,
  'g'
)
const ANSI_STRING_PATTERN = new RegExp(
  `(?:${String.fromCharCode(27)}\\]|${String.fromCharCode(157)})[\\s\\S]*?(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\|${String.fromCharCode(156)})|(?:${String.fromCharCode(27)}[PX^_]|[${String.fromCharCode(144)}${String.fromCharCode(152)}${String.fromCharCode(158)}${String.fromCharCode(159)}])[\\s\\S]*?(?:${String.fromCharCode(27)}\\\\|${String.fromCharCode(156)})`,
  'g'
)
const ANSI_SINGLE_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}[ -/]*[0-~]`,
  'g'
)
const ANSI_C1_PATTERN = /[\u0080-\u009f]/g
const PHOENIX_DEPENDENCY_MISSING_PATTERN =
  /Phoenix[^\r\n]*未安装\s+Arize Phoenix/i
const OTLP_TRACE_PATH = '/api/v1/observability/otlp/v1/traces'
const CURRENT_EDGE_LAUNCH_PATTERN =
  /^\[launcher\]\s+\S+\s+starting\s*$/gm

export function detectPhoenixObservabilityDependencyIssue(
  content: string
): boolean {
  const sanitizedContent = stripTerminalControlCodes(content)
  const launchMarkers = [...sanitizedContent.matchAll(CURRENT_EDGE_LAUNCH_PATTERN)]
  const latestLaunch = launchMarkers.at(-1)
  const currentLaunchContent = latestLaunch?.index === undefined
    ? sanitizedContent
    : sanitizedContent.slice(latestLaunch.index)

  return PHOENIX_DEPENDENCY_MISSING_PATTERN.test(currentLaunchContent)
    && currentLaunchContent.split(/\r?\n/).some((line) => (
      line.includes(OTLP_TRACE_PATH) && /\b503\b/.test(line)
    ))
}

function formatLocalRuntimeLog(content: string): FormattedLocalRuntimeLogRow[] {
  return stripTerminalControlCodes(content)
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(formatLocalRuntimeLogLine)
}

function stripTerminalControlCodes(content: string): string {
  return content
    .replace(ANSI_STRING_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_SINGLE_ESCAPE_PATTERN, '')
    .replace(ANSI_C1_PATTERN, '')
}

function formatLocalRuntimeLogLine(
  line: string
): FormattedLocalRuntimeLogRow {
  const launcher = line.match(/^\[launcher\]\s+(\S+)\s*(.*)$/)
  if (launcher) {
    return {
      time: compactLogTime(launcher[1] ?? ''),
      level: 'system',
      source: 'launcher',
      message: launcher[2] ?? ''
    }
  }

  const loguru = line.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*\|\s*([A-Z]+)\s*\|\s*(?:(.*?)\s+-\s+)?(.*)$/
  )
  if (loguru) {
    return {
      time: loguru[2] ?? '',
      level: normalizeLogLevel(loguru[3]),
      source: (loguru[4] ?? '').trim(),
      message: loguru[5] ?? ''
    }
  }

  const unilab = line.match(
    /^(?:\d{2}|\d{4})-\d{2}-\d{2}\s+\[([\d:,\.]+)\]\s+\[([A-Z]+)\]\s+(.*?)(?:\s+\[[^\]]+\]\s+\[([^\]]+)\])?$/
  )
  if (unilab) {
    return {
      time: unilab[1] ?? '',
      level: normalizeLogLevel(unilab[2]),
      source: unilab[4] ?? 'unilabos',
      message: unilab[3] ?? ''
    }
  }

  const ros = line.match(
    /^\[([A-Z]+)\]\s+\[([^\]]+)\](?:\s+\[([^\]]+)\])?:\s*(.*)$/
  )
  if (ros) {
    return {
      time: ros[2] ?? '',
      level: normalizeLogLevel(ros[1]),
      source: ros[3] ?? 'ROS',
      message: ros[4] ?? ''
    }
  }

  const status = line.match(/^\[([A-Z]+)\]\s+(.*)$/)
  if (status) {
    return {
      time: '',
      level: normalizeLogLevel(status[1]),
      source: 'unilabos',
      message: status[2] ?? ''
    }
  }

  return { time: '', level: 'plain', source: '', message: line }
}

function compactLogTime(value: string): string {
  const match = value.match(/T(\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/)
  return match?.[1] ?? value
}

function normalizeLogLevel(value: string | undefined): LocalRuntimeLogLevel {
  switch ((value ?? '').toLowerCase()) {
    case 'trace':
      return 'trace'
    case 'debug':
      return 'debug'
    case 'warn':
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'fatal':
    case 'critical':
      return 'critical'
    default:
      return 'info'
  }
}

function logLevelLabel(level: LocalRuntimeLogLevel): string {
  if (level === 'warning') return 'WARN'
  if (level === 'critical') return 'FATAL'
  if (level === 'system') return 'SYSTEM'
  if (level === 'plain') return 'LOG'
  return level.toUpperCase()
}

function PathField({
  id,
  label,
  value,
  placeholder,
  buttonLabel,
  disabled,
  invalid,
  error,
  autoFocus = false,
  editable = false,
  onValueChange,
  onChoose
}: {
  id: string
  label: string
  value: string
  placeholder: string
  buttonLabel: string
  disabled: boolean
  invalid: boolean
  error?: string
  autoFocus?: boolean
  editable?: boolean
  onValueChange?: (value: string) => void
  onChoose: () => void
}): React.JSX.Element {
  const errorId = `${id}-error`
  const labelId = `${id}-label`
  const valueId = `${id}-value`
  const actionId = `${id}-action`
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} id={labelId} htmlFor={id}>
        {label}
      </label>
      {editable ? (
        <div
          className={styles.pathEditor}
          data-disabled={disabled || undefined}
          data-invalid={invalid || undefined}
        >
          <input
            id={id}
            type="text"
            className={styles.pathInput}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            autoFocus={autoFocus}
            spellCheck={false}
            title={value || undefined}
            onChange={(event) => onValueChange?.(event.target.value)}
          />
          <button
            type="button"
            className={styles.pathBrowse}
            disabled={disabled}
            aria-label={`${label}：${buttonLabel}`}
            onClick={onChoose}
          >
            {buttonLabel}
          </button>
        </div>
      ) : (
        <button
          id={id}
          type="button"
          className={styles.pathPicker}
          disabled={disabled}
          aria-labelledby={`${labelId} ${valueId} ${actionId}`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          autoFocus={autoFocus}
          title={value || undefined}
          onClick={onChoose}
        >
          <span
            id={valueId}
            className={value ? styles.pathValue : styles.pathPlaceholder}
          >
            {value || placeholder}
          </span>
          <span className={styles.pathAction} id={actionId}>
            {buttonLabel}
          </span>
        </button>
      )}
      {invalid && error ? (
        <small className={styles.fieldError} id={errorId}>
          {error}
        </small>
      ) : null}
    </div>
  )
}

function RuntimeStatus({
  snapshot
}: {
  snapshot: LocalRuntimeSnapshot
}): React.JSX.Element {
  return (
    <div
      className={styles.statusPanel}
      data-phase={snapshot.phase}
      role="status"
      aria-live="polite"
    >
      <div className={styles.statusHeader}>
        <span className={styles.statusDot} aria-hidden="true" />
        <strong>{snapshot.message}</strong>
      </div>
      <div className={styles.processGrid}>
        <ProcessState
          label="PLC-Sim"
          port="18765"
          status={simulatorRuntimeStatus(snapshot)}
        />
        <ProcessState
          label="领域侧 Edge"
          port="HTTP 18003"
          status={edgeRuntimeStatus(snapshot)}
        />
      </div>
    </div>
  )
}

type ProcessDisplayStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'failed'
  | 'disabled'

function ProcessState({
  label,
  port,
  status
}: {
  label: string
  port: string
  status: ProcessDisplayStatus
}): React.JSX.Element {
  return (
    <div className={styles.processItem} data-status={status}>
      <span className={styles.processIdentity}>
        <strong>{label}</strong>
        <small>{port}</small>
      </span>
      <span className={styles.processStatus}>{processStatusLabel(status)}</span>
    </div>
  )
}

type LocalRuntimeValidationField = keyof LocalRuntimeLaunchConfig
  | 'customEdgeExecutable'

interface ValidationResult {
  valid: boolean
  errors: Partial<Record<LocalRuntimeValidationField, string>>
}

export function validateSimulatorConfig(
  config: LocalRuntimeLaunchConfig
): ValidationResult {
  const errors: ValidationResult['errors'] = {}
  if (!config.environmentPath.trim()) {
    errors.environmentPath = '请选择 unilab Conda 环境目录'
  }
  if (!config.simulatorProjectPath.trim()) {
    errors.simulatorProjectPath = '请选择 PLC-Sim 项目根目录'
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

/**
 * 校验领域侧 Edge 启动所需路径与自定义命令的最小 renderer 输入。
 *
 * @param config 当前本地运行配置。
 * @returns 各字段可直接展示的错误集合；主进程仍会执行权威文件与模板校验。
 */
export function validateEdgeConfig(
  config: LocalRuntimeLaunchConfig
): ValidationResult {
  const errors: ValidationResult['errors'] = {}
  if (!config.graphPath.trim()) errors.graphPath = '请选择设备图 JSON'
  if (!config.osProjectPath.trim()) {
    errors.osProjectPath = '请选择 Uni-Lab-OS 项目根目录'
  }
  if (!config.environmentPath.trim()) {
    errors.environmentPath = '请选择 unilab Conda 环境目录'
  }
  if (config.edgeCommandMode === 'custom') {
    if (!config.szlabProjectPath.trim()) {
      errors.szlabProjectPath = '自定义命令仅适用于已挂载领域设备包'
    }
    if (!config.customEdgeCommand.executable.trim()) {
      errors.customEdgeExecutable = '请输入或选择 Edge 自定义可执行文件'
    }
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

function launcherLabel(snapshot: LocalRuntimeSnapshot): string {
  if (snapshot.phase === 'ready') return '本地调试已启动'
  if (snapshot.phase === 'simulator_ready') return 'PLC-Sim 已启动'
  if (snapshot.phase === 'failed') return '本地调试启动失败'
  if (isTransitioning(snapshot)) return '本地服务处理中'
  return '启动本地环境'
}

function isTransitioning(snapshot: LocalRuntimeSnapshot): boolean {
  return [
    'validating_simulator',
    'starting_simulator',
    'waiting_simulator',
    'validating_edge',
    'starting_bridge',
    'waiting_bridge',
    'starting_edge',
    'waiting_edge',
    'stopping_simulator',
    'stopping_edge'
  ].includes(snapshot.phase)
}

function isSimulatorTransitioning(snapshot: LocalRuntimeSnapshot): boolean {
  return [
    'validating_simulator',
    'starting_simulator',
    'waiting_simulator',
    'stopping_simulator'
  ].includes(snapshot.phase)
}

function isEdgeTransitioning(snapshot: LocalRuntimeSnapshot): boolean {
  return [
    'validating_edge',
    'starting_bridge',
    'waiting_bridge',
    'starting_edge',
    'waiting_edge',
    'stopping_edge'
  ].includes(snapshot.phase)
}

/**
 * 将普通路径类别映射到平面配置字段；嵌套的自定义 executable 由调用方单独处理。
 *
 * @param kind 除自定义可执行文件之外的受控路径类别。
 * @returns 对应的本地运行配置字段名。
 */
function pathField(
  kind: Exclude<LocalRuntimePathKind, 'edgeExecutable'>
): keyof LocalRuntimeLaunchConfig {
  if (kind === 'graph') return 'graphPath'
  if (kind === 'os') return 'osProjectPath'
  if (kind === 'szlab') return 'szlabProjectPath'
  if (kind === 'environment') return 'environmentPath'
  return 'simulatorProjectPath'
}

/**
 * 读取 renderer 本地偏好并把 v1/v2 路径配置迁移为默认生成式 Edge 启动模式。
 *
 * @returns 完整 v3 配置；存储缺失或损坏时返回安全默认值。
 */
function readStoredConfig(): LocalRuntimeLaunchConfig {
  if (typeof globalThis.localStorage === 'undefined') {
    return normalizeStoredLocalRuntimeConfig(null)
  }
  try {
    const storedValue = globalThis.localStorage.getItem(STORAGE_KEY)
      ?? LEGACY_STORAGE_KEYS
        .map((key) => globalThis.localStorage.getItem(key))
        .find((value) => value !== null)
    return normalizeStoredLocalRuntimeConfig(JSON.parse(storedValue ?? 'null'))
  } catch {
    return normalizeStoredLocalRuntimeConfig(null)
  }
}

/**
 * 将未知 localStorage 值归一化为 v3 配置；旧版本没有命令字段时保持系统默认启动。
 *
 * @param value JSON 解析后的未知本地偏好。
 * @returns 字段逐项收窄且嵌套对象独立复制的完整配置。
 */
export function normalizeStoredLocalRuntimeConfig(
  value: unknown
): LocalRuntimeLaunchConfig {
  if (!value || typeof value !== 'object') {
    return {
      ...EMPTY_CONFIG,
      customEdgeCommand: { ...EMPTY_CONFIG.customEdgeCommand }
    }
  }
  const parsed = value as Partial<LocalRuntimeLaunchConfig>
  const customEdgeCommand = parsed.customEdgeCommand
  return {
    graphPath: typeof parsed.graphPath === 'string' ? parsed.graphPath : '',
    osProjectPath: typeof parsed.osProjectPath === 'string'
      ? parsed.osProjectPath
      : '',
    szlabProjectPath: typeof parsed.szlabProjectPath === 'string'
      ? parsed.szlabProjectPath
      : '',
    environmentPath: typeof parsed.environmentPath === 'string'
      ? parsed.environmentPath
      : '',
    simulatorProjectPath: typeof parsed.simulatorProjectPath === 'string'
      ? parsed.simulatorProjectPath
      : '',
    edgeCommandMode: parsed.edgeCommandMode === 'custom'
      ? 'custom'
      : 'generated',
    customEdgeCommand: {
      executable: typeof customEdgeCommand?.executable === 'string'
        ? customEdgeCommand.executable
        : '',
      args: Array.isArray(customEdgeCommand?.args)
        ? customEdgeCommand.args.filter(
            (argument): argument is string => typeof argument === 'string'
          )
        : []
    }
  }
}

function simulatorRuntimeStatus(
  snapshot: LocalRuntimeSnapshot
): ProcessDisplayStatus {
  if (snapshot.failedProcess === 'simulator') return 'failed'
  if (snapshot.phase === 'stopping_simulator' && snapshot.simulatorRunning) {
    return 'stopping'
  }
  if (
    snapshot.phase === 'validating_simulator'
    || snapshot.phase === 'starting_simulator'
    || snapshot.phase === 'waiting_simulator'
  ) {
    return 'starting'
  }
  if (snapshot.simulatorRunning) return 'running'
  return 'idle'
}

function edgeRuntimeStatus(
  snapshot: LocalRuntimeSnapshot
): ProcessDisplayStatus {
  if (
    snapshot.failedProcess === 'bridge'
    || snapshot.failedProcess === 'edge'
  ) {
    return 'failed'
  }
  if (
    snapshot.phase === 'stopping_edge'
    && (snapshot.bridgeRunning || snapshot.edgeRunning)
  ) {
    return 'stopping'
  }
  if (snapshot.phase === 'ready' && snapshot.edgeRunning) {
    return 'running'
  }
  if (
    snapshot.phase === 'starting_bridge'
    || snapshot.phase === 'validating_edge'
    || snapshot.phase === 'waiting_bridge'
    || snapshot.phase === 'starting_edge'
    || snapshot.phase === 'waiting_edge'
    || snapshot.bridgeRunning
    || snapshot.edgeRunning
  ) {
    return 'starting'
  }
  return 'idle'
}

function simulatorControlLabel(
  snapshot: LocalRuntimeSnapshot,
  active: boolean
): string {
  if (snapshot.phase === 'stopping_simulator') return '正在停止…'
  if (isSimulatorTransitioning(snapshot)) return '正在启动…'
  return active ? '停止 PLC' : '启动 PLC'
}

function edgeControlLabel(
  snapshot: LocalRuntimeSnapshot,
  active: boolean
): string {
  if (snapshot.phase === 'stopping_edge') return '正在停止…'
  if (isEdgeTransitioning(snapshot)) return '正在启动…'
  return active ? '停止 Edge' : '启动 Edge'
}

function processStatusLabel(status: ProcessDisplayStatus): string {
  if (status === 'running') return '运行中'
  if (status === 'starting') return '启动中'
  if (status === 'stopping') return '停止中'
  if (status === 'failed') return '异常'
  if (status === 'disabled') return '未启用'
  return '未启动'
}

function desktopRuntimeApi(): DesktopRuntimeApi | undefined {
  return typeof globalThis.window === 'undefined'
    ? undefined
    : globalThis.window.api?.runtime
}

function useDeviceCardSurfaceOcclusion(
  source: string,
  occluded: boolean
): void {
  useEffect(() => {
    if (typeof globalThis.window === 'undefined') return
    const deviceCards = globalThis.window.api?.deviceCards
    if (!deviceCards) return
    void deviceCards.setOccluded(source, occluded).catch(() => undefined)
    return () => {
      if (!occluded) return
      void deviceCards.setOccluded(source, false).catch(() => undefined)
    }
  }, [occluded, source])
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function phoenixRecoveryCommands(osProjectPath: string): string {
  const projectPath = osProjectPath.trim() || '/path/to/Uni-Lab-OS'
  return [
    `cd ${shellQuote(projectPath)}`,
    'conda activate unilab',
    "pip install -e '.[observability]'"
  ].join('\n')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
