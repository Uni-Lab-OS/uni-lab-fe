import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  useServices,
  type DeviceAction,
  type DeviceActionInputSchema,
  type WorkflowRevision,
  type WorkflowRun,
  type WorkflowRunEvent,
  type WorkflowRunNode
} from '@unilab/services'

import { useWorkbench } from '../../context/WorkbenchContext'
import type { ManagedDevice } from '../../data/deviceCatalog'
import { useDevices } from '../../hooks/useDevices'
import styles from './DevicePanel.module.scss'

type ArgumentDraft = Record<string, string | boolean>

interface DebugExecution {
  actionRef: string | null
  submitting: boolean
  run: WorkflowRun | null
  node: WorkflowRunNode | null
  events: WorkflowRunEvent[]
  error: string | null
}

const TERMINAL_RUN_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled'
])

const EMPTY_EXECUTION: DebugExecution = {
  actionRef: null,
  submitting: false,
  run: null,
  node: null,
  events: [],
  error: null
}

export default function DevicePanel(): React.JSX.Element {
  const services = useServices()
  const { backend, connection } = useWorkbench()
  const {
    devices,
    loading,
    error,
    lastUpdated,
    refresh
  } = useDevices()
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [selectedActionRef, setSelectedActionRef] = useState<string | null>(null)
  const [argumentDraft, setArgumentDraft] = useState<ArgumentDraft>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [execution, setExecution] = useState<DebugExecution>(EMPTY_EXECUTION)
  const pollTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null
  )
  const pollGenerationRef = useRef(0)

  const selectedDevice = useMemo(
    () =>
      devices.find((device) => device.id === selectedDeviceId)
      ?? devices[0]
      ?? null,
    [devices, selectedDeviceId]
  )
  const selectedAction = useMemo(
    () =>
      selectedDevice?.actions.find(
        (action) => action.actionRef === selectedActionRef
      )
      ?? selectedDevice?.actions[0]
      ?? null,
    [selectedActionRef, selectedDevice]
  )
  const argumentDraftKey = useMemo(
    () =>
      selectedDevice && selectedAction
        ? [
            'unilab',
            'device-action-draft',
            backend.id,
            backend.apiUrl,
            selectedDevice.id,
            selectedAction.actionRef
          ].join(':')
        : null,
    [
      backend.apiUrl,
      backend.id,
      selectedAction,
      selectedDevice
    ]
  )
  const executionActive =
    execution.submitting
    || (
      execution.run != null
      && !TERMINAL_RUN_STATUSES.has(execution.run.status)
    )
  useEffect(() => {
    if (!devices.length) {
      setSelectedDeviceId(null)
      return
    }
    if (!devices.some((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(devices[0]?.id ?? null)
    }
  }, [devices, selectedDeviceId])

  useEffect(() => {
    if (!selectedDevice?.actions.length) {
      setSelectedActionRef(null)
      return
    }
    if (
      !selectedDevice.actions.some(
        (action) => action.actionRef === selectedActionRef
      )
    ) {
      setSelectedActionRef(selectedDevice.actions[0]?.actionRef ?? null)
    }
  }, [selectedActionRef, selectedDevice])

  useEffect(() => {
    const fallback = selectedAction
      ? createArgumentDraft(selectedAction.inputSchema)
      : {}
    setArgumentDraft(readArgumentDraft(argumentDraftKey, fallback))
    setFormError(null)
    if (!executionActive) setExecution(EMPTY_EXECUTION)
  }, [argumentDraftKey, selectedAction?.actionRef])

  const handleArgumentChange = useCallback(
    (name: string, value: string | boolean) => {
      setArgumentDraft((current) => {
        const next = { ...current, [name]: value }
        writeArgumentDraft(argumentDraftKey, next)
        return next
      })
    },
    [argumentDraftKey]
  )

  useEffect(() => {
    return () => {
      pollGenerationRef.current += 1
      if (pollTimerRef.current != null) {
        globalThis.clearTimeout(pollTimerRef.current)
      }
    }
  }, [])

  const pollRun = useCallback(
    async (runId: string, generation: number): Promise<void> => {
      try {
        const [run, nodes, eventPage] = await Promise.all([
          services.workflow.getRun(runId),
          services.workflow.listRunNodes(runId),
          services.workflow.listRunEvents(runId)
        ])
        if (generation !== pollGenerationRef.current) return
        setExecution((current) => ({
          ...current,
          submitting: false,
          run,
          node: nodes[0] ?? null,
          events: eventPage.events,
          error: null
        }))
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          void refresh()
          return
        }
        pollTimerRef.current = globalThis.setTimeout(() => {
          void pollRun(runId, generation)
        }, 400)
      } catch (pollError) {
        if (generation !== pollGenerationRef.current) return
        setExecution((current) => ({
          ...current,
          submitting: false,
          error: errorMessage(pollError, '读取动作执行状态失败')
        }))
      }
    },
    [refresh, services.workflow]
  )

  const runAction = useCallback(async (): Promise<void> => {
    if (!selectedDevice || !selectedAction) return
    setFormError(null)
    let actionArgs: Record<string, unknown>
    try {
      actionArgs = parseActionArguments(
        selectedAction.inputSchema,
        argumentDraft
      )
    } catch (parseError) {
      setFormError(errorMessage(parseError, '动作参数格式不正确'))
      return
    }

    const generation = pollGenerationRef.current + 1
    pollGenerationRef.current = generation
    if (pollTimerRef.current != null) {
      globalThis.clearTimeout(pollTimerRef.current)
    }
    setExecution({
      actionRef: selectedAction.actionRef,
      submitting: true,
      run: null,
      node: null,
      events: [],
      error: null
    })
    try {
      const requestId = createRequestId()
      const revision: WorkflowRevision = {
        schema_version: '2',
        revision_id: `device-debug-${requestId}`,
        workflow_id: `device-debug-${selectedDevice.id}`,
        invocations: [
          {
            node_id: 'action',
            action_ref: selectedAction.actionRef,
            name: selectedAction.displayName,
            input_bindings: Object.fromEntries(
              Object.entries(actionArgs).map(([name, value]) => [
                name,
                { kind: 'literal', value }
              ])
            ),
            output_schema: selectedAction.outputSchema
          }
        ],
        control_edges: []
      }
      const run = await services.workflow.createRun({
        source: {
          format: 'workflow_revision_v2',
          revision
        },
        client_request_id: requestId
      })
      if (generation !== pollGenerationRef.current) return
      setExecution((current) => ({
        ...current,
        submitting: false,
        run
      }))
      await pollRun(run.id, generation)
    } catch (runError) {
      if (generation !== pollGenerationRef.current) return
      setExecution((current) => ({
        ...current,
        submitting: false,
        error: errorMessage(runError, '动作提交失败')
      }))
    }
  }, [
    argumentDraft,
    pollRun,
    selectedAction,
    selectedDevice,
    services.workflow
  ])

  const cancelRun = useCallback(async (): Promise<void> => {
    if (!execution.run || !executionActive) return
    try {
      const run = await services.workflow.cancelRun(execution.run.id)
      setExecution((current) => ({ ...current, run, error: null }))
      const generation = pollGenerationRef.current
      await pollRun(run.id, generation)
    } catch (cancelError) {
      setExecution((current) => ({
        ...current,
        error: errorMessage(cancelError, '停止动作失败')
      }))
    }
  }, [execution.run, executionActive, pollRun, services.workflow])

  return (
    <section
      className={`section section--split device-page edge-device${
        devices.length ? '' : ' is-empty'
      }`}
    >
      <aside className="section__list" aria-label="Edge 设备列表">
        <header className="section__list-head edge-device__list-head">
          <div>
            <h1 className="section__list-title">仪器设备</h1>
            <span className="section__list-meta">
              {devices.length} 台设备 · Edge 实时上报
            </span>
          </div>
          <button
            type="button"
            className="edge-device__refresh"
            disabled={loading || connection !== 'connected'}
            onClick={() => void refresh()}
          >
            {loading ? '同步中' : '刷新'}
          </button>
        </header>
        <ConnectionSummary
          connection={connection}
          backendName={backend.name}
          lastUpdated={lastUpdated}
        />
        {loading && devices.length === 0 ? (
          <div className="device-loading" role="status">
            正在读取 Edge 设备与动作目录…
          </div>
        ) : null}
        {error ? (
          <div className="edge-device__load-error" role="alert">
            <strong>设备目录不可用</strong>
            <span>{error}</span>
            <button type="button" onClick={() => void refresh()}>
              重新读取
            </button>
          </div>
        ) : null}
        {devices.length === 0 ? (
          <div className="device-empty device-empty--compact">
            <strong>等待 Edge 上报设备</strong>
            <p>
              Edge 连接后会自动上报在线设备、动作节点及其参数 Schema。
            </p>
          </div>
        ) : (
          <ul className="device-list">
            {devices.map((device) => (
              <DeviceListItem
                key={device.id}
                device={device}
                selected={device.id === selectedDevice?.id}
                disabled={executionActive}
                onSelect={setSelectedDeviceId}
              />
            ))}
          </ul>
        )}
        <div className="edge-device__source-note">
          <span>数据来源</span>
          设备、在线状态、动作与结果均来自 Edge 实时上报。
        </div>
      </aside>

      <main className="section__detail edge-device__detail">
        {selectedDevice ? (
          <DeviceWorkspace
            device={selectedDevice}
            selectedAction={selectedAction}
            selectedActionRef={selectedActionRef}
            argumentDraft={argumentDraft}
            formError={formError}
            execution={execution}
            executionActive={executionActive}
            onSelectAction={setSelectedActionRef}
            onArgumentChange={handleArgumentChange}
            onRun={() => void runAction()}
            onCancel={() => void cancelRun()}
          />
        ) : (
          <div className="device-empty device-empty--detail">
            <strong>暂无可调试设备</strong>
            <p>请确认 Edge 已启动并连接到本地桥。</p>
          </div>
        )}
      </main>
    </section>
  )
}

function ConnectionSummary({
  connection,
  backendName,
  lastUpdated
}: {
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  backendName: string
  lastUpdated: number | null
}): React.JSX.Element {
  const state =
    connection === 'connected'
      ? 'is-online'
      : connection === 'connecting'
        ? 'is-pending'
        : 'is-offline'
  const label =
    connection === 'connected'
      ? 'Edge 已连接'
      : connection === 'connecting'
        ? '正在连接 Edge'
        : connection === 'error'
          ? 'Edge 连接失败'
          : 'Edge 未连接'
  return (
    <div className="edge-device__connection">
      <span className={`edge-device__connection-state ${state}`}>
        <span aria-hidden="true" />
        {label}
      </span>
      <small>
        {lastUpdated
          ? `更新于 ${formatTime(lastUpdated)}`
          : backendName}
      </small>
    </div>
  )
}

function DeviceListItem({
  device,
  selected,
  disabled,
  onSelect
}: {
  device: ManagedDevice
  selected: boolean
  disabled: boolean
  onSelect: (deviceId: string) => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        className={`device-list__item edge-device__device-item${
          selected ? ' is-active' : ''
        }`}
        aria-pressed={selected}
        disabled={disabled && !selected}
        onClick={() => onSelect(device.id)}
      >
        <span className="edge-device__device-icon">
          <DeviceIcon device={device} />
        </span>
        <span className="edge-device__device-copy">
          <span className="device-list__row">
            <span
              className={`device-list__status ${
                device.online ? 'is-online' : 'is-offline'
              }`}
            />
            <span className="device-list__name">{device.displayName}</span>
          </span>
          <span className="device-list__key">
            {device.displayDetail} · {device.actions.length} 个动作
          </span>
        </span>
        <span className="edge-device__chevron" aria-hidden="true">›</span>
      </button>
    </li>
  )
}

function DeviceWorkspace({
  device,
  selectedAction,
  selectedActionRef,
  argumentDraft,
  formError,
  execution,
  executionActive,
  onSelectAction,
  onArgumentChange,
  onRun,
  onCancel
}: {
  device: ManagedDevice
  selectedAction: DeviceAction | null
  selectedActionRef: string | null
  argumentDraft: ArgumentDraft
  formError: string | null
  execution: DebugExecution
  executionActive: boolean
  onSelectAction: (actionRef: string) => void
  onArgumentChange: (name: string, value: string | boolean) => void
  onRun: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="edge-device__workspace">
      <header className="edge-device__identity">
        <span className="edge-device__identity-icon">
          <DeviceIcon device={device} />
        </span>
        <div>
          <div className="edge-device__identity-title">
            <h2>{device.displayName}</h2>
          </div>
          <p>{device.deviceKey || `${device.namespace}/${device.id}`}</p>
        </div>
        <span
          className={`edge-device__status-badge ${
            device.online ? 'is-online' : 'is-offline'
          }`}
        >
          {device.online ? '在线' : '离线'}
        </span>
      </header>

      <div className="edge-device__metrics" aria-label="设备目录信息">
        <Metric
          label="上报 Edge"
          value={device.machineName}
        />
        <Metric label="命名空间" value={device.namespace || '—'} />
        <Metric label="动作节点" value={`${device.actions.length}`} />
        <Metric
          label="当前状态"
          value={device.online ? '可调试' : '不可用'}
          tone={device.online ? 'success' : 'muted'}
        />
      </div>

      <div className="edge-device__content">
        <section className="edge-device__action-section">
          <div className="edge-device__section-heading">
            <div>
              <span>动作目录</span>
              <h3>Edge 上报的动作节点</h3>
            </div>
            <small>{device.actions.length} 个</small>
          </div>
          {device.actions.length ? (
            <div className="edge-device__action-list">
              {device.actions.map((action, index) => (
                <button
                  key={action.actionRef}
                  type="button"
                  className={`edge-device__action-node${
                    action.actionRef === selectedActionRef ? ' is-active' : ''
                  }`}
                  aria-pressed={action.actionRef === selectedActionRef}
                  aria-label={`${action.displayName} 动作节点`}
                  disabled={
                    executionActive
                    && action.actionRef !== execution.actionRef
                  }
                  onClick={() => onSelectAction(action.actionRef)}
                >
                  <span className="edge-device__node-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="edge-device__node-copy">
                    <strong>{action.displayName}</strong>
                    <code>{action.actionRef}</code>
                  </span>
                  <span
                    className={`edge-device__node-state ${
                      action.isBusy ? 'is-busy' : 'is-ready'
                    }`}
                  >
                    {action.isBusy ? '占用中' : '空闲'}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="edge-device__no-actions">
              Edge 已上报该设备，但没有可调试的动作节点。
            </div>
          )}
        </section>

        <section className="edge-device__debug-section">
          {selectedAction ? (
            <>
              <div className="edge-device__section-heading">
                <div>
                  <span>单节点调试</span>
                  <h3>{selectedAction.displayName}</h3>
                </div>
                <code>{selectedAction.actionName}</code>
              </div>
              <ActionParameterForm
                action={selectedAction}
                draft={argumentDraft}
                disabled={executionActive}
                onChange={onArgumentChange}
              />
              {formError ? (
                <p className="edge-device__form-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <div className="edge-device__debug-actions">
                <button
                  type="button"
                  className="edge-device__run-button"
                  disabled={
                    !device.online
                    || selectedAction.isBusy
                    || executionActive
                  }
                  onClick={onRun}
                >
                  {execution.submitting ? '正在提交…' : '运行此动作'}
                </button>
                {executionActive && execution.run ? (
                  <button
                    type="button"
                    className="edge-device__cancel-button"
                    onClick={onCancel}
                  >
                    终止
                  </button>
                ) : null}
                <span>
                  仅执行当前动作节点，结果以 OS 返回状态为准。
                </span>
              </div>
              <ExecutionResult execution={execution} />
            </>
          ) : (
            <div className="edge-device__no-actions">
              选择一个动作节点后配置参数并运行。
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'success' | 'muted'
}): React.JSX.Element {
  return (
    <span className={`edge-device__metric${tone ? ` is-${tone}` : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  )
}

function ActionParameterForm({
  action,
  draft,
  disabled,
  onChange
}: {
  action: DeviceAction
  draft: ArgumentDraft
  disabled: boolean
  onChange: (name: string, value: string | boolean) => void
}): React.JSX.Element {
  const fields = Object.entries(action.inputSchema)
  if (!fields.length) {
    return (
      <div className="edge-device__parameter-empty">
        此动作不需要输入参数，可直接运行。
      </div>
    )
  }
  return (
    <div className="edge-device__parameter-form">
      {fields.map(([name, schema]) => (
        <ActionField
          key={name}
          name={name}
          schema={schema}
          value={draft[name] ?? ''}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  )
}

function ActionField({
  name,
  schema,
  value,
  disabled,
  onChange
}: {
  name: string
  schema: DeviceActionInputSchema
  value: string | boolean
  disabled: boolean
  onChange: (name: string, value: string | boolean) => void
}): React.JSX.Element {
  const label = schema.title || name
  if (schema.type === 'boolean') {
    return (
      <label className="edge-device__field edge-device__field--boolean">
        <span>
          {label}
          {schema.required ? <em>必填</em> : null}
        </span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(name, event.target.checked)}
        />
        {schema.description ? <small>{schema.description}</small> : null}
      </label>
    )
  }
  const isStructured = schema.type === 'object' || schema.type === 'array'
  return (
    <label className={`edge-device__field${isStructured ? ' is-wide' : ''}`}>
      <span>
        {label}
        {schema.required ? <em>必填</em> : null}
      </span>
      {schema.enum?.length ? (
        <select
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(name, event.target.value)}
        >
          {schema.enum.map((option) => (
            <option key={JSON.stringify(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      ) : isStructured ? (
        <textarea
          rows={2}
          value={String(value)}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => onChange(name, event.target.value)}
        />
      ) : (
        <input
          type={
            schema.type === 'number' || schema.type === 'integer'
              ? 'number'
              : 'text'
          }
          value={String(value)}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === 'integer' ? 1 : 'any'}
          disabled={disabled}
          onChange={(event) => onChange(name, event.target.value)}
        />
      )}
      {schema.description ? <small>{schema.description}</small> : null}
    </label>
  )
}

function ExecutionResult({
  execution
}: {
  execution: DebugExecution
}): React.JSX.Element | null {
  const [copied, setCopied] = useState(false)
  const log = executionLog(execution)
  useEffect(() => {
    setCopied(false)
  }, [log])

  if (
    !execution.submitting
    && !execution.run
    && !execution.error
  ) {
    return null
  }
  const state = execution.node?.state || execution.run?.status || 'submitting'
  const presentation = executionPresentation(state)
  return (
    <div className="edge-device__execution" aria-live="polite">
      <div className="edge-device__execution-head">
        <span className={`edge-device__execution-state ${presentation.tone}`}>
          <span aria-hidden="true" />
          {presentation.label}
        </span>
        <span className={styles.executionTools}>
          {execution.run ? <code>{execution.run.id.slice(0, 12)}</code> : null}
          {log ? (
            <button
              type="button"
              className={styles.copyButton}
              data-copied={copied}
              onClick={() => {
                void navigator.clipboard.writeText(log).then(() => {
                  setCopied(true)
                })
              }}
            >
              {copied ? '已复制' : '复制'}
            </button>
          ) : null}
        </span>
      </div>
      {execution.error ? (
        <p className="edge-device__execution-error" role="alert">
          {execution.error}
        </p>
      ) : null}
      {log ? (
          <pre aria-label="Action 运行日志">{log}</pre>
        ) : execution.run?.status === 'completed' ? (
          <p>动作执行成功，设备未返回结构化结果。</p>
        ) : (
          <p>{presentation.description}</p>
        )}
    </div>
  )
}

function executionLog(execution: DebugExecution): string {
  const projection: Record<string, unknown> = {}
  if (execution.events.length > 0) {
    projection.events = execution.events
  }
  if (
    execution.node?.result
    && Object.keys(execution.node.result).length > 0
  ) {
    projection.result = execution.node.result
  }
  if (execution.error) {
    projection.error = execution.error
  }
  return Object.keys(projection).length > 0
    ? JSON.stringify(projection, null, 2)
    : ''
}

function DeviceIcon({ device }: { device: ManagedDevice }): React.JSX.Element {
  const text = [
    device.id,
    device.displayName,
    device.machineName
  ].join(' ').toLowerCase()
  if (text.includes('camera') || text.includes('相机')) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7.5h3l1.4-2h7.2l1.4 2h3v11H4z" />
        <circle cx="12" cy="13" r="3.4" />
      </svg>
    )
  }
  if (
    text.includes('robot')
    || text.includes('arm')
    || text.includes('机械臂')
  ) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 19h14M8 19v-3.5l3-1.5 1.2-4.1" />
        <circle cx="12.6" cy="8.5" r="1.7" />
        <path d="m14 7.4 2.4-2.1 2.1 2.2-2.2 2.1M16.2 9.7l1.8 2.1" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 13h5M17 13h.01" />
    </svg>
  )
}

function createArgumentDraft(
  schema: Record<string, DeviceActionInputSchema>
): ArgumentDraft {
  return Object.fromEntries(
    Object.entries(schema).map(([name, field]) => [
      name,
      draftValue(field)
    ])
  )
}

function readArgumentDraft(
  storageKey: string | null,
  fallback: ArgumentDraft
): ArgumentDraft {
  if (!storageKey || typeof globalThis.localStorage === 'undefined') {
    return fallback
  }
  try {
    const parsed = JSON.parse(
      globalThis.localStorage.getItem(storageKey) ?? 'null'
    ) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback
    }
    const persisted = Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) =>
          typeof value === 'string' || typeof value === 'boolean'
      )
    ) as ArgumentDraft
    return { ...fallback, ...persisted }
  } catch {
    return fallback
  }
}

function writeArgumentDraft(
  storageKey: string | null,
  draft: ArgumentDraft
): void {
  if (!storageKey || typeof globalThis.localStorage === 'undefined') return
  try {
    globalThis.localStorage.setItem(storageKey, JSON.stringify(draft))
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

function draftValue(schema: DeviceActionInputSchema): string | boolean {
  if (schema.type === 'boolean') return Boolean(schema.default)
  if (schema.default !== undefined && schema.default !== null) {
    if (schema.type === 'object' || schema.type === 'array') {
      return JSON.stringify(schema.default, null, 2)
    }
    return String(schema.default)
  }
  if (schema.enum?.length) return String(schema.enum[0])
  if (schema.type === 'object') return '{}'
  if (schema.type === 'array') return '[]'
  return ''
}

function parseActionArguments(
  schema: Record<string, DeviceActionInputSchema>,
  draft: ArgumentDraft
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema).flatMap(([name, field]) => {
      const raw = draft[name]
      if (field.type !== 'boolean' && String(raw ?? '').trim() === '') {
        if (field.required) throw new Error(`${field.title || name} 为必填项`)
        return []
      }
      if (field.type === 'boolean') return [[name, Boolean(raw)]]
      if (field.type === 'number' || field.type === 'integer') {
        const value = Number(raw)
        if (!Number.isFinite(value)) {
          throw new Error(`${field.title || name} 必须是数字`)
        }
        if (field.type === 'integer' && !Number.isInteger(value)) {
          throw new Error(`${field.title || name} 必须是整数`)
        }
        return [[name, value]]
      }
      if (field.type === 'object' || field.type === 'array') {
        let value: unknown
        try {
          value = JSON.parse(String(raw))
        } catch {
          throw new Error(`${field.title || name} 必须是有效 JSON`)
        }
        if (field.type === 'object' && (
          value == null
          || typeof value !== 'object'
          || Array.isArray(value)
        )) {
          throw new Error(`${field.title || name} 必须是 JSON 对象`)
        }
        if (field.type === 'array' && !Array.isArray(value)) {
          throw new Error(`${field.title || name} 必须是 JSON 数组`)
        }
        return [[name, value]]
      }
      return [[name, String(raw)]]
    })
  )
}

function executionPresentation(state: string): {
  label: string
  description: string
  tone: string
} {
  switch (state) {
    case 'success':
    case 'completed':
      return {
        label: '执行成功',
        description: '动作已由 OS 确认为成功。',
        tone: 'is-success'
      }
    case 'failed':
      return {
        label: '执行失败',
        description: 'OS 报告动作执行失败，请检查设备日志。',
        tone: 'is-danger'
      }
    case 'cancelled':
      return {
        label: '已停止',
        description: 'OS 已确认动作停止。',
        tone: 'is-muted'
      }
    case 'running':
      return {
        label: '执行中',
        description: '动作已进入设备执行队列。',
        tone: 'is-running'
      }
    case 'reconciling':
    case 'dispatch_unknown':
      return {
        label: '等待核对',
        description: '物理执行状态尚不确定，正在等待 OS 核对。',
        tone: 'is-warning'
      }
    case 'cancel_requested':
      return {
        label: '停止中',
        description: '停止请求已发送，等待 OS 确认物理终态。',
        tone: 'is-warning'
      }
    case 'submitting':
      return {
        label: '正在提交',
        description: '正在校验并提交单节点 DAG。',
        tone: 'is-pending'
      }
    default:
      return {
        label: '等待执行',
        description: 'OS 已接受任务，等待动作调度。',
        tone: 'is-pending'
      }
  }
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
