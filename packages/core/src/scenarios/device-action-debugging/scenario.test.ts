import { describe, expect, it } from 'vitest'
import type { DeviceActionPort } from '../../domain/device-action/port'
import type { WorkflowExecutionReadPort } from '../../domain/workflow-execution-read/port'
import { createDeviceActionDebuggingScenario } from './scenario'

describe('device action debugging scenario', () => {
  it('loads devices and action definitions, then inspects an action', async () => {
    const scenario = createDeviceActionDebuggingScenario(fakeDeviceActions(), fakeExecutionRead())
    const view = await scenario.load({ pageSize: 10 })
    const selected = await scenario.inspectAction(view, 'action-1')

    expect(view).toMatchObject({
      kind: 'device_action_debugging',
      devices: [{ deviceUuid: 'device-1' }],
      actions: [{ actionUuid: 'action-1' }],
    })
    expect(selected.selectedAction).toMatchObject({ actionUuid: 'action-1' })
  })

  it('keeps command acceptance separate from run and feedback reads', async () => {
    const scenario = createDeviceActionDebuggingScenario(fakeDeviceActions(), fakeExecutionRead())
    const view = await scenario.load()
    const accepted = await scenario.startRun(view, {
      materialUuid: 'material-1',
      workflowNodeTemplateUuid: 'action-1',
      param: {},
      idempotencyKey: 'idem-1',
    })
    const inspected = await scenario.inspectRun(accepted, 'task-1', { afterSequence: 4 })

    expect(accepted).toMatchObject({
      acceptedRun: { taskUuid: 'task-1', jobUuid: 'job-1' },
      run: null,
      feedback: null,
    })
    expect(inspected).toMatchObject({
      run: { task: { taskUuid: 'task-1' }, job: { jobUuid: 'job-1' } },
      nodeJob: { jobUuid: 'job-1', workflowTaskUuid: 'task-1' },
      feedback: { nextCursor: 5 },
    })
  })
})

function fakeDeviceActions(): DeviceActionPort {
  return {
    async listDevices() {
      return [
        {
          kind: 'device_summary',
          source: 'os',
          deviceUuid: 'device-1',
          materialUuid: 'material-1',
          resourceTemplateUuid: 'template-1',
          deviceKey: 'device-1',
          namespace: 'lab',
          label: 'Device 1',
          online: true,
          edgeStatus: 'online',
          dispatchable: true,
          dispatchBlockReason: null,
          executionOccupancies: [],
          actions: [],
          raw: {},
        },
      ]
    },
    async listActionDefinitions() {
      return [
        {
          kind: 'action_definition_summary',
          source: 'os',
          actionUuid: 'action-1',
          name: 'move',
          displayName: 'Move',
          actionType: 'move',
          nodeType: 'device_action',
          resourceTemplateUuid: 'template-1',
          raw: {},
        },
      ]
    },
    async getActionDefinition(actionUuid) {
      return {
        kind: 'action_definition',
        source: 'os',
        actionUuid,
        name: 'move',
        displayName: 'Move',
        actionType: 'move',
        nodeType: 'device_action',
        resourceTemplateUuid: 'template-1',
        actionClass: null,
        schema: {},
        goal: {},
        goalDefault: {},
        handles: [],
        resourceContract: null,
        raw: {},
      }
    },
    async createActionRun() {
      return {
        kind: 'device_action_run_accepted',
        source: 'os',
        created: true,
        taskUuid: 'task-1',
        jobUuid: 'job-1',
        raw: {},
      }
    },
    async getActionRun() {
      return {
        kind: 'device_action_run_view',
        source: 'os',
        task: taskDetail('task-1'),
        job: taskJob('job-1'),
      }
    },
  }
}

function fakeExecutionRead(): WorkflowExecutionReadPort {
  return {
    async listTaskPresentations() {
      return { items: [], total: 0, page: 1, pageSize: 20, raw: {} }
    },
    async listTasks() {
      return { items: [], total: 0, page: 1, pageSize: 20, hasMore: false, raw: {} }
    },
    async getTaskDetail(taskUuid) {
      return taskDetail(taskUuid)
    },
    async listTaskJobs() {
      return [taskJob('job-1')]
    },
    async getNodeJobDetail(jobUuid) {
      return {
        kind: 'node_job_detail',
        source: 'os',
        jobUuid,
        workflowTaskUuid: 'task-1',
        workflowNodeUuid: 'node-1',
        materialUuid: null,
        edgeUuid: null,
        edgeCommandUuid: null,
        feedbackSequence: 5,
        topologicalIndex: 0,
        executorKind: 'device',
        executionPolicy: {},
        executionTimeoutSeconds: null,
        status: 'running',
        attempt: 1,
        param: {},
        feedbackData: {},
        returnInfo: {},
        controlData: {},
        errorInfo: [],
        uncertaintyReason: null,
        dispatchDeadlineAt: null,
        executionDeadlineAt: null,
        cancelCommandUuid: null,
        cancelAckDeadlineAt: null,
        cancelCompleteDeadlineAt: null,
        startedAt: null,
        finishedAt: null,
        raw: {},
      }
    },
    async listNodeJobFeedback() {
      return { items: [], nextCursor: 5, hasMore: false, raw: {} }
    },
  }
}

function taskDetail(taskUuid: string) {
  return {
    kind: 'task_runtime_detail' as const,
    source: 'os' as const,
    taskUuid,
    workflowUuid: 'workflow-1',
    executionKind: 'device_action',
    status: 'running',
    runMode: 'normal',
    controlStatus: 'active',
    cleanupStatus: 'none',
    createdAt: 'now',
    updatedAt: 'now',
    raw: {},
  }
}

function taskJob(jobUuid: string) {
  return {
    kind: 'task_job_summary' as const,
    source: 'os' as const,
    jobUuid,
    workflowNodeUuid: 'node-1',
    topologicalIndex: 0,
    executorKind: 'device',
    status: 'running',
    attempt: 1,
    currentAttempt: true,
    controlData: {},
    errorInfo: [],
    waitReason: {},
    expectedChangeSet: {},
    raw: {},
  }
}
