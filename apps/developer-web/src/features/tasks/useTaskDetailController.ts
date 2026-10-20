import { useCallback, useEffect, useMemo, useState } from 'react'
import { createWorkflowDebuggingReactStore } from '@unilab-fe/core/react'
import { useBackend } from '../../app/BackendProvider'
import {
  type BranchId,
  type ControlStatus,
  type DebugCommandType,
  type EventStatus,
  type InspectorTab,
  isActiveTimelineEvent,
  statusLabels,
  toTimelineEvent,
} from './taskDetailModel'
import { taskListView } from './taskListSource'
import { observeTaskNodes } from './observedTaskNodes'
import { useDeviceNames } from '../../hooks/useDeviceNames'

export function useTaskDetailController(requestedTaskUuid?: string) {
  const { backend } = useBackend()
  const debugStore = useMemo(
    () => createWorkflowDebuggingReactStore(backend.core.workflowDebugging),
    [backend.core.workflowDebugging],
  )
  const viewModel = debugStore((state) => state.viewModel)
  const storeCommand = debugStore((state) => state.command)
  const storeError = debugStore((state) => state.error)
  const storeStatus = debugStore((state) => state.status)
  const load = debugStore((state) => state.load)
  const inspectTask = debugStore((state) => state.inspectTask)
  const inspectJob = debugStore((state) => state.inspectJob)
  const sendCommand = debugStore((state) => state.sendCommand)
  const stopRuntimeSubscription = debugStore((state) => state.stopRuntimeSubscription)

  // 侧边任务列表只需 Task 字段：profile 声明摘要能力时读摘要视图，否则读标准 Task presentation。
  // debug 是前端场景语义，不能作为后端 view 参数下发。
  const listView = taskListView(backend)
  useEffect(() => {
    void load({ page: 1, pageSize: 20, taskListView: listView })
    return () => stopRuntimeSubscription()
  }, [listView, load, stopRuntimeSubscription])

  // 侧边列表的在途节点名也记入会话，调度甘特图给其他任务的条命名时可用。
  useEffect(() => observeTaskNodes(backend, viewModel?.tasks ?? []), [backend, viewModel?.tasks])

  useEffect(() => {
    const taskUuid = requestedTaskUuid ?? viewModel?.tasks[0]?.taskUuid
    if (taskUuid && viewModel && !viewModel.selectedTaskUuid) void inspectTask(taskUuid)
  }, [inspectTask, requestedTaskUuid, viewModel])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<InspectorTab>('evidence')
  const [parallelOpen, setParallelOpen] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<BranchId | null>(null)
  const [parallelNotice, setParallelNotice] = useState('等待 OS 返回 ready frontier。')
  const [lastCommandType, setLastCommandType] = useState<DebugCommandType | null>(null)

  const selectedTask = viewModel?.selectedTask ?? null
  const timelineLoading =
    !selectedTask &&
    storeStatus !== 'error' &&
    (!viewModel || storeStatus === 'loading' || Boolean(viewModel.tasks.length))
  const facts = viewModel?.facts
  const readyFrontier = facts?.readyFrontier ?? []
  const joins = facts?.joins ?? []
  // 执行列显示设备中文名（与设备页、调度甘特图同一目录），原始设备身份放在提示里。
  const deviceNames = useDeviceNames()
  const timelineEvents = useMemo(
    () => (viewModel?.timeline ?? []).map((job) => toTimelineEvent(job, deviceNames)),
    [deviceNames, viewModel?.timeline],
  )
  // 多分支并行时可能同时有多个节点在执行或等待处置，概览需要全部列出。
  const activeTimelineEvents = useMemo(
    () => timelineEvents.filter(isActiveTimelineEvent),
    [timelineEvents],
  )
  const currentTimelineEvent = useMemo(() => {
    const focusedJobUuid = viewModel?.currentFocus?.jobUuid
    if (focusedJobUuid) {
      const focusedEvent = timelineEvents.find((event) => event.id === focusedJobUuid)
      if (focusedEvent) return focusedEvent
    }
    // 只聚焦真正在进行或等待处置的节点，不突出“尚未到达”的节点；都没有时取最近发生的节点。
    const active = timelineEvents.find(isActiveTimelineEvent)
    if (active) return active
    const happened = timelineEvents.filter((event) => event.sortTime != null)
    return happened.length
      ? happened.reduce((latest, event) =>
          (event.sortTime ?? 0) > (latest.sortTime ?? 0) ? event : latest,
        )
      : null
  }, [timelineEvents, viewModel?.currentFocus?.jobUuid])
  const statusTooltip = useMemo(() => {
    const counts = timelineEvents.reduce<Partial<Record<EventStatus, number>>>((result, event) => {
      result[event.status] = (result[event.status] ?? 0) + 1
      return result
    }, {})
    return (
      (Object.entries(counts) as Array<[EventStatus, number]>)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${statusLabels[status]} ${count}`)
        .join(' · ') || '暂无节点状态'
    )
  }, [timelineEvents])
  const selectedEvent = useMemo(
    () => timelineEvents.find((event) => event.id === selectedId) ?? null,
    [selectedId, timelineEvents],
  )
  // 操作员在本页停止的任务：OS 受理（未拒绝）取消命令后记住任务号，用于跟进停止后的资源收尾。
  // 重读任务会清空 store 中的命令回执，所以单独保存，不随回执消失。
  const [stopRequestedTaskUuid, setStopRequestedTaskUuid] = useState<string | null>(null)
  useEffect(() => {
    if (storeCommand?.type === 'cancel' && storeCommand.lifecycle !== 'rejected')
      setStopRequestedTaskUuid(storeCommand.workflowTaskUuid)
  }, [storeCommand])
  const stopRequested = Boolean(selectedTask) && stopRequestedTaskUuid === selectedTask?.taskUuid
  const submittedNodeUuid = storeCommand?.type === 'step' ? storeCommand.targetNodeUuid : null
  const submittedLifecycle = storeCommand?.type === 'step' ? storeCommand.lifecycle : null
  const controlStatus: ControlStatus =
    selectedTask?.controlStatus === 'active'
      ? 'active'
      : selectedTask?.controlStatus === 'canceling'
        ? 'canceling'
        : 'paused'

  const openEvent = (id: string, tab: InspectorTab = 'evidence') => {
    setSelectedId(id)
    setActiveTab(tab)
    void inspectJob(id)
  }

  const decideManualConfirmation = useCallback(
    async (jobUuid: string, action: 'approve' | 'reject') => {
      await backend.core.manualConfirmation.decide(jobUuid, action)
      await inspectJob(jobUuid)
    },
    [backend.core.manualConfirmation, inspectJob],
  )

  const resolveUncertainJob = useCallback(
    async (jobUuid: string, reason: string) => {
      await backend.core.executionRecovery.resolveUncertainJob(jobUuid, reason)
      await inspectJob(jobUuid)
    },
    [backend.core.executionRecovery, inspectJob],
  )

  const reloadTask = useCallback(() => {
    if (selectedTask) void inspectTask(selectedTask.taskUuid)
  }, [inspectTask, selectedTask])

  const submitCommand = (type: DebugCommandType, targetNodeUuid?: string) => {
    if (!selectedTask) return
    setLastCommandType(type)
    void sendCommand({
      type,
      targetNodeUuid: targetNodeUuid ?? null,
      idempotencyKey: `${selectedTask.taskUuid}:${type}:${Date.now()}`,
    })
  }

  const submitBranch = () => {
    if (!selectedBranch) return
    const candidate = facts?.readyFrontier.find(
      (item) => item.selectable && (item.branchUuid ?? item.nodeUuid) === selectedBranch,
    )
    if (!candidate) {
      setParallelNotice('OS 尚未返回可选择的 ready frontier，不能伪造单步节点。')
      return
    }
    setParallelNotice('正在发送单步命令，等待 Core 返回 accepted/applied 与 NodeJob 状态。')
    submitCommand('step', candidate.nodeUuid)
  }

  const commandLabel =
    lastCommandType === 'step'
      ? '执行下一步'
      : lastCommandType === 'pause'
        ? '暂停任务'
        : lastCommandType === 'resume'
          ? '继续任务'
          : '取消任务'
  const commandResultMessage =
    storeStatus === 'commanding' && lastCommandType
      ? `正在提交“${commandLabel}”命令，等待 Core 返回回执。`
      : storeError && lastCommandType
        ? `“${commandLabel}”命令发送失败：${storeError.message}`
        : storeCommand && lastCommandType
          ? storeCommand.lifecycle === 'accepted'
            ? `“${commandLabel}”命令已接受，等待 OS 更新任务状态。`
            : storeCommand.lifecycle === 'applied'
              ? `“${commandLabel}”命令已生效，任务状态以 OS 回传为准。`
              : storeCommand.lifecycle === 'rejected'
                ? `“${commandLabel}”命令已被拒绝。`
                : `“${commandLabel}”命令回执状态未知，请查看任务状态。`
          : null

  return {
    viewModel,
    storeCommand,
    storeError,
    storeStatus,
    inspectJob,
    selectedTask,
    selectedId,
    setSelectedId,
    activeTab,
    setActiveTab,
    parallelOpen,
    setParallelOpen,
    selectedBranch,
    setSelectedBranch,
    parallelNotice,
    facts,
    joins,
    readyFrontier,
    timelineEvents,
    currentTimelineEvent,
    activeTimelineEvents,
    statusTooltip,
    selectedEvent,
    submittedNodeUuid,
    submittedLifecycle,
    controlStatus,
    stopRequested,
    timelineLoading,
    commandResultMessage,
    openEvent,
    decideManualConfirmation,
    resolveUncertainJob,
    reloadTask,
    submitCommand,
    submitBranch,
  }
}
