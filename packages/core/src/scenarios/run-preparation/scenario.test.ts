import { describe, expect, it } from 'vitest'
import { createRunPreparationScenario } from './scenario'
import type { WorkflowDefinitionPort } from '../../domain/workflow-definition/port'
import type { RunPreparationPort } from '../../domain/run-preparation/port'
import type { DeviceActionPort } from '../../domain/device-action/port'
import type { MaterialSitePort } from '../../domain/material-site/port'
import type { ReagentInventoryPort } from '../../domain/reagent-inventory/port'

describe('run preparation scenario', () => {
  it('loads a revision through a port and creates a scenario view model', async () => {
    const port: WorkflowDefinitionPort = {
      async listPublishedRevisions() {
        return []
      },
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
            inventoryRequirements: [],
          },
        }
      },
    }

    const runPreparation: RunPreparationPort = {
      async requestPreflight() {
        throw new Error('not used')
      },
      async submitRun() {
        throw new Error('not used')
      },
      async getNodeJobDetail(jobUuid) {
        return {
          kind: 'node_job_detail',
          source: 'fixture',
          jobUuid,
          workflowTaskUuid: 'task-1',
          workflowNodeUuid: 'node-1',
          executorKind: 'device',
          logicalStatus: 'running',
          attempt: 1,
          raw: {},
        }
      },
    }

    const view = await createRunPreparationScenario(port, runPreparation).load('wf-1', {
      configuration: { runMode: 'normal', input: {} },
      binding: { source: 'fixture', inventoryBindings: [], selectedResources: {} },
    })

    expect(view.kind).toBe('run_preparation')
    expect(view.revision.workflowUuid).toBe('wf-1')
    const inspected = await createRunPreparationScenario(port, runPreparation).inspectNodeJob(
      view,
      'job-1',
    )
    expect(inspected.nodeJob).toMatchObject({ jobUuid: 'job-1', workflowTaskUuid: 'task-1' })
  })

  it('projects available resource facts as candidates without changing the binding draft', async () => {
    const workflowDefinitions: WorkflowDefinitionPort = {
      async listPublishedRevisions() {
        return []
      },
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
            inventoryRequirements: [],
          },
        }
      },
    }
    const runPreparation: RunPreparationPort = {
      async requestPreflight() {
        throw new Error('not used')
      },
      async submitRun() {
        throw new Error('not used')
      },
      async getNodeJobDetail() {
        throw new Error('not used')
      },
    }
    const deviceActions = {
      async listDevices() {
        return [
          {
            kind: 'device_summary',
            source: 'fixture',
            deviceUuid: 'device-1',
            materialUuid: 'material-device-1',
            resourceTemplateUuid: 'template-1',
            deviceKey: 'liquid-handler-1',
            namespace: 'fixture',
            label: 'Liquid handler',
            online: true,
            edgeStatus: 'ready',
            dispatchable: true,
            dispatchBlockReason: null,
            executionOccupancies: [],
            actions: [],
            raw: {},
          },
        ]
      },
    } satisfies Pick<DeviceActionPort, 'listDevices'>
    const materialSite = {
      async getGraph() {
        return {
          kind: 'material_graph',
          source: 'fixture',
          raw: {},
          nodes: [
            {
              material: {
                kind: 'material_summary',
                source: 'fixture',
                materialUuid: 'material-1',
                resourceTemplateUuid: 'template-1',
                materialType: null,
                className: null,
                parentMaterialUuid: null,
                barcode: null,
                name: 'Plate',
                description: null,
                revision: 1,
                config: {},
                metadata: {},
                createdAt: null,
                updatedAt: 'now',
                raw: {},
              },
              resourceTemplate: null,
              relativePosition: null,
              currentSiteUuid: null,
              raw: {},
              sites: [
                {
                  kind: 'site',
                  source: 'fixture',
                  siteUuid: 'site-1',
                  ownerMaterialUuid: 'material-1',
                  key: 'A1',
                  name: 'A1',
                  sortOrder: 1,
                  allowedResourceTemplateUuids: null,
                  occupancy: { known: true, occupiedMaterialUuid: null },
                  geometry: null,
                  metadata: {},
                  raw: {},
                },
              ],
            },
          ],
        }
      },
    } satisfies Pick<MaterialSitePort, 'getGraph'>
    const reagentInventory = {
      async listInventoryInstances() {
        return [
          {
            instanceUuid: 'inventory-1',
            legacyCloudId: null,
            lotId: 'lot-1',
            templateId: 'template-1',
            barcode: 'tube-1',
            status: 'available',
            version: 1,
            parentUuid: null,
            raw: {},
          },
        ]
      },
    } satisfies Pick<ReagentInventoryPort, 'listInventoryInstances'>

    const binding = { source: 'fixture' as const, inventoryBindings: [], selectedResources: {} }
    const view = await createRunPreparationScenario(workflowDefinitions, runPreparation, {
      deviceActions,
      materialSite,
      reagentInventory,
    }).load('wf-1', {
      configuration: { runMode: 'normal', input: {} },
      binding,
    })

    expect(view.candidates).toEqual([
      expect.objectContaining({ id: 'device-1', resourceKind: 'device', status: 'available' }),
      expect.objectContaining({ id: 'material-1', resourceKind: 'material', observedAt: 'now' }),
      expect.objectContaining({ id: 'site-1', resourceKind: 'site', status: 'available' }),
      expect.objectContaining({
        id: 'inventory-1',
        resourceKind: 'inventory',
        status: 'available',
      }),
    ])
    expect(view.binding).toBe(binding)
  })

  it('keeps revision loading available when an optional candidate source fails', async () => {
    const workflowDefinitions: WorkflowDefinitionPort = {
      async listPublishedRevisions() {
        return []
      },
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
            inventoryRequirements: [],
          },
        }
      },
    }
    const runPreparation: RunPreparationPort = {
      async requestPreflight() {
        throw new Error('not used')
      },
      async submitRun() {
        throw new Error('not used')
      },
      async getNodeJobDetail() {
        throw new Error('not used')
      },
    }
    const view = await createRunPreparationScenario(workflowDefinitions, runPreparation, {
      materialSite: {
        async getGraph() {
          throw new Error('catalog unavailable')
        },
      },
    }).load('wf-1', {
      configuration: { runMode: 'normal', input: {} },
      binding: { source: 'fixture', inventoryBindings: [], selectedResources: {} },
    })

    expect(view.revision.workflowUuid).toBe('wf-1')
    expect(view.candidates).toEqual([])
    expect(view.candidateIssues).toEqual([
      {
        kind: 'resource_candidate_issue',
        resourceKind: 'material',
        message: 'catalog unavailable',
      },
    ])
  })
})
