import { prepareLocalRuntimeLogCopyText } from '@unilab/design-system/lib/runtime-log-formatting'
import type {
  WorkbenchEnvironmentLogKind,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import * as React from 'react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import {
  WorkbenchRuntimeLogViewer,
  type WorkbenchRuntimeLogAvailability,
  type WorkbenchRuntimeLogContent
} from './workbench-runtime-log-viewer'

const DEFAULT_LOG_REFRESH_INTERVAL_MS = 2_000

export type WorkbenchRuntimeLogPaths = Partial<Record<
  WorkbenchEnvironmentLogKind,
  string
>>

interface WorkbenchRuntimeLogLauncherProps {
  onReadLog: (kind: WorkbenchEnvironmentLogKind) => Promise<string>
  logPaths?: WorkbenchRuntimeLogPaths
  onOpenLog?: (path: string) => Promise<void>
  defaultOpen?: boolean
  refreshIntervalMs?: number
}

/**
 * 清除日志中的终端控制序列，同时保留换行、缩进和完整异常堆栈。
 * @param content Workbench 会话接口返回的日志尾部原文。
 * @returns 可安全渲染和复制的纯文本日志。
 */
export function sanitizeWorkbenchRuntimeLog(content: string): string {
  return prepareLocalRuntimeLogCopyText(content)
}

/**
 * 通过 Workbench 会话白名单接口读取一个固定来源并清理终端控制序列。
 * @param onReadLog WorkbenchSessionServer 提供的日志读取边界。
 * @param kind Workspace Backend、OS、PLC-Sim 或 Agent 固定来源。
 * @returns 保留换行与堆栈结构的安全日志尾部。
 */
export async function readWorkbenchRuntimeLog(
  onReadLog: (kind: WorkbenchEnvironmentLogKind) => Promise<string>,
  kind: WorkbenchEnvironmentLogKind
): Promise<string> {
  return sanitizeWorkbenchRuntimeLog(await onReadLog(kind))
}

/**
 * 从会话投影提取四类固定日志文件路径。
 * @param snapshot 当前 Workbench 会话权威投影。
 * @returns 只包含固定日志来源的文件路径映射；未生成的路径保持空值。
 */
export function workbenchRuntimeLogPaths(
  snapshot: WorkbenchSessionSnapshot
): WorkbenchRuntimeLogPaths {
  return {
    'workspace-backend': snapshot.identity?.logPath,
    os: snapshot.edgeRuntime.logPath,
    'plc-sim': snapshot.plcSimulator.logPath,
    agent: snapshot.agent?.logPath
  }
}

/**
 * 在 Workbench 中提供原版日志文件查看器入口与读取生命周期。
 * @param props 白名单日志读取接口、固定文件路径、打开文件接口和刷新配置。
 * @returns 可访问的日志入口；抽屉按来源展示结构化日志文件尾部。
 * @safety 浏览器只提交固定来源枚举；文件路径来自会话投影且由 Theia 打开。
 */
export function WorkbenchRuntimeLogLauncher({
  onReadLog,
  logPaths = {},
  onOpenLog,
  defaultOpen = false,
  refreshIntervalMs = DEFAULT_LOG_REFRESH_INTERVAL_MS
}: WorkbenchRuntimeLogLauncherProps): React.JSX.Element {
  const instanceId = useId().replace(/:/g, '')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const readGenerationRef = useRef(0)
  const activeReadRef = useRef<{
    generation: number
    kind: WorkbenchEnvironmentLogKind
  } | null>(null)
  const [open, setOpen] = useState(defaultOpen)
  const [activeKind, setActiveKind] =
    useState<WorkbenchEnvironmentLogKind>('os')
  const [contentByKind, setContentByKind] =
    useState<WorkbenchRuntimeLogContent>({})
  const [availableByKind, setAvailableByKind] =
    useState<WorkbenchRuntimeLogAvailability>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [following, setFollowing] = useState(true)

  /** 打开日志文件查看器并恢复最新输出自动跟随。 */
  const openDrawer = useCallback((): void => {
    setOpen(true)
    setFollowing(true)
    setError(null)
  }, [])

  /** 关闭抽屉、终止旧读取世代并把焦点归还入口。 */
  const closeDrawer = useCallback((): void => {
    readGenerationRef.current += 1
    activeReadRef.current = null
    setOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [])

  /**
   * 读取当前固定来源的日志文件尾部，并拒绝旧请求覆盖新来源。
   * @returns 本次读取结束后完成；错误转换为抽屉内可见提示。
   */
  const refreshActiveLog = useCallback(async (): Promise<void> => {
    if (activeReadRef.current?.kind === activeKind) return
    const readGeneration = ++readGenerationRef.current
    activeReadRef.current = { generation: readGeneration, kind: activeKind }
    setLoading(true)
    setError(null)
    try {
      const safeContent = await readWorkbenchRuntimeLog(onReadLog, activeKind)
      if (readGeneration !== readGenerationRef.current) return
      setContentByKind((current) => ({
        ...current,
        [activeKind]: safeContent
      }))
      setAvailableByKind((current) => ({
        ...current,
        [activeKind]: true
      }))
    } catch (readError) {
      if (readGeneration !== readGenerationRef.current) return
      setError(readError instanceof Error ? readError.message : String(readError))
    } finally {
      if (activeReadRef.current?.generation === readGeneration) {
        activeReadRef.current = null
        if (readGeneration === readGenerationRef.current) setLoading(false)
      }
    }
  }, [activeKind, onReadLog])

  /** 切换日志来源，并恢复该文件对最新输出的自动跟随。 */
  const selectSource = useCallback((kind: WorkbenchEnvironmentLogKind): void => {
    readGenerationRef.current += 1
    activeReadRef.current = null
    setActiveKind(kind)
    setFollowing(true)
    setError(null)
  }, [])

  /**
   * 通过 Theia 编辑器打开当前来源的真实日志文件。
   * @returns 文件成功打开后完成；路径缺失或打开失败在抽屉内显示。
   */
  const openActiveLogFile = useCallback(async (): Promise<void> => {
    const activeLogPath = logPaths[activeKind]
    if (!onOpenLog || !activeLogPath) return
    setError(null)
    try {
      await onOpenLog(activeLogPath)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError))
    }
  }, [activeKind, logPaths, onOpenLog])

  useEffect(
    /** 打开期间串行轮询；一次读取完成后才安排下一次，避免慢请求重入。 */
    () => {
      if (!open) return undefined
      let disposed = false
      let timer: ReturnType<typeof setTimeout> | null = null
      /** 完成本次读取后再延迟安排下一次轮询。 */
      const poll = async (): Promise<void> => {
        if (
          typeof document === 'undefined'
          || document.visibilityState === 'visible'
        ) {
          await refreshActiveLog()
        }
        if (disposed) return
        timer = globalThis.setTimeout(() => void poll(), refreshIntervalMs)
      }
      void poll()
      return () => {
        disposed = true
        if (timer) globalThis.clearTimeout(timer)
        readGenerationRef.current += 1
        activeReadRef.current = null
      }
    },
    [open, refreshActiveLog, refreshIntervalMs]
  )

  useEffect(
    /** 打开后处理 Escape、初始焦点和关闭后的焦点回收。 */
    () => {
      if (!open || typeof document === 'undefined') return undefined
      const previousFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      /** Escape 只关闭日志抽屉，不改变任何运行进程。 */
      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') closeDrawer()
      }
      document.addEventListener('keydown', handleKeyDown)
      const frame = globalThis.requestAnimationFrame(() => {
        dialogRef.current?.focus({ preventScroll: true })
      })
      return () => {
        document.removeEventListener('keydown', handleKeyDown)
        globalThis.cancelAnimationFrame(frame)
        previousFocus?.focus({ preventScroll: true })
      }
    },
    [closeDrawer, open]
  )

  const activeLogPath = logPaths[activeKind]
  const drawer = open ? (
    <WorkbenchRuntimeLogViewer
      instanceId={instanceId}
      dialogRef={dialogRef}
      contentByKind={contentByKind}
      availableByKind={availableByKind}
      activeKind={activeKind}
      activeLogPath={activeLogPath}
      loading={loading}
      error={error}
      following={following}
      refreshIntervalMs={refreshIntervalMs}
      onFollowChange={setFollowing}
      onSelect={selectSource}
      onRefresh={() => void refreshActiveLog()}
      onOpenFile={onOpenLog
        ? () => void openActiveLogFile()
        : undefined}
      onClose={closeDrawer}
    />
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="unilab-runtime-log-trigger"
        aria-expanded={open}
        onClick={openDrawer}
      >
        <span className="codicon codicon-output" aria-hidden="true" />
        调试日志
      </button>
      {drawer && typeof document !== 'undefined'
        ? createPortal(drawer, document.body)
        : drawer}
    </>
  )
}
