import { useCallback, useEffect, useMemo, useState } from 'react'
import { createWorkflowDebuggingReactStore } from '@unilab-fe/core/react'
import { useBackend } from '../../app/BackendProvider'
import {
  type BranchId,
  type ControlStatus,
  type DebugCommandType,
  type EventStatus,
  type InspectorTab,
  statusLabels,
  toTimelineEvent,
} from './taskDetailModel'

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

  useEffect(() => {
    // Task 详情读取标准 Task presentation；OS 只接受空 view 或 matrix，
    // debug 是前端场景语义，不能作为后端查询参数下发。
    void load({ page: 1, pageSize: 20 })
    return () => stopRuntimeSubscription()
  }, [load, stopRuntimeSubscription])

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
  const timelineEvents = useMemo(
    () => (viewModel?.timeline ?? []).map(toTimelineEvent),
    [viewModel?.timeline],
  )
  const currentTimelineEvent = useMemo(() => {
    const focusedJobUuid = viewModel?.currentFocus?.jobUuid
    if (focusedJobUuid) {
      const focusedEvent = timelineEvents.find((event) => event.id === focusedJobUuid)
      if (focusedEvent) return focusedEvent
    }
    return (
      timelineEvents.find((event) =>
        ['running', 'waiting', 'manual', 'unknown', 'pending'].includes(event.status),
      ) ??
      timelineEvents.at(-1) ??
      null
    )
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
    statusTooltip,
    selectedEvent,
    submittedNodeUuid,
    submittedLifecycle,
    controlStatus,
    timelineLoading,
    commandResultMessage,
    openEvent,
    decideManualConfirmation,
    submitCommand,
    submitBranch,
  }
}
