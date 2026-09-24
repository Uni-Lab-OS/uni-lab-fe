import { createStore, type StateCreator, type StoreApi } from 'zustand/vanilla'
import type { PreflightReport, RunConfiguration, SubmittedRun } from '../../domain/run-preparation/model'
import type { BindingDraft } from '../../domain/run-preparation/model'
import type { RunPreparationScenario } from './scenario'
import type { RunPreparationViewModel } from './view-model'

export type RunPreparationStoreStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'preflighting'
  | 'submitting'
  | 'error'

export interface RunPreparationStoreState {
  readonly status: RunPreparationStoreStatus
  readonly workflowUuid: string | null
  readonly viewModel: RunPreparationViewModel | null
  readonly configuration: RunConfiguration
  readonly binding: BindingDraft
  readonly preflight: PreflightReport | null
  readonly submittedRun: SubmittedRun | null
  readonly error: Error | null

  load(workflowUuid: string): Promise<void>
  requestPreflight(): Promise<void>
  submitRun(): Promise<void>
  updateConfiguration(patch: Partial<RunConfiguration>): void
  updateBinding(patch: Partial<BindingDraft>): void
  clearError(): void
}

export type RunPreparationStore = StoreApi<RunPreparationStoreState>

export function createRunPreparationStore(
  scenario: RunPreparationScenario
): RunPreparationStore {
  return createStore(createRunPreparationStoreState(scenario))
}

export function createRunPreparationStoreState(
  scenario: RunPreparationScenario
): StateCreator<RunPreparationStoreState> {
  return (set, get) => ({
    status: 'idle',
    workflowUuid: null,
    viewModel: null,
    configuration: {
      runMode: 'normal',
      input: {}
    },
    binding: {
      source: 'user',
      inventoryBindings: [],
      selectedResources: {}
    },
    preflight: null,
    submittedRun: null,
    error: null,

    async load(workflowUuid) {
      set({ status: 'loading', workflowUuid, error: null })

      try {
        const state = get()
        const viewModel = await scenario.load(workflowUuid, {
          configuration: state.configuration,
          binding: state.binding
        })
        set({
          status: 'ready',
          viewModel,
          preflight: null,
          submittedRun: null,
          error: null
        })
      } catch (error) {
        set({ status: 'error', error: toError(error) })
      }
    },

    async requestPreflight() {
      const state = get()
      if (!state.viewModel) return

      set({ status: 'preflighting', error: null })

      try {
        const preflight = await scenario.requestPreflight(currentScenarioState(get()))
        set({ status: 'ready', preflight, error: null })
      } catch (error) {
        set({ status: 'error', error: toError(error) })
      }
    },

    async submitRun() {
      const state = get()
      if (!state.viewModel) return

      set({ status: 'submitting', error: null })

      try {
        const submittedRun = await scenario.submitRun(currentScenarioState(get()))
        set({ status: 'ready', submittedRun, error: null })
      } catch (error) {
        set({ status: 'error', error: toError(error) })
      }
    },

    updateConfiguration(patch) {
      set((state) => ({
        configuration: { ...state.configuration, ...patch },
        preflight: null
      }))
    },

    updateBinding(patch) {
      set((state) => ({
        binding: { ...state.binding, ...patch },
        preflight: null
      }))
    },

    clearError() {
      set({ error: null })
    }
  })
}

function currentScenarioState(
  state: RunPreparationStoreState
) {
  return {
    ...state.viewModel!,
    configuration: state.configuration,
    binding: state.binding
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('请求失败')
}
