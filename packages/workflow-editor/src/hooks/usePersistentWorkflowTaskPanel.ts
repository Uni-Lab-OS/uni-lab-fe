import type {
  WorkflowAuthoringAggregate,
  WorkflowDefinitionPort,
  WorkflowRuntimePort,
  WorkflowTaskRunMode
} from '@unilab/services'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { createWorkflowExecutionScope } from '../utils/canonicalWorkflow'
import type { WorkflowStructure } from '../utils/parseWorkflow'
import {
  existingWorkflowPreflightFailureMessage
} from '../utils/existingWorkflowRunProjection'
import {
  errorMessage,
  workflowSourceMap
} from '../utils/persistentAuthoringProjection'
import {
  AuthoringOperationQueue,
  hasRunnableAppliedWorkflow
} from '../utils/persistentAuthoringSession'
import { projectWorkflowCodeMarkers } from '../utils/workflowCodeMarkers'
import {
  buildDebugLaunchOverrides,
  createDebugLaunchInputForm,
  setDebugLaunchField,
  type DebugLaunchInputFieldState,
  type DebugLaunchInputFormState
} from '../utils/debugLaunchInputForm'
import {
  createWorkflowTaskInputForm,
  containsResourceSlotInput,
  setWorkflowTaskInputField,
  submitWorkflowTaskInput,
  type WorkflowTaskInputFieldState,
  type WorkflowTaskInputFormState
} from '../utils/workflowTaskInputForm'
import { workflowTaskInputProblem } from '../utils/workflowTaskInputProblem'
import { projectWorkflowTaskOutput } from '../utils/workflowTaskOutputProjection'
import {
  loadWorkflowResourceSlotOptions,
  type WorkflowResourceSlotOptionsPort,
  type WorkflowResourceSlotOptionsState
} from '../utils/workflowResourceSlotOptions'
import {
  TERMINAL_JOB_STATUSES,
  workflowTaskDagState
} from '../utils/workflowTaskPanelProjection'
import { workflowTaskControls } from '../utils/workflowTaskPresentation'
import type { WorkflowOutputTab } from '../components/WorkflowOutput'
import { useWorkflowSessionStore } from '../components/WorkflowSessionProvider'
import { useWorkflowTaskRuntime } from './useWorkflowTaskRuntime'

interface PersistentWorkflowDebugSession {
  startNodeId: string | null
  breakpoints: string[]
}

export type PersistentWorkflowRunMode = WorkflowTaskRunMode | 'debug'

interface PersistentWorkflowTaskPanelOptions {
  runtime: WorkflowRuntimePort
  active?: boolean
  definitionPort: WorkflowDefinitionPort
  workflowUuid: string
  aggregate: WorkflowAuthoringAggregate | null
  structure: WorkflowStructure
  editorValue: string
  setCodeMarkers: (
    markers: ReturnType<typeof projectWorkflowCodeMarkers>
  ) => void
  queue: AuthoringOperationQueue
  resourceSlotOptionsPort?: WorkflowResourceSlotOptionsPort
  setMessage: (message: string) => void
  setError: (message: string | null) => void
}

/**
 * 集中维护工作流任务（WorkflowTask）的运行、输入、调试投影与输出状态。
 * 编写会话只提供已应用聚合、图结构和窄端口，不接管任务生命周期。
 */
export function usePersistentWorkflowTaskPanel({
  runtime,
  active = true,
  definitionPort,
  workflowUuid,
  aggregate,
  structure,
  editorValue,
  setCodeMarkers,
  queue,
  resourceSlotOptionsPort,
  setMessage,
  setError
}: PersistentWorkflowTaskPanelOptions) {
  const sessionStore = useWorkflowSessionStore()
  const debugSessionKey = `unilab.workflow.debug.${workflowUuid}.v1`
  const [initialDebugSession] = useState<PersistentWorkflowDebugSession | null>(
    () => sessionStore?.read<PersistentWorkflowDebugSession>(
      debugSessionKey
    ) ?? null
  )
  const [taskRunMode, setTaskRunMode] =
    useState<PersistentWorkflowRunMode>('normal')
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [taskInputAuthority, setTaskInputAuthority] =
    useState<WorkflowAuthoringAggregate | null>(null)
  const [taskInputForm, setTaskInputForm] =
    useState<WorkflowTaskInputFormState | null>(null)
  const [taskInputProblem, setTaskInputProblem] = useState<string | null>(null)
  const [debugLaunchForm, setDebugLaunchForm] =
    useState<DebugLaunchInputFormState | null>(null)
  const [debugLaunchTaskInput, setDebugLaunchTaskInput] =
    useState<Record<string, unknown> | null>(null)
  const [resourceSlotOptions, setResourceSlotOptions] =
    useState<WorkflowResourceSlotOptionsState | undefined>(undefined)
  const [traceViewerOpen, setTraceViewerOpen] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)
  const [outputTab, setOutputTab] = useState<WorkflowOutputTab>('nodes')
  const [selectedJobNodeUuid, setSelectedJobNodeUuid] =
    useState<string | null>(null)
  const [debugStartNodeId, setDebugStartNodeId] = useState<string | null>(
    initialDebugSession?.startNodeId ?? null
  )
  const [debugBreakpoints, setDebugBreakpoints] = useState<Set<string>>(
    () => new Set(initialDebugSession?.breakpoints ?? [])
  )
  const taskRuntime = useWorkflowTaskRuntime(runtime, workflowUuid, active)
  const debugExecutionScope = useMemo(
    () => createWorkflowExecutionScope(
      structure.nodes,
      structure.links,
      debugStartNodeId
    ),
    [debugStartNodeId, structure.links, structure.nodes]
  )
  const appliedWorkflowRunnable = useMemo(
    () => hasRunnableAppliedWorkflow(aggregate),
    [aggregate]
  )
  const singleNodeTargetMissing =
    (taskRunMode === 'single_node' || taskRunMode === 'debug') &&
    !debugExecutionScope.startNodeId
  const task = taskRuntime.snapshot.task
  const taskJobs = taskRuntime.snapshot.jobs
  const taskOutput = useMemo(
    () => projectWorkflowTaskOutput({
      task,
      jobs: taskJobs,
      feedback: taskRuntime.snapshot.feedback
    }),
    [task, taskJobs, taskRuntime.snapshot.feedback]
  )
  const taskOutputNodes = taskOutput.nodes
  const taskActivity = taskOutput.activity
  const failedTaskJobCount = useMemo(
    () => taskOutputNodes.filter((node) => node.state === 'failed').length,
    [taskOutputNodes]
  )
  const selectedTaskNode = taskOutputNodes.find(
    (node) => node.sourceNodeId === selectedJobNodeUuid
  )
  const completedTaskJobCount = taskJobs.filter(
    (job) => TERMINAL_JOB_STATUSES.has(job.status)
  ).length
  const taskControls = useMemo(
    () => workflowTaskControls(task, runtimeBusy),
    [runtimeBusy, task]
  )
  const taskNodeNames = useMemo(
    () => Object.fromEntries(structure.nodes.map((node) => [
      node.id,
      node.name || node.id
    ])),
    [structure.nodes]
  )
  const taskNodeStates = useMemo(
    () => ({
      ...Object.fromEntries(structure.nodes
        .filter((node) => node.disabled)
        .map((node) => [node.id, 'disabled'])),
      ...Object.fromEntries(taskJobs.map((job) => [
        job.workflow_node_uuid,
        workflowTaskDagState(
          job.status,
          structure.nodes.find((node) => node.id === job.workflow_node_uuid)
            ?.type === 'material_source',
          task?.status
        )
      ]))
    }),
    [structure.nodes, task?.status, taskJobs]
  )
  const pausedBeforeNodeId = taskRuntime.snapshot.debug?.holds.find(
    (hold) => hold.status === 'open'
  )?.workflow_node_uuid ?? null
  const codeSourceMap = useMemo(
    () => workflowSourceMap(aggregate, editorValue),
    [aggregate, editorValue]
  )
  const codeMarkers = useMemo(
    () => projectWorkflowCodeMarkers({
      nodeIds: structure.nodes.map((node) => node.id),
      resolveLine: (nodeId) => codeSourceMap.find(
        (entry) => entry.workflow_node_uuid === nodeId
      )?.start_line ?? null,
      startNodeId: debugExecutionScope.startNodeId,
      beforeStartNodeIds: debugExecutionScope.beforeStartNodeIds,
      breakpoints: debugBreakpoints,
      pausedBeforeNodeId,
      nodeStates: taskNodeStates
    }),
    [
      codeSourceMap,
      debugBreakpoints,
      debugExecutionScope.beforeStartNodeIds,
      debugExecutionScope.startNodeId,
      structure.nodes,
      pausedBeforeNodeId,
      taskNodeStates
    ]
  )

  useEffect(() => {
    if (structure.nodes.length === 0) return
    const validNodeIds = new Set(structure.nodes.map((node) => node.id))
    setDebugStartNodeId((current) =>
      current && !validNodeIds.has(current) ? null : current
    )
    setDebugBreakpoints((current) => {
      const next = new Set(
        [...current].filter((nodeId) => validNodeIds.has(nodeId))
      )
      return next.size === current.size ? current : next
    })
  }, [structure.nodes])

  useEffect(() => {
    sessionStore?.write<PersistentWorkflowDebugSession>(debugSessionKey, {
      startNodeId: debugExecutionScope.startNodeId,
      breakpoints: [...debugBreakpoints]
    })
  }, [
    debugBreakpoints,
    debugExecutionScope.startNodeId,
    debugSessionKey,
    sessionStore
  ])

  useEffect(() => {
    setCodeMarkers(codeMarkers)
  }, [codeMarkers, setCodeMarkers])

  useEffect(() => {
    if (
      selectedJobNodeUuid &&
      taskOutputNodes.some(
        (node) => node.sourceNodeId === selectedJobNodeUuid
      )
    ) return
    setSelectedJobNodeUuid(taskOutputNodes[0]?.sourceNodeId ?? null)
  }, [selectedJobNodeUuid, taskOutputNodes])

  useEffect(() => {
    if (failedTaskJobCount === 0) return
    setOutputExpanded(true)
    setOutputTab('errors')
  }, [failedTaskJobCount])

  const runRuntime = useCallback((
    operation: () => Promise<void>
  ): void => {
    setRuntimeBusy(true)
    void operation()
      .catch(() => undefined)
      .finally(() => setRuntimeBusy(false))
  }, [])

  /** Refresh the current-lab material projection shared by authoring and runs. */
  const refreshResourceSlotOptions = useCallback(async (): Promise<
    WorkflowResourceSlotOptionsState
  > => {
    setResourceSlotOptions(undefined)
    const next = await loadWorkflowResourceSlotOptions(resourceSlotOptionsPort)
    setResourceSlotOptions(next)
    return next
  }, [resourceSlotOptionsPort])

  const toggleDebugStartNode = (nodeUuid: string): void => {
    const removing = debugExecutionScope.startNodeId === nodeUuid
    setDebugStartNodeId(removing ? null : nodeUuid)
    setMessage(
      removing
        ? '已取消调试器起始点'
        : '已设置调试器起始点；普通任务不携带此配置'
    )
  }

  const toggleDebugBreakpoint = (nodeUuid: string): void => {
    const removing = debugBreakpoints.has(nodeUuid)
    setDebugBreakpoints((current) => {
      const next = new Set(current)
      if (next.has(nodeUuid)) next.delete(nodeUuid)
      else next.add(nodeUuid)
      return next
    })
    setMessage(
      removing
        ? '已取消调试器断点'
        : '已设置调试器断点；普通任务不携带此配置'
    )
  }

  /**
   * 使用精确补读的已应用工作流图（Applied Workflow Graph）建立任务输入。
   *
   * @param authority 与应用结果修订一致的工作流创作权威聚合。
   * @returns 输入表单与物料占位符（ResourceSlot）选项加载完成后的 Promise。
   */
  const openTaskInputFormForAuthority = useCallback(async (
    authority: WorkflowAuthoringAggregate
  ): Promise<void> => {
    setTaskInputProblem(null)
    if (singleNodeTargetMissing) {
      throw new Error(
        `${taskRunMode === 'debug' ? '调试启动' : '单节点调试'}前请先在画布节点上设置起始点`
      )
    }
    if (!hasRunnableAppliedWorkflow(authority)) {
      throw new Error('已应用版本不包含可执行节点，不能创建工作流任务')
    }
    const nextForm = createWorkflowTaskInputForm(authority)
    setTaskInputAuthority(authority)
    setTaskInputForm(nextForm)
    setResourceSlotOptions(undefined)
    if (nextForm.fields.some(({ descriptor }) =>
      containsResourceSlotInput(descriptor.schema)
    )) {
      await refreshResourceSlotOptions()
    }
    setMessage(
      (taskRunMode === 'single_node'
        ? `目标节点 ${debugExecutionScope.startNodeId}；`
        : taskRunMode === 'debug'
          ? `调试起始点 ${debugExecutionScope.startNodeId}，断点 ${debugBreakpoints.size} 个；`
          : '') +
      `本次运行使用已应用版本 ${authority.workflow_revision}；` +
      '未填写且没有默认值的字段将保持省略'
    )
  }, [
    debugBreakpoints.size,
    debugExecutionScope.startNodeId,
    refreshResourceSlotOptions,
    setMessage,
    singleNodeTargetMissing,
    taskRunMode
  ])

  /**
   * 从操作系统（OS）补读最新工作流创作权威后打开任务输入。
   *
   * @returns 无返回值；读取或投影失败时通过界面错误呈现。
   */
  const openTaskInputForm = (): void => {
    setTaskInputProblem(null)
    if (singleNodeTargetMissing) {
      setError(
        `${taskRunMode === 'debug' ? '调试启动' : '单节点调试'}前请先在画布节点上设置起始点`
      )
      return
    }
    if (!hasRunnableAppliedWorkflow(aggregate)) {
      setError('当前工作流候选尚未应用；请先应用包含可执行节点的工作流')
      return
    }
    runRuntime(async () => {
      try {
        const latest = await queue.run(() => definitionPort.read())
        await openTaskInputFormForAuthority(latest)
      } catch (openError) {
        setError(errorMessage(openError))
        throw openError
      }
    })
  }

  /**
   * 关闭任务输入，但不回滚已应用工作流图（Applied Workflow Graph）。
   *
   * @returns 无返回值；不会创建工作流任务（WorkflowTask）或发送设备动作。
   */
  const closeTaskInputForm = (): void => {
    if (runtimeBusy) return
    const retainedRevision = taskInputAuthority?.workflow_revision
    setTaskInputAuthority(null)
    setTaskInputForm(null)
    setTaskInputProblem(null)
    setDebugLaunchForm(null)
    setDebugLaunchTaskInput(null)
    setResourceSlotOptions(undefined)
    if (retainedRevision !== undefined) {
      setMessage(
        `已取消本次运行；已应用版本 ${retainedRevision} 保持不变，未创建任务`
      )
    }
  }

  const updateTaskInput = (
    name: string,
    state: WorkflowTaskInputFieldState
  ): void => {
    if (!taskInputForm) return
    const next = setWorkflowTaskInputField(taskInputForm, name, state)
    setTaskInputForm(next)
    setTaskInputProblem(null)
  }

  const submitTaskInput = (): void => {
    if (!taskInputAuthority || !taskInputForm) return
    const submittedForm = taskInputForm
    runRuntime(async () => {
      const requirementsPending = new Error('debug-launch-requirements')
      const guidedInput: {
        current: {
          form: DebugLaunchInputFormState
          input: Record<string, unknown>
        } | null
      } = { current: null }
      try {
        const result = await submitWorkflowTaskInput({
          form: submittedForm,
          readApplied: () => queue.run(() => definitionPort.read()),
          createTask: async (input) => {
            if (taskRunMode !== 'debug') {
              const targetNodeUuid = taskRunMode === 'single_node'
                ? debugExecutionScope.startNodeId ?? undefined
                : undefined
              const preflight = await definitionPort.preflightRun(
                taskRunMode,
                targetNodeUuid
              )
              if (
                preflight &&
                (preflight.status !== 'ready' || !preflight.can_run)
              ) {
                throw new Error(
                  existingWorkflowPreflightFailureMessage(preflight)
                )
              }
              return taskRuntime.create(
                taskRunMode,
                input,
                targetNodeUuid
              )
            }
            const preflight = await taskRuntime.preflightDebug(
              debugExecutionScope.startNodeId as string,
              [...debugBreakpoints],
              input,
              []
            )
            if (preflight.status === 'needs_input') {
              guidedInput.current = {
                form: createDebugLaunchInputForm(preflight),
                input
              }
              throw requirementsPending
            }
            return taskRuntime.createDebug(
              debugExecutionScope.startNodeId as string,
              [...debugBreakpoints],
              input,
              [],
              preflight.preflight_hash
            )
          }
        })
        if (result.kind === 'reproject_before_create') {
          setTaskInputAuthority(result.authority)
          setTaskInputForm(result.form)
          setTaskInputProblem(result.message)
          return
        }
        if (result.kind === 'reproject_after_create') {
          setTaskInputAuthority(result.authority)
          setTaskInputForm(result.form)
          setTaskInputProblem(result.message)
          setMessage(result.message)
          return
        }
        setTaskInputAuthority(null)
        setTaskInputForm(null)
        setTaskInputProblem(null)
        setDebugLaunchForm(null)
        setDebugLaunchTaskInput(null)
        setMessage(result.message)
      } catch (submitError) {
        if (submitError === requirementsPending && guidedInput.current) {
          setDebugLaunchForm(guidedInput.current.form)
          setDebugLaunchTaskInput(guidedInput.current.input)
          setTaskInputProblem(null)
          setMessage(
            `OS 预检识别到 ${guidedInput.current.form.fields.length} 个调试输入；` +
            '请确认后再创建任务'
          )
          return
        }
        setTaskInputProblem(
          workflowTaskInputProblem(submitError, submittedForm)
        )
        throw submitError
      }
    })
  }

  const updateDebugLaunchInput = (
    requirementId: string,
    next: Pick<DebugLaunchInputFieldState, 'valueText' | 'confirmed'>
  ): void => {
    setDebugLaunchForm((current) => current
      ? setDebugLaunchField(current, requirementId, next)
      : current)
    setTaskInputProblem(null)
  }

  const backToTaskInput = (): void => {
    if (runtimeBusy) return
    setDebugLaunchForm(null)
    setDebugLaunchTaskInput(null)
    setTaskInputProblem(null)
  }

  const submitDebugLaunch = (): void => {
    if (
      !debugLaunchForm ||
      !debugLaunchTaskInput ||
      !debugExecutionScope.startNodeId
    ) return
    const submittedForm = debugLaunchForm
    runRuntime(async () => {
      try {
        const overrides = buildDebugLaunchOverrides(submittedForm)
        const preflight = await taskRuntime.preflightDebug(
          debugExecutionScope.startNodeId as string,
          [...debugBreakpoints],
          debugLaunchTaskInput,
          overrides
        )
        if (preflight.status !== 'ready') {
          setDebugLaunchForm(createDebugLaunchInputForm(preflight))
          setTaskInputProblem(
            preflight.diagnostics.map(({ message }) => message).join('；') ||
            '补充输入仍未满足调试启动要求'
          )
          return
        }
        await taskRuntime.createDebug(
          debugExecutionScope.startNodeId as string,
          [...debugBreakpoints],
          debugLaunchTaskInput,
          overrides,
          preflight.preflight_hash
        )
        setTaskInputAuthority(null)
        setTaskInputForm(null)
        setTaskInputProblem(null)
        setDebugLaunchForm(null)
        setDebugLaunchTaskInput(null)
        setMessage(
          `调试任务已创建；${overrides.length} 个补充值已冻结到本次任务`
        )
      } catch (submitError) {
        setTaskInputProblem(errorMessage(submitError))
        throw submitError
      }
    })
  }

  /**
   * 选择单节点调试（single_node），并提示当前目标是否已经就绪。
   *
   * @returns 无返回值；只修改本地运行意图，不创建工作流任务（WorkflowTask）。
   */
  const selectSingleNodeMode = (): void => {
    setTaskRunMode('single_node')
    setMessage(
      debugExecutionScope.startNodeId
        ? '单节点调试将只创建起始点对应的正式作业'
        : '请在画布节点上设置起始点，再启动单节点调试'
    )
  }

  return {
    appliedWorkflowRunnable,
    codeSourceMap,
    completedTaskJobCount,
    debugLaunchForm,
    debugBreakpoints,
    debugExecutionScope,
    closeTaskInputForm,
    backToTaskInput,
    openTaskInputForm,
    openTaskInputFormForAuthority,
    outputExpanded,
    outputTab,
    resourceSlotOptions,
    refreshResourceSlotOptions,
    selectSingleNodeMode,
    runRuntime,
    runtimeBusy,
    selectedJobNodeUuid,
    selectedTaskNode,
    setOutputExpanded,
    setOutputTab,
    setResourceSlotOptions,
    setSelectedJobNodeUuid,
    setTaskInputAuthority,
    setTaskInputForm,
    setTaskInputProblem,
    setTaskRunMode,
    setTraceViewerOpen,
    submitTaskInput,
    submitDebugLaunch,
    task,
    taskControls,
    taskInputAuthority,
    taskInputForm,
    taskInputProblem,
    taskJobs,
    taskNodeNames,
    taskNodeStates,
    pausedBeforeNodeId,
    taskOutputNodes,
    taskRunMode,
    singleNodeTargetMissing,
    taskRuntime,
    taskActivity,
    toggleDebugBreakpoint,
    toggleDebugStartNode,
    traceViewerOpen,
    updateDebugLaunchInput,
    updateTaskInput
  }
}
