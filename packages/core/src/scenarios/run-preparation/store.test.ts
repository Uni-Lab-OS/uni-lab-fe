import { describe, expect, it } from 'vitest'
import type {
  PreflightReport,
  RunConfiguration,
  SubmittedRun
} from '../../domain/run-preparation/model'
import type { RunPreparationScenario } from './scenario'
import { createRunPreparationStore } from './store'

describe('createRunPreparationStore', () => {
  it('keeps draft state in Zustand and sends the latest draft through the scenario', async () => {
    let receivedConfiguration: RunConfiguration | undefined
    const scenario: RunPreparationScenario = {
      async load(workflowUuid, state) {
        return {
          kind: 'run_preparation',
          revision: {
            kind: 'published_revision',
            source: 'fixture',
            workflowUuid,
            name: 'Example workflow',
            revision: 1,
            workflowType: 'workflow',
            status: 'published',
            graph: {
              workflow: { uuid: workflowUuid },
              nodes: [],
              edges: [],
              nodeTemplates: [],
              handleTemplates: [],
              inventoryRequirements: []
            }
          },
          ...state,
          requirements: [],
          nodeJob: null
        }
      },
      async requestPreflight(state): Promise<PreflightReport> {
        receivedConfiguration = state.configuration
        return {
          kind: 'preflight_report',
          source: 'fixture',
          workflowUuid: state.revision.workflowUuid,
          workflowRevision: state.revision.revision,
          runMode: state.configuration.runMode,
          status: 'runnable_now',
          canRun: true,
          checkedAt: '2026-09-24T00:00:00Z',
          checks: []
        }
      },
      async submitRun(): Promise<SubmittedRun> {
        return {
          kind: 'submitted_run',
          source: 'fixture',
          taskUuid: 'task-1',
          raw: {}
        }
      },
      async inspectNodeJob(viewModel, jobUuid) {
        return {
          ...viewModel,
          nodeJob: {
            kind: 'node_job_detail', source: 'fixture', jobUuid, workflowTaskUuid: 'task-1',
            workflowNodeUuid: 'node-1', executorKind: 'device', logicalStatus: 'running', attempt: 1, raw: {}
          }
        }
      }
    }

    const store = createRunPreparationStore(scenario)
    await store.getState().load('workflow-1')
    store.getState().updateConfiguration({
      runMode: 'single_node',
      targetNodeUuid: 'node-1'
    })
    await store.getState().requestPreflight()

    expect(receivedConfiguration).toEqual({
      runMode: 'single_node',
      targetNodeUuid: 'node-1',
      input: {}
    })
    expect(store.getState().preflight?.canRun).toBe(true)
    expect(store.getState().status).toBe('ready')

    await store.getState().inspectNodeJob('job-1')
    expect(store.getState().viewModel?.nodeJob?.jobUuid).toBe('job-1')
  })
})
