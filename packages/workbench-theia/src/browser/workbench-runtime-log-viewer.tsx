import { useVirtualizedRuntimeLog } from '@unilab/design-system/hooks/use-virtualized-runtime-log'
import {
  formatLocalRuntimeLog,
  prepareLocalRuntimeLogCopyText,
  type FormattedLocalRuntimeLogRow,
  type LocalRuntimeLogLevel
} from '@unilab/design-system/lib/runtime-log-formatting'
import type { WorkbenchEnvironmentLogKind } from '@unilab/workbench-session'
import { matchesWorkbenchLogQuery, type WorkbenchLogQuery } from '@unilab/workbench-session/log-query'
import * as React from 'react'
import { WorkbenchLogFilter } from './workbench-log-filter'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from 'react'

export const WORKBENCH_RUNTIME_LOG_MAX_LINES = 500

export const WORKBENCH_RUNTIME_LOG_SOURCES: ReadonlyArray<{
  kind: WorkbenchEnvironmentLogKind
  label: string
}> = [
  { kind: 'workspace-backend', label: 'Workspace Backend' },
  { kind: 'os', label: 'OS' },
  { kind: 'plc-sim', label: 'PLC-Sim' },
  { kind: 'agent', label: 'Agent' }
]

export type WorkbenchRuntimeLogContent = Partial<Record<
  WorkbenchEnvironmentLogKind,
  string
>>

export type WorkbenchRuntimeLogAvailability = Partial<Record<
  WorkbenchEnvironmentLogKind,
  boolean
>>

type WorkbenchRuntimeLogFilter = 'all' | LocalRuntimeLogLevel

const LOG_BOTTOM_TOLERANCE_PX = 4

interface WorkbenchRuntimeLogViewerProps {
  query?: WorkbenchLogQuery
  onQueryChange?: (query: WorkbenchLogQuery) => void
  instanceId: string
  dialogRef: RefObject<HTMLElement | null>
  contentByKind: WorkbenchRuntimeLogContent
  availableByKind: WorkbenchRuntimeLogAvailability
  activeKind: WorkbenchEnvironmentLogKind
  activeLogPath?: string
  loading: boolean
  error: string | null
  following: boolean
  refreshIntervalMs: number
  onFollowChange: (following: boolean) => void
  onSelect: (kind: WorkbenchEnvironmentLogKind) => void
  onRefresh: () => void
  onOpenFile?: () => void
  onClose: () => void
}

/**
 * 按指定级别筛选格式化日志，并限制界面最多保留最近五百条。
 * @param content 当前日志文件的安全文本尾部。
 * @param filter 用户选择的日志级别或全部级别。
 * @returns 过滤后的结构化日志及过滤前、裁剪前数量。
 * @safety 只处理内存文本，不改变日志文件或读取游标。
 */
export function filterWorkbenchRuntimeLogRows(
  content: string,
  filter: WorkbenchRuntimeLogFilter | WorkbenchLogQuery
): {
  rows: FormattedLocalRuntimeLogRow[]
  retainedCount: number
  totalCount: number
} {
  const allRows = formatLocalRuntimeLog(content)
  const query = typeof filter === 'string'
    ? { limit: WORKBENCH_RUNTIME_LOG_MAX_LINES, levels: filter === 'all' ? undefined : [filter] }
    : filter
  const matches = allRows.filter(row => matchesWorkbenchLogQuery(row.level, row.message, query))
  const retainedRows = matches.slice(-query.limit)
  return {
    rows: retainedRows,
    retainedCount: retainedRows.length,
    totalCount: allRows.length
  }
}

/**
 * 展示与 Kernel Web 原实现一致的结构化日志文件查看抽屉。
 *
 * @param props 四类日志快照、当前来源、读取状态与文件打开回调。
 * @returns 支持级别筛选、悬停原文、窗口化长列表和自动跟随的日志抽屉。
 * @safety 筛选与复制只作用于内存快照；打开文件仍由 Theia 文件服务控制。
 */
export function WorkbenchRuntimeLogViewer({
  query = { limit: WORKBENCH_RUNTIME_LOG_MAX_LINES, heartbeat: true },
  onQueryChange = () => {},
  instanceId,
  dialogRef,
  contentByKind,
  availableByKind,
  activeKind,
  activeLogPath,
  loading,
  error,
  following,
  refreshIntervalMs,
  onFollowChange,
  onSelect,
  onRefresh,
  onOpenFile,
  onClose
}: WorkbenchRuntimeLogViewerProps): React.JSX.Element {
  const activeLogContentRef = useRef({ kind: activeKind, content: '' })
  const [hasNewOutput, setHasNewOutput] = useState(false)
  const [copyState, setCopyState] =
    useState<'idle' | 'copied' | 'failed'>('idle')
  const titleId = `workbench-runtime-log-title-${instanceId}`
  const outputId = `workbench-runtime-log-output-${instanceId}`
  const activeContent = contentByKind[activeKind] ?? ''
  const activeAvailable = availableByKind[activeKind] === true
  const filtered = useMemo(
    /** 解析当前日志文件并应用用户选择的级别筛选。 */
    () => filterWorkbenchRuntimeLogRows(activeContent, { limit: query.limit }),
    [activeContent, query]
  )
  const hasRenderedOutput = activeAvailable && filtered.rows.length > 0
  const {
    outputRef,
    totalHeight,
    visibleRows,
    setScrollTop
  } = useVirtualizedRuntimeLog(
    filtered.rows,
    activeKind,
    activeContent,
    following,
    hasRenderedOutput,
    onFollowChange
  )

  useEffect(
    /** 在暂停跟随时识别当前日志文件是否出现新内容。 */
    () => {
      const previous = activeLogContentRef.current
      const activeKindChanged = previous.kind !== activeKind
      activeLogContentRef.current = { kind: activeKind, content: activeContent }
      if (activeKindChanged || following) {
        setHasNewOutput(false)
        setCopyState('idle')
        return
      }
      if (activeContent !== previous.content) setHasNewOutput(true)
    },
    [activeContent, activeKind, following]
  )

  /** 清除级别筛选并恢复全部结构化日志记录。 */
  const clearLevelFilter = useCallback((): void => {
    onQueryChange({ limit: WORKBENCH_RUNTIME_LOG_MAX_LINES, heartbeat: true })
  }, [onQueryChange, query.limit])

  /** 清除新日志提示并恢复对日志文件末尾的自动跟随。 */
  const resumeFollowing = useCallback((): void => {
    setHasNewOutput(false)
    onFollowChange(true)
  }, [onFollowChange])

  /** 把当前日志文件的安全原文复制到系统剪贴板。 */
  const copyActiveLog = useCallback(async (): Promise<void> => {
    if (!activeContent) return
    try {
      const clipboard = globalThis.navigator?.clipboard
      if (!clipboard?.writeText) throw new Error('当前环境不支持剪贴板写入')
      await clipboard.writeText(prepareLocalRuntimeLogCopyText(activeContent))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [activeContent])

  return (
    <div className="unilab-runtime-log-drawer__layer">
      <button
        type="button"
        className="unilab-runtime-log-drawer__scrim"
        aria-label="关闭运行日志"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        className="unilab-runtime-log-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="unilab-runtime-log-drawer__header">
          <div>
            <h2 id={titleId}>本地运行日志</h2>
            <p>
              {following
                ? `显示当前日志文件的最新输出，每 ${refreshIntervalMs / 1_000} 秒刷新。`
                : `已暂停自动跟随；日志仍每 ${refreshIntervalMs / 1_000} 秒刷新。`}
            </p>
          </div>
          <div className="unilab-runtime-log-drawer__header-actions">
            {onOpenFile ? (
              <button
                type="button"
                disabled={!activeLogPath}
                title={activeLogPath
                  ? `在编辑器中打开日志文件：${activeLogPath}`
                  : '当前来源尚未生成日志文件'}
                onClick={onOpenFile}
              >
                <span className="codicon codicon-go-to-file" aria-hidden="true" />
                打开日志文件（再次点击关闭）
              </button>
            ) : null}
            <button
              type="button"
              disabled={loading}
              onClick={onRefresh}
            >
              <span className="codicon codicon-refresh" aria-hidden="true" />
              {loading ? '刷新中…' : '刷新'}
            </button>
            <button type="button" aria-label="关闭本地运行日志" onClick={onClose}>
              <span className="codicon codicon-close" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div
          className="unilab-runtime-log-drawer__tabs"
          role="tablist"
          aria-label="日志来源"
        >
          {WORKBENCH_RUNTIME_LOG_SOURCES.map((source) => {
            const content = contentByKind[source.kind] ?? ''
            const available = availableByKind[source.kind] === true
            return (
              <button
                key={source.kind}
                id={`workbench-runtime-log-tab-${source.kind}-${instanceId}`}
                type="button"
                role="tab"
                aria-selected={source.kind === activeKind}
                aria-controls={outputId}
                data-available={(available && Boolean(content)) || undefined}
                onClick={() => onSelect(source.kind)}
              >
                <span>{source.label}</span>
                <small>
                  {content ? '有输出' : available ? '等待输出' : '暂无'}
                </small>
              </button>
            )
          })}
        </div>

        <div
          id={outputId}
          className="unilab-runtime-log-drawer__body"
          role="tabpanel"
          aria-labelledby={`workbench-runtime-log-tab-${activeKind}-${instanceId}`}
          aria-busy={loading}
        >
          <div className="unilab-runtime-log-drawer__filter-bar">
            <WorkbenchLogFilter query={query} onChange={onQueryChange} />
            <button
              type="button"
              onClick={() => void copyActiveLog()}
              aria-live="polite"
            >
              <span className="codicon codicon-copy" aria-hidden="true" />
              {copyState === 'copied'
                ? '已复制'
                : copyState === 'failed'
                  ? '复制失败'
                  : '复制当前日志'}
            </button>
            <span
              className="unilab-runtime-log-drawer__filter-count"
              aria-live="polite"
            >
              显示筛选后最近 {filtered.rows.length} 条（上限 {query.limit}）
            </span>
          </div>
          {error ? (
            <p className="unilab-runtime-log-drawer__error" role="alert">
              日志操作失败：{error}
            </p>
          ) : null}
          {loading && !activeAvailable ? (
            <div className="unilab-runtime-log-drawer__empty" role="status">
              正在读取日志…
            </div>
          ) : activeAvailable && activeContent ? (
            <>
              {!following ? (
                <button
                  type="button"
                  className="unilab-runtime-log-drawer__follow-notice"
                  aria-live="polite"
                  aria-atomic="true"
                  onClick={resumeFollowing}
                >
                  {hasNewOutput ? '有新日志，回到底部' : '已暂停自动跟随，回到底部'}
                </button>
              ) : null}
              {filtered.totalCount > WORKBENCH_RUNTIME_LOG_MAX_LINES ? (
                <p className="unilab-runtime-log-drawer__notice">
                  界面保留最近 {WORKBENCH_RUNTIME_LOG_MAX_LINES.toLocaleString()} 条；
                  可通过“打开日志文件”查看完整内容。
                </p>
              ) : null}
              {filtered.rows.length > 0 ? (
                <div
                  ref={outputRef}
                  className="unilab-runtime-log-drawer__output"
                  role="list"
                  aria-label="格式化运行日志"
                  onPointerDown={() => onFollowChange(false)}
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
                    className="unilab-runtime-log-drawer__virtual-space"
                    style={{ height: totalHeight }}
                  >
                    {visibleRows.map((entry) => {
                      const { row, index: rowIndex } = entry
                      return (
                        <div
                          key={`${rowIndex}-${row.message}`}
                          className="unilab-runtime-log-drawer__row"
                          role="listitem"
                          aria-posinset={rowIndex + 1}
                          aria-setsize={filtered.rows.length}
                          data-level={row.level}
                          data-log-row-index={rowIndex}
                          style={{ transform: `translateY(${entry.top}px)` }}
                        >
                          <span className="unilab-runtime-log-drawer__row-meta">
                            {row.time ? <time>{row.time}</time> : <span>—</span>}
                            <span className="unilab-runtime-log-drawer__level">
                              {logLevelLabel(row.level)}
                            </span>
                            {row.source ? <code title={row.source}>{row.source}</code> : null}
                          </span>
                          <span
                            className="unilab-runtime-log-drawer__message"
                            title={row.message}
                          >
                            {row.message || '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="unilab-runtime-log-drawer__empty" role="status">
                  <strong>
                    没有符合当前筛选条件的日志
                  </strong>
                  <span>原始日志仍保留，可清除筛选继续查看。</span>
                  <button type="button" onClick={clearLevelFilter}>清除筛选</button>
                </div>
              )}
            </>
          ) : (
            <div className="unilab-runtime-log-drawer__empty" role="status">
              <strong>{activeAvailable ? '当前筛选没有匹配日志' : '尚未生成日志'}</strong>
              <span>启动相应服务后，输出会自动显示在这里。</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

/** 返回格式化日志级别的紧凑显示文本。 */
function logLevelLabel(level: LocalRuntimeLogLevel): string {
  if (level === 'warning') return 'WARN'
  if (level === 'critical') return 'FATAL'
  if (level === 'system') return 'SYSTEM'
  if (level === 'plain') return 'LOG'
  return level.toUpperCase()
}
