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

export type WorkflowDebuggingReactStore = UseBoundStore<StoreApi<WorkflowDebuggingStoreState>>

export function createWorkflowDebuggingReactStore(
  scenario: WorkflowDebuggingScenario,
): WorkflowDebuggingReactStore {
  return create(createWorkflowDebuggingStoreState(scenario))
}
