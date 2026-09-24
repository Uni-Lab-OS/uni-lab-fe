import { create, type UseBoundStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import {
  createRunPreparationStoreState,
  type RunPreparationStoreState
} from './scenarios/run-preparation/store'
import type { RunPreparationScenario } from './scenarios/run-preparation/scenario'

export type RunPreparationReactStore = UseBoundStore<StoreApi<RunPreparationStoreState>>

export function createRunPreparationReactStore(
  scenario: RunPreparationScenario
): RunPreparationReactStore {
  return create(createRunPreparationStoreState(scenario))
}
