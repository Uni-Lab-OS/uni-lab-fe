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
  type WorkflowActionNodeTemplate,
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
import {
  createArgumentDraft,
  isTerminalDeviceActionTask,
  projectDeviceActionTask,
  readArgumentDraft,
  writeArgumentDraft,
  type ArgumentDraft,
  type DeviceActionRunState
} from './DevicePanelSupport'
import { DevicePanelView } from './DevicePanelView'
import RobotPointWorkbench from '../robot-points/RobotPointWorkbench'
import { useDeviceActionCatalog } from './useDeviceActionCatalog'
import { useDeviceUnlock } from './useDeviceUnlock'
import type {
  DeviceActionFeedbackState,
  DeviceActionRunAttempt,
  DeviceActionRunOperation
} from './deviceActionTaskState'
export {
  DeviceActionAvailability,
  DeviceLockControl,
  UnlockConfirmationDialog
} from './DevicePanelSupport'

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
  const [panelView, setPanelView] = useState<DevicePanelViewMode>(
    readInitialDevicePanelView
  )
  const [selectedActionRef, setSelectedActionRef] = useState<string | null>(null)
  const [argumentDraft, setArgumentDraft] = useState<ArgumentDraft>({})
  const [runOperation, setRunOperation] =
    useState<DeviceActionRunOperation | null>(null)
  const runAttemptRef = useRef<DeviceActionRunAttempt | null>(null)
  const feedbackByTaskRef = useRef<Map<string, DeviceActionFeedbackState>>(
    new Map()
  )
  const refreshByTaskRef = useRef<Map<string, Promise<boolean>>>(new Map())
  const canForceUnlock = services.capabilities.devices.forceUnlock
  const canRunActionTask = services.capabilities.devices.runActionTask
  const actionCatalogState = useDeviceActionCatalog(canRunActionTask)
  const actionCatalog = actionCatalogState.catalog
  const unlock = useDeviceUnlock(refresh)

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
    if (!device.materialUuid) {
      setRunOperation({
        actionRef: action.actionRef,
        state: {
          kind: 'error',
          message: '当前设备缺少运行标识，请刷新设备列表后重试',
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
      fingerprint: actionCatalog.fingerprint,
      templateUuid: template.uuid,
      materialUuid: device.materialUuid,
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
        material_uuid: device.materialUuid,
        workflow_node_template_uuid: template.uuid,
        param: input,
        execution_policy: {},
        idempotency_key: idempotencyKey,
        description: '设备页单动作运行',
        meta_data: {
          source: 'device-panel',
          device_id: device.id,
          action_name: action.actionName
        }
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
        await Promise.all([actionCatalogState.refresh(), refresh()])
        setRunOperation({
          actionRef: action.actionRef,
          state: {
            kind: 'error',
            message: '动作信息已更新，请重新检查参数后运行',
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
    actionCatalogState,
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

  const runState =
    runOperation !== null && selectedAction !== null &&
    runOperation.actionRef === selectedAction.actionRef
      ? runOperation.state
      : null
  const activeRunActionRef = runOperation && (
    runOperation.state.kind === 'submitting' ||
    runOperation.state.kind === 'accepted' ||
    runOperation.state.kind === 'running'
  )
    ? runOperation.actionRef
    : null

  /** 从当前机械臂设备进入点位配置任务页。 */
  const openRobotPoints = useCallback(() => {
    setPanelView('robot-points')
  }, [])
  /** 从点位配置任务页返回 Edge 设备目录。 */
  const closeRobotPoints = useCallback(() => {
    setPanelView('catalog')
  }, [])

  if (panelView === 'robot-points') {
    return <RobotPointWorkbench onBack={closeRobotPoints} />
  }

  return (
    <DevicePanelView
      backend={backend}
      connection={connection}
      devices={devices}
      loading={loading}
      error={error}
      lastUpdated={lastUpdated}
      selectedDevice={selectedDevice}
      selectedAction={selectedAction}
      selectedActionRef={selectedActionRef}
      argumentDraft={argumentDraft}
      actionTemplate={selectedActionTemplate}
      actionCatalogLoading={actionCatalogState.loading}
      actionCatalogError={actionCatalogState.error}
      canRunActionTask={canRunActionTask}
      canForceUnlock={canForceUnlock}
      runState={runState}
      activeRunActionRef={activeRunActionRef}
      unlockIntent={unlock.unlockIntent}
      unlockOperation={unlock.unlockOperation}
      refresh={refresh}
      onSelectDevice={setSelectedDeviceId}
      onSelectAction={setSelectedActionRef}
      onOpenRobotPoints={openRobotPoints}
      onArgumentChange={handleArgumentChange}
      onRunAction={(action, template) => {
        if (selectedDevice) void handleRunAction(selectedDevice, action, template)
      }}
      onCancelActionTask={(taskUuid) => {
        void handleCancelActionTask(taskUuid)
      }}
      onRequestUnlock={unlock.requestUnlock}
      onDismissUnlock={unlock.dismissUnlock}
      onConfirmUnlock={() => void unlock.confirmUnlock()}
    />
  )
}

type DevicePanelViewMode = 'catalog' | 'robot-points'

/**
 * 从稳定查询参数恢复设备模块的任务页，不接受未知视图。
 *
 * @returns Edge 设备目录或机械臂点位管理视图。
 */
function readInitialDevicePanelView(): DevicePanelViewMode {
  if (typeof globalThis.location === 'undefined') return 'catalog'
  return new URLSearchParams(globalThis.location.search).get('deviceView')
    === 'robot-points'
    ? 'robot-points'
    : 'catalog'
}
