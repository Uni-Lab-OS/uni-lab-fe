import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import type {
  DesktopRuntimeApi,
  LocalRuntimeLaunchConfig,
  LocalRuntimeLogsSnapshot,
  LocalRuntimePathKind,
  LocalRuntimeProcessKind,
  LocalRuntimeSnapshot
} from '../types/electron'

import styles from './LocalRuntimeLauncher.module.scss'

const STORAGE_KEY = 'unilab.local-runtime-launch-config.v2'
const LEGACY_STORAGE_KEY = 'unilab.local-runtime-launch-config.v1'
const EMPTY_CONFIG: LocalRuntimeLaunchConfig = {
  graphPath: '',
  osProjectPath: '',
  szlabProjectPath: '',
  environmentPath: '',
  simulatorProjectPath: ''
}
const IDLE_SNAPSHOT: LocalRuntimeSnapshot = {
  phase: 'idle',
  message: 'PLC-Sim 与领域侧 Edge 均未启动',
  simulatorRunning: false,
  bridgeRunning: false,
  edgeRunning: false
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
  const readSequenceRef = useRef(0)
  const selectInitialLogRef = useRef(true)
  useDeviceCardSurfaceOcclusion(`local-runtime-log-${variant}`, open)

  const closeLogs = useCallback((): void => {
    setOpen(false)
    onOpenChange?.(false)
  }, [onOpenChange])

  const refresh = useCallback(async (): Promise<void> => {
    if (!runtimeApi) return
    const requestSequence = ++readSequenceRef.current
    setLoading(true)
    setError(null)
    try {
      const nextSnapshot = await runtimeApi.readLogs()
      if (requestSequence !== readSequenceRef.current) return
      setSnapshot(nextSnapshot)
      if (selectInitialLogRef.current) {
        const preferredEntry = nextSnapshot.entries.find(
          (entry) => entry.kind === 'edge' && entry.available
        ) ?? nextSnapshot.entries.find((entry) => entry.available)
        if (preferredEntry) setActiveKind(preferredEntry.kind)
        selectInitialLogRef.current = false
      }
    } catch (readError) {
      if (requestSequence === readSequenceRef.current) {
        setError(errorMessage(readError))
      }
    } finally {
      if (requestSequence === readSequenceRef.current) {
        setLoading(false)
      }
    }
  }, [runtimeApi])

  useEffect(() => {
    if (!open) return
    void refresh()
    const refreshTimer = globalThis.setInterval(() => {
      void refresh()
    }, 2_000)
    return () => {
      globalThis.clearInterval(refreshTimer)
      readSequenceRef.current += 1
    }
  }, [open, refresh])

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
    selectInitialLogRef.current = true
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
              onSelect={setActiveKind}
              onRefresh={() => void refresh()}
              onClose={closeLogs}
            />,
            document.body
          )
        : null}
    </>
  )
}

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
  const [dialogLogsOpen, setDialogLogsOpen] = useState(false)
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

  const choosePath = async (kind: LocalRuntimePathKind): Promise<void> => {
    setLocalError(null)
    try {
      const path = await runtimeApi.selectPath(kind)
      if (!path) return
      setConfig((current) => ({
        ...current,
        [pathField(kind)]: path
      }))
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

  return (
    <>
      <button
        type="button"
        className={styles.launcherButton}
        data-runtime-phase={snapshot.phase}
        onClick={() => setOpen(true)}
      >
        <span className={styles.launcherDot} aria-hidden="true" />
        {launcherLabel(snapshot)}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <LocalRuntimeDialog
              config={config}
              snapshot={snapshot}
              error={localError ?? snapshot.error ?? null}
              simulatorSubmitted={simulatorSubmitted}
              edgeSubmitted={edgeSubmitted}
              simulatorValidation={simulatorValidation}
              edgeValidation={edgeValidation}
              onChange={setConfig}
              onChoosePath={(kind) => void choosePath(kind)}
              onClose={closeDialog}
              onStartSimulator={() => void startSimulator()}
              onStopSimulator={() => void stopSimulator()}
              onStartEdge={() => void startEdge()}
              onStopEdge={() => void stopEdge()}
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
  simulatorValidation: ValidationResult
  edgeValidation: ValidationResult
  transitioning: boolean
  onChange: (config: LocalRuntimeLaunchConfig) => void
  onChoosePath: (kind: LocalRuntimePathKind) => void
  onClose: () => void
  onStartSimulator: () => void
  onStopSimulator: () => void
  onStartEdge: () => void
  onStopEdge: () => void
  logControl?: ReactNode
}

export function LocalRuntimeDialog({
  config,
  snapshot,
  error,
  simulatorSubmitted,
  edgeSubmitted,
  simulatorValidation,
  edgeValidation,
  transitioning,
  onChange,
  onChoosePath,
  onClose,
  onStartSimulator,
  onStopSimulator,
  onStartEdge,
  onStopEdge,
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

interface LocalRuntimeLogDrawerProps {
  instanceId?: string
  snapshot: LocalRuntimeLogsSnapshot | null
  activeKind: LocalRuntimeProcessKind
  loading: boolean
  error: string | null
  onSelect: (kind: LocalRuntimeProcessKind) => void
  onRefresh: () => void
  onClose: () => void
}

const LOG_TABS: Array<{
  kind: LocalRuntimeProcessKind
  label: string
}> = [
  { kind: 'simulator', label: 'PLC-Sim' },
  { kind: 'edge', label: 'Edge 运行时' }
]

export function LocalRuntimeLogDrawer({
  instanceId,
  snapshot,
  activeKind,
  loading,
  error,
  onSelect,
  onRefresh,
  onClose
}: LocalRuntimeLogDrawerProps): React.JSX.Element {
  const outputRef = useRef<HTMLOListElement>(null)
  const idSuffix = instanceId ? `-${instanceId}` : ''
  const drawerId = `local-runtime-log-drawer${idSuffix}`
  const titleId = `local-runtime-log-title${idSuffix}`
  const outputId = `local-runtime-log-output${idSuffix}`
  const activeEntry = snapshot?.entries.find(
    (entry) => entry.kind === activeKind
  )
  const formattedRows = useMemo(
    () => formatLocalRuntimeLog(activeEntry?.content ?? ''),
    [activeEntry?.content]
  )

  useEffect(() => {
    const output = outputRef.current
    if (output) output.scrollTop = output.scrollHeight
  }, [activeEntry?.content, activeKind])

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
            <p>直接展示最新输出，每 2 秒自动刷新。</p>
          </div>
          <div className={styles.logDrawerActions}>
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
              日志读取失败：{error}
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
                  日志较长，当前展示最新 128 KB。
                </p>
              ) : null}
              <ol
                ref={outputRef}
                className={styles.logOutput}
                aria-label="格式化运行日志"
              >
                {formattedRows.map((row, index) => (
                  <li key={`${index}-${row.message}`} data-level={row.level}>
                    <span className={styles.logRowMeta}>
                      {row.time ? <time>{row.time}</time> : <span>—</span>}
                      <span className={styles.logLevel}>{logLevelLabel(row.level)}</span>
                      {row.source ? <code>{row.source}</code> : null}
                    </span>
                    <span className={styles.logMessage}>{row.message || '—'}</span>
                  </li>
                ))}
              </ol>
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

function formatLocalRuntimeLog(content: string): FormattedLocalRuntimeLogRow[] {
  return content
    .replace(ANSI_STRING_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_SINGLE_ESCAPE_PATTERN, '')
    .replace(ANSI_C1_PATTERN, '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(formatLocalRuntimeLogLine)
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

interface ValidationResult {
  valid: boolean
  errors: Partial<Record<keyof LocalRuntimeLaunchConfig, string>>
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

function pathField(
  kind: LocalRuntimePathKind
): keyof LocalRuntimeLaunchConfig {
  if (kind === 'graph') return 'graphPath'
  if (kind === 'os') return 'osProjectPath'
  if (kind === 'szlab') return 'szlabProjectPath'
  if (kind === 'environment') return 'environmentPath'
  return 'simulatorProjectPath'
}

function readStoredConfig(): LocalRuntimeLaunchConfig {
  if (typeof globalThis.localStorage === 'undefined') return { ...EMPTY_CONFIG }
  try {
    const storedValue = globalThis.localStorage.getItem(STORAGE_KEY)
      ?? globalThis.localStorage.getItem(LEGACY_STORAGE_KEY)
    const parsed = JSON.parse(storedValue ?? 'null') as
      Partial<LocalRuntimeLaunchConfig> | null
    if (!parsed) return { ...EMPTY_CONFIG }
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
        : ''
    }
  } catch {
    return { ...EMPTY_CONFIG }
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
