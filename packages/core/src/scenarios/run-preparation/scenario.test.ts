import { describe, expect, it } from 'vitest'
import { createRunPreparationScenario } from './scenario'
import type { WorkflowDefinitionPort } from '../../domain/workflow-definition/port'
import type { RunPreparationPort } from '../../domain/run-preparation/port'
import type { DeviceActionPort } from '../../domain/device-action/port'
import type { MaterialSitePort } from '../../domain/material-site/port'
import type { ReagentInventoryPort } from '../../domain/reagent-inventory/port'
import type { Reagent } from '../../domain/reagent-inventory/model'

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
          {
            kind: 'device_summary',
            source: 'fixture',
            deviceUuid: 'device-2',
            materialUuid: 'material-device-2',
            resourceTemplateUuid: 'template-2',
            deviceKey: 'offline-device',
            namespace: 'fixture',
            label: 'Offline device',
            online: false,
            edgeStatus: 'offline',
            dispatchable: false,
            dispatchBlockReason: '设备离线',
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
                {
                  kind: 'site',
                  source: 'fixture',
                  siteUuid: 'site-2',
                  ownerMaterialUuid: 'material-1',
                  key: 'B1',
                  name: 'B1',
                  sortOrder: 2,
                  allowedResourceTemplateUuids: null,
                  occupancy: { known: true, occupiedMaterialUuid: 'material-child' },
                  geometry: null,
                  metadata: {},
                  raw: {},
                },
                {
                  kind: 'site',
                  source: 'fixture',
                  siteUuid: 'site-3',
                  ownerMaterialUuid: 'material-1',
                  key: 'C1',
                  name: '',
                  sortOrder: 3,
                  allowedResourceTemplateUuids: null,
                  occupancy: { known: false, occupiedMaterialUuid: null },
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
      async listReagents() {
        const reagent: Reagent = {
          kind: 'reagent',
          source: 'fixture',
          reagentUuid: 'reagent-1',
          materialUuid: 'material-1',
          reagentInfoUuid: 'reagent-info-1',
          name: '乙醇',
          nameEn: null,
          cas: null,
          molecularFormula: null,
          physicalState: 'liquid',
          quantity: 10,
          quantityUnit: 'mL',
          reservedQuantity: 0,
          concentrationValue: null,
          concentrationUnit: null,
          densityGPerMl: null,
          densitySource: null,
          revision: 1,
          materialRevision: 1,
          containerBarcode: 'tube-1',
          containerName: '来源容器 R1C4',
          maximumCapacity: null,
          configuredCapacity: null,
          ratedCapacity: null,
          reagentInfo: null,
          description: null,
          metadata: {},
          createdAt: null,
          updatedAt: 'now',
          status: 'available',
          raw: {},
        }
        return { items: [reagent], total: 1, page: 1, pageSize: 1000, raw: {} }
      },
    } satisfies Pick<ReagentInventoryPort, 'listInventoryInstances' | 'listReagents'>

    const binding = { source: 'fixture' as const, inventoryBindings: [], selectedResources: {} }
    const view = await createRunPreparationScenario(workflowDefinitions, runPreparation, {
      deviceActions,
      materialSite,
      reagentInventory,
    }).load('wf-1', {
      configuration: { runMode: 'normal', input: {} },
      binding,
    })

    expect(view.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'device-1', resourceKind: 'device', status: 'available' }),
        expect.objectContaining({ id: 'device-2', resourceKind: 'device', status: 'offline' }),
        expect.objectContaining({
          id: 'reagent-1',
          resourceKind: 'inventory',
          label: '乙醇',
          metadata: expect.objectContaining({ container_name: '来源容器 R1C4' }),
        }),
        expect.objectContaining({
          id: 'material-1',
          resourceKind: 'material',
          observedAt: 'now',
          metadata: expect.objectContaining({ reagent_name: '乙醇' }),
        }),
        expect.objectContaining({ id: 'site-1', resourceKind: 'site', status: 'available' }),
        expect.objectContaining({ id: 'site-2', resourceKind: 'site', status: 'occupied' }),
        expect.objectContaining({ id: 'site-3', resourceKind: 'site', label: 'C1', status: 'unknown' }),
        expect.objectContaining({
          id: 'inventory-1',
          resourceKind: 'inventory',
          status: 'available',
        }),
      ]),
    )
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
