import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  ServiceError,
  type DeviceAction,
  type DeviceActionInputSchema,
  type DeviceActionTaskView,
  type WorkflowActionCatalogSnapshot,
  type WorkflowActionNodeTemplate,
  type WorkflowNodeJobFeedback,
  useServices
} from '@unilab/services'

import { useWorkbench } from '../../context/WorkbenchContext'
import type { ManagedDevice } from '../../data/deviceCatalog'
import { useDevices } from '../../hooks/useDevices'
import {
  getD1AS1UnsupportedReason,
  matchDeviceActionTemplate,
  serializeDeviceActionInput,
  type D1AS1UnsupportedReason,
  type DeviceActionArgumentDraft
} from './deviceActionRun'
import styles from './DevicePanel.module.scss'

type ArgumentDraft = DeviceActionArgumentDraft

interface UnlockIntent {
  deviceId: string
  deviceName: string
  actionName: string
  actionRef: string
  actionLabel: string
  expectedJobId: string
}

interface UnlockOperation {
  actionRef: string
  state: 'pending' | 'success' | 'error'
  message: string
}

interface DeviceActionRunOperation {
  actionRef: string
  state: DeviceActionRunState
}

interface DeviceActionRunAttempt {
  signature: string
  idempotencyKey: string
}

interface DeviceActionFeedbackState {
  cursor: number
  items: WorkflowNodeJobFeedback[]
}

export default function DevicePanel(): React.JSX.Element {
  const { backend, connection } = useWorkbench()
  const services = useServices()
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
  const [unlockIntent, setUnlockIntent] = useState<UnlockIntent | null>(null)
  const [unlockOperation, setUnlockOperation] =
    useState<UnlockOperation | null>(null)
  const [actionCatalog, setActionCatalog] =
    useState<WorkflowActionCatalogSnapshot | null>(null)
  const [actionCatalogLoading, setActionCatalogLoading] = useState(false)
  const [actionCatalogError, setActionCatalogError] = useState<string | null>(null)
  const [runOperation, setRunOperation] =
    useState<DeviceActionRunOperation | null>(null)
  const runAttemptRef = useRef<DeviceActionRunAttempt | null>(null)
  const feedbackByTaskRef = useRef<Map<string, DeviceActionFeedbackState>>(
    new Map()
  )
  const refreshByTaskRef = useRef<Map<string, Promise<void>>>(new Map())
  const canForceUnlock = services.capabilities.devices.forceUnlock
  const canRunActionTask = services.capabilities.devices.runActionTask

  useEffect(() => {
    runAttemptRef.current = null
    feedbackByTaskRef.current.clear()
    refreshByTaskRef.current.clear()
    setRunOperation(null)
  }, [backend.apiUrl, backend.id])

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
  const selectedActionTemplate = useMemo(
    () =>
      actionCatalog && selectedAction
        ? matchDeviceActionTemplate(actionCatalog, selectedAction)
        : null,
    [actionCatalog, selectedAction]
  )

  const loadActionCatalog = useCallback(async (signal?: AbortSignal) => {
    if (!canRunActionTask || connection !== 'connected') return
    setActionCatalogLoading(true)
    setActionCatalogError(null)
    try {
      const catalog = await services.workflow.getWorkflowActionCatalog(signal)
      if (signal?.aborted) return
      setActionCatalog(catalog)
    } catch (error) {
      if (signal?.aborted) return
      setActionCatalog(null)
      setActionCatalogError(
        error instanceof Error ? error.message : 'Action 合同目录不可用'
      )
    } finally {
      if (!signal?.aborted) setActionCatalogLoading(false)
    }
  }, [canRunActionTask, connection, services.workflow])

  useEffect(() => {
    if (!canRunActionTask || connection !== 'connected') {
      setActionCatalog(null)
      setActionCatalogError(null)
      setActionCatalogLoading(false)
      return
    }
    const controller = new AbortController()
    void loadActionCatalog(controller.signal)
    return () => controller.abort()
  }, [backend.apiUrl, backend.id, canRunActionTask, connection, loadActionCatalog])
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

  const handleRequestUnlock = useCallback(
    (device: ManagedDevice, action: DeviceAction) => {
      if (!action.currentJobId) return
      setUnlockOperation(null)
      setUnlockIntent({
        deviceId: device.id,
        deviceName: device.displayName,
        actionName: action.actionName,
        actionRef: action.actionRef,
        actionLabel: action.displayName,
        expectedJobId: action.currentJobId
      })
    },
    []
  )

  const handleConfirmUnlock = useCallback(async () => {
    const intent = unlockIntent
    if (!intent) return
    setUnlockOperation({
      actionRef: intent.actionRef,
      state: 'pending',
      message: '正在请求 OS 取消当前动作并释放锁…'
    })
    try {
      const result = await services.laboratory.forceUnlockDeviceAction({
        deviceId: intent.deviceId,
        actionName: intent.actionName,
        expectedJobId: intent.expectedJobId
      })
      setUnlockIntent(null)
      setUnlockOperation({
        actionRef: intent.actionRef,
        state: 'success',
        message: result.status === 'already_unlocked'
          ? '该动作锁已由 OS 释放，正在复核最新目录状态。'
          : `OS 已释放 ${result.releasedJobIds.length} 个关联 Job，正在复核最新目录状态。`
      })
      await refresh()
    } catch (error) {
      setUnlockOperation({
        actionRef: intent.actionRef,
        state: 'error',
        message: error instanceof Error
          ? error.message
          : '设备解锁失败，请刷新状态后重试'
      })
    }
  }, [refresh, services.laboratory, unlockIntent])

  const refreshDeviceActionTask = useCallback(async (
    taskUuid: string,
    actionRef: string
  ) => {
    const view = await services.deviceActionTasks.getDeviceActionTask(taskUuid)
    const previous = feedbackByTaskRef.current.get(taskUuid) ?? {
      cursor: 0,
      items: []
    }
    let cursor = previous.cursor
    const feedback = [...previous.items]
    while (cursor < view.feedback_cursor) {
      const page = await services.workflow.listWorkflowNodeJobFeedback(
        view.job_uuid,
        { after_sequence: cursor, limit: 100 }
      )
      feedback.push(...page.items.filter((item) => item.sequence > cursor))
      if (page.next_cursor <= cursor) break
      cursor = page.next_cursor
      if (!page.has_more) break
    }
    feedbackByTaskRef.current.set(taskUuid, { cursor, items: feedback })
    setRunOperation((current) => {
      if (
        !current ||
        current.actionRef !== actionRef ||
        !('taskUuid' in current.state) ||
        current.state.taskUuid !== taskUuid
      ) {
        return current
      }
      return {
        actionRef,
        state: projectDeviceActionTask(view, feedback)
      }
    })
    if (isTerminalDeviceActionTask(view.status)) {
      await refresh()
    }
  }, [refresh, services.deviceActionTasks, services.workflow])

  const queueDeviceActionTaskRefresh = useCallback((
    taskUuid: string,
    actionRef: string
  ): Promise<void> => {
    const previous = refreshByTaskRef.current.get(taskUuid) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => refreshDeviceActionTask(taskUuid, actionRef))
    refreshByTaskRef.current.set(taskUuid, next)
    const removeIfCurrent = (): void => {
      if (refreshByTaskRef.current.get(taskUuid) === next) {
        refreshByTaskRef.current.delete(taskUuid)
      }
    }
    void next.then(removeIfCurrent, removeIfCurrent)
    return next
  }, [refreshDeviceActionTask])

  const activeTaskUuid = runOperation?.state && 'taskUuid' in runOperation.state
    ? runOperation.state.taskUuid
    : null
  useEffect(() => {
    if (!activeTaskUuid || !runOperation) return
    const actionRef = runOperation.actionRef
    const subscription = services.workflow.subscribeWorkflowRuntime((event) => {
      if (
        event.event !== 'device_action_task.changed' ||
        event.data.task_uuid !== activeTaskUuid
      ) return
      void queueDeviceActionTaskRefresh(activeTaskUuid, actionRef).catch((error) => {
        setRunOperation((current) => {
          if (
            !current ||
            !('taskUuid' in current.state) ||
            current.state.taskUuid !== activeTaskUuid
          ) {
            return current
          }
          return {
            ...current,
            state: {
              ...current.state,
              message: error instanceof Error
                ? `任务状态补读失败：${error.message}`
                : '任务状态补读失败'
            }
          }
        })
      })
    })
    return () => subscription.dispose()
  }, [
    activeTaskUuid,
    queueDeviceActionTaskRefresh,
    runOperation?.actionRef,
    services.workflow
  ])

  const handleRunAction = useCallback(async (
    device: ManagedDevice,
    action: DeviceAction,
    template: WorkflowActionNodeTemplate
  ) => {
    if (
      !actionCatalog ||
      runOperation?.state.kind === 'submitting' ||
      runOperation?.state.kind === 'accepted' ||
      runOperation?.state.kind === 'running'
    ) return
    let input: Record<string, unknown>
    try {
      input = serializeDeviceActionInput(action, argumentDraft)
    } catch (error) {
      setRunOperation({
        actionRef: action.actionRef,
        state: {
          kind: 'error',
          message: error instanceof Error ? error.message : 'Action 参数不合法',
          retryable: false
        }
      })
      return
    }
    const signature = JSON.stringify({
      authorityId: actionCatalog.authorityId,
      fingerprint: actionCatalog.fingerprint,
      templateUuid: template.uuid,
      deviceId: device.id,
      input
    })
    const previous = runAttemptRef.current
    const idempotencyKey = previous?.signature === signature
      ? previous.idempotencyKey
      : globalThis.crypto.randomUUID()
    runAttemptRef.current = { signature, idempotencyKey }
    setRunOperation({
      actionRef: action.actionRef,
      state: { kind: 'submitting', message: '正在创建正式任务…' }
    })
    try {
      const view = await services.deviceActionTasks.createDeviceActionTask({
        authority_id: actionCatalog.authorityId,
        template_catalog_fingerprint: actionCatalog.fingerprint,
        workflow_node_template_uuid: template.uuid,
        device_id: device.id,
        input,
        idempotency_key: idempotencyKey,
        description: '设备页单动作运行'
      })
      runAttemptRef.current = null
      feedbackByTaskRef.current.set(view.task_uuid, { cursor: 0, items: [] })
      setRunOperation({
        actionRef: action.actionRef,
        state: projectDeviceActionTask(view, [])
      })
      const [, taskRefresh] = await Promise.allSettled([
        refresh(),
        queueDeviceActionTaskRefresh(view.task_uuid, action.actionRef)
      ])
      if (taskRefresh.status === 'rejected') {
        const error = taskRefresh.reason
        setRunOperation((current) => {
          if (
            !current ||
            !('taskUuid' in current.state) ||
            current.state.taskUuid !== view.task_uuid
          ) {
            return current
          }
          return {
            ...current,
            state: {
              ...current.state,
              message: error instanceof Error
                ? `任务已接受，状态补读失败：${error.message}`
                : '任务已接受，状态补读失败'
            }
          }
        })
      }
    } catch (error) {
      if (
        error instanceof ServiceError &&
        error.code === 'template_catalog_conflict'
      ) {
        runAttemptRef.current = null
        await Promise.all([loadActionCatalog(), refresh()])
        setRunOperation({
          actionRef: action.actionRef,
          state: {
            kind: 'error',
            message: 'Action 合同目录已更新，请复核参数后重新运行',
            retryable: false
          }
        })
        return
      }
      setRunOperation({
        actionRef: action.actionRef,
        state: {
          kind: 'error',
          message: error instanceof Error ? error.message : '任务创建失败',
          retryable: error instanceof ServiceError && error.retryable
        }
      })
    }
  }, [
    actionCatalog,
    argumentDraft,
    loadActionCatalog,
    refresh,
    queueDeviceActionTaskRefresh,
    runOperation?.state.kind,
    services.deviceActionTasks
  ])

  const handleCancelActionTask = useCallback(async (taskUuid: string) => {
    try {
      await services.workflow.commandWorkflowTask(taskUuid, {
        type: 'cancel',
        idempotency_key: globalThis.crypto.randomUUID(),
        description: '设备页取消单动作任务'
      })
      setRunOperation((current) => current && 'taskUuid' in current.state
        ? {
            ...current,
            state: {
              ...current.state,
              message: '取消命令已接受，等待 OS 确认生效'
            }
          }
        : current)
    } catch (error) {
      setRunOperation((current) => current && 'taskUuid' in current.state
        ? {
            ...current,
            state: {
              ...current.state,
              message: error instanceof Error
                ? `取消任务失败：${error.message}`
                : '取消任务失败，请重试'
            }
          }
        : current)
    }
  }, [services.workflow])

  return (
    <>
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
            onSelectAction={setSelectedActionRef}
            onArgumentChange={handleArgumentChange}
            actionTemplate={selectedActionTemplate}
            actionCatalogLoading={actionCatalogLoading}
            actionCatalogError={actionCatalogError}
            canRunActionTask={canRunActionTask}
            connection={connection}
            runState={
              runOperation !== null && selectedAction !== null &&
              runOperation.actionRef === selectedAction.actionRef
                ? runOperation.state
                : null
            }
            activeRunActionRef={
              runOperation && (
                runOperation.state.kind === 'submitting' ||
                runOperation.state.kind === 'accepted' ||
                runOperation.state.kind === 'running'
              )
                ? runOperation.actionRef
                : null
            }
            onRunAction={(action, template) => {
              void handleRunAction(selectedDevice, action, template)
            }}
            onCancelActionTask={(taskUuid) => {
              void handleCancelActionTask(taskUuid)
            }}
            canForceUnlock={canForceUnlock}
            unlockOperation={unlockOperation}
            onRequestUnlock={handleRequestUnlock}
          />
        ) : (
          <div className="device-empty device-empty--detail">
            <strong>暂无可调试设备</strong>
            <p>请确认 Edge 已启动并连接到本地桥。</p>
          </div>
        )}
        </main>
      </section>
      {unlockIntent ? (
        <UnlockConfirmationDialog
          intent={unlockIntent}
          operation={unlockOperation}
          onCancel={() => {
            if (unlockOperation?.state !== 'pending') setUnlockIntent(null)
          }}
          onConfirm={() => void handleConfirmUnlock()}
        />
      ) : null}
    </>
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
  onSelect
}: {
  device: ManagedDevice
  selected: boolean
  onSelect: (deviceId: string) => void
}): React.JSX.Element {
  const lockedActionCount = device.actions.filter(
    (action) => action.isBusy
  ).length
  return (
    <li>
      <button
        type="button"
        className={`device-list__item edge-device__device-item${
          selected ? ' is-active' : ''
        }`}
        aria-pressed={selected}
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
            {lockedActionCount ? (
              <span className="edge-device__list-lock">
                已锁定
              </span>
            ) : null}
          </span>
          <span className="device-list__key">
            {device.displayDetail} · {device.actions.length} 个动作
            {lockedActionCount ? ` · ${lockedActionCount} 个占用` : ''}
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
  onSelectAction,
  onArgumentChange,
  actionTemplate,
  actionCatalogLoading,
  actionCatalogError,
  canRunActionTask,
  connection,
  runState,
  activeRunActionRef,
  onRunAction,
  onCancelActionTask,
  canForceUnlock,
  unlockOperation,
  onRequestUnlock
}: {
  device: ManagedDevice
  selectedAction: DeviceAction | null
  selectedActionRef: string | null
  argumentDraft: ArgumentDraft
  onSelectAction: (actionRef: string) => void
  onArgumentChange: (name: string, value: string | boolean) => void
  actionTemplate: WorkflowActionNodeTemplate | null
  actionCatalogLoading: boolean
  actionCatalogError: string | null
  canRunActionTask: boolean
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  runState: DeviceActionRunState | null
  activeRunActionRef: string | null
  onRunAction: (
    action: DeviceAction,
    template: WorkflowActionNodeTemplate
  ) => void
  onCancelActionTask: (taskUuid: string) => void
  canForceUnlock: boolean
  unlockOperation: UnlockOperation | null
  onRequestUnlock: (device: ManagedDevice, action: DeviceAction) => void
}): React.JSX.Element {
  const lockedActionCount = device.actions.filter(
    (action) => action.isBusy
  ).length
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
        <div className="edge-device__identity-states">
          {lockedActionCount ? (
            <span className="edge-device__status-badge is-locked">
              已锁定 · {lockedActionCount} 个动作
            </span>
          ) : null}
          <span
            className={`edge-device__status-badge ${
              device.online ? 'is-online' : 'is-offline'
            }`}
          >
            {device.online ? '在线' : '离线'}
          </span>
        </div>
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
          value={lockedActionCount
            ? `${lockedActionCount} 个动作占用`
            : device.online ? '可编排' : '不可用'}
          tone={lockedActionCount
            ? 'warning'
            : device.online ? 'success' : 'muted'}
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
                  title={action.displayName}
                  disabled={
                    activeRunActionRef !== null &&
                    action.actionRef !== activeRunActionRef
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
                  <span>动作参数预览</span>
                  <h3 title={selectedAction.displayName}>
                    {selectedAction.displayName}
                  </h3>
                </div>
                <code>{selectedAction.actionName}</code>
              </div>
              <DeviceLockControl
                action={selectedAction}
                canForceUnlock={canForceUnlock}
                operation={unlockOperation}
                onRequestUnlock={() => {
                  onRequestUnlock(device, selectedAction)
                }}
              />
              <ActionParameterForm
                action={selectedAction}
                draft={argumentDraft}
                disabled={
                  runState?.kind === 'submitting' ||
                  runState?.kind === 'accepted' ||
                  runState?.kind === 'running'
                }
                onChange={onArgumentChange}
              />
              <DeviceActionAvailability
                state={runState ?? deviceActionReadiness({
                  action: selectedAction,
                  device,
                  template: actionTemplate,
                  canRunActionTask,
                  connection,
                  catalogLoading: actionCatalogLoading,
                  catalogError: actionCatalogError
                })}
                onRun={() => {
                  if (actionTemplate) onRunAction(selectedAction, actionTemplate)
                }}
                onCancel={onCancelActionTask}
              />
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

function deviceActionReadiness({
  action,
  device,
  template,
  canRunActionTask,
  connection,
  catalogLoading,
  catalogError
}: {
  action: DeviceAction
  device: ManagedDevice
  template: WorkflowActionNodeTemplate | null
  canRunActionTask: boolean
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  catalogLoading: boolean
  catalogError: string | null
}): DeviceActionRunState {
  if (!canRunActionTask) {
    return {
      kind: 'unavailable',
      reason: 'workflow_required',
      message: '当前服务未启用设备页单动作运行，请在工作流中运行'
    }
  }
  if (connection !== 'connected') {
    return {
      kind: 'unavailable',
      reason: 'edge_disconnected',
      message: 'Edge 当前未连接，恢复连接后才能运行'
    }
  }
  if (!device.online) {
    return {
      kind: 'unavailable',
      reason: 'device_offline',
      message: '设备当前离线，设备上线后才能运行'
    }
  }
  if (catalogLoading) {
    return {
      kind: 'unavailable',
      reason: 'catalog_loading',
      message: '正在读取动作合同目录…'
    }
  }
  if (catalogError) {
    return {
      kind: 'unavailable',
      reason: 'catalog_error',
      message: `动作合同目录读取失败：${catalogError}`
    }
  }
  if (!template) {
    return {
      kind: 'unavailable',
      reason: 'workflow_required',
      message: '该设备动作未唯一匹配到动作模板，请在工作流中运行'
    }
  }
  const unsupportedReason = getD1AS1UnsupportedReason(template)
  if (unsupportedReason) {
    return {
      kind: 'unavailable',
      reason: 'workflow_required',
      message: workflowRequirementMessage(unsupportedReason)
    }
  }
  return {
    kind: 'ready',
    message: action.isBusy
      ? '当前动作被占用；提交后由 OS durable admission 排队'
      : '参数将提交为正式 WorkflowTask / WorkflowNodeJob'
  }
}

function projectDeviceActionTask(
  view: DeviceActionTaskView,
  feedback: WorkflowNodeJobFeedback[]
): DeviceActionRunState {
  const projection = {
    taskUuid: view.task_uuid,
    output: view.output,
    feedback,
    error: view.error_info
  }
  if (view.status === 'succeeded') {
    return { kind: 'succeeded', message: '动作执行完成', ...projection }
  }
  if (view.status === 'failed' || view.status === 'timeout') {
    return {
      kind: 'failed',
      message: view.status === 'timeout' ? '动作执行超时' : '动作执行失败',
      ...projection
    }
  }
  if (view.status === 'canceled') {
    return { kind: 'canceled', message: '动作任务已取消', ...projection }
  }
  if (view.status === 'running' || view.status === 'canceling') {
    return {
      kind: 'running',
      message: view.status === 'canceling'
        ? '取消正在生效，等待设备终态'
        : `设备正在执行 · Job ${view.job_status}`,
      ...projection
    }
  }
  return {
    kind: 'accepted',
    message: '任务已接受，正在等待设备',
    ...projection
  }
}

function isTerminalDeviceActionTask(status: string): boolean {
  return ['succeeded', 'failed', 'canceled', 'timeout'].includes(status)
}

type DeviceActionUnavailableReason =
  | 'workflow_required'
  | 'edge_disconnected'
  | 'device_offline'
  | 'catalog_loading'
  | 'catalog_error'

function workflowRequirementMessage(
  reason: D1AS1UnsupportedReason
): string {
  switch (reason) {
    case 'material_port':
      return '该动作需要工作流提供物料输入，请在工作流中运行'
    case 'resource_slot':
      return '该动作需要解析物料占位符（ResourceSlot），请在工作流中运行'
    case 'site_selector':
      return '该动作需要选择库位（Site），请在工作流中运行'
    case 'implicit_passthrough':
      return '该动作依赖工作流上下文中的隐式输入，请在工作流中运行'
  }
}

export type DeviceActionRunState =
  | {
      kind: 'ready' | 'submitting'
      message: string
    }
  | {
      kind: 'unavailable'
      reason: DeviceActionUnavailableReason
      message: string
    }
  | {
      kind: 'error'
      message: string
      retryable: boolean
    }
  | {
      kind: 'accepted' | 'running' | 'succeeded' | 'failed' | 'canceled'
      message: string
      taskUuid: string
      output?: Record<string, unknown>
      feedback?: WorkflowNodeJobFeedback[]
      error?: unknown[]
    }

function deviceActionRunLabel(
  state: DeviceActionRunState,
  terminal: boolean
): string {
  if (state.kind === 'unavailable') {
    switch (state.reason) {
      case 'workflow_required':
        return '请在工作流中运行'
      case 'edge_disconnected':
        return 'Edge 未连接'
      case 'device_offline':
        return '设备离线'
      case 'catalog_loading':
        return '正在读取动作合同…'
      case 'catalog_error':
        return '动作合同不可用'
    }
  }
  if (state.kind === 'submitting') return '正在创建正式任务…'
  if (state.kind === 'error' && state.retryable) return '重试同一请求'
  if (terminal) return '再次运行'
  return '运行此动作'
}

export function DeviceActionAvailability({
  state,
  onRun,
  onCancel
}: {
  state: DeviceActionRunState
  onRun: () => void
  onCancel?: (taskUuid: string) => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const messageId = useId()
  const ready = state.kind === 'ready' || (
    state.kind === 'error' && state.retryable
  )
  const terminal = state.kind === 'succeeded' ||
    state.kind === 'failed' ||
    state.kind === 'canceled'
  const runnable = ready || terminal
  const actionLabel = deviceActionRunLabel(state, terminal)
  const log = deviceActionExecutionLog(state)
  useEffect(() => {
    setCopied(false)
  }, [log])
  return (
    <>
      <div
        className={`edge-device__debug-actions is-${state.kind}`}
        role={state.kind === 'failed' ? 'alert' : 'status'}
      >
        <span
          className="edge-device__run-control"
          title={state.kind === 'unavailable' ? state.message : undefined}
        >
          <button
            type="button"
            className="edge-device__run-button"
            disabled={!runnable}
            aria-describedby={messageId}
            onClick={onRun}
          >
            {actionLabel}
          </button>
        </span>
        {'taskUuid' in state &&
        (state.kind === 'accepted' || state.kind === 'running') &&
        onCancel ? (
          <button
            type="button"
            className="edge-device__cancel-button"
            onClick={() => onCancel(state.taskUuid)}
          >
            取消任务
          </button>
        ) : null}
        <span id={messageId} className="edge-device__run-reason">
          {state.message}
        </span>
      </div>
      {'taskUuid' in state ? (
        <div className="edge-device__execution" aria-live="polite">
          <div className="edge-device__execution-head">
            <span className={`edge-device__execution-state ${
              deviceActionExecutionPresentation(state.kind).tone
            }`}>
              <span aria-hidden="true" />
              {deviceActionExecutionPresentation(state.kind).label}
            </span>
            <span className={styles.executionTools}>
              <code title={state.taskUuid}>
                Task {shortIdentifier(state.taskUuid)}
              </code>
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
          {log ? (
            <pre aria-label="Action 运行日志">{log}</pre>
          ) : (
            <p>{deviceActionExecutionPresentation(state.kind).description}</p>
          )}
        </div>
      ) : null}
    </>
  )
}

function deviceActionExecutionLog(state: DeviceActionRunState): string {
  if (!('taskUuid' in state)) return ''
  const projection: Record<string, unknown> = {}
  if (state.feedback?.length) {
    projection.events = state.feedback.map((item) => ({
      sequence: item.sequence,
      type: item.feedback_type,
      data: item.data,
      observed_at: item.observed_at
    }))
  }
  if (state.output && Object.keys(state.output).length > 0) {
    projection.result = state.output
  }
  if (state.error?.length) projection.error = state.error
  return Object.keys(projection).length > 0
    ? JSON.stringify(projection, null, 2)
    : ''
}

function deviceActionExecutionPresentation(kind: DeviceActionRunState['kind']): {
  label: string
  description: string
  tone: string
} {
  switch (kind) {
    case 'succeeded':
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
    case 'canceled':
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
    default:
      return {
        label: '等待执行',
        description: 'OS 已接受任务，等待动作调度。',
        tone: 'is-pending'
      }
  }
}

export function DeviceLockControl({
  action,
  canForceUnlock,
  operation,
  onRequestUnlock
}: {
  action: DeviceAction
  canForceUnlock: boolean
  operation: UnlockOperation | null
  onRequestUnlock: () => void
}): React.JSX.Element | null {
  const currentOperation = operation?.actionRef === action.actionRef
    ? operation
    : null
  if (!action.isBusy) {
    return currentOperation?.state === 'success' ? (
      <div
        className="edge-device__lock-result is-success"
        role="status"
      >
        <strong>动作锁已释放</strong>
        <span>{currentOperation.message}</span>
      </div>
    ) : null
  }

  const pending = currentOperation?.state === 'pending'
  return (
    <div className="edge-device__lock-panel" aria-label="设备动作锁状态">
      <div className="edge-device__lock-copy">
        <span className="edge-device__lock-icon" aria-hidden="true">
          <LockIcon />
        </span>
        <div>
          <strong>此动作被设备锁占用</strong>
          <p>
            {action.currentJobId
              ? '锁持有者已确认；请先核对关联运行，再决定是否手动解锁。'
              : '锁持有者信息缺失。为避免误释放新任务，当前只允许刷新设备状态。'}
          </p>
          {action.currentJobId ? (
            <code title={action.currentJobId}>
              Job {shortIdentifier(action.currentJobId)}
            </code>
          ) : null}
        </div>
      </div>
      {canForceUnlock && action.currentJobId ? (
        <button
          type="button"
          className="edge-device__unlock-button"
          disabled={pending}
          onClick={onRequestUnlock}
        >
          {pending ? '正在解锁…' : '手动解锁'}
        </button>
      ) : null}
      {currentOperation ? (
        <div
          className={`edge-device__lock-result is-${currentOperation.state}`}
          role={currentOperation.state === 'error' ? 'alert' : 'status'}
        >
          <span>{currentOperation.message}</span>
        </div>
      ) : null}
    </div>
  )
}

export function UnlockConfirmationDialog({
  intent,
  operation,
  onCancel,
  onConfirm
}: {
  intent: UnlockIntent
  operation: UnlockOperation | null
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const currentOperation = operation?.actionRef === intent.actionRef
    ? operation
    : null
  const pending = currentOperation?.state === 'pending'

  useEffect(() => {
    setConfirmed(false)
    confirmationRef.current?.focus()
  }, [intent.actionRef, intent.expectedJobId])

  return (
    <div
      className="edge-device__unlock-layer"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) onCancel()
      }}
    >
      <section
        className="edge-device__unlock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-unlock-title"
        aria-describedby="device-unlock-description"
      >
        <header>
          <span className="edge-device__unlock-dialog-icon" aria-hidden="true">
            <LockIcon />
          </span>
          <div>
            <h2 id="device-unlock-title">确认手动解锁</h2>
            <p>{intent.deviceName} · {intent.actionLabel}</p>
          </div>
        </header>
        <div className="edge-device__unlock-dialog-body">
          <p id="device-unlock-description">
            手动解锁不会证明物理动作已自然结束。OS 会请求取消当前动作，
            并释放该 Action 的当前与排队 Job。
          </p>
          <div className="edge-device__unlock-warning" role="note">
            只有在现场确认设备已经停止、无人仍在操作、相关工作流不会继续下发动作时，
            才能继续。
          </div>
          <dl>
            <div>
              <dt>Action</dt>
              <dd><code>{intent.actionRef}</code></dd>
            </div>
            <div>
              <dt>当前 holder</dt>
              <dd><code>{intent.expectedJobId}</code></dd>
            </div>
          </dl>
          <label className="edge-device__unlock-confirmation">
            <input
              ref={confirmationRef}
              type="checkbox"
              checked={confirmed}
              disabled={pending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>我已确认设备处于安全状态，并理解此操作会取消关联 Job。</span>
          </label>
          {currentOperation?.state === 'error' ? (
            <p className="edge-device__unlock-dialog-error" role="alert">
              {currentOperation.message}。请刷新设备状态，确认 holder 后再重试。
            </p>
          ) : null}
        </div>
        <footer>
          <button
            type="button"
            className="edge-device__unlock-cancel"
            disabled={pending}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="edge-device__unlock-confirm"
            disabled={!confirmed || pending}
            onClick={onConfirm}
          >
            {pending ? '正在请求 OS…' : '确认并解锁'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function LockIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v2" />
    </svg>
  )
}

function Metric({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'muted'
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

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

function shortIdentifier(value: string): string {
  return value.length > 16
    ? `${value.slice(0, 8)}…${value.slice(-6)}`
    : value
}
