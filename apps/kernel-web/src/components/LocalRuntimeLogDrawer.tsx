import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent
} from 'react'

import type {
  LocalRuntimeLogsSnapshot,
  LocalRuntimeProcessKind
} from '../types/electron'

import {
  formatLocalRuntimeLog,
  prepareLocalRuntimeLogCopyText,
  type FormattedLocalRuntimeLogRow,
  type LocalRuntimeLogLevel
} from './localRuntimeLogFormatting'
import { LOCAL_RUNTIME_LOG_MAX_LINES } from './localRuntimeLogModel'
import { projectLocalRuntimeLogEntry } from './localRuntimePreconditionLogs'
import styles from './LocalRuntimeLauncher.module.scss'

export { detectPhoenixObservabilityDependencyIssue } from './localRuntimeLogFormatting'

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

type LocalRuntimeLogFilter = 'all' | LocalRuntimeLogLevel

const LOG_LEVEL_FILTER_OPTIONS: ReadonlyArray<{
  value: LocalRuntimeLogFilter
  label: string
}> = [
  { value: 'all', label: '全部级别' },
  { value: 'trace', label: 'TRACE' },
  { value: 'debug', label: 'DEBUG' },
  { value: 'info', label: 'INFO' },
  { value: 'warning', label: 'WARNING' },
  { value: 'error', label: 'ERROR' },
  { value: 'critical', label: 'CRITICAL' },
  { value: 'system', label: 'SYSTEM' },
  { value: 'plain', label: 'LOG' }
]

/**
 * 展示本地运行日志，并在用户位于底部时持续跟随最新一行。
 *
 * @param props 日志快照、当前来源、加载状态及抽屉交互回调。
 * @returns 支持动态行高和窗口化渲染的日志抽屉。
 * @throws 不主动抛出异常；读取和打开目录失败通过 error 呈现。
 * @safety 筛选只作用于格式化视图，保留 snapshot 中的原始日志内容。
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
  const activeLogContentRef = useRef({
    kind: activeKind,
    content: ''
  })
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({})
  const [levelFilter, setLevelFilter] = useState<LocalRuntimeLogFilter>('all')
  const [hasNewOutput, setHasNewOutput] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  )
  const idSuffix = instanceId ? `-${instanceId}` : ''
  const drawerId = `local-runtime-log-drawer${idSuffix}`
  const titleId = `local-runtime-log-title${idSuffix}`
  const outputId = `local-runtime-log-output${idSuffix}`
  const activeEntry = projectLocalRuntimeLogEntry(snapshot, activeKind)
  const hasActiveOutput = Boolean(activeEntry?.available && activeEntry.content)
  const formattedRows = useMemo(
    () => formatLocalRuntimeLog(activeEntry?.content ?? ''),
    [activeEntry?.content]
  )
  const filteredRows = useMemo(
    () => levelFilter === 'all'
      ? formattedRows
      : formattedRows.filter((row) => row.level === levelFilter),
    [formattedRows, levelFilter]
  )
  const hasRenderedOutput = hasActiveOutput && filteredRows.length > 0
  const formattedRowEntries = useMemo(
    () => filteredRows.map((row, index) => ({
      row,
      index,
      measurementKey: localRuntimeLogRowMeasurementKey(row)
    })),
    [filteredRows]
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

  /**
   * 比较当前来源的日志内容，在暂停自动跟随期间记录新内容提示。
   *
   * @returns 无清理函数；每次内容、来源或跟随状态变化后同步提示状态。
   * @throws 不抛出异常；只比较内存中的日志文本。
   * @safety 提示状态不修改日志快照，也不影响后台增量读取游标。
   */
  useEffect(() => {
    const currentContent = activeEntry?.content ?? ''
    const previous = activeLogContentRef.current
    const activeKindChanged = previous.kind !== activeKind
    activeLogContentRef.current = {
      kind: activeKind,
      content: currentContent
    }

    if (activeKindChanged || following) {
      setHasNewOutput(false)
      return
    }
    if (currentContent !== previous.content) setHasNewOutput(true)
  }, [activeEntry?.content, activeKind, following])

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
  }, [hasRenderedOutput])

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

  /**
   * 应用受控选择框提供的日志级别筛选。
   *
   * @param event 日志级别选择框的变更事件。
   * @returns 无返回值。
   * @throws 不抛出异常；选项值由固定列表约束。
   * @safety 仅更新本地展示状态，不修改或丢弃原始日志快照。
   */
  const handleLevelFilterChange = useCallback(
    (event: SyntheticEvent<HTMLSelectElement>): void => {
      setLevelFilter(event.currentTarget.value as LocalRuntimeLogFilter)
    },
    []
  )

  /**
   * 清除日志级别筛选并恢复全部格式化记录。
   *
   * @returns 无返回值。
   * @throws 不抛出异常。
   * @safety 只恢复视图筛选，不发起日志读取或变更原始数据。
   */
  const clearLevelFilter = useCallback((): void => {
    setLevelFilter('all')
  }, [])

  /**
   * 清除新日志提示并恢复日志列表对最新输出的自动跟随。
   *
   * @returns 无返回值。
   * @throws 不抛出异常。
   * @safety 只改变滚动展示状态，不跳过、不删除任何日志记录。
   */
  const resumeFollowing = useCallback((): void => {
    setHasNewOutput(false)
    onFollowChange(true)
  }, [onFollowChange])

  /**
   * 把当前来源的安全日志原文复制到系统剪贴板。
   *
   * @returns 剪贴板写入完成后结束，并更新成功或失败反馈。
   * @throws 不向界面抛出异常；接口缺失或写入拒绝转换为失败状态。
   * @safety 只移除终端控制码，保留换行、空行和堆栈缩进；不会复制其他来源或隐藏裁剪内容。
   */
  const copyActiveLog = useCallback(async (): Promise<void> => {
    const content = activeEntry?.content ?? ''
    if (!content) return
    try {
      const clipboard = globalThis.navigator?.clipboard
      if (!clipboard?.writeText) throw new Error('当前环境不支持剪贴板写入')
      await clipboard.writeText(prepareLocalRuntimeLogCopyText(content))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [activeEntry?.content])

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
                : '已暂停自动跟随；日志仍每 2 秒刷新。'}
            </p>
          </div>
          <div className={styles.logDrawerActions}>
            {onOpenFile ? (
              <button
                type="button"
                className={styles.secondaryButton}
                title="在系统文件管理器中打开当前日志目录"
                onClick={onOpenFile}
              >
                打开日志目录
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
            const entry = projectLocalRuntimeLogEntry(snapshot, tab.kind)
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
              <div className={styles.logFilterBar}>
                <label className={styles.logFilterControl}>
                  <span>日志级别</span>
                  <select
                    aria-label="日志级别筛选"
                    value={levelFilter}
                    onChange={handleLevelFilterChange}
                  >
                    {LOG_LEVEL_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void copyActiveLog()}
                  aria-live="polite"
                >
                  {copyState === 'copied'
                    ? '已复制'
                    : copyState === 'failed'
                      ? '复制失败'
                      : '复制当前日志'}
                </button>
                <span className={styles.logFilterCount} aria-live="polite">
                  显示 {filteredRows.length} / {formattedRows.length} 条
                </span>
              </div>
              {!following ? (
                <button
                  type="button"
                  className={styles.logFollowNotice}
                  aria-live="polite"
                  aria-atomic="true"
                  onClick={resumeFollowing}
                >
                  {hasNewOutput
                    ? '有新日志，回到底部'
                    : '已暂停自动跟随，回到底部'}
                </button>
              ) : null}
              {activeEntry.truncated ? (
                <p className={styles.logNotice}>
                  界面保留最近 {LOCAL_RUNTIME_LOG_MAX_LINES.toLocaleString()} 行；
                  可通过“打开日志目录”查看当前会话与轮转历史。
                </p>
              ) : null}
              {filteredRows.length > 0 ? (
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
                          aria-setsize={filteredRows.length}
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
              ) : (
                <div className={styles.logEmpty} role="status">
                  <strong>
                    没有符合 {logFilterLabel(levelFilter)} 条件的日志
                  </strong>
                  <span>原始日志仍保留，可清除筛选继续查看。</span>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={clearLevelFilter}
                  >
                    清除筛选
                  </button>
                </div>
              )}
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

function localRuntimeLogRowMeasurementKey(
  row: FormattedLocalRuntimeLogRow
): string {
  return [row.time, row.level, row.source, row.message].join('\u0000')
}

function logLevelLabel(level: LocalRuntimeLogLevel): string {
  if (level === 'warning') return 'WARN'
  if (level === 'critical') return 'FATAL'
  if (level === 'system') return 'SYSTEM'
  if (level === 'plain') return 'LOG'
  return level.toUpperCase()
}

/**
 * 返回当前日志级别筛选的用户可见标签。
 *
 * @param filter 固定筛选选项中的值。
 * @returns 对应选项标签；未知值回退为全部级别。
 * @throws 不抛出异常。
 * @safety 只读取本地常量，不接触或修改日志内容。
 */
function logFilterLabel(filter: LocalRuntimeLogFilter): string {
  return LOG_LEVEL_FILTER_OPTIONS.find((option) => option.value === filter)
    ?.label ?? '全部级别'
}
