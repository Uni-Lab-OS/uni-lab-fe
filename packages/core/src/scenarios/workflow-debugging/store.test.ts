import { describe, expect, it, vi } from 'vitest'
import { createWorkflowDebuggingStore } from './store'
import type { WorkflowDebuggingScenario } from './scenario'
import { createWorkflowDebuggingViewModel } from './view-model'
import type { WorkflowTaskCommandRequest } from '../../domain/workflow-execution-read/model'

describe('createWorkflowDebuggingStore', () => {
  it('stores command receipt without changing the authoritative task snapshot', async () => {
    const task = {
      kind: 'task_runtime_detail', source: 'os', taskUuid: 'task-1', workflowUuid: 'workflow-1', executionKind: 'workflow',
      status: 'running', runMode: 'step', controlStatus: 'paused', cleanupStatus: 'none', createdAt: 'now', updatedAt: 'now', raw: {}
    } as const
    const base = createWorkflowDebuggingViewModel({}, {
      items: [], total: 0, page: 1, pageSize: 20, raw: {}
    })
    const loaded = { ...base, selectedTaskUuid: 'task-1', selectedTask: task, controls: { canStep: true, canPause: false, canResume: false, canCancel: true } }
    const scenario: WorkflowDebuggingScenario = {
      load: vi.fn(async () => base),
      reload: vi.fn(async () => base),
      inspectWorkflow: vi.fn(async (view) => view),
      inspectTask: vi.fn(async () => loaded),
      inspectJob: vi.fn(async (view) => view),
      refreshTask: vi.fn(async (view) => view),
      sendCommand: vi.fn(async (view, request: WorkflowTaskCommandRequest) => ({
        viewModel: { ...view, lastCommand: {
          kind: 'workflow_task_command_receipt', commandUuid: 'command-1', workflowTaskUuid: 'task-1', type: request.type,
          targetNodeUuid: request.targetNodeUuid ?? null, idempotencyKey: request.idempotencyKey, accepted: true,
          lifecycle: 'accepted', statusCode: 201, result: {}, createdAt: null, updatedAt: null, raw: {}
        } },
        command: {
          kind: 'workflow_task_command_receipt', commandUuid: 'command-1', workflowTaskUuid: 'task-1', type: request.type,
          targetNodeUuid: request.targetNodeUuid ?? null, idempotencyKey: request.idempotencyKey, accepted: true,
          lifecycle: 'accepted', statusCode: 201, result: {}, createdAt: null, updatedAt: null, raw: {}
        }
      })),
      subscribeRuntime: vi.fn(() => ({ dispose: vi.fn() }))
    }
    const store = createWorkflowDebuggingStore(scenario)
    await store.getState().load()
    await store.getState().inspectTask('task-1')
    await store.getState().sendCommand({ type: 'step', targetNodeUuid: 'node-1', idempotencyKey: 'idem-1' })

    expect(store.getState().viewModel?.selectedTask?.status).toBe('running')
    expect(store.getState().command).toMatchObject({ lifecycle: 'accepted' })
    expect(scenario.sendCommand).toHaveBeenCalledTimes(1)
  })

  it('keeps the runtime subscription when an invalidation refreshes the task', async () => {
    const base = createWorkflowDebuggingViewModel({}, {
      items: [], total: 0, page: 1, pageSize: 20, raw: {}
    })
    const loaded = { ...base, selectedTaskUuid: 'task-1' }
    let emit: ((viewModel: typeof loaded, event: never) => void) | undefined
    const scenario: WorkflowDebuggingScenario = {
      load: vi.fn(async () => base),
      reload: vi.fn(async () => base),
      inspectWorkflow: vi.fn(async (view) => view),
      inspectTask: vi.fn(async () => loaded),
      inspectJob: vi.fn(async (view) => view),
      refreshTask: vi.fn(async (view) => view),
      sendCommand: vi.fn(),
      subscribeRuntime: vi.fn((_view, listener) => {
        emit = listener as typeof emit
        return { dispose: vi.fn() }
      })
    }
    const store = createWorkflowDebuggingStore(scenario)
    await store.getState().load()
    await store.getState().inspectTask('task-1')
    emit?.(loaded, {} as never)

    expect(scenario.subscribeRuntime).toHaveBeenCalledTimes(1)
  })
})
