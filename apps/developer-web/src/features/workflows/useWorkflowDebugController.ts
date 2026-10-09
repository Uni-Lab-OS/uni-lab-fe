import { useEffect, useMemo, useState } from 'react'
import { message } from 'antd'
import { normalizeWorkflowInput, RunPreparationError, workflowInputDefaults } from '@unilab-fe/core'
import { createRunPreparationReactStore } from '@unilab-fe/core/react'
import { useBackend } from '../../app/BackendProvider'
import { nodeLabel, nodeUuid } from './workflowPresentation'

export function useWorkflowDebugController(workflowUuid: string) {
  const { backend } = useBackend()
  const [messageApi, messageContextHolder] = message.useMessage()
  const useRunPreparationStore = useMemo(
    () => createRunPreparationReactStore(backend.core.runPreparation),
    [backend.core.runPreparation],
  )
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
  const [workflowInput, setWorkflowInput] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    void useRunPreparationStore.getState().load(workflowUuid)
  }, [useRunPreparationStore, workflowUuid])

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
    setWorkflowInput(configuration?.input ?? defaults)
    const current = useRunPreparationStore.getState().viewModel?.configuration
    if (!current?.description) {
      useRunPreparationStore.getState().updateConfiguration({
        description: revision.name,
        input: configuration?.input ?? defaults,
      })
    }
  }, [configuration?.input, inputParameters, revision, useRunPreparationStore])

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
    useRunPreparationStore,
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
