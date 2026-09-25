import { describe, expect, it } from 'vitest'
import type { DeviceActionPort } from '../../domain/device-action/port'
import type { EvidenceInterventionPort } from '../../domain/evidence-intervention/port'
import type { WorkflowExecutionReadPort } from '../../domain/workflow-execution-read/port'
import { createLaboratoryOperationsScenario } from './scenario'

describe('laboratory operations scenario', () => {
  it('loads task attention, device availability and interventions together', async () => {
    const scenario = createLaboratoryOperationsScenario(
      fakeExecutionRead(), fakeDeviceActions(), fakeInterventions()
    )
    const view = await scenario.load({ status: 'running', interventionStatus: 'open' })
    const task = await scenario.inspectTask(view, 'task-1')
    const intervention = await scenario.inspectIntervention(task, 'intervention-1')

    expect(view).toMatchObject({
      kind: 'laboratory_operations',
      tasks: [{ taskUuid: 'task-1' }],
      devices: [{ deviceUuid: 'device-1' }],
      interventions: [{ interventionUuid: 'intervention-1' }]
    })
    expect(task.selectedJobs).toHaveLength(1)
    expect(intervention.selectedIntervention).toMatchObject({ interventionUuid: 'intervention-1' })
  })
})

function fakeExecutionRead(): WorkflowExecutionReadPort {
  return {
    async listTaskPresentations() {
      return {
        items: [{
          kind: 'task_runtime_presentation', source: 'os', taskUuid: 'task-1', workflowUuid: 'workflow-1',
          executionKind: 'workflow', status: 'running', runMode: 'normal', controlStatus: 'active',
          cleanupStatus: 'none', priority: null, description: null, createdAt: 'now', updatedAt: 'now',
          finishedAt: null, attentionReason: null, jobs: [], raw: {}
        }], total: 1, page: 1, pageSize: 20, raw: {}
      }
    },
    async listTasks() { return { items: [], total: 0, page: 1, pageSize: 20, hasMore: false, raw: {} } },
    async getTaskDetail(taskUuid) {
      return {
        kind: 'task_runtime_detail', source: 'os', taskUuid, workflowUuid: 'workflow-1', executionKind: 'workflow',
        status: 'running', runMode: 'normal', controlStatus: 'active', cleanupStatus: 'none',
        createdAt: 'now', updatedAt: 'now', raw: {}
      }
    },
    async listTaskJobs() {
      return [{
        kind: 'task_job_summary', source: 'os', jobUuid: 'job-1', workflowNodeUuid: 'node-1', topologicalIndex: 0,
        executorKind: 'device', status: 'running', attempt: 1, currentAttempt: true, controlData: {}, errorInfo: [],
        waitReason: {}, expectedChangeSet: {}, raw: {}
      }]
    },
    async getNodeJobDetail(jobUuid) {
      return {
        kind: 'node_job_detail', source: 'os', jobUuid, workflowTaskUuid: 'task-1', workflowNodeUuid: 'node-1',
        materialUuid: null, edgeUuid: null, edgeCommandUuid: null, feedbackSequence: null, topologicalIndex: 0,
        executorKind: 'device', executionPolicy: {}, executionTimeoutSeconds: null, status: 'running', attempt: 1,
        param: {}, feedbackData: {}, returnInfo: {}, controlData: {}, errorInfo: [], uncertaintyReason: null,
        dispatchDeadlineAt: null, executionDeadlineAt: null, cancelCommandUuid: null, cancelAckDeadlineAt: null,
        cancelCompleteDeadlineAt: null, startedAt: null, finishedAt: null, raw: {}
      }
    },
    async listNodeJobFeedback() { return { items: [], nextCursor: 0, hasMore: false, raw: {} } }
  }
}

function fakeDeviceActions(): DeviceActionPort {
  return {
    async listDevices() {
      return [{
        kind: 'device_summary', source: 'os', deviceUuid: 'device-1', materialUuid: 'material-1',
        resourceTemplateUuid: 'template-1', deviceKey: 'device-1', namespace: 'lab', label: 'Device 1',
        online: true, edgeStatus: 'online', dispatchable: true, dispatchBlockReason: null,
        executionOccupancies: [], actions: [], raw: {}
      }]
    },
    async listActionDefinitions() { return [] },
    async getActionDefinition() { throw new Error('not used') },
    async createActionRun() { throw new Error('not used') },
    async getActionRun() { throw new Error('not used') }
  }
}

function fakeInterventions(): EvidenceInterventionPort {
  return {
    async listInterventions() { return [intervention()] },
    async getIntervention() { return intervention() }
  }
}

function intervention() {
  return {
    kind: 'workflow_intervention' as const, source: 'os' as const, interventionUuid: 'intervention-1',
    workflowTaskUuid: 'task-1', workflowNodeJobUuid: 'job-1', edgeCommandUuid: null, revision: 1,
    status: 'open' as const, options: [], resumeControlStatus: 'waiting', selectedOptionId: null,
    selectedOption: {}, deliveryStatus: 'none' as const, description: null, metadata: {}, openedAt: 'now',
    createdAt: 'now', updatedAt: 'now', decidedAt: null, deliveredAt: null, raw: {}
  }
}
