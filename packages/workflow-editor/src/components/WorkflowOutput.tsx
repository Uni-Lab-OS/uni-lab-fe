import { useEffect, useState, type CSSProperties } from 'react'

import { useResizableWorkflowOutput } from './useResizableWorkflowOutput'

export type WorkflowOutputTab = 'nodes' | 'events' | 'errors'

export interface WorkflowOutputNode {
  nodeId: string
  sourceNodeId: string
  nodeType: string
  state: string
  attempt: number
  result: Record<string, unknown>
}

export interface WorkflowOutputActivity {
  key: string
  occurredAt: string
  positionLabel: string
  type: string
  nodeId: string | null
  detail?: Record<string, unknown>
}

interface WorkflowOutputProps {
  expanded: boolean
  activeTab: WorkflowOutputTab
  completedNodeCount: number
  expectedNodeCount: number
  nodes: readonly WorkflowOutputNode[]
  nodeNames: Readonly<Record<string, string>>
  activity: readonly WorkflowOutputActivity[]
  error: string | null
  selectedNode: WorkflowOutputNode | undefined
  selectedNodeId: string | null
  pausedBeforeNodeId: string | null
  onExpandedChange: (expanded: boolean) => void
  onTabChange: (tab: WorkflowOutputTab) => void
  onNodeSelect: (nodeId: string) => void
  onClearError: () => void
  onTraceOpen?: () => void
  title?: string
  countLabel?: string
  nodesTabLabel?: string
  activityTabLabel?: string
  activityEmptyLabel?: string
  resizable?: boolean
}

/**
 * 展示工作流任务（WorkflowTask）的节点结果、事件和异常摘要。
 *
 * @param props 运行输出的投影数据、选择状态与交互回调。
 * @returns 可折叠的运行输出区域。
 */
export function WorkflowOutput({
  expanded,
  activeTab,
  completedNodeCount,
  expectedNodeCount,
  nodes,
  nodeNames,
  activity,
  error,
  selectedNode,
  selectedNodeId,
  pausedBeforeNodeId,
  onExpandedChange,
  onTabChange,
  onNodeSelect,
  onClearError,
  onTraceOpen,
  title = '运行输出',
  countLabel = '个节点已有结果',
  nodesTabLabel = '节点结果',
  activityTabLabel = '运行记录',
  activityEmptyLabel = '等待 OS 返回运行状态……',
  resizable = false
}: WorkflowOutputProps): React.JSX.Element {
  const outputResize = useResizableWorkflowOutput()
  const [fullscreen, setFullscreen] = useState(false)
  const outputVisible = resizable || expanded

  useEffect(() => {
    if (!fullscreen) return
    /** 允许操作者用 Escape 退出运行输出全屏，而不改变底部面板高度。 */
    const exitOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    globalThis.addEventListener('keydown', exitOnEscape)
    return () => globalThis.removeEventListener('keydown', exitOnEscape)
  }, [fullscreen])
  /** 切换运行输出全屏；折叠面板会先恢复为可见状态。 */
  const toggleFullscreen = (): void => {
    if (!outputVisible) onExpandedChange(true)
    setFullscreen(current => !current)
  }
  const activityNodeNames = workflowEventNodeNames(nodes, nodeNames)
  const nodeFailures = workflowNodeFailureLogs(nodes, nodeNames, activity)
  const selectedNodeFailure = selectedNode
    ? nodeFailures.find((failure) => (
        failure.nodeId === selectedNode.nodeId ||
        failure.sourceNodeId === selectedNode.nodeId ||
        failure.nodeId === selectedNode.sourceNodeId ||
        failure.sourceNodeId === selectedNode.sourceNodeId
      ))
    : undefined
  const selectedNodeHasResult = Boolean(
    selectedNode &&
    !selectedNodeFailure &&
    Object.keys(selectedNode.result).length > 0
  )
  const selectedNodeLog = selectedNode && selectedNode.state !== 'failed'
    ? workflowNodeLogText(selectedNode, activity)
    : ''
  const selectedNodeName = selectedNode
    ? workflowOutputNodeName(selectedNode, nodeNames)
    : '未命名节点'
  const errorCount = nodeFailures.length + (error ? 1 : 0)

  return (
    <div
      ref={resizable ? outputResize.panelRef : undefined}
      className={`workflow-runtime__results${
        outputVisible ? ' is-expanded' : ' is-collapsed'
      }${resizable ? ' is-resizable' : ''}${
        outputResize.resizing ? ' is-resizing' : ''
      }${fullscreen ? ' is-fullscreen' : ''
      }`}
      style={resizable ? {
        '--workflow-output-height': `${outputResize.height}px`
      } as CSSProperties : undefined}
    >
      {resizable && !fullscreen ? (
        <div
          className="workflow-runtime__output-resizer"
          role="separator"
          aria-label="调整运行输出高度"
          aria-orientation="horizontal"
          aria-valuemin={outputResize.minimum}
          aria-valuemax={outputResize.maximum}
          aria-valuenow={Math.round(outputResize.height)}
          tabIndex={0}
          title="向上拖动扩大运行输出；双击恢复默认高度"
          onPointerDown={outputResize.onPointerDown}
          onKeyDown={outputResize.onKeyDown}
          onDoubleClick={outputResize.reset}
        >
          <span aria-hidden="true" />
        </div>
      ) : null}
      <header className="workflow-runtime__output-header">
        <div className="workflow-runtime__output-title">
          <strong>{title}</strong>
          <span>
            {completedNodeCount}/{expectedNodeCount}
            {' '}{countLabel}
          </span>
        </div>
        {outputVisible && (
          <div
            className="workflow-runtime__output-tabs"
            role="tablist"
            aria-label="运行输出类型"
          >
            <OutputTabButton
              id="nodes"
              activeTab={activeTab}
              label={nodesTabLabel}
              count={nodes.length}
              onSelect={onTabChange}
            />
            <OutputTabButton
              id="events"
              activeTab={activeTab}
              label={activityTabLabel}
              count={activity.length}
              onSelect={onTabChange}
            />
            <OutputTabButton
              id="errors"
              activeTab={activeTab}
              label="运行异常"
              errorCount={errorCount}
              onSelect={onTabChange}
            />
          </div>
        )}
        {onTraceOpen && (
          <button
            type="button"
            className="workflow-runtime__output-trace"
            aria-label="查看工作流 Trace"
            title="查看 Electron 与 Uni-Lab-OS 上报的运行 Trace"
            onClick={onTraceOpen}
          >
            Trace
          </button>
        )}
        <button
          type="button"
          className="workflow-runtime__output-fullscreen"
          aria-pressed={fullscreen}
          aria-label={fullscreen ? '退出运行输出全屏' : '全屏显示运行输出'}
          title={fullscreen ? '退出全屏（Esc）' : '全屏显示运行输出'}
          onClick={toggleFullscreen}
        >
          <span
            className={`codicon codicon-${fullscreen ? 'screen-normal' : 'screen-full'}`}
            aria-hidden="true"
          />
          {fullscreen ? '退出全屏' : '全屏'}
        </button>
      </header>

      {outputVisible && (
        <WorkflowOutputBody
          activeTab={activeTab}
          nodes={nodes}
          nodeNames={nodeNames}
          activity={activity}
          activityNodeNames={activityNodeNames}
          activityEmptyLabel={activityEmptyLabel}
          error={error}
          errorCount={errorCount}
          nodeFailures={nodeFailures}
          selectedNode={selectedNode}
          selectedNodeFailure={selectedNodeFailure}
          selectedNodeHasResult={selectedNodeHasResult}
          selectedNodeLog={selectedNodeLog}
          selectedNodeName={selectedNodeName}
          selectedNodeId={selectedNodeId}
          pausedBeforeNodeId={pausedBeforeNodeId}
          onNodeSelect={onNodeSelect}
          onClearError={onClearError}
        />
      )}
    </div>
  )
}

/**
 * 承载展开态的三个输出面板，使外层模块只管理折叠与标签页接口。
 *
 * @param props 节点、事件、异常及当前选择状态。
 * @returns 当前标签对应的运行输出面板。
 */
function WorkflowOutputBody({
  activeTab,
  nodes,
  nodeNames,
  activity,
  activityNodeNames,
  activityEmptyLabel,
  error,
  errorCount,
  nodeFailures,
  selectedNode,
  selectedNodeFailure,
  selectedNodeHasResult,
  selectedNodeLog,
  selectedNodeName,
  selectedNodeId,
  pausedBeforeNodeId,
  onNodeSelect,
  onClearError
}: {
  activeTab: WorkflowOutputTab
  nodes: readonly WorkflowOutputNode[]
  nodeNames: Readonly<Record<string, string>>
  activity: readonly WorkflowOutputActivity[]
  activityNodeNames: ReadonlyMap<string, string>
  activityEmptyLabel: string
  error: string | null
  errorCount: number
  nodeFailures: readonly WorkflowNodeFailureLog[]
  selectedNode: WorkflowOutputNode | undefined
  selectedNodeFailure: WorkflowNodeFailureLog | undefined
  selectedNodeHasResult: boolean
  selectedNodeLog: string
  selectedNodeName: string
  selectedNodeId: string | null
  pausedBeforeNodeId: string | null
  onNodeSelect: (nodeId: string) => void
  onClearError: () => void
}): React.JSX.Element {
  const [nodeLogExpanded, setNodeLogExpanded] = useState(true)
  const [nodeResultExpanded, setNodeResultExpanded] = useState(true)

  useEffect(() => {
    setNodeLogExpanded(true)
    setNodeResultExpanded(true)
  }, [selectedNodeId])

  const hasCollapsibleNodeDetails = Boolean(selectedNodeLog) ||
    selectedNodeHasResult
  const allNodeDetailsCollapsed = !selectedNodeFailure &&
    hasCollapsibleNodeDetails &&
    (!selectedNodeLog || !nodeLogExpanded) &&
    (!selectedNodeHasResult || !nodeResultExpanded)

  return (
    <div className="workflow-runtime__output-body">
      <section
        id="workflow-output-panel-nodes"
        className={[
          'workflow-runtime__output-panel',
          allNodeDetailsCollapsed ? 'is-node-details-collapsed' : ''
        ].filter(Boolean).join(' ')}
        role="tabpanel"
        aria-labelledby="workflow-output-tab-nodes"
        tabIndex={0}
        hidden={activeTab !== 'nodes'}
      >
        <WorkflowOutputNodeList
          nodes={nodes}
          nodeNames={nodeNames}
          selectedNodeId={selectedNodeId}
          pausedBeforeNodeId={pausedBeforeNodeId}
          onNodeSelect={onNodeSelect}
        />
        {selectedNode && (
          selectedNodeFailure || selectedNodeLog || selectedNodeHasResult
        ) && (
          <div
            className={[
              'workflow-runtime__node-details',
              allNodeDetailsCollapsed ? 'is-collapsed' : ''
            ].filter(Boolean).join(' ')}
          >
            {selectedNodeFailure && (
              <article
                className="workflow-runtime__error-detail workflow-runtime__node-error"
              >
                <header>
                  <strong>{selectedNodeFailure.nodeName} 执行失败</strong>
                  {selectedNodeFailure.attempt > 0 && (
                    <small>第 {selectedNodeFailure.attempt} 次尝试</small>
                  )}
                </header>
                {selectedNodeFailure.log ? (
                  <pre aria-label={`${selectedNodeFailure.nodeName} 错误日志`}>
                    {selectedNodeFailure.log}
                  </pre>
                ) : (
                  <p>节点已失败，但 OS 未返回详细错误日志。</p>
                )}
              </article>
            )}
            {selectedNodeLog && (
              <article
                className={[
                  'workflow-runtime__node-log',
                  nodeLogExpanded ? '' : 'is-collapsed'
                ].filter(Boolean).join(' ')}
              >
                <header>
                  <strong>{selectedNodeName} 运行日志</strong>
                  <div className="workflow-runtime__node-detail-actions">
                    {selectedNode.attempt > 0 && (
                      <small>第 {selectedNode.attempt} 次尝试</small>
                    )}
                    <OutputCopyButton
                      label="复制运行日志"
                      text={selectedNodeLog}
                    />
                    <OutputVisibilityButton
                      label="运行日志"
                      expanded={nodeLogExpanded}
                      onExpandedChange={setNodeLogExpanded}
                    />
                  </div>
                </header>
                {nodeLogExpanded && (
                  <pre
                    aria-label={`${selectedNodeName} 运行日志`}
                  >
                    {selectedNodeLog}
                  </pre>
                )}
              </article>
            )}
            {selectedNodeHasResult && (
              <WorkflowNodeResult
                nodeName={selectedNodeName}
                result={selectedNode.result}
                expanded={nodeResultExpanded}
                onExpandedChange={setNodeResultExpanded}
              />
            )}
          </div>
        )}
      </section>

      <section
        id="workflow-output-panel-events"
        className="workflow-runtime__output-panel"
        role="tabpanel"
        aria-labelledby="workflow-output-tab-events"
        tabIndex={0}
        hidden={activeTab !== 'events'}
      >
        <div className="workflow-runtime__events">
          {activity.length > 0 && (
            <p className="workflow-runtime__events-order">
              按 OS 权威时间排序，最新记录在前
            </p>
          )}
          {[...activity].reverse().slice(0, 50).map((event) => {
            const nodeName = event.nodeId
              ? activityNodeNames.get(event.nodeId) || '未命名节点'
              : '整体运行'
            return (
              <div
                key={event.key}
                data-event-kind={event.type}
                data-event-time={event.occurredAt}
              >
                <code className="workflow-runtime__activity-time">
                  <b>{event.positionLabel}</b>
                  <time dateTime={event.occurredAt}>
                    {formatActivityTime(event.occurredAt)}
                  </time>
                </code>
                <span>
                  <strong>{eventLabel(event.type)}</strong>
                  <small>{event.type}</small>
                  {event.detail && (
                    <details className="workflow-runtime__event-raw">
                      <summary>查看原始数据</summary>
                      <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                    </details>
                  )}
                </span>
                <em
                  data-node-id={event.nodeId || undefined}
                >
                  {nodeName}
                </em>
              </div>
            )
          })}
          {activity.length === 0 && <p>{activityEmptyLabel}</p>}
        </div>
      </section>

      <section
        id="workflow-output-panel-errors"
        className="workflow-runtime__output-panel"
        role="tabpanel"
        aria-labelledby="workflow-output-tab-errors"
        tabIndex={0}
        hidden={activeTab !== 'errors'}
      >
        {errorCount > 0 ? (
          <div className="workflow-runtime__error-list">
            {error && (
              <div className="workflow-runtime__error-detail">
                <strong>运行或编写过程中发生异常</strong>
                <p>{error}</p>
                <button type="button" onClick={onClearError}>
                  清除异常
                </button>
              </div>
            )}
            {nodeFailures.map((failure) => (
              <article
                key={`${failure.nodeId}:${failure.attempt}`}
                className="workflow-runtime__error-detail workflow-runtime__node-error"
              >
                <header>
                  <strong>{failure.nodeName} 执行失败</strong>
                  {failure.attempt > 0 && (
                    <small>第 {failure.attempt} 次尝试</small>
                  )}
                </header>
                {failure.log ? (
                  <pre aria-label={`${failure.nodeName} 错误日志`}>
                    {failure.log}
                  </pre>
                ) : (
                  <p>节点已失败，但 OS 未返回详细错误日志。</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="workflow-runtime__output-empty">
            当前没有运行异常
          </div>
        )}
      </section>
    </div>
  )
}

const NODE_RESULT_SUMMARY_FIELDS = [
  ['executor_kind', '执行器'],
  ['job_uuid', 'Job ID'],
  ['workflow_node_uuid', '节点 ID']
] as const

const NODE_RESULT_STATUS_LABELS: Readonly<Record<string, string>> = {
  succeeded: '执行成功',
  success: '执行成功',
  failed: '执行失败',
  canceled: '已取消',
  cancelled: '已取消',
  running: '执行中',
  pending: '等待执行'
}

/** 将节点任务的技术响应整理为可扫读摘要，同时保留完整原始数据。 */
function WorkflowNodeResult({
  nodeName,
  result,
  expanded,
  onExpandedChange
}: {
  nodeName: string
  result: Record<string, unknown>
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}): React.JSX.Element {
  const rawStatus = typeof result.status === 'string'
    ? result.status.toLowerCase()
    : ''
  const statusLabel = NODE_RESULT_STATUS_LABELS[rawStatus] || rawStatus || '已返回'
  const statusTone = rawStatus === 'succeeded' || rawStatus === 'success'
    ? 'is-success'
    : rawStatus === 'failed'
      ? 'is-error'
      : 'is-neutral'
  const summaryFields = NODE_RESULT_SUMMARY_FIELDS.flatMap(([field, label]) => {
    const value = result[field]
    return typeof value === 'string' && value.length > 0
      ? [{ field, label, value }]
      : []
  })

  return (
    <article
      className={[
        'workflow-runtime__node-result',
        expanded ? '' : 'is-collapsed'
      ].filter(Boolean).join(' ')}
      aria-label={`${nodeName} 节点结果`}
    >
      <header>
        <div>
          <strong>运行结果</strong>
          <small>节点执行返回</small>
        </div>
        <div className="workflow-runtime__node-detail-actions">
          <span className={statusTone}>{statusLabel}</span>
          <OutputCopyButton
            label="复制运行结果"
            text={JSON.stringify(result, null, 2)}
          />
          <OutputVisibilityButton
            label="运行结果"
            expanded={expanded}
            onExpandedChange={onExpandedChange}
          />
        </div>
      </header>
      {expanded && summaryFields.length > 0 && (
        <dl>
          {summaryFields.map(({ field, label, value }) => (
            <div key={field}>
              <dt>{label}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {expanded && (
        <div className="workflow-runtime__node-result-raw">
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </article>
  )
}

/** 切换单个节点详情面板的内容可见性，同时保留可操作的标题栏。 */
function OutputVisibilityButton({
  label,
  expanded,
  onExpandedChange
}: {
  label: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}): React.JSX.Element {
  const actionLabel = expanded ? `隐藏${label}` : `显示${label}`

  return (
    <button
      type="button"
      className="workflow-runtime__node-detail-toggle"
      aria-expanded={expanded}
      aria-label={actionLabel}
      title={actionLabel}
      onClick={() => onExpandedChange(!expanded)}
    >
      <span
        className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`}
        aria-hidden="true"
      />
      {expanded ? '隐藏' : '显示'}
    </button>
  )
}

/** 复制单侧运行详情，并用紧凑状态反馈避免额外提示层。 */
function OutputCopyButton({
  label,
  text
}: {
  label: string
  text: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await globalThis.navigator.clipboard.writeText(text)
      setCopied(true)
      globalThis.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className="workflow-runtime__node-detail-copy"
      aria-label={label}
      title={copied ? '已复制' : label}
      onClick={() => void copy()}
    >
      <span
        className={`codicon codicon-${copied ? 'check' : 'copy'}`}
        aria-hidden="true"
      />
      {copied ? '已复制' : '复制'}
    </button>
  )
}

/**
 * 把运行节点状态投影为可选择列表，隔离暂停和选中态的展示分支。
 *
 * @param props 运行节点、名称映射、选择状态与选择回调。
 * @returns 仅以节点名称为主身份的动态节点列表。
 */
function WorkflowOutputNodeList({
  nodes,
  nodeNames,
  selectedNodeId,
  pausedBeforeNodeId,
  onNodeSelect
}: {
  nodes: readonly WorkflowOutputNode[]
  nodeNames: Readonly<Record<string, string>>
  selectedNodeId: string | null
  pausedBeforeNodeId: string | null
  onNodeSelect: (nodeId: string) => void
}): React.JSX.Element {
  return (
    <div className="workflow-runtime__node-list">
      {nodes.map((node) => {
        const pausedBefore = pausedBeforeNodeId === node.sourceNodeId
        const nodeName = workflowOutputNodeName(node, nodeNames)
        return (
          <button
            key={node.nodeId}
            type="button"
            data-node-state={pausedBefore ? 'paused-before' : node.state}
            className={[
              selectedNodeId === node.sourceNodeId ? 'is-selected' : '',
              pausedBefore ? 'is-paused-before' : ''
            ].filter(Boolean).join(' ')}
            aria-label={`${nodeName}，${nodeTypeLabel(node.nodeType)}，${
              pausedBefore ? '暂停位置' : nodeStateLabel(node.state)
            }`}
            onClick={() => onNodeSelect(node.sourceNodeId)}
          >
            <i
              className={
                pausedBefore ? 'is-paused-before' : `is-${node.state}`
              }
            />
            <span className="is-node-name">{nodeName}</span>
            <span className="is-node-meta">
              <span>{nodeTypeLabel(node.nodeType)}</span>
              {node.attempt > 0 && <span>第 {node.attempt} 次</span>}
            </span>
            <em>
              {pausedBefore ? '暂停位置' : nodeStateLabel(node.state)}
            </em>
          </button>
        )
      })}
    </div>
  )
}

function OutputTabButton({
  id,
  activeTab,
  label,
  count,
  errorCount = 0,
  onSelect
}: {
  id: WorkflowOutputTab
  activeTab: WorkflowOutputTab
  label: string
  count?: number
  errorCount?: number
  onSelect: (tab: WorkflowOutputTab) => void
}): React.JSX.Element {
  return (
    <button
      id={`workflow-output-tab-${id}`}
      type="button"
      role="tab"
      aria-controls={`workflow-output-panel-${id}`}
      aria-selected={activeTab === id}
      className={activeTab === id ? 'is-active' : ''}
      onClick={() => onSelect(id)}
    >
      {label}
      {errorCount > 0
        ? <span className="is-error">{errorCount}</span>
        : count !== undefined && <span>{count}</span>}
    </button>
  )
}

interface WorkflowNodeFailureLog {
  nodeId: string
  sourceNodeId: string
  nodeName: string
  attempt: number
  log: string
}

const FAILURE_LOG_FIELDS = [
  ['error_info', ''],
  ['error', ''],
  ['traceback', ''],
  ['message', ''],
  ['detail', ''],
  ['stderr', 'stderr'],
  ['logs', 'logs'],
  ['log', 'log'],
  ['info', 'info']
] as const

const NODE_LOG_FIELDS = [
  ['param', '动作下发参数'],
  ['return_info', '执行结果'],
  ['feedback', '动作反馈'],
  ['feedback_data', '最新反馈'],
  ['command_result', '控制命令结果'],
  ['error_info', '错误信息'],
  ['stdout', 'stdout'],
  ['stderr', 'stderr'],
  ['logs', 'logs'],
  ['log', 'log'],
  ['info', 'info'],
  ['message', '']
] as const

function workflowNodeLogText(
  node: WorkflowOutputNode,
  events: readonly WorkflowOutputActivity[]
): string {
  const matchingEvents = events
    .filter((event) => (
      event.type !== 'node.exception' &&
      (event.nodeId === node.nodeId || event.nodeId === node.sourceNodeId)
    ))
  const logs: string[] = []
  const seen = new Set<string>()

  const append = (value: unknown, label: string): void => {
    const text = formatLogValue(value)
    if (!text || seen.has(text)) return
    seen.add(text)
    logs.push(label ? `${label}:\n${text}` : text)
  }
  const visit = (value: Record<string, unknown>): void => {
    for (const [field, label] of NODE_LOG_FIELDS) {
      append(value[field], label)
    }
    for (const field of ['result', 'output']) {
      const nested = value[field]
      if (isRecord(nested)) visit(nested)
    }
  }

  visit(node.result)
  matchingEvents.forEach((event) => {
    if (event.detail) visit(event.detail)
  })
  if (logs.length > 0) return logs.join('\n\n')

  return matchingEvents.map((event) => {
    const heading = `${event.positionLabel} ${eventLabel(event.type)} ` +
      `(${formatActivityTime(event.occurredAt)})`
    const detail = formatLogValue(event.detail)
    return detail ? `${heading}\n${detail}` : heading
  }).join('\n\n')
}

/**
 * 汇总工作流节点作业（WorkflowNodeJob）及异常事件中的失败日志。
 *
 * @param nodes 运行节点投影。
 * @param nodeNames 工作流节点 UUID 到用户名称的只读映射。
 * @param events 运行事件投影。
 * @returns 按节点归并的失败日志列表。
 */
function workflowNodeFailureLogs(
  nodes: readonly WorkflowOutputNode[],
  nodeNames: Readonly<Record<string, string>>,
  events: readonly WorkflowOutputActivity[]
): WorkflowNodeFailureLog[] {
  const exceptionEvents = events.filter(
    (event) => event.type === 'node.exception'
  )
  const consumedEventKeys = new Set<string>()
  const failures = nodes
    .filter((node) => node.state === 'failed')
    .map((node) => {
      const sourceNodeId = node.sourceNodeId || node.nodeId
      const matchingEvents = exceptionEvents.filter((event) => {
        const matches =
          event.nodeId === node.nodeId ||
          event.nodeId === sourceNodeId
        if (matches) consumedEventKeys.add(event.key)
        return matches
      })
      return {
        nodeId: node.nodeId,
        sourceNodeId,
        nodeName: workflowOutputNodeName(node, nodeNames),
        attempt: node.attempt,
        log: failureLogText(
          node.result,
          ...matchingEvents.flatMap((event) =>
            event.detail ? [event.detail] : []
          )
        )
      }
    })

  const eventNodeNames = workflowEventNodeNames(nodes, nodeNames)
  for (const event of exceptionEvents) {
    if (consumedEventKeys.has(event.key)) continue
    const sourceNodeId = event.nodeId || '未知节点'
    failures.push({
      nodeId: `${sourceNodeId}:activity:${event.key}`,
      sourceNodeId,
      nodeName: eventNodeNames.get(sourceNodeId) || '未命名节点',
      attempt: 0,
      log: failureLogText(event.detail ?? {})
    })
  }
  return failures
}

function failureLogText(
  ...results: readonly Record<string, unknown>[]
): string {
  const logs: string[] = []
  const seen = new Set<string>()

  const append = (value: unknown, label = ''): void => {
    const text = formatLogValue(value)
    if (!text || seen.has(text)) return
    seen.add(text)
    logs.push(label ? `${label}:\n${text}` : text)
  }

  const visit = (result: Record<string, unknown>): void => {
    const previousCount = logs.length
    let hasFailureField = false
    for (const [field, label] of FAILURE_LOG_FIELDS) {
      if (field in result) hasFailureField = true
      append(result[field], label)
    }
    for (const field of ['result', 'failure', 'exception']) {
      const nested = result[field]
      if (isRecord(nested)) visit(nested)
    }
    if (
      logs.length === previousCount &&
      !hasFailureField &&
      Object.keys(result).length > 0
    ) {
      append(result)
    }
  }

  results.forEach(visit)
  return logs.join('\n\n')
}

function formatLogValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(formatLogValue).filter(Boolean).join('\n')
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const NODE_STATE_LABELS: Readonly<Record<string, string>> = {
  pending: '等待执行',
  dispatched: '已下发',
  ready: '已就绪',
  running: '正在运行',
  success: '执行成功',
  succeeded: '执行成功',
  intervention_required: '需要干预',
  cancel_requested: '等待取消',
  execution_unknown: '执行状态未知',
  skipped: '已跳过',
  excluded: '不执行',
  failed: '执行失败',
  cancelled: '已取消',
  canceled: '已取消',
  timeout: '执行超时',
  reconciling: '状态核对中'
}

const NODE_TYPE_LABELS: Readonly<Record<string, string>> = {
  action: '操作节点',
  branch: '分支节点',
  join: '汇合节点',
  group: '节点组',
  subworkflow: '子工作流'
}

const EVENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  'run.created': '运行已创建',
  'run.started': '运行已开始',
  'run.status': '运行状态已更新',
  'run.completed': '运行已完成',
  'run.failed': '运行失败',
  'run.canceled': '运行已取消',
  'run.timeout': '运行已超时',
  'run.command': '控制命令已处理',
  'run.recovered': '运行状态已恢复',
  'node.ready': '节点已就绪',
  'node.dispatched': '动作已下发',
  'node.started': '节点开始执行',
  'node.result': '节点执行成功',
  'node.completed': '节点已完成',
  'node.canceled': '节点已取消',
  'node.timeout': '节点执行超时',
  'node.intervention_required': '节点需要干预',
  'node.cancel_requested': '节点等待取消',
  'node.execution_unknown': '节点执行状态未知',
  'node.skipped': '节点已跳过',
  'node.exception': '节点执行异常',
  'node.feedback': '动作反馈',
  'node.status': '节点状态已更新',
  'node.uncertainty_opened': '节点进入不确定状态',
  'node.uncertainty_resolved': '节点不确定状态已解除',
  'debug.paused': '调试已暂停',
  'debug.pause_pending': '正在等待安全暂停',
  'debug.stepping': '正在单步执行',
  'debug.continued': '调试已继续',
  'debug.terminate_requested': '已请求终止运行',
  'debug.emergency_stop_requested': '已请求当前运行急停',
  'debug.cancelled': '调试运行已取消'
}

function nodeStateLabel(status: string): string {
  return NODE_STATE_LABELS[status] || status
}

function nodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type] || type || '操作节点'
}

function eventLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] || '运行事件'
}

function formatActivityTime(value: string): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return value
  const pad = (part: number, width = 2): string =>
    String(part).padStart(width, '0')
  return `${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}:` +
    `${pad(timestamp.getSeconds())}.${pad(timestamp.getMilliseconds(), 3)}`
}

/**
 * 构建事件节点身份到用户可读节点名称的映射。
 *
 * @param runNodes 运行节点投影。
 * @param nodeNames 工作流节点 UUID 到用户名称的只读映射。
 * @returns 不包含身份回退值的名称映射。
 */
function workflowEventNodeNames(
  runNodes: readonly WorkflowOutputNode[],
  nodeNames: Readonly<Record<string, string>>
): ReadonlyMap<string, string> {
  const result = new Map<string, string>()
  for (const [nodeId, nodeName] of Object.entries(nodeNames)) {
    const displayName = nodeName.trim()
    if (displayName && displayName !== nodeId) {
      result.set(nodeId, displayName)
    }
  }
  for (const node of runNodes) {
    const sourceNodeId = node.sourceNodeId || node.nodeId
    const displayName = workflowOutputNodeName(node, nodeNames)
    result.set(sourceNodeId, displayName)
    result.set(node.nodeId, displayName)
  }
  return result
}

/**
 * 解析运行输出节点的可见名称，并阻止节点或作业身份回退到界面。
 *
 * @param node 工作流节点作业（WorkflowNodeJob）的运行输出投影。
 * @param nodeNames 工作流节点 UUID 到用户名称的只读映射。
 * @returns 可直接展示的节点名称；缺少有效名称时返回“未命名节点”。
 */
function workflowOutputNodeName(
  node: WorkflowOutputNode,
  nodeNames: Readonly<Record<string, string>>
): string {
  const candidates = [
    nodeNames[node.sourceNodeId],
    nodeNames[node.nodeId]
  ]
  for (const candidate of candidates) {
    const displayName = candidate?.trim()
    if (
      displayName &&
      displayName !== node.sourceNodeId &&
      displayName !== node.nodeId
    ) return displayName
  }
  return '未命名节点'
}
