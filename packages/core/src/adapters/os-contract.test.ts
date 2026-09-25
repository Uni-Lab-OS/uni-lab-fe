import { describe, expect, it } from 'vitest'
import { WorkflowDefinitionClient } from '../domain/workflow-definition/client'
import { RunPreparationClient } from '../domain/run-preparation/client'
import { WorkflowExecutionReadClient } from '../domain/workflow-execution-read/client'
import type { BindingDraft, RunConfiguration } from '../domain/run-preparation/model'
import type {
  RequestTransport,
  TransportRequest,
  TransportResponse
} from '../transport/request'

/**
 * This test is the formal Shared Interface seam. Responses mirror the public
 * envelopes exercised by Uni-Lab OS workflow API tests, rather than UI/demo data.
 */
describe('OS adapter contract: published workflow to execution read', () => {
  it('maps the published/preflight/submit/task/job/feedback contract end to end', async () => {
    const transport = new WorkflowContractTransport()
    const definitions = new WorkflowDefinitionClient(transport)
    const preparation = new RunPreparationClient(transport)
    const execution = new WorkflowExecutionReadClient(transport)

    const revisions = await definitions.listPublishedRevisions()
    const revision = await definitions.getPublishedRevision('workflow-1')
    const configuration: RunConfiguration = {
      runMode: 'normal',
      priority: 'high',
      description: 'contract check',
      metadata: { source: 'os-contract' },
      input: { value: true }
    }
    const binding: BindingDraft = {
      source: 'user',
      inventoryBindings: [],
      selectedResources: {}
    }
    const preflight = await preparation.requestPreflight('workflow-1', configuration, binding)
    const submitted = await preparation.submitRun('workflow-1', configuration, binding)
    const task = await execution.getTaskDetail(submitted.taskUuid)
    const jobs = await execution.listTaskJobs(submitted.taskUuid)
    const job = await execution.getNodeJobDetail(jobs[0]!.jobUuid)
    const feedback = await execution.listNodeJobFeedback(job.jobUuid)

    expect(revisions).toMatchObject([
      { workflowUuid: 'workflow-1', workflowType: 'workflow', status: 'published' }
    ])
    expect(revision).toMatchObject({
      workflowUuid: 'workflow-1',
      revision: 3,
      graph: { workflow: { uuid: 'workflow-1', revision: 3 } }
    })
    expect(preflight).toMatchObject({
      workflowUuid: 'workflow-1',
      workflowRevision: 3,
      status: 'runnable_now',
      canRun: true,
      checks: [
        { status: 'passed' },
        { status: 'deferred' },
        { status: 'confirmation_required' }
      ]
    })
    expect(submitted).toMatchObject({ taskUuid: 'task-1' })
    expect(task).toMatchObject({
      taskUuid: 'task-1',
      status: 'pending',
      workflowUuid: 'workflow-1'
    })
    expect(jobs).toMatchObject([
      { jobUuid: 'job-1', status: 'execution_unknown', attempt: 1 }
    ])
    expect(job).toMatchObject({
      jobUuid: 'job-1',
      status: 'execution_unknown',
      uncertaintyReason: 'device_acknowledgement_missing'
    })
    expect(feedback).toMatchObject({
      items: [{ jobUuid: 'job-1', sequence: 1 }],
      nextCursor: 1,
      hasMore: false
    })

    expect(transport.requests.map(({ method, url }) => [method, url])).toEqual([
      ['GET', '/api/v1/workflows?page=1&page_size=100&status=published'],
      ['GET', '/api/v1/workflows/workflow-1'],
      ['GET', '/api/v1/workflows/workflow-1/graph'],
      ['POST', '/api/v1/workflows/workflow-1/run-preflight'],
      ['POST', '/api/v1/workflow-tasks'],
      ['GET', '/api/v1/workflow-tasks/task-1'],
      ['GET', '/api/v1/workflow-tasks/task-1/jobs'],
      ['GET', '/api/v1/workflow-node-jobs/job-1'],
      ['GET', '/api/v1/workflow-node-jobs/job-1/feedback?page=1&page_size=500']
    ])
    expect(transport.requests[3]?.body).toEqual({
      run_mode: 'normal',
      input: { value: true },
      inventory_bindings: []
    })
    expect(transport.requests[4]?.body).toEqual({
      workflow_uuid: 'workflow-1',
      run_mode: 'normal',
      priority: 'high',
      input: { value: true },
      inventory_bindings: [],
      description: 'contract check',
      meta_data: { source: 'os-contract' }
    })
  })

  it('preserves OS business errors returned in a successful HTTP response', async () => {
    const transport = new BusinessErrorTransport()
    const preparation = new RunPreparationClient(transport)

    await expect(
      preparation.requestPreflight(
        'workflow-1',
        { runMode: 'normal', input: {} },
        { source: 'user', inventoryBindings: [], selectedResources: {} }
      )
    ).rejects.toMatchObject({
      code: 'OS_REQUEST_REJECTED',
      message: 'workflow is temporarily unavailable'
    })
  })
})

class WorkflowContractTransport implements RequestTransport {
  readonly requests: TransportRequest[] = []

  async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
    this.requests.push(request)
    const data = responseFor(request)
    const status = request.url === '/api/v1/workflow-tasks' ? 201 : 200
    return { status, headers: {}, data: data as Value }
  }
}

class BusinessErrorTransport implements RequestTransport {
  async request<Value>(_request: TransportRequest): Promise<TransportResponse<Value>> {
    return {
      status: 200,
      headers: {},
      data: {
        code: 3003,
        error: { code: 'preflight_failed', msg: 'workflow is temporarily unavailable' }
      } as Value
    }
  }
}

function responseFor(request: TransportRequest): unknown {
  if (request.url.startsWith('/api/v1/workflows?')) {
    return {
      code: 0,
      data: {
        items: [{
          uuid: 'workflow-1', name: 'Contract Workflow', revision: 3,
          workflow_type: 'workflow', status: 'published', description: 'contract'
        }],
        total: 1, page: 1, page_size: 100, has_more: false
      }
    }
  }
  if (request.url === '/api/v1/workflows/workflow-1') {
    return {
      code: 0,
      data: {
        uuid: 'workflow-1', name: 'Contract Workflow', revision: 3,
        workflow_type: 'workflow', status: 'published'
      }
    }
  }
  if (request.url === '/api/v1/workflows/workflow-1/graph') {
    return {
      code: 0,
      data: {
        workflow: { uuid: 'workflow-1', revision: 3 },
        nodes: [], edges: [], node_templates: [], handle_templates: [],
        inventory_requirements: []
      }
    }
  }
  if (request.url === '/api/v1/workflows/workflow-1/run-preflight') {
    return {
      code: 0,
      data: {
        workflow_uuid: 'workflow-1', workflow_revision: 3,
        run_mode: 'normal', status: 'runnable_now', can_run: true,
        checked_at: '2026-09-25T03:00:00Z',
        checks: [
          { type: 'definition', status: 'passed', code: 'ok', message: 'ok', blocking: false },
          { type: 'resource_lock', status: 'deferred', code: 'resource_admission_at_dispatch', message: 'dispatch time', blocking: false },
          { type: 'manual_gate', status: 'confirmation_required', code: 'operator_confirmation', message: 'confirm', blocking: false }
        ]
      }
    }
  }
  if (request.url === '/api/v1/workflow-tasks') {
    return {
      code: 0,
      data: {
        uuid: 'task-1', workflow_uuid: 'workflow-1', execution_kind: 'workflow',
        status: 'pending', run_mode: 'normal', control_status: 'active', cleanup_status: 'none',
        priority: 'high', description: 'contract check', create_time: '2026-09-25T03:00:00Z',
        update_time: '2026-09-25T03:00:00Z', input: { value: true }, output: {},
        workflow_snapshot: { nodes: [] }
      }
    }
  }
  if (request.url === '/api/v1/workflow-tasks/task-1') {
    return {
      code: 0,
      data: {
        uuid: 'task-1', workflow_uuid: 'workflow-1', execution_kind: 'workflow',
        status: 'pending', run_mode: 'normal', control_status: 'active', cleanup_status: 'none',
        create_time: '2026-09-25T03:00:00Z', update_time: '2026-09-25T03:00:00Z'
      }
    }
  }
  if (request.url === '/api/v1/workflow-tasks/task-1/jobs') {
    return {
      code: 0,
      data: [{
        uuid: 'job-1', workflow_node_uuid: 'node-1', topological_index: 0,
        executor_kind: 'device_action', status: 'execution_unknown', attempt: 1,
        current_attempt: true, control_data: {}, error_info: [], wait_reason: {}, expected_change_set: {}
      }]
    }
  }
  if (request.url === '/api/v1/workflow-node-jobs/job-1') {
    return {
      code: 0,
      data: {
        uuid: 'job-1', workflow_task_uuid: 'task-1', workflow_node_uuid: 'node-1',
        material_uuid: 'device-material-1', edge_uuid: null, edge_command_uuid: null,
        feedback_sequence: 1, topological_index: 0, executor_kind: 'device_action',
        execution_policy: {}, execution_timeout_seconds: null, status: 'execution_unknown', attempt: 1,
        param: {}, feedback_data: {}, return_info: {}, control_data: {}, error_info: [],
        uncertainty_reason: 'device_acknowledgement_missing', dispatch_deadline_at: null,
        execution_deadline_at: null, cancel_command_uuid: null, cancel_ack_deadline_at: null,
        cancel_complete_deadline_at: null, started_at: null, finished_at: null
      }
    }
  }
  if (request.url.startsWith('/api/v1/workflow-node-jobs/job-1/feedback?')) {
    return {
      code: 0,
      data: {
        items: [{
          uuid: 'feedback-1', workflow_node_job_uuid: 'job-1', sequence: 1,
          feedback_type: 'progress', data: { percent: 50 },
          observed_at: '2026-09-25T03:00:01Z', received_at: '2026-09-25T03:00:01Z',
          published_at: null, idempotency_key: 'feedback-1', description: null, meta_data: {}
        }],
        has_more: false, page: 1, page_size: 500
      }
    }
  }
  throw new Error(`Unexpected OS contract request: ${request.method} ${request.url}`)
}
