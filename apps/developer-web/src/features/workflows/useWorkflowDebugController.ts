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
import { clearRunDraft, readRunDraft, writeRunDraft } from './runDraftStorage'

// 同一个 store 当前挂载着几个控制器。StrictMode 的模拟卸载会立刻重新挂载，
// 因此“离开页面”必须等一个宏任务后确认没有重新挂载才算数。
const attachedControllers = new WeakMap<object, number>()

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
  const [step, setStep] = useState(() => {
    const { submittedRun, preflight: settledPreflight } = useRunPreparationStore.getState()
    return submittedRun ? 2 : settledPreflight ? 1 : 0
  })
  const [workflowInput, setWorkflowInputState] = useState<Record<string, unknown>>({})
  const [localBusy, setBusy] = useState(false)
  // 检查/提交的请求在 store 里继续进行；切走再切回时，转圈状态由 store 而不是本地 state 决定。
  const busy = localBusy || storeStatus === 'preflighting' || storeStatus === 'submitting'
  const previousStatus = useRef(storeStatus)
  const storageScope = `${backend.config.id}@${backend.config.apiUrl}`
  const [formError, setFormError] = useState<string | null>(null)
  // 页面刷新后从 sessionStorage 恢复了草稿（区别于应用内切换时的内存保留）。
  const [restoredFromStorage, setRestoredFromStorage] = useState(false)

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
    const store = useRunPreparationStore
    attachedControllers.set(store, (attachedControllers.get(store) ?? 0) + 1)
    return () => {
      attachedControllers.set(store, (attachedControllers.get(store) ?? 1) - 1)
      window.setTimeout(() => {
        if ((attachedControllers.get(store) ?? 0) === 0) {
          store.getState().discardSettledResults()
        }
      }, 0)
    }
  }, [useRunPreparationStore])

  useEffect(() => {
    const store = useRunPreparationStore
    const apiUrl = storageScope
    // 内存里已有草稿（应用内切换）时不读存储；只有整页刷新后的首次挂载才恢复。
    const persisted = restoredDraft ? null : readRunDraft(apiUrl, workflowUuid)
    let cancelled = false
    let persistenceReady = false

    void store
      .getState()
      .load(workflowUuid)
      .then(() => {
        if (cancelled) return
        const loaded = store.getState().viewModel
        if (persisted && loaded?.revision.workflowUuid === workflowUuid) {
          store.getState().restoreDraft(persisted)
          setRestoredFromStorage(true)
          if (persisted.preflight) setStep(1)
        }
        persistenceReady = true
      })

    // 草稿写入等恢复完成之后才开始，避免默认空值覆盖刚读到的刷新前内容。
    const unsubscribe = store.subscribe((state) => {
      if (!persistenceReady || !state.viewModel) return
      if (state.submittedRun) {
        clearRunDraft(apiUrl, workflowUuid)
        return
      }
      writeRunDraft(apiUrl, workflowUuid, {
        configuration: state.viewModel.configuration,
        preflight: state.preflight,
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [storageScope, restoredDraft, useRunPreparationStore, workflowUuid])

  // 请求在页面卸载期间返回时，旧组件里的 setStep 已经失效，按 store 状态迁移补上。
  useEffect(() => {
    const previous = previousStatus.current
    previousStatus.current = storeStatus
    if (storeStatus !== 'ready') return
    if (previous === 'preflighting' && preflight) setStep(1)
    if (previous === 'submitting' && submitted) setStep(2)
  }, [storeStatus, preflight, submitted])

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
      if (nextState.submittedRun.materialWait) messageApi.warning('任务已提交，但在等待物料准入')
      else messageApi.success('任务已提交')
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
    restoredDraft: restoredDraft || restoredFromStorage,
    restoredFromStorage,
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
