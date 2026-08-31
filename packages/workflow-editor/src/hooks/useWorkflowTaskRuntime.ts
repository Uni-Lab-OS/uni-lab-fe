import type {
  DebugLaunchOverride,
  DebugWorkflowTaskPreflight,
  WorkflowRuntimePort,
  WorkflowTask,
  WorkflowTaskCommandType,
  WorkflowTaskRunMode
} from '@unilab/services'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import { WorkflowTaskController } from '../runtime/WorkflowTaskController'

/**
 * 把工作流任务（WorkflowTask）控制器生命周期绑定到 React 组件。
 *
 * 参数：`runtime` 是唯一工作流运行端口，`workflowUuid` 是当前工作流
 * （Workflow）身份。返回：权威任务快照以及创建、命令、补读和清错控制面。
 * 生命周期：挂载时订阅全局服务器发送事件（SSE）并补读，卸载时释放订阅；
 * StrictMode 同一轮重放不会误销毁控制器。异常：异步端口失败由各控制方法传播，
 * 同时保留在控制器快照中；生命周期启动失败不产生未处理 Promise。
 */
export function useWorkflowTaskRuntime(
  runtime: WorkflowRuntimePort,
  workflowUuid: string,
  active = true
): {
  snapshot: ReturnType<WorkflowTaskController['getSnapshot']>
  create: (
    runMode: WorkflowTaskRunMode,
    input?: Record<string, unknown>,
    targetNodeUuid?: string
  ) => Promise<WorkflowTask>
  createDebug: (
    startNodeUuid: string,
    breakpointNodeUuids: readonly string[],
    input?: Record<string, unknown>,
    launchOverrides?: readonly DebugLaunchOverride[],
    preflightHash?: string
  ) => Promise<WorkflowTask>
  preflightDebug: (
    startNodeUuid: string,
    breakpointNodeUuids: readonly string[],
    input?: Record<string, unknown>,
    launchOverrides?: readonly DebugLaunchOverride[]
  ) => Promise<DebugWorkflowTaskPreflight>
  debugCommand: (type: 'step' | 'continue') => Promise<void>
  command: (type: WorkflowTaskCommandType) => Promise<void>
  refresh: () => Promise<void>
  clearError: () => void
} {
  const initialActive = useRef(active)
  // Authority 或 Workflow 身份在隐藏态切换时，新控制器必须继承当前可见性。
  initialActive.current = active
  const controller = useMemo(
    () => new WorkflowTaskController(
      runtime,
      workflowUuid,
      initialActive.current
    ),
    [runtime, workflowUuid]
  )
  const lifecycleGeneration = useRef(0)
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )

  useEffect(() => {
    const generation = ++lifecycleGeneration.current
    void controller.start()
    return () => {
      globalThis.queueMicrotask(() => {
        // React StrictMode immediately replays effects in development.  Do
        // not permanently dispose the memoized controller during that replay;
        // only dispose when no replacement setup occurred in the same turn.
        if (lifecycleGeneration.current === generation) controller.dispose()
      })
    }
  }, [controller])

  useEffect(() => {
    controller.setActive(active)
  }, [active, controller])

  return {
    snapshot,
    /**
     * 通过唯一控制器创建正常、单步或单节点工作流任务（WorkflowTask）。
     *
     * 参数：`runMode` 是运行模式，`input` 是已验证输入，`targetNodeUuid` 是可选
     * 单节点目标。返回：OS 权威任务。异常：创建失败时保留控制器错误并传播。
     */
    create: (runMode, input, targetNodeUuid) =>
      controller.create(runMode, input, targetNodeUuid),
    createDebug: (
      startNodeUuid,
      breakpointNodeUuids,
      input,
      launchOverrides,
      preflightHash
    ) => controller.createDebug(
      startNodeUuid,
      breakpointNodeUuids,
      input,
      launchOverrides,
      preflightHash
    ),
    preflightDebug: (
      startNodeUuid,
      breakpointNodeUuids,
      input,
      launchOverrides
    ) => controller.preflightDebug(
      startNodeUuid,
      breakpointNodeUuids,
      input,
      launchOverrides
    ),
    debugCommand: (type) => controller.debugCommand(type),
    command: (type) => controller.command(type),
    refresh: () => controller.refresh(),
    clearError: () => controller.clearError()
  }
}
