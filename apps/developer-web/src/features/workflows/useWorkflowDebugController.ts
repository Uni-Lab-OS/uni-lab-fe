import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { message } from 'antd'
import {
  normalizeWorkflowInput,
  RunPreparationError,
  workflowInputDefaults,
  type RunConfiguration,
} from '@unilab-fe/core'
import { getRunPreparationReactStore } from '@unilab-fe/core/react'
import { useBackend } from '../../app/BackendProvider'
import { nodeLabel, nodeUuid } from './workflowPresentation'

export function useWorkflowDebugController(workflowUuid: string) {
  const { backend } = useBackend()
  const [messageApi, messageContextHolder] = message.useMessage()
  const useRunPreparationStore = useMemo(
    () => getRunPreparationReactStore(backend.core.runPreparation, workflowUuid),
    [backend.core.runPreparation, workflowUuid],
  )
  // 复用的 store 在挂载前已有草稿，说明用户是离开后返回；入参已保留，检查结果需重新获取。
  const restoredDraft = useRef(useRunPreparationStore.getState().viewModel !== null).current
  const storeStatus = useRunPreparationStore((state) => state.status)
  const storeError = useRunPreparationStore((state) => state.error)
  const viewModel = useRunPreparationStore((state) => state.viewModel)
  const revision = viewModel?.revision
  const preflight = useRunPreparationStore((state) => state.preflight)
  const submitted = useRunPreparationStore((state) => state.submittedRun)
  const configuration = viewModel?.configuration
  const runMode = configuration?.runMode ?? 'normal'
  const targetNodeUuid = configuration?.targetNodeUuid ?? ''
  const priority = configuration?.priority ?? 'normal'
  const taskName = configuration?.description ?? ''
  const hasTaskConflict =
    storeError instanceof RunPreparationError && storeError.code === 'DEVELOP_TASK_CONFLICT'
  const [step, setStep] = useState(0)
  const [workflowInput, setWorkflowInputState] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const reload = useCallback(
    () => useRunPreparationStore.getState().load(workflowUuid),
    [useRunPreparationStore, workflowUuid],
  )
  const updateConfiguration = useCallback(
    (patch: Partial<RunConfiguration>) =>
      useRunPreparationStore.getState().updateConfiguration(patch),
    [useRunPreparationStore],
  )
  const setRunMode = useCallback(
    (next: RunConfiguration['runMode']) =>
      updateConfiguration(
        next === 'single_node' ? { runMode: next } : { runMode: next, targetNodeUuid: undefined },
      ),
    [updateConfiguration],
  )
  const setPriority = useCallback(
    (next: NonNullable<RunConfiguration['priority']>) => updateConfiguration({ priority: next }),
    [updateConfiguration],
  )
  const setTargetNodeUuid = useCallback(
    (next: string) => updateConfiguration({ targetNodeUuid: next }),
    [updateConfiguration],
  )
  const setTaskName = useCallback(
    (next: string) => updateConfiguration({ description: next }),
    [updateConfiguration],
  )

  // 入参随输入同步进 store，离开页面时尚未点“依赖检查”的内容也不会丢。
  const setWorkflowInput = useCallback(
    (next: Record<string, unknown>) => {
      setWorkflowInputState(next)
      useRunPreparationStore.getState().updateConfiguration({ input: next })
    },
    [useRunPreparationStore],
  )

  useEffect(() => {
    void reload()
  }, [reload])

  const inputParameters = useMemo(() => revision?.graph.inputParameters ?? [], [revision])
  const targetNodeOptions = useMemo(
    () =>
      revision?.graph.nodes.map((node, index) => {
        const uuid = nodeUuid(node, index)
        return { value: uuid, label: `${nodeLabel(node, index)} (${uuid})` }
      }) ?? [],
    [revision],
  )

  useEffect(() => {
    if (!revision) return
    const defaults = workflowInputDefaults(inputParameters)
    setWorkflowInputState(configuration?.input ?? defaults)
    const current = useRunPreparationStore.getState().viewModel?.configuration
    if (!current?.description) {
      updateConfiguration({
        description: revision.name,
        input: configuration?.input ?? defaults,
      })
    }
  }, [configuration?.input, inputParameters, revision, updateConfiguration, useRunPreparationStore])

  const runPreflight = async () => {
    if (!revision) return
    setBusy(true)
    setFormError(null)
    try {
      if (!taskName.trim()) {
        setFormError('请填写任务名称')
        return
      }
      if (runMode === 'single_node' && !targetNodeUuid) {
        setFormError('请选择目标节点')
        return
      }
      const nextInput = normalizeWorkflowInput(workflowInput, inputParameters)
      const store = useRunPreparationStore.getState()
      store.updateConfiguration({
        runMode,
        priority,
        description: taskName.trim(),
        input: nextInput,
      })
      await store.requestPreflight()
      const nextState = useRunPreparationStore.getState()
      if (nextState.error) throw nextState.error
      setStep(1)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '请完善必填运行参数')
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!revision || !preflight?.canRun) return
    setBusy(true)
    setFormError(null)
    try {
      await useRunPreparationStore.getState().submitRun()
      const nextState = useRunPreparationStore.getState()
      if (nextState.error) throw nextState.error
      if (!nextState.submittedRun) throw new Error('后端未返回已接受的任务')
      setStep(2)
      messageApi.success('任务已提交')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }

  return {
    reload,
    setRunMode,
    setPriority,
    setTargetNodeUuid,
    setTaskName,
    storeStatus,
    storeError,
    viewModel,
    revision,
    preflight,
    submitted,
    runMode,
    targetNodeUuid,
    priority,
    taskName,
    hasTaskConflict,
    step,
    setStep,
    restoredDraft,
    workflowInput,
    setWorkflowInput,
    busy,
    formError,
    hasLocalWorkflowServiceError:
      step === 1 && formError?.includes('本地工作流服务处理失败') === true,
    inputParameters,
    targetNodeOptions,
    runPreflight,
    submit,
    messageContextHolder,
  }
}
