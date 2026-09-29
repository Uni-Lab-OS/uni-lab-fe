import { createStore, type StateCreator, type StoreApi } from 'zustand/vanilla'
import type {
  WorkflowTaskCommandReceipt,
  WorkflowTaskCommandRequest
} from '../../domain/workflow-execution-read/model'
import type { WorkflowDebuggingQuery, WorkflowDebuggingViewModel } from './view-model'
import type { WorkflowDebuggingScenario } from './scenario'

export type WorkflowDebuggingStoreStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'commanding' | 'error'

export interface WorkflowDebuggingStoreState {
  readonly status: WorkflowDebuggingStoreStatus
  readonly viewModel: WorkflowDebuggingViewModel | null
  readonly selectedTaskUuid: string | null
  readonly selectedJobUuid: string | null
  readonly command: WorkflowTaskCommandReceipt | null
  readonly error: Error | null
  readonly runtimeError: Error | null
  load(query?: WorkflowDebuggingQuery): Promise<void>
  reload(): Promise<void>
  inspectTask(taskUuid: string): Promise<void>
  inspectJob(jobUuid: string): Promise<void>
  inspectWorkflow(workflowUuid: string): Promise<void>
  sendCommand(request: WorkflowTaskCommandRequest): Promise<void>
  startRuntimeSubscription(): void
  stopRuntimeSubscription(): void
  clearError(): void
}

export type WorkflowDebuggingStore = StoreApi<WorkflowDebuggingStoreState>

export function createWorkflowDebuggingStore(scenario: WorkflowDebuggingScenario): WorkflowDebuggingStore {
  return createStore(createWorkflowDebuggingStoreState(scenario))
}

export function createWorkflowDebuggingStoreState(
  scenario: WorkflowDebuggingScenario
): StateCreator<WorkflowDebuggingStoreState> {
  return (set, get) => {
    let subscription: { dispose: () => void } | null = null
    return {
      status: 'idle',
      viewModel: null,
      selectedTaskUuid: null,
      selectedJobUuid: null,
      command: null,
      error: null,
      runtimeError: null,

      async load(query = {}) {
        subscription?.dispose()
        subscription = null
        set({ status: 'loading', error: null })
        try {
          const viewModel = await scenario.load(query)
          set({ status: 'ready', viewModel, selectedTaskUuid: null, selectedJobUuid: null, command: null, error: null })
        } catch (error) {
          set({ status: 'error', error: toError(error) })
        }
      },

      async reload() {
        const current = get().viewModel
        if (!current) return get().load()
        set({ status: 'loading', error: null })
        try {
          const viewModel = await scenario.reload(current)
          set({ status: 'ready', viewModel, selectedTaskUuid: null, selectedJobUuid: null, error: null })
        } catch (error) {
          set({ status: 'error', error: toError(error) })
        }
      },

      async inspectTask(taskUuid) {
        const current = get().viewModel
        if (!current) return
        set({ status: 'loading', error: null })
        try {
          const viewModel = await scenario.inspectTask(current, taskUuid)
          set({ status: 'ready', viewModel, selectedTaskUuid: taskUuid, selectedJobUuid: null, command: null, error: null })
          get().startRuntimeSubscription()
        } catch (error) {
          set({ status: 'error', error: toError(error) })
        }
      },

      async inspectJob(jobUuid) {
        const current = get().viewModel
        if (!current) return
        set({ status: 'loading', error: null })
        try {
          const viewModel = await scenario.inspectJob(current, jobUuid)
          set({ status: 'ready', viewModel, selectedJobUuid: jobUuid, error: null })
          get().startRuntimeSubscription()
        } catch (error) {
          set({ status: 'error', error: toError(error) })
        }
      },

      async inspectWorkflow(workflowUuid) {
        const current = get().viewModel
        if (!current) return
        try {
          const viewModel = await scenario.inspectWorkflow(current, workflowUuid)
          set({ status: 'ready', viewModel, error: null })
        } catch (error) {
          set({ status: 'error', error: toError(error) })
        }
      },

      async sendCommand(request) {
        const current = get().viewModel
        if (!current) return
        set({ status: 'commanding', error: null })
        try {
          const result = await scenario.sendCommand(current, request)
          // 保留旧 Task/Job 快照，只有后续 REST rehydrate 才能改变运行状态。
          set({ status: 'ready', viewModel: result.viewModel, command: result.command, error: null })
        } catch (error) {
          set({ status: 'error', error: toError(error) })
        }
      },

      startRuntimeSubscription() {
        const current = get().viewModel
        if (!current?.selectedTaskUuid) return
        subscription?.dispose()
        try {
          subscription = scenario.subscribeRuntime(current, (viewModel) => {
            set({ status: 'ready', viewModel, selectedTaskUuid: viewModel.selectedTaskUuid, selectedJobUuid: viewModel.selectedJobUuid, runtimeError: null })
          }, { onError: (error) => set({ runtimeError: error }) })
        } catch (error) {
          subscription = null
          set({ runtimeError: toError(error) })
        }
      },

      stopRuntimeSubscription() {
        subscription?.dispose()
        subscription = null
      },

      clearError() {
        set({ error: null, runtimeError: null })
      }
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('请求失败')
}
