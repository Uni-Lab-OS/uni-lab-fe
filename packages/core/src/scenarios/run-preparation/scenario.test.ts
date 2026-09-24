import { describe, expect, it } from 'vitest'
import { createRunPreparationScenario } from './scenario'
import type { WorkflowDefinitionPort } from '../../domain/workflow-definition/port'
import type { RunPreparationPort } from '../../domain/run-preparation/port'

describe('run preparation scenario', () => {
  it('loads a revision through a port and creates a scenario view model', async () => {
    const port: WorkflowDefinitionPort = {
      async listPublishedRevisions() { return [] },
      async getPublishedRevision() {
        return {
          kind: 'published_revision',
          source: 'fixture',
          workflowUuid: 'wf-1',
          name: 'Fixture',
          revision: 1,
          workflowType: 'workflow',
          status: 'published',
          graph: {
            workflow: {},
            nodes: [],
            edges: [],
            nodeTemplates: [],
            handleTemplates: [],
            inventoryRequirements: []
          }
        }
      }
    }

    const runPreparation: RunPreparationPort = {
      async requestPreflight() { throw new Error('not used') },
      async submitRun() { throw new Error('not used') },
      async getNodeJobDetail() { throw new Error('not used') }
    }

    const view = await createRunPreparationScenario(port, runPreparation).load('wf-1', {
      configuration: { runMode: 'normal', input: {} },
      binding: { source: 'fixture', inventoryBindings: [], selectedResources: {} }
    })

    expect(view.kind).toBe('run_preparation')
    expect(view.revision.workflowUuid).toBe('wf-1')
  })
})
