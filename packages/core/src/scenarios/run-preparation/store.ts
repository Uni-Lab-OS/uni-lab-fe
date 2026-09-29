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
  readonly preflight: PreflightReport | null
  readonly submittedRun: SubmittedRun | null
  readonly error: Error | null

  load(workflowUuid: string): Promise<void>
  requestPreflight(): Promise<void>
  submitRun(): Promise<void>
  inspectNodeJob(jobUuid: string): Promise<void>
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
    preflight: null,
    submittedRun: null,
    error: null,

    async load(workflowUuid) {
      set({ status: 'loading', workflowUuid, error: null })

      try {
        const state = get()
        const draft = state.viewModel?.revision.workflowUuid === workflowUuid
          ? state.viewModel
          : undefined
        const viewModel = await scenario.load(workflowUuid, {
          configuration: draft?.configuration ?? defaultConfiguration,
          binding: draft?.binding ?? defaultBinding
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

    async inspectNodeJob(jobUuid) {
      const state = get()
      if (!state.viewModel) return

      set({ status: 'loading', error: null })

      try {
        const viewModel = await scenario.inspectNodeJob(state.viewModel, jobUuid)
        set({ status: 'ready', viewModel, error: null })
      } catch (error) {
        set({ status: 'error', error: toError(error) })
      }
    },

    updateConfiguration(patch) {
      set((state) => state.viewModel
        ? {
            viewModel: {
              ...state.viewModel,
              configuration: { ...state.viewModel.configuration, ...patch },
              nodeJob: null
            },
            preflight: null,
            submittedRun: null
          }
        : state)
    },

    updateBinding(patch) {
      set((state) => state.viewModel
        ? {
            viewModel: {
              ...state.viewModel,
              binding: { ...state.viewModel.binding, ...patch },
              nodeJob: null
            },
            preflight: null,
            submittedRun: null
          }
        : state)
    },

    clearError() {
      set({ error: null })
    }
  })
}

function currentScenarioState(
  state: RunPreparationStoreState
) {
  return state.viewModel!
}

const defaultConfiguration: RunConfiguration = {
  runMode: 'normal',
  input: {}
}

const defaultBinding: BindingDraft = {
  source: 'user',
  inventoryBindings: [],
  selectedResources: {}
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('请求失败')
}
