import { describe, expect, it, vi } from 'vitest'
import { createRunPreparationStore } from './run-preparation/store'
import type { RunPreparationScenario } from './run-preparation/scenario'
import { createWorkflowDebuggingStore } from './workflow-debugging/store'
import type { WorkflowDebuggingScenario } from './workflow-debugging/scenario'
import { createWorkflowDebuggingViewModel } from './workflow-debugging/view-model'

const runView = {
  kind: 'run_preparation',
  revision: { kind: 'published_revision', source: 'fixture', workflowUuid: 'wf', name: 'W', revision: 1, workflowType: 'workflow', status: 'published', graph: { workflow: {}, nodes: [], edges: [], nodeTemplates: [], handleTemplates: [], inventoryRequirements: [] } },
  configuration: { runMode: 'normal', input: {} }, binding: { source: 'user', inventoryBindings: [], selectedResources: {} }, requirements: [], nodeJob: null,
} as never

describe('scenario store failure paths', () => {
  it('keeps run preparation errors actionable and clears stale submissions', async () => {
    let fail = true
    const scenario: RunPreparationScenario = {
      load: vi.fn(async () => { if (fail) throw 'load failed'; return runView }),
      requestPreflight: vi.fn(async () => { throw new Error('preflight failed') }),
      submitRun: vi.fn(async () => { throw new Error('submit failed') }),
      inspectNodeJob: vi.fn(async () => { throw new Error('job failed') }),
    }
    const store = createRunPreparationStore(scenario)
    await store.getState().load('wf')
    expect(store.getState().status).toBe('error')
    expect(store.getState().error?.message).toBe('请求失败')
    fail = false
    await store.getState().load('wf')
    store.getState().updateConfiguration({ description: 'desc' })
    store.getState().updateBinding({ selectedResources: { device: 'd-1' } })
    expect(store.getState().viewModel?.configuration.description).toBe('desc')
    await store.getState().requestPreflight()
    expect(store.getState().error?.message).toBe('preflight failed')
    await store.getState().submitRun()
    expect(store.getState().error?.message).toBe('submit failed')
    await store.getState().inspectNodeJob('job')
    expect(store.getState().error?.message).toBe('job failed')
    store.getState().clearError()
    expect(store.getState().error).toBeNull()
  })

  it('covers workflow debugging reload, inspection, subscription errors and cleanup', async () => {
    const base = createWorkflowDebuggingViewModel({}, { items: [], total: 0, page: 1, pageSize: 20, raw: {} })
    let listener: ((view: typeof base, event: never) => void) | undefined
    const scenario: WorkflowDebuggingScenario = {
      load: vi.fn(async () => base), reload: vi.fn(async () => { throw new Error('reload failed') }),
      inspectWorkflow: vi.fn(async () => { throw new Error('workflow failed') }),
      inspectTask: vi.fn(async () => { throw new Error('task failed') }),
      inspectJob: vi.fn(async () => { throw new Error('job failed') }),
      refreshTask: vi.fn(async (view) => view), sendCommand: vi.fn(async () => { throw 'command failed' }),
      subscribeRuntime: vi.fn((_view, next, options) => { listener = next as typeof listener; options?.onError?.(new Error('runtime failed')); return { dispose: vi.fn() } }),
    }
    const store = createWorkflowDebuggingStore(scenario)
    await store.getState().reload()
    expect(store.getState().status).toBe('ready')
    await store.getState().load()
    await store.getState().inspectWorkflow('wf')
    expect(store.getState().error?.message).toBe('workflow failed')
    await store.getState().inspectTask('task')
    expect(store.getState().error?.message).toBe('task failed')
    await store.getState().inspectJob('job')
    expect(store.getState().error?.message).toBe('job failed')
    await store.getState().sendCommand({ type: 'step', idempotencyKey: 'id' })
    expect(store.getState().error?.message).toBe('请求失败')
    store.getState().clearError()
    expect(store.getState().runtimeError).toBeNull()
    // no selected task is a safe no-op; the subscription callback is still type checked by the port.
    store.getState().startRuntimeSubscription()
    listener?.(base, {} as never)
    store.getState().stopRuntimeSubscription()
  })
})
