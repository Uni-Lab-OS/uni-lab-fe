import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'

import { WorkflowButton } from './WorkflowButton'

import type {
  WorkflowTracePort,
  WorkflowTraceRecord
} from '../traceRuntime'

type TraceScope = 'current' | 'recent'

const LOCAL_SIGNOZ_URL = 'http://127.0.0.1:30080'

interface WorkflowTraceViewerProps {
  open: boolean
  currentRunId: string | null
  runtime: WorkflowTracePort
  onClose: () => void
}

export interface WorkflowTraceSummary {
  traceId: string
  name: string
  startedAt: unknown
  latencyMs: number | null
  spanCount: number | null
  status: string
  matchesCurrentRun: boolean
  raw: WorkflowTraceRecord
}

export interface WorkflowSpanSummary {
  spanId: string
  parentId: string | null
  name: string
  startedAt: unknown
  latencyMs: number | null
  status: string
  depth: number
  attributes: ReadonlyArray<readonly [string, string]>
  raw: WorkflowTraceRecord
}

export function WorkflowTraceViewer({
  open,
  currentRunId,
  runtime,
  onClose
}: WorkflowTraceViewerProps): React.JSX.Element | null {
  const titleId = useId()
  const drawerRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const [scope, setScope] = useState<TraceScope>(
    currentRunId ? 'current' : 'recent'
  )
  const [traces, setTraces] = useState<WorkflowTraceRecord[]>([])
  const [serverMatchedTraceIds, setServerMatchedTraceIds] = useState(
    () => new Set<string>()
  )
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(
    null
  )
  const [spans, setSpans] = useState<WorkflowTraceRecord[]>([])
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(
    null
  )
  const [listLoading, setListLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailRevision, setDetailRevision] = useState(0)

  const traceSummaries = useMemo(
    () => traces
      .map((trace) => workflowTraceSummary(
        trace,
        currentRunId,
        serverMatchedTraceIds
      ))
      .filter((trace): trace is WorkflowTraceSummary => Boolean(trace)),
    [currentRunId, serverMatchedTraceIds, traces]
  )
  const currentTraceCount = traceSummaries.filter(
    (trace) => trace.matchesCurrentRun
  ).length
  const visibleTraces = useMemo(
    () => scope === 'current'
      ? traceSummaries.filter((trace) => trace.matchesCurrentRun)
      : traceSummaries,
    [scope, traceSummaries]
  )
  const spanSummaries = useMemo(
    () => workflowSpanSummaries(spans),
    [spans]
  )
  const selectedSpan = spanSummaries.find(
    (span) => span.spanId === selectedSpanId
  ) ?? spanSummaries[0]

  const loadTraces = useCallback(async (): Promise<void> => {
    const requestId = ++listRequestRef.current
    setListLoading(true)
    setListError(null)
    try {
      const [recentResult, currentRunTraces] = await Promise.all([
        runtime.listTraces({
          limit: 100,
          sort: 'start_time',
          order: 'desc',
          includeSpans: true
        }),
        currentRunId
          ? listWorkflowRunTraces(runtime, currentRunId)
          : Promise.resolve([])
      ])
      if (requestId !== listRequestRef.current) return
      setServerMatchedTraceIds(new Set(
        currentRunTraces.map(traceIdFor).filter(Boolean)
      ))
      setTraces(mergeTraceRecords(
        currentRunTraces,
        recentResult.traces
      ))
      setDetailRevision((current) => current + 1)
    } catch (error) {
      if (requestId !== listRequestRef.current) return
      setListError(errorMessage(error, 'Trace 列表读取失败'))
    } finally {
      if (requestId === listRequestRef.current) setListLoading(false)
    }
  }, [currentRunId, runtime])

  useEffect(() => {
    if (!open) return
    setScope(currentRunId ? 'current' : 'recent')
    void loadTraces()
    return () => {
      listRequestRef.current += 1
      detailRequestRef.current += 1
    }
  }, [currentRunId, loadTraces, open])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), ' +
        'select:not(:disabled), textarea:not(:disabled), ' +
        '[tabindex]:not([tabindex="-1"])'
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [onClose, open])

  useEffect(() => {
    if (
      selectedTraceId &&
      visibleTraces.some((trace) => trace.traceId === selectedTraceId)
    ) return
    setSelectedTraceId(visibleTraces[0]?.traceId ?? null)
  }, [selectedTraceId, visibleTraces])

  useEffect(() => {
    if (!open || !selectedTraceId) {
      setSpans([])
      setSelectedSpanId(null)
      return
    }
    const requestId = ++detailRequestRef.current
    setDetailLoading(true)
    setDetailError(null)
    setSpans([])
    setSelectedSpanId(null)
    void runtime.getTrace(selectedTraceId, { limit: 500 })
      .then((result) => {
        if (requestId !== detailRequestRef.current) return
        setSpans(result.spans)
      })
      .catch((error: unknown) => {
        if (requestId !== detailRequestRef.current) return
        setDetailError(errorMessage(error, 'Trace 详情读取失败'))
      })
      .finally(() => {
        if (requestId === detailRequestRef.current) {
          setDetailLoading(false)
        }
      })
  }, [detailRevision, open, runtime, selectedTraceId])

  if (!open) return null

  return (
    <div
      className="workflow-runtime__trace-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={drawerRef}
        className="workflow-runtime__trace-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="workflow-runtime__trace-header">
          <div>
            <span className="workflow-runtime__trace-symbol" aria-hidden="true">
              <TraceGlyph />
            </span>
            <div>
              <h2 id={titleId}>工作流 Trace</h2>
              <p>
                {currentRunId
                  ? <>当前运行 <code>{shortId(currentRunId)}</code></>
                  : 'Electron 与 Uni-Lab-OS 上报的运行 Trace'}
              </p>
            </div>
          </div>
          <div className="workflow-runtime__trace-header-actions">
            <a
              className="workflow-runtime__trace-signoz"
              href={signozTraceUrl(selectedTraceId)}
              target="_blank"
              rel="noreferrer"
              title={selectedTraceId
                ? '在 SigNoz 中查看当前选中的 Trace'
                : '打开 SigNoz Trace 列表'}
            >
              <ExternalLinkGlyph />
              {selectedTraceId ? '在 SigNoz 查看' : '打开 SigNoz'}
            </a>
            <WorkflowButton
              type="button"
              className="workflow-runtime__trace-refresh"
              disabled={listLoading}
              disabledReason="正在读取 Trace 列表，请稍候"
              onClick={() => void loadTraces()}
            >
              <RefreshGlyph />
              {listLoading ? '刷新中' : '刷新'}
            </WorkflowButton>
            <button
              ref={closeButtonRef}
              type="button"
              className="workflow-runtime__trace-close"
              aria-label="关闭 Trace 查看器"
              title="关闭"
              onClick={onClose}
            >
              <CloseGlyph />
            </button>
          </div>
        </header>

        <div
          className="workflow-runtime__trace-scope"
          role="group"
          aria-label="Trace 查看范围"
        >
          <WorkflowButton
            type="button"
            aria-pressed={scope === 'current'}
            disabled={!currentRunId}
            disabledReason="当前还没有工作流运行记录"
            className={scope === 'current' ? 'is-active' : undefined}
            onClick={() => setScope('current')}
          >
            当前运行
            {currentRunId && <span>{currentTraceCount}</span>}
          </WorkflowButton>
          <button
            type="button"
            aria-pressed={scope === 'recent'}
            className={scope === 'recent' ? 'is-active' : undefined}
            onClick={() => setScope('recent')}
          >
            最近记录
            <span>{traceSummaries.length}</span>
          </button>
          <small>数据来自 Uni-Lab-OS 本地 Phoenix</small>
        </div>

        <div className="workflow-runtime__trace-content">
          <aside className="workflow-runtime__trace-list" aria-label="Trace 列表">
            {listLoading && traces.length === 0 ? (
              <TraceState title="正在读取 Trace" detail="正在连接本地日志服务……" />
            ) : listError ? (
              <TraceState
                tone="error"
                title="无法读取 Trace"
                detail={listError}
                actionLabel="重试"
                onAction={() => void loadTraces()}
              />
            ) : visibleTraces.length === 0 ? (
              <TraceState
                title={scope === 'current' ? '当前运行暂无 Trace' : '暂无 Trace 记录'}
                detail={scope === 'current'
                  ? '运行链路可能仍在上报。请刷新，或切换到“最近记录”查看全部 Trace。'
                  : '启动并运行工作流后，Trace 会在这里显示。'}
                actionLabel={scope === 'current' ? '查看最近记录' : undefined}
                onAction={scope === 'current' ? () => setScope('recent') : undefined}
              />
            ) : (
              visibleTraces.map((trace) => (
                <button
                  key={trace.traceId}
                  type="button"
                  className={[
                    'workflow-runtime__trace-item',
                    selectedTraceId === trace.traceId ? 'is-selected' : ''
                  ].filter(Boolean).join(' ')}
                  aria-pressed={selectedTraceId === trace.traceId}
                  onClick={() => setSelectedTraceId(trace.traceId)}
                >
                  <span className="workflow-runtime__trace-item-heading">
                    <strong>{trace.name}</strong>
                    <i data-status={statusTone(trace.status)}>
                      {statusLabel(trace.status)}
                    </i>
                  </span>
                  <span className="workflow-runtime__trace-item-meta">
                    <time>{formatTimestamp(trace.startedAt)}</time>
                    <em>{formatDuration(trace.latencyMs)}</em>
                    {trace.spanCount !== null && (
                      <small>{trace.spanCount} spans</small>
                    )}
                  </span>
                  <code title={trace.traceId}>{shortId(trace.traceId)}</code>
                  {trace.matchesCurrentRun && (
                    <span className="workflow-runtime__trace-current">
                      当前运行
                    </span>
                  )}
                </button>
              ))
            )}
          </aside>

          <section
            className="workflow-runtime__trace-detail"
            aria-label="Trace 详情"
          >
            {!selectedTraceId ? (
              <TraceState
                title="选择一条 Trace"
                detail="选择左侧记录后查看完整 Span 链路。"
              />
            ) : detailLoading ? (
              <TraceState
                title="正在读取 Span"
                detail={`Trace ${shortId(selectedTraceId)}`}
              />
            ) : detailError ? (
              <TraceState
                tone="error"
                title="无法读取 Span"
                detail={detailError}
                actionLabel="重试"
                onAction={() => setDetailRevision((current) => current + 1)}
              />
            ) : spanSummaries.length === 0 ? (
              <TraceState
                title="该 Trace 暂无 Span"
                detail="上报可能尚未完成，请稍后刷新 Trace 列表。"
                actionLabel="刷新 Trace"
                onAction={() => void loadTraces()}
              />
            ) : (
              <>
                <section className="workflow-runtime__span-chain">
                  <header>
                    <div>
                      <strong>Span 链路</strong>
                      <span>{spanSummaries.length} 个步骤</span>
                    </div>
                    <code title={selectedTraceId}>{selectedTraceId}</code>
                  </header>
                  <div aria-label="Trace Span 链路">
                    {spanSummaries.map((span) => (
                      <button
                        key={span.spanId}
                        type="button"
                        aria-pressed={selectedSpan?.spanId === span.spanId}
                        className={[
                          'workflow-runtime__span-item',
                          selectedSpan?.spanId === span.spanId
                            ? 'is-selected'
                            : ''
                        ].filter(Boolean).join(' ')}
                        style={{
                          '--workflow-span-depth': span.depth
                        } as React.CSSProperties}
                        onClick={() => setSelectedSpanId(span.spanId)}
                      >
                        <span className="workflow-runtime__span-rail" aria-hidden="true" />
                        <span>
                          <strong>{span.name}</strong>
                          <small>{formatTimestamp(span.startedAt)}</small>
                        </span>
                        <em>{formatDuration(span.latencyMs)}</em>
                        <i data-status={statusTone(span.status)}>
                          {statusLabel(span.status)}
                        </i>
                      </button>
                    ))}
                  </div>
                </section>

                {selectedSpan && (
                  <section className="workflow-runtime__span-inspector">
                    <header>
                      <div>
                        <strong>{selectedSpan.name}</strong>
                        <span>{statusLabel(selectedSpan.status)}</span>
                      </div>
                      <code title={selectedSpan.spanId}>
                        {selectedSpan.spanId}
                      </code>
                    </header>
                    <dl>
                      <div>
                        <dt>开始时间</dt>
                        <dd>{formatTimestamp(selectedSpan.startedAt, true)}</dd>
                      </div>
                      <div>
                        <dt>耗时</dt>
                        <dd>{formatDuration(selectedSpan.latencyMs)}</dd>
                      </div>
                      <div>
                        <dt>父 Span</dt>
                        <dd>{selectedSpan.parentId || '根 Span'}</dd>
                      </div>
                      {selectedSpan.attributes.map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}

function TraceState({
  title,
  detail,
  tone = 'neutral',
  actionLabel,
  onAction
}: {
  title: string
  detail: string
  tone?: 'neutral' | 'error'
  actionLabel?: string
  onAction?: () => void
}): React.JSX.Element {
  return (
    <div
      className="workflow-runtime__trace-state"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <span aria-hidden="true">{tone === 'error' ? '!' : '···'}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  )
}

export function workflowTraceSummary(
  trace: WorkflowTraceRecord,
  currentRunId: string | null,
  serverMatchedTraceIds: ReadonlySet<string> = new Set()
): WorkflowTraceSummary | null {
  const traceId = firstString(
    trace.trace_id,
    trace.traceId,
    recordValue(trace.context, 'trace_id')
  )
  if (!traceId) return null
  const embeddedSpans = Array.isArray(trace.spans) ? trace.spans : null
  const firstSpan = embeddedSpans?.find(isRecord)
  const latencyMs = firstNumber(trace.latency_ms, trace.latencyMs) ??
    durationBetween(trace.start_time, trace.end_time)
  return {
    traceId,
    name: firstString(
      trace.root_span_name,
      trace.name,
      recordValue(trace.root_span, 'name'),
      firstSpan?.name
    ) || '未命名 Trace',
    startedAt: trace.start_time ?? trace.startTime ?? firstSpan?.start_time,
    latencyMs,
    spanCount: firstNumber(trace.span_count, trace.spanCount) ??
      embeddedSpans?.length ?? null,
    status: firstString(
      trace.status_code,
      trace.status,
      recordValue(trace.root_span, 'status_code')
    ) || 'UNSET',
    matchesCurrentRun: Boolean(
      currentRunId && (
        serverMatchedTraceIds.has(traceId) ||
        containsIdentifier(trace, currentRunId)
      )
    ),
    raw: trace
  }
}

export async function listWorkflowRunTraces(
  runtime: WorkflowTracePort,
  runId: string,
  maxPages = 10
): Promise<WorkflowTraceRecord[]> {
  const traces: WorkflowTraceRecord[] = []
  let cursor: string | undefined
  for (let page = 0; page < maxPages; page += 1) {
    const result = await runtime.listTraces({
      limit: 1000,
      ...(cursor ? { cursor } : {}),
      sort: 'start_time',
      order: 'desc',
      includeSpans: true,
      sessionIdentifiers: [runId]
    })
    traces.push(...result.traces)
    if (!result.next_cursor) break
    cursor = result.next_cursor
  }
  return traces
}

export function workflowSpanSummaries(
  spans: readonly WorkflowTraceRecord[]
): WorkflowSpanSummary[] {
  const base = spans.map((span, index) => {
    const context = isRecord(span.context) ? span.context : {}
    const spanId = firstString(
      context.span_id,
      span.span_id,
      span.spanId
    ) || `span-${index + 1}`
    return {
      spanId,
      parentId: firstString(
        span.parent_id,
        span.parent_span_id,
        span.parentId
      ) || null,
      name: firstString(span.name, span.span_name) || '未命名 Span',
      startedAt: span.start_time ?? span.startTime,
      latencyMs: firstNumber(span.latency_ms, span.latencyMs) ??
        durationBetween(span.start_time, span.end_time),
      status: firstString(
        span.status_code,
        span.status,
        recordValue(span.status, 'status_code'),
        recordValue(span.status, 'code')
      ) || 'UNSET',
      depth: 0,
      attributes: traceAttributes(span),
      raw: span
    }
  })
  const byId = new Map(base.map((span) => [span.spanId, span]))
  const children = new Map<string, Array<(typeof base)[number]>>()
  const roots: Array<(typeof base)[number]> = []
  for (const span of base) {
    if (
      !span.parentId ||
      span.parentId === span.spanId ||
      !byId.has(span.parentId)
    ) {
      roots.push(span)
      continue
    }
    const siblings = children.get(span.parentId) ?? []
    siblings.push(span)
    children.set(span.parentId, siblings)
  }
  const byStartTime = (
    left: (typeof base)[number],
    right: (typeof base)[number]
  ): number => timestampValue(left.startedAt) - timestampValue(right.startedAt)
  roots.sort(byStartTime)
  children.forEach((siblings) => siblings.sort(byStartTime))

  const ordered: WorkflowSpanSummary[] = []
  const visited = new Set<string>()
  const append = (span: (typeof base)[number], depth: number): void => {
    if (visited.has(span.spanId)) return
    visited.add(span.spanId)
    ordered.push({ ...span, depth: Math.min(6, depth) })
    for (const child of children.get(span.spanId) ?? []) {
      append(child, depth + 1)
    }
  }
  roots.forEach((span) => append(span, 0))
  base.sort(byStartTime).forEach((span) => append(span, 0))
  return ordered
}

export function traceMatchesWorkflowRun(
  trace: WorkflowTraceRecord,
  runId: string
): boolean {
  return containsIdentifier(trace, runId)
}

function traceAttributes(
  span: WorkflowTraceRecord
): ReadonlyArray<readonly [string, string]> {
  const attributes = isRecord(span.attributes)
    ? span.attributes
    : isRecord(span.span_attributes)
      ? span.span_attributes
      : {}
  return Object.entries(attributes)
    .map(([key, value]) => [key, displayValue(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
}

function mergeTraceRecords(
  ...collections: readonly WorkflowTraceRecord[][]
): WorkflowTraceRecord[] {
  const merged = new Map<string, WorkflowTraceRecord>()
  let anonymousIndex = 0
  for (const collection of collections) {
    for (const trace of collection) {
      const traceId = traceIdFor(trace)
      merged.set(traceId || `anonymous-${anonymousIndex++}`, trace)
    }
  }
  return [...merged.values()]
}

function traceIdFor(trace: WorkflowTraceRecord): string {
  return firstString(
    trace.trace_id,
    trace.traceId,
    recordValue(trace.context, 'trace_id')
  )
}

function containsIdentifier(value: unknown, target: string): boolean {
  const seen = new Set<object>()
  const normalizedTarget = normalizeIdentifier(target)
  const visit = (candidate: unknown, depth: number): boolean => {
    if (depth > 8) return false
    if (typeof candidate === 'string') {
      return normalizeIdentifier(candidate) === normalizedTarget
    }
    if (!candidate || typeof candidate !== 'object') return false
    if (seen.has(candidate)) return false
    seen.add(candidate)
    if (Array.isArray(candidate)) {
      return candidate.some((item) => visit(item, depth + 1))
    }
    return Object.values(candidate).some((item) => visit(item, depth + 1))
  }
  return visit(value, 0)
}

function normalizeIdentifier(value: string): string {
  const compact = value.trim().toLowerCase().replaceAll('-', '')
  return /^[a-f0-9]{32}$/.test(compact) ? compact : value.trim()
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function durationBetween(start: unknown, end: unknown): number | null {
  const startValue = timestampValue(start)
  const endValue = timestampValue(end)
  if (!startValue || !endValue || endValue < startValue) return null
  return endValue - startValue
}

function timestampValue(value: unknown): number {
  if (typeof value === 'number') {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatTimestamp(value: unknown, includeDate = false): string {
  const timestamp = timestampValue(value)
  if (!timestamp) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    ...(includeDate
      ? { year: 'numeric', month: '2-digit', day: '2-digit' }
      : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false
  }).format(timestamp)
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '耗时未知'
  if (value < 1) return `${Math.round(value * 1000)} μs`
  if (value < 1000) return `${value.toFixed(value < 10 ? 2 : 1)} ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`
}

function statusTone(status: string): 'success' | 'error' | 'neutral' {
  const normalized = status.toUpperCase()
  if (normalized.includes('ERROR') || normalized.includes('FAIL')) {
    return 'error'
  }
  if (normalized === 'OK' || normalized.includes('SUCCESS')) {
    return 'success'
  }
  return 'neutral'
}

function statusLabel(status: string): string {
  const tone = statusTone(status)
  if (tone === 'success') return '正常'
  if (tone === 'error') return '异常'
  return '未标记'
}

function shortId(value: string): string {
  return value.length > 12
    ? `${value.slice(0, 8)}…${value.slice(-4)}`
    : value
}

function firstString(...values: unknown[]): string {
  return values.find(
    (value): value is string => typeof value === 'string' && value.length > 0
  ) ?? ''
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function isRecord(value: unknown): value is WorkflowTraceRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function TraceGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4" cy="5" r="1.75" />
      <circle cx="15.5" cy="10" r="1.75" />
      <circle cx="7" cy="15" r="1.75" />
      <path d="M5.6 5.8 13.8 9M14 11.2 8.5 14.3M5.1 6.6l1.4 6.7" />
    </svg>
  )
}

function RefreshGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.8 7.2A6.2 6.2 0 1 0 16 12" />
      <path d="M12.7 7.2h3.1V4.1" />
    </svg>
  )
}

export function signozTraceUrl(traceId: string | null): string {
  return traceId
    ? `${LOCAL_SIGNOZ_URL}/trace/${encodeURIComponent(traceId)}`
    : `${LOCAL_SIGNOZ_URL}/trace`
}

function ExternalLinkGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5" />
      <path d="m19 5-8 8" />
      <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

function CloseGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  )
}
