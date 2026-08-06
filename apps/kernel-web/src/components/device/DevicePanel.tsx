import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  ServiceError,
  type DeviceAction,
  type WorkflowActionCatalogSnapshot,
  type WorkflowActionNodeTemplate,
  type WorkflowNodeJobFeedback,
  useServices
} from '@unilab/services'

import { useWorkbench } from '../../context/WorkbenchContext'
import type { ManagedDevice } from '../../data/deviceCatalog'
import { useDevices } from '../../hooks/useDevices'
import {
  matchDeviceActionTemplate,
  serializeDeviceActionInput
} from './deviceActionRun'
import { startDeviceActionTaskRecovery } from './deviceActionTaskRecovery'
import styles from './DevicePanel.module.scss'
import {
  ConnectionSummary,
  DeviceListItem,
  DeviceWorkspace,
  UnlockConfirmationDialog,
  createArgumentDraft,
  isTerminalDeviceActionTask,
  projectDeviceActionTask,
  readArgumentDraft,
  writeArgumentDraft,
  type ArgumentDraft,
  type DeviceActionRunState,
  type UnlockIntent,
  type UnlockOperation
} from './DevicePanelSupport'
export {
  DeviceActionAvailability,
  DeviceLockControl,
  UnlockConfirmationDialog
} from './DevicePanelSupport'

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

/**
 * 渲染设备目录、实时状态、动作参数与单动作任务控制面板。
 *
 * @returns 设备列表、空设备引导和当前设备动作工作区。
 * @throws 服务上下文或数据服务异常由对应 Hook 与 React 错误边界传播。
 * @safety 设备动作与人工解锁仍必须经过既有能力检查和确认流程。
 */
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
  const refreshByTaskRef = useRef<Map<string, Promise<boolean>>>(new Map())
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
  ): Promise<boolean> => {
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
    const terminal = isTerminalDeviceActionTask(view.status)
    if (terminal) {
      await refresh()
    }
    return terminal
  }, [refresh, services.deviceActionTasks, services.workflow])

  const queueDeviceActionTaskRefresh = useCallback((
    taskUuid: string,
    actionRef: string
  ): Promise<boolean> => {
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

  const activeTaskUuid = runOperation?.state && (
    runOperation.state.kind === 'accepted' ||
    runOperation.state.kind === 'running'
  ) && 'taskUuid' in runOperation.state
    ? runOperation.state.taskUuid
    : null
  useEffect(() => {
    if (!activeTaskUuid || !runOperation) return
    const actionRef = runOperation.actionRef
    const recovery = startDeviceActionTaskRecovery({
      tasks: [{ taskUuid: activeTaskUuid, actionRef }],
      subscribe: (listener, options) =>
        services.workflow.subscribeWorkflowRuntime(listener, options),
      read: (task) => queueDeviceActionTaskRefresh(
        task.taskUuid,
        task.actionRef
      ),
      onError: (task, error) => {
        setRunOperation((current) => {
          if (
            !current ||
            !('taskUuid' in current.state) ||
            current.state.taskUuid !== task.taskUuid
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
      }
    })
    return () => recovery.dispose()
  }, [
    activeTaskUuid,
    queueDeviceActionTaskRefresh,
    runOperation?.actionRef,
    services.workflow
  ])

  /**
   * 用冻结动作目录代际创建一个设备单动作工作流任务（WorkflowTask）。
   *
   * @param device 当前选择的设备。
   * @param action 当前选择的动作。
   * @param template 动作对应的工作流节点模板（WorkflowNodeTemplate）。
   * @returns 提交及首次补水完成后返回无。
   * @throws 异常在回调内投影为可见错误状态，不向事件循环传播。
   */
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
    const authorityId = actionCatalog.authorityId
    const catalogFingerprint = actionCatalog.fingerprint
    if (!authorityId || !catalogFingerprint) {
      setRunOperation({
        actionRef: action.actionRef,
        state: {
          kind: 'error',
          message: '当前动作目录缺少权威标识或目录指纹，无法安全创建设备单动作任务',
          retryable: false
        }
      })
      return
    }
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
      authorityId,
      fingerprint: catalogFingerprint,
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
        authority_id: authorityId,
        template_catalog_fingerprint: catalogFingerprint,
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
            <strong>
              {connection === 'connected'
                ? '当前未配置仪器设备'
                : '等待 Edge 上报设备'}
            </strong>
            {connection === 'connected' ? (
              <p>
                Edge 核心服务已连接。安装或配置设备包和设备图后，重新启动 Edge 并刷新设备。
              </p>
            ) : (
              <p>
                Edge 连接后会自动上报在线设备、动作节点及其参数 Schema。
              </p>
            )}
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
            <p>
              {connection === 'connected'
                ? '当前可继续使用 Edge 核心服务；配置仪器设备后请重新启动并刷新。'
                : '请确认 Edge 已启动并连接到本地桥。'}
            </p>
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
