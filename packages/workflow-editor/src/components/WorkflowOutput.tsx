export type WorkflowOutputTab = 'nodes' | 'events' | 'errors'

export interface WorkflowOutputNode {
  nodeId: string
  sourceNodeId: string
  nodeType: string
  state: string
  attempt: number
  result: Record<string, unknown>
}

export interface WorkflowOutputEvent {
  key?: string
  seq: number
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
  events: readonly WorkflowOutputEvent[]
  error: string | null
  selectedNode: WorkflowOutputNode | undefined
  selectedNodeId: string | null
  pausedBeforeNodeId: string | null
  onExpandedChange: (expanded: boolean) => void
  onTabChange: (tab: WorkflowOutputTab) => void
  onNodeSelect: (nodeId: string) => void
  onClearError: () => void
  title?: string
  countLabel?: string
  nodesTabLabel?: string
  eventsTabLabel?: string
  eventsEmptyLabel?: string
}

export function WorkflowOutput({
  expanded,
  activeTab,
  completedNodeCount,
  expectedNodeCount,
  nodes,
  nodeNames,
  events,
  error,
  selectedNode,
  selectedNodeId,
  pausedBeforeNodeId,
  onExpandedChange,
  onTabChange,
  onNodeSelect,
  onClearError,
  title = '运行输出',
  countLabel = '个节点已有结果',
  nodesTabLabel = '节点结果',
  eventsTabLabel = '事件流',
  eventsEmptyLabel = '等待 OS 节点反馈……'
}: WorkflowOutputProps): React.JSX.Element {
  const eventNodeNames = workflowEventNodeNames(nodes, nodeNames)
  const nodeFailures = workflowNodeFailureLogs(nodes, nodeNames, events)
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
    ? workflowNodeLogText(selectedNode, events)
    : ''
  const errorCount = nodeFailures.length + (error ? 1 : 0)

  return (
    <div
      className={`workflow-runtime__results${
        expanded ? ' is-expanded' : ' is-collapsed'
      }`}
    >
      <header className="workflow-runtime__output-header">
        <div className="workflow-runtime__output-title">
          <strong>{title}</strong>
          <span>
            {completedNodeCount}/{expectedNodeCount}
            {' '}{countLabel}
          </span>
        </div>
        {expanded && (
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
              label={eventsTabLabel}
              count={events.length}
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
        <button
          type="button"
          className="workflow-runtime__output-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? '收起运行输出' : '展开运行输出'}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </header>

      {expanded && (
        <div className="workflow-runtime__output-body">
          <section
            id="workflow-output-panel-nodes"
            className="workflow-runtime__output-panel"
            role="tabpanel"
            aria-labelledby="workflow-output-tab-nodes"
            tabIndex={0}
            hidden={activeTab !== 'nodes'}
          >
            <div className="workflow-runtime__node-list">
              {nodes.map((node) => {
                const pausedBefore =
                  pausedBeforeNodeId === node.sourceNodeId
                return (
                  <button
                    key={node.nodeId}
                    type="button"
                    data-node-state={
                      pausedBefore ? 'paused-before' : node.state
                    }
                    className={[
                      selectedNodeId === node.sourceNodeId
                        ? 'is-selected'
                        : '',
                      pausedBefore ? 'is-paused-before' : ''
                    ].filter(Boolean).join(' ')}
                    onClick={() => onNodeSelect(node.sourceNodeId)}
                  >
                    <i
                      className={
                        pausedBefore
                          ? 'is-paused-before'
                          : `is-${node.state}`
                      }
                    />
                    <span className="is-node-id">
                      {node.sourceNodeId}
                    </span>
                    <span className="is-node-type">
                      {nodeTypeLabel(node.nodeType)}
                    </span>
                    <em>
                      {pausedBefore
                        ? '暂停位置'
                        : nodeStateLabel(node.state)}
                    </em>
                  </button>
                )
              })}
            </div>
            {selectedNode && (
              selectedNodeFailure || selectedNodeLog || selectedNodeHasResult
            ) && (
              <div className="workflow-runtime__node-details">
                {selectedNodeFailure && (
                  <article
                    className="workflow-runtime__error-detail workflow-runtime__node-error"
                  >
                    <header>
                      <strong>{selectedNodeFailure.nodeName} 执行失败</strong>
                      <small
                        title={`节点 ID：${selectedNodeFailure.sourceNodeId}`}
                      >
                        {selectedNodeFailure.sourceNodeId}
                        {selectedNodeFailure.attempt > 0
                          ? ` · 第 ${selectedNodeFailure.attempt} 次尝试`
                          : ''}
                      </small>
                    </header>
                    {selectedNodeFailure.log ? (
                      <pre
                        aria-label={`${selectedNodeFailure.nodeName} 错误日志`}
                      >
                        {selectedNodeFailure.log}
                      </pre>
                    ) : (
                      <p>节点已失败，但 OS 未返回详细错误日志。</p>
                    )}
                  </article>
                )}
                {selectedNodeLog && (
                  <article className="workflow-runtime__node-log">
                    <header>
                      <strong>
                        {nodeNames[selectedNode.sourceNodeId] ||
                          selectedNode.sourceNodeId} 运行日志
                      </strong>
                      {selectedNode.attempt > 0 && (
                        <small>第 {selectedNode.attempt} 次尝试</small>
                      )}
                    </header>
                    <pre
                      aria-label={`${nodeNames[selectedNode.sourceNodeId] || selectedNode.sourceNodeId} 运行日志`}
                    >
                      {selectedNodeLog}
                    </pre>
                  </article>
                )}
                {selectedNodeHasResult && (
                  <pre
                    className="workflow-runtime__node-result"
                    aria-label={`${nodeNames[selectedNode.sourceNodeId] || selectedNode.sourceNodeId} 节点结果`}
                  >
                    {JSON.stringify(selectedNode.result, null, 2)}
                  </pre>
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
              {events.length > 0 && (
                <p className="workflow-runtime__events-order">
                  最新事件在前
                </p>
              )}
              {[...events].reverse().slice(0, 50).map((event) => {
                const nodeName = event.nodeId
                  ? eventNodeNames.get(event.nodeId) || event.nodeId
                  : '整体运行'
                return (
                  <div
                    key={event.key ?? `${event.nodeId}:${event.seq}:${event.type}`}
                    data-event-kind={event.type}
                  >
                    <code>#{event.seq}</code>
                    <span>
                      <strong>{eventLabel(event.type)}</strong>
                      <small>{event.type}</small>
                      {event.detail && (
                        <details
                          className="workflow-runtime__event-raw"
                        >
                          <summary>查看原始数据</summary>
                          <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                        </details>
                      )}
                    </span>
                    <em
                      data-node-id={event.nodeId || undefined}
                      title={
                        event.nodeId && nodeName !== event.nodeId
                          ? `节点 ID：${event.nodeId}`
                          : undefined
                      }
                    >
                      {nodeName}
                    </em>
                  </div>
                )
              })}
              {events.length === 0 && <p>{eventsEmptyLabel}</p>}
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
                      <small title={`节点 ID：${failure.sourceNodeId}`}>
                        {failure.sourceNodeId}
                        {failure.attempt > 0
                          ? ` · 第 ${failure.attempt} 次尝试`
                          : ''}
                      </small>
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
      )}
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
  events: readonly WorkflowOutputEvent[]
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
    const heading = `#${event.seq} ${eventLabel(event.type)} (${event.type})`
    const detail = formatLogValue(event.detail)
    return detail ? `${heading}\n${detail}` : heading
  }).join('\n\n')
}

function workflowNodeFailureLogs(
  nodes: readonly WorkflowOutputNode[],
  nodeNames: Readonly<Record<string, string>>,
  events: readonly WorkflowOutputEvent[]
): WorkflowNodeFailureLog[] {
  const exceptionEvents = events.filter(
    (event) => event.type === 'node.exception'
  )
  const consumedEventSequences = new Set<number>()
  const failures = nodes
    .filter((node) => node.state === 'failed')
    .map((node) => {
      const sourceNodeId = node.sourceNodeId || node.nodeId
      const matchingEvents = exceptionEvents.filter((event) => {
        const matches =
          event.nodeId === node.nodeId ||
          event.nodeId === sourceNodeId
        if (matches) consumedEventSequences.add(event.seq)
        return matches
      })
      return {
        nodeId: node.nodeId,
        sourceNodeId,
        nodeName:
          nodeNames[sourceNodeId] ||
          nodeNames[node.nodeId] ||
          sourceNodeId,
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
    if (consumedEventSequences.has(event.seq)) continue
    const sourceNodeId = event.nodeId || '未知节点'
    failures.push({
      nodeId: `${sourceNodeId}:event:${event.seq}`,
      sourceNodeId,
      nodeName: eventNodeNames.get(sourceNodeId) || sourceNodeId,
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
  'run.command': '控制命令已处理',
  'run.recovered': '运行状态已恢复',
  'node.ready': '节点已就绪',
  'node.dispatched': '动作已下发',
  'node.started': '节点开始执行',
  'node.result': '节点执行成功',
  'node.completed': '节点执行成功',
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

function workflowEventNodeNames(
  runNodes: readonly WorkflowOutputNode[],
  nodeNames: Readonly<Record<string, string>>
): ReadonlyMap<string, string> {
  const result = new Map(Object.entries(nodeNames))
  for (const node of runNodes) {
    const sourceNodeId = node.sourceNodeId || node.nodeId
    const displayName =
      nodeNames[sourceNodeId] ||
      nodeNames[node.nodeId] ||
      sourceNodeId
    result.set(sourceNodeId, displayName)
    result.set(node.nodeId, displayName)
  }
  return result
}
