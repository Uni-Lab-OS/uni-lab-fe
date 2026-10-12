import { create, type UseBoundStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import {
  createRunPreparationStoreState,
  type RunPreparationStoreState,
} from './scenarios/run-preparation/store'
import type { RunPreparationScenario } from './scenarios/run-preparation/scenario'
import {
  createWorkflowDebuggingStoreState,
  type WorkflowDebuggingStoreState,
} from './scenarios/workflow-debugging/store'
import type { WorkflowDebuggingScenario } from './scenarios/workflow-debugging/scenario'

export type RunPreparationReactStore = UseBoundStore<StoreApi<RunPreparationStoreState>>

export function createRunPreparationReactStore(
  scenario: RunPreparationScenario,
): RunPreparationReactStore {
  return create(createRunPreparationStoreState(scenario))
}

const sharedRunPreparationStores = new WeakMap<
  RunPreparationScenario,
  Map<string, RunPreparationReactStore>
>()

/**
 * 按 scenario + 工作流 UUID 复用同一个运行准备 store。
 * 页面卸载再挂载（例如去物料/试剂页补料后返回）时，已填写的运行参数得以保留；
 * 依赖检查结果仍由 load 作废，因为库存可能已经变化。
 */
export function getRunPreparationReactStore(
  scenario: RunPreparationScenario,
  workflowUuid: string,
): RunPreparationReactStore {
  let byWorkflow = sharedRunPreparationStores.get(scenario)
  if (!byWorkflow) {
    byWorkflow = new Map()
    sharedRunPreparationStores.set(scenario, byWorkflow)
  }
  let store = byWorkflow.get(workflowUuid)
  if (!store) {
    store = createRunPreparationReactStore(scenario)
    byWorkflow.set(workflowUuid, store)
  }
  return store
}

export type WorkflowDebuggingReactStore = UseBoundStore<StoreApi<WorkflowDebuggingStoreState>>

export function createWorkflowDebuggingReactStore(
  scenario: WorkflowDebuggingScenario,
): WorkflowDebuggingReactStore {
  return create(createWorkflowDebuggingStoreState(scenario))
}
