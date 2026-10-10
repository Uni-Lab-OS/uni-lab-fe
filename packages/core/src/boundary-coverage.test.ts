import { describe, expect, it, vi } from 'vitest'
import { getCapabilityStatus, resolveServerCapabilities } from './capabilities'
import { createRunPreparationReactStore, createWorkflowDebuggingReactStore } from './react'
import { WorkflowExecutionControlClient } from './domain/workflow-execution-control/client'
import { WorkflowExecutionRecoveryClient } from './domain/workflow-execution-recovery/client'
import { RunPreparationError } from './domain/run-preparation/errors'
import { decodeNodeJobDetail, decodePreflightReport, decodeSubmittedRun } from './domain/run-preparation/codec'
import { decodePublishedWorkflow, decodePublishedWorkflowList, decodeWorkflowListHasMore } from './domain/workflow-definition/codec'
import { deriveWorkflowDebugFacts, deriveWorkflowProgress } from './domain/workflow-execution-read/debug-facts'
import type { RequestTransport } from './transport/request'
import type { RunConfiguration } from './domain/run-preparation/model'
import type { TaskRuntimeDetail, TaskJobSummary } from './domain/workflow-execution-read/model'

const configuration: RunConfiguration = { runMode: 'normal', input: {} }

function transport(data: unknown, status = 200): RequestTransport {
  return { request: vi.fn(async () => ({ status, headers: {}, data })) }
}

const task = (raw: Record<string, unknown> = {}, overrides: Partial<TaskRuntimeDetail> = {}): TaskRuntimeDetail => ({
  kind: 'task_runtime_detail', source: 'os', taskUuid: 'task-1', workflowUuid: 'wf-1', executionKind: 'workflow', status: 'running', runMode: 'normal', controlStatus: 'running', cleanupStatus: 'pending', createdAt: 'now', updatedAt: 'now', raw, ...overrides,
})

const job = (status = 'running', waitReason: Record<string, unknown> = {}): TaskJobSummary => ({
  kind: 'task_job_summary', source: 'os', jobUuid: `job-${status}`, workflowNodeUuid: 'node-1', topologicalIndex: 1, executorKind: 'device', status, attempt: 1, currentAttempt: true, controlData: {}, errorInfo: [], waitReason, expectedChangeSet: {}, raw: {},
})

describe('core boundary and failure contracts', () => {
  it('resolves capability profiles and deny-by-default statuses', () => {
    expect(resolveServerCapabilities({ id: 'local-go' })).toContain('workflow.editDefinitions')
    expect(resolveServerCapabilities({ id: 'local-python' })).toContain('inventory.dispenseReagent')
    const unknown = resolveServerCapabilities({ id: 'remote' })
    expect(unknown.size).toBe(0)
    expect(getCapabilityStatus({ id: 'remote', name: '远端' }, unknown, 'workflow.editDefinitions')).toEqual({ available: false, reason: '远端 尚未声明 workflow.editDefinitions 能力' })
    expect(getCapabilityStatus({ id: 'local-go', name: 'Go' }, resolveServerCapabilities({ id: 'local-go' }), 'workflow.editDefinitions')).toEqual({ available: true })
  })

  it('creates React stores around scenario state creators', () => {
    const scenario = {} as never
    const runStore = createRunPreparationReactStore(scenario)
    const debugStore = createWorkflowDebuggingReactStore(scenario)
    expect(runStore.getState().status).toBe('idle')
    expect(debugStore.getState().status).toBe('idle')
  })

  it('decodes command lifecycle states and preserves optional request fields', async () => {
    const client = new WorkflowExecutionControlClient(transport({ data: { uuid: 'cmd-1', status: 'applied', type: 'pause', workflow_task_uuid: 'task-2', target_node_uuid: 'node-2', idempotency_key: 'id-1', meta_data: { source: 'test' }, result: { ok: true }, created_at: 'c', updated_at: 'u' } }))
    const receipt = await client.sendTaskCommand('task-2', { type: 'pause', targetNodeUuid: 'node-2', idempotencyKey: 'id-1', description: '暂停', metadata: { source: 'test' } })
    expect(receipt).toMatchObject({ lifecycle: 'applied', accepted: true, commandUuid: 'cmd-1', result: { ok: true } })
    const request = (client as unknown as { transport: RequestTransport }).transport.request as ReturnType<typeof vi.fn>
    expect(request.mock.calls[0][0].body).toMatchObject({ target_node_uuid: 'node-2', description: '暂停', meta_data: { source: 'test' } })
    for (const [status, lifecycle] of [['rejected', 'rejected'], ['succeeded', 'applied'], ['mystery', 'accepted']] as const) {
      const result = await new WorkflowExecutionControlClient(transport({ status })).sendTaskCommand('t', { type: 'resume', idempotencyKey: status })
      expect(result.lifecycle).toBe(lifecycle)
    }
    const unknown = await new WorkflowExecutionControlClient(transport({}, 500)).sendTaskCommand('t', { type: 'cancel', idempotencyKey: 'x' })
    expect(unknown.lifecycle).toBe('unknown')
  })

  it('decodes run preparation optional fields and rejects invalid responses', () => {
    expect(decodeSubmittedRun({ data: { uuid: 'task-1' } })).toMatchObject({ taskUuid: 'task-1' })
    expect(decodeSubmittedRun({ data: { task_uuid: 'task-1', accepted_at: 'now' } })).toMatchObject({ acceptedAt: 'now' })
    expect(decodeNodeJobDetail({ data: { uuid: 'job-1', task_uuid: 'task-1', workflow_node_uuid: 'node-1', executor_kind: 'device', status: 'running', attempt: 1, uncertainty_reason: 'restart' } })).toMatchObject({ uncertaintyReason: 'restart' })
    expect(decodePreflightReport({ data: { workflow_uuid: 'wf-1', workflow_revision: 1, status: 'runnable_now', checked_at: 'now', can_run: false, target_node_uuid: 'node-1', checks: [{ type: 'resource', status: 'passed', code: 'OK', message: 'ok', blocking: false, node_uuid: 'node-1', node_name: 'N', details: { x: 1 } }] } }, { runMode: 'single_node', input: {} })).toMatchObject({ canRun: true, targetNodeUuid: 'node-1' })
    expect(() => decodePreflightReport({ code: 1, error: { code: 'develop_task_conflict', message: 'develop_task_conflict:task-1:running' } }, configuration)).toThrow('执行中')
    expect(() => decodePreflightReport({ code: 1, error: { message: 'bad' } }, configuration)).toThrow(RunPreparationError)
    expect(() => decodePreflightReport({ data: [] }, configuration)).toThrow('workflow_revision')
  })

  it('validates workflow list envelopes and identity drift', () => {
    expect(decodeWorkflowListHasMore({ data: { has_more: true } })).toBe(true)
    expect(decodePublishedWorkflowList({ items: [{ uuid: 'wf-1', name: 'W', revision: 1, workflow_type: 'normal' }] })).toMatchObject([{ workflowType: 'workflow', status: 'published' }])
    expect(() => decodePublishedWorkflowList({ items: [{ uuid: 'wf-1', name: 'W', revision: 1, workflow_type: 'workflow' }, { uuid: 'wf-1', name: 'W2', revision: 2, workflow_type: 'workflow' }] })).toThrow('duplicate workflow uuid')
    expect(() => decodeWorkflowListHasMore({ data: {} })).toThrow('has_more')
    expect(() => decodePublishedWorkflowList([])).toThrow('workflow list must be an object')
    expect(() => decodePublishedWorkflow({ data: { uuid: 'wf-1', name: 'W', revision: 1, workflow_type: 'workflow' } } as never, { workflow: { uuid: 'wf-2', revision: 1 }, nodes: [], edges: [], node_templates: [], handle_templates: [] } as never)).toThrow('identities differ')
  })

  it('reads debug facts from explicit projections and job fallbacks', () => {
    const facts = deriveWorkflowDebugFacts(task({
      ready_frontier: [{ node_uuid: 'n-1', selectable: false, blocked_by: ['lock'] }, {}],
      joins: [{ node_uuid: 'join-1', required_branches: ['a', 'b'], satisfied_branches: ['a'] }],
      resource_waits: [{ resource_uuid: 'r-1', resource_kind: 'device', message: '等待', blocking: false }],
      locks: [{ uuid: 'lock-1', status: 'uncertain', blocked_by: ['cleanup'], can_release: false }],
      progress: { completed_count: 1, total_count: 2 }, recovery: { source: 'os' },
    }), [job('pending', { resourceUuid: 'r-2', reason: '资源' }), job('succeeded')])
    expect(facts.readyFrontier[0]).toMatchObject({ nodeUuid: 'n-1', selectable: false })
    expect(facts.joins[0]).toMatchObject({ ready: false, missingConditions: [] })
    expect(facts.resourceWaits).toHaveLength(2)
    expect(facts.recovery).toMatchObject({ locks: [{ state: 'uncertain' }], requiresReconciliation: false })
    expect(deriveWorkflowProgress(undefined, [job('succeeded'), job('failed'), job('skipped')])).toMatchObject({ completed: 3, total: 3, percent: 100 })
    expect(deriveWorkflowProgress(undefined, [])).toBeNull()
    expect(deriveWorkflowProgress({ total: 0, completed: 0 }, [])).toMatchObject({ percent: 0 })
    expect(deriveWorkflowDebugFacts(task({}, { status: 'execution_unknown' }), [])).toMatchObject({ recovery: { executionUnknown: true, requiresReconciliation: true } })
  })

  it('loads recovery facts through both read requests', async () => {
    const read = { getTaskDetail: vi.fn(async () => task({ execution_locks: [] })), listTaskJobs: vi.fn(async () => [job('succeeded')]) }
    const recovery = await new WorkflowExecutionRecoveryClient(read).getTaskRecovery('task-1')
    expect(read.getTaskDetail).toHaveBeenCalledWith('task-1')
    expect(read.listTaskJobs).toHaveBeenCalledWith('task-1')
    expect(recovery.executionUnknown).toBe(false)
  })
})
