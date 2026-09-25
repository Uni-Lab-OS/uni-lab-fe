import { describe, expect, it } from 'vitest'
import { DeviceActionClient } from '../domain/device-action/client'
import { EvidenceInterventionClient } from '../domain/evidence-intervention/client'
import { MaterialSiteClient } from '../domain/material-site/client'
import { ReagentInventoryClient } from '../domain/reagent-inventory/client'
import { WorkflowExecutionReadClient } from '../domain/workflow-execution-read/client'
import type {
  RequestTransport,
  TransportRequest,
  TransportResponse
} from '../transport/request'

/**
 * Formal OS wire contracts for the remaining Domain seams.
 *
 * These are deliberately transport-level tests: the payloads mirror the OS
 * `{ code, data }` envelope and assert that Domain clients own route/query/
 * DTO projection while the generic adapter remains unaware of OS semantics.
 */
describe('OS adapter contracts: domain seams', () => {
  it('covers Device & Action catalog, resource contract, occupancy and command', async () => {
    const transport = new DomainContractTransport()
    const client = new DeviceActionClient(transport)

    const devices = await client.listDevices()
    const definitions = await client.listActionDefinitions({ page: 2, pageSize: 20 })
    const definition = await client.getActionDefinition('action/1')
    const accepted = await client.createActionRun({
      materialUuid: 'device-material-1',
      workflowNodeTemplateUuid: 'action-1',
      param: { volume: 10 },
      executionPolicy: { mode: 'queue' },
      idempotencyKey: 'action-request-1',
      description: 'contract action',
      metadata: { source: 'contract' }
    })

    expect(devices).toMatchObject([{
      deviceUuid: 'device-material-1',
      namespace: 'edge-1',
      dispatchable: false,
      dispatchBlockReason: 'occupied',
      executionOccupancies: [{ workflowNodeJobUuid: 'job-1', state: 'running' }],
      actions: [{ actionName: 'aspirate', isBusy: true, busyStatusKnown: true }]
    }])
    expect(definitions).toMatchObject([{
      actionUuid: 'action-1',
      resourceTemplateUuid: 'device-template-1'
    }])
    expect(definition).toMatchObject({
      actionUuid: 'action-1',
      handles: [{ handleKey: 'source', editorControl: 'material_port' }],
      resourceContract: {
        version: 1,
        requiredDeviceParams: ['device'],
        resourceParams: [{ param: 'device', role: 'device' }]
      }
    })
    expect(accepted).toMatchObject({
      created: true,
      taskUuid: 'task-action-1',
      jobUuid: 'job-action-1'
    })

    expect(transport.requests.map(({ method, url }) => [method, url])).toEqual([
      ['GET', '/api/v1/devices'],
      ['GET', '/api/v1/workflow-node-templates?page=2&page_size=20&node_type=device_action'],
      ['GET', '/api/v1/workflow-node-templates/action%2F1'],
      ['POST', '/api/v1/device-action-runs']
    ])
    expect(transport.requests[3]?.body).toEqual({
      material_uuid: 'device-material-1',
      workflow_node_template_uuid: 'action-1',
      param: { volume: 10 },
      execution_policy: { mode: 'queue' },
      idempotency_key: 'action-request-1',
      description: 'contract action',
      meta_data: { source: 'contract' }
    })
  })

  it('covers Material & Site graph, owner relation and geometry projection', async () => {
    const transport = new DomainContractTransport()
    const client = new MaterialSiteClient(transport)

    const materials = await client.listMaterials({
      page: 2,
      pageSize: 10,
      name: 'Vial A',
      barcode: 'BC/1',
      resourceTemplateUuid: 'template-1'
    })
    const graph = await client.getGraph()
    const detail = await client.getMaterial('material/1')
    const sites = await client.listSites('material/1')
    const site = await client.getSite('site/1')

    expect(materials).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 10,
      items: [{ materialUuid: 'material-1', resourceTemplateUuid: 'template-1' }]
    })
    expect(graph).toMatchObject({
      nodes: [{
        material: { materialUuid: 'material-1' },
        currentSiteUuid: 'site-1',
        sites: [{ siteUuid: 'site-1', ownerMaterialUuid: 'material-1', occupancy: {
          known: true,
          occupiedMaterialUuid: null
        } }]
      }]
    })
    expect(detail).toMatchObject({
      materialUuid: 'material-1',
      relativePosition: { positionMm: [1, 2, 3] },
      sites: [{ siteUuid: 'site-1' }]
    })
    expect(sites).toMatchObject([{ siteUuid: 'site-1', ownerMaterialUuid: 'material/1' }])
    expect(site).toMatchObject({ siteUuid: 'site/1', geometry: {
      positionMm: [1, 2, 3],
      sizeMm: [10, 20, 30]
    } })

    expect(transport.requests.map(({ method, url }) => [method, url])).toEqual([
      ['GET', '/api/v1/materials?page=2&page_size=10&name=Vial+A&barcode=BC%2F1&resource_template_uuid=template-1'],
      ['GET', '/api/v1/materials/graph'],
      ['GET', '/api/v1/materials/material%2F1'],
      ['GET', '/api/v1/materials/material%2F1/sites'],
      ['GET', '/api/v1/sites/site%2F1']
    ])
  })

  it('covers Backend reagent and Edge inventory routes through OS envelopes', async () => {
    const transport = new DomainContractTransport()
    const client = new ReagentInventoryClient(transport)

    const infos = await client.listReagentInfos({ page: 2, pageSize: 10, name: '乙腈', cas: '75-05-8', physicalState: 'liquid' })
    const info = await client.getReagentInfo('info/1')
    const reagents = await client.listReagents({ materialUuid: 'material-1', reagentInfoUuid: 'info-1', keyword: '乙腈', cas: '75-05-8', barcode: 'R/1' })
    const reagent = await client.getReagent('reagent/1')
    const instances = await client.listInventoryInstances()
    const instance = await client.getInventoryInstance('instance/1')
    const lots = await client.listInventoryLots()
    const lot = await client.getInventoryLot('lot/1')
    const snapshot = await client.getInventorySnapshot()

    expect(infos).toMatchObject({ items: [{ reagentInfoUuid: 'info-1', physicalState: 'liquid' }], page: 2, pageSize: 10 })
    expect(info).toMatchObject({ reagentInfoUuid: 'info-1', name: '乙腈' })
    expect(reagents).toMatchObject({ items: [{ reagentUuid: 'reagent-1', quantity: 4, status: 'available' }] })
    expect(reagent).toMatchObject({ reagentUuid: 'reagent-1', reservedQuantity: 1 })
    expect(instances).toMatchObject([{ instanceUuid: 'instance-1', status: 'available' }])
    expect(instance).toMatchObject({ instanceUuid: 'instance/1', templateId: 'vial' })
    expect(lots).toMatchObject([{ lotId: 'lot-1', status: 'available' }])
    expect(lot).toMatchObject({ lotId: 'lot/1', status: 'available' })
    expect(snapshot).toMatchObject({
      snapshotSequence: 7,
      templates: [{ templateId: 'vial' }],
      lots: [{ lotId: 'lot-1' }],
      instances: [{ instanceUuid: 'instance-1' }]
    })

    expect(transport.requests.map(({ method, url }) => [method, url])).toEqual([
      ['GET', '/api/v1/reagent-infos?page=2&page_size=10&name=%E4%B9%99%E8%85%88&cas=75-05-8&physical_state=liquid'],
      ['GET', '/api/v1/reagent-infos/info%2F1'],
      ['GET', '/api/v1/reagents?page=1&page_size=100&material_uuid=material-1&reagent_info_uuid=info-1&keyword=%E4%B9%99%E8%85%88&cas=75-05-8&barcode=R%2F1'],
      ['GET', '/api/v1/reagents/reagent%2F1'],
      ['GET', '/api/v1/inventory/instances'],
      ['GET', '/api/v1/inventory/instances/instance%2F1'],
      ['GET', '/api/v1/inventory/lots'],
      ['GET', '/api/v1/inventory/lots/lot%2F1'],
      ['GET', '/api/v1/inventory/snapshot']
    ])
  })

  it('covers Evidence & Intervention read states and execution list projections', async () => {
    const transport = new DomainContractTransport()
    const interventions = new EvidenceInterventionClient(transport)
    const execution = new WorkflowExecutionReadClient(transport)

    const open = await interventions.listInterventions({ status: 'open', limit: 20 })
    const intervention = await interventions.getIntervention('intervention/1')
    const tasks = await execution.listTasks({ page: 2, pageSize: 10, workflowUuid: 'workflow-1', executionKind: 'workflow', status: 'running', cleanupStatus: 'none' })
    const presentations = await execution.listTaskPresentations({ view: 'matrix', terminalLimit: 5, status: 'running' })

    expect(open).toMatchObject([{
      interventionUuid: 'intervention-1',
      deliveryStatus: 'unknown',
      options: [{ id: 'retry' }]
    }])
    expect(intervention).toMatchObject({
      interventionUuid: 'intervention/1',
      selectedOptionId: 'retry',
      deliveryStatus: 'accepted'
    })
    expect(tasks).toMatchObject({ page: 2, pageSize: 10, items: [{ taskUuid: 'task-1', status: 'running' }] })
    expect(presentations).toMatchObject({ items: [{ taskUuid: 'task-1', jobs: [{ jobUuid: 'job-1' }] }] })

    expect(transport.requests.map(({ method, url }) => [method, url])).toEqual([
      ['GET', '/api/v1/workflow-interventions?status=open&limit=20'],
      ['GET', '/api/v1/workflow-interventions/intervention%2F1'],
      ['GET', '/api/v1/workflow-tasks?page=2&page_size=10&workflow_uuid=workflow-1&execution_kind=workflow&status=running&cleanup_status=none'],
      ['GET', '/api/v1/workflow-task-presentations?page=1&page_size=20&status=running&view=matrix&terminal_limit=5']
    ])
  })

  it('maps OS business errors consistently across every Domain adapter', async () => {
    const transport = new RejectedDomainContractTransport()
    const device = new DeviceActionClient(transport)
    const material = new MaterialSiteClient(transport)
    const reagent = new ReagentInventoryClient(transport)
    const intervention = new EvidenceInterventionClient(transport)
    const execution = new WorkflowExecutionReadClient(transport)

    await expect(device.listDevices()).rejects.toMatchObject({ code: 'OS_REQUEST_REJECTED' })
    await expect(material.getGraph()).rejects.toMatchObject({ code: 'OS_REQUEST_REJECTED' })
    await expect(reagent.listInventoryLots()).rejects.toMatchObject({ code: 'OS_REQUEST_REJECTED' })
    await expect(intervention.listInterventions()).rejects.toMatchObject({ code: 'OS_REQUEST_REJECTED' })
    await expect(execution.listTasks()).rejects.toMatchObject({ code: 'OS_REQUEST_REJECTED' })
  })
})

class DomainContractTransport implements RequestTransport {
  readonly requests: TransportRequest[] = []

  async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
    this.requests.push(request)
    return { status: 200, headers: {}, data: responseFor(request) as Value }
  }
}

class RejectedDomainContractTransport implements RequestTransport {
  async request<Value>(_request: TransportRequest): Promise<TransportResponse<Value>> {
    return {
      status: 200,
      headers: {},
      data: {
        code: 3003,
        error: { code: 'domain_unavailable', msg: 'domain is temporarily unavailable' }
      } as Value
    }
  }
}

function responseFor(request: TransportRequest): unknown {
  const { url } = request
  if (url === '/api/v1/devices') return envelope({
    items: [{
      material: { uuid: 'device-material-1', resource_template_uuid: 'device-template-1', name: 'Robot' },
      binding: { local_id: 'robot-1', edge_uuid: 'edge-1' },
      online: true,
      edge_status: 'ready',
      dispatchable: false,
      dispatch_block_reason: 'occupied',
      execution_occupancies: [{ workflow_node_job_uuid: 'job-1', state: 'running', action_name: 'aspirate' }],
      actions: [{ name: 'aspirate', type: 'pipette', is_busy: true, current_job_uuid: 'job-1' }]
    }]
  })
  if (url.startsWith('/api/v1/workflow-node-templates?')) return envelope({
    items: [{
      uuid: 'action-1', resource_template_uuid: 'device-template-1', name: 'aspirate',
      display_name: 'Aspirate', type: 'pipette', node_type: 'device_action'
    }],
    total: 1, page: 2, page_size: 20, has_more: false
  })
  if (url === '/api/v1/workflow-node-templates/action%2F1') return envelope({
    template: {
      uuid: 'action-1', resource_template_uuid: 'device-template-1', name: 'aspirate',
      display_name: 'Aspirate', type: 'pipette', node_type: 'device_action', class: 'Pipette',
      schema: { type: 'object' }, goal: { volume: { type: 'number' } }, goal_default: { volume: 1 },
      meta_data: { unilab: { resource_contract: {
        version: 1, resource_params: [{ param: 'device', role: 'device' }], required_device_params: ['device']
      } } }
    },
    handles: [{ uuid: 'handle-1', workflow_node_template_uuid: 'action-1', handle_key: 'source',
      io_type: 'source', display_name: 'Source', type: 'material', required: true,
      data_source: null, data_key: null, value_schema: {}, editor_control: 'material_port',
      allowed_resource_template_uuids: null, implicit_passthrough: false, structural_role: null }]
  })
  if (url === '/api/v1/device-action-runs') return envelope({
    created: true, task: { uuid: 'task-action-1' }, job: { uuid: 'job-action-1' }
  })

  if (url.startsWith('/api/v1/materials?')) return envelope({
    items: [{ uuid: 'material-1', resource_template_uuid: 'template-1', name: 'Vial A', config: {}, data: {}, meta_data: {} }],
    total: 1, page: 2, page_size: 10
  })
  if (url === '/api/v1/materials/graph') return envelope({
    nodes: [{
      material: { uuid: 'material-1', resource_template_uuid: 'template-1', name: 'Vial A' },
      resource_template: { uuid: 'template-1', name: 'Vial', display_name: 'Vial', resource_type: 'container' },
      relative_position: { material_uuid: 'material-1', position_x: 1, position_y: 2, position_z: 3 },
      current_site_uuid: 'site-1',
      sites: [{ uuid: 'site-1', material_uuid: 'material-1', name: 'A1', occupied_material_uuid: null, meta_data: { key: 'A1' } }]
    }]
  })
  if (url === '/api/v1/materials/material%2F1') return envelope({
    uuid: 'material-1', resource_template_uuid: 'template-1', name: 'Vial A',
    relative_position: { position_x: 1, position_y: 2, position_z: 3 },
    sites: [{ uuid: 'site-1', material_uuid: 'material-1', name: 'A1' }], current_site: null
  })
  if (url === '/api/v1/materials/material%2F1/sites') return envelope([
    { uuid: 'site-1', material_uuid: 'material/1', name: 'A1' }
  ])
  if (url === '/api/v1/sites/site%2F1') return envelope({
    uuid: 'site/1', material_uuid: 'material-1', name: 'A1',
    position_x: 1, position_y: 2, position_z: 3, width: 10, depth: 20, length: 30,
    rotation_x: 0, rotation_y: 0, rotation_z: 0
  })

  if (url.startsWith('/api/v1/reagent-infos?')) return envelope({
    items: [{ uuid: 'info-1', name: '乙腈', aliases: [], physical_state: 'liquid' }],
    total: 1, page: 2, page_size: 10
  })
  if (url === '/api/v1/reagent-infos/info%2F1') return envelope({ uuid: 'info-1', name: '乙腈', aliases: [], physical_state: 'liquid' })
  if (url.startsWith('/api/v1/reagents?')) return envelope({
    items: [{ uuid: 'reagent-1', material_uuid: 'material-1', reagent_info_uuid: 'info-1', name: '乙腈', quantity: 4, active_workflow_reserved_quantity: 1, meta_data: {}, revision: 1 }],
    total: 1, page: 1, page_size: 100
  })
  if (url === '/api/v1/reagents/reagent%2F1') return envelope({
    uuid: 'reagent-1', material_uuid: 'material-1', reagent_info_uuid: 'info-1', name: '乙腈', quantity: 4, active_workflow_reserved_quantity: 1, meta_data: {}, revision: 1
  })
  if (url === '/api/v1/inventory/instances') return envelope({ instances: [{ edge_uuid: 'instance-1', template_id: 'vial', status: 'available', version: 1 }] })
  if (url === '/api/v1/inventory/instances/instance%2F1') return envelope({ edge_uuid: 'instance/1', template_id: 'vial', status: 'available', version: 1 })
  if (url === '/api/v1/inventory/lots') return envelope({ lots: [{ lot_id: 'lot-1', template_id: 'vial', quantity_total: 5, quantity_available: 4, quantity_reserved: 1, version: 1 }] })
  if (url === '/api/v1/inventory/lots/lot%2F1') return envelope({ lot_id: 'lot/1', template_id: 'vial', quantity_total: 5, quantity_available: 4, quantity_reserved: 1, version: 1 })
  if (url === '/api/v1/inventory/snapshot') return envelope({
    snapshot_sequence: 7,
    templates: [{ template_id: 'vial', name: 'Vial', category: 'container' }],
    lots: [{ lot_id: 'lot-1', template_id: 'vial', quantity_total: 5, quantity_available: 4, quantity_reserved: 1 }],
    instances: [{ edge_uuid: 'instance-1', template_id: 'vial', status: 'available' }],
    relations: [], contents: [], reservations: []
  })

  if (url === '/api/v1/workflow-interventions?status=open&limit=20') return envelope({ items: [intervention('intervention-1', 'unknown', null)] })
  if (url === '/api/v1/workflow-interventions/intervention%2F1') return envelope(intervention('intervention/1', 'accepted', 'retry'))
  if (url.startsWith('/api/v1/workflow-tasks?')) return envelope({
    items: [task('task-1')], total: 1, page: 2, page_size: 10, has_more: false
  })
  if (url.startsWith('/api/v1/workflow-task-presentations?')) return envelope({
    items: [{ ...task('task-1'), jobs: [job('job-1')] }], total: 1, page: 1, page_size: 20
  })
  throw new Error(`Unexpected OS domain contract request: ${request.method} ${request.url}`)
}

function envelope(data: unknown): unknown {
  return { code: 0, data }
}

function intervention(uuid: string, deliveryStatus: string, selectedOptionId: string | null): Record<string, unknown> {
  return {
    uuid, workflow_task_uuid: 'task-1', workflow_node_job_uuid: 'job-1', edge_command_uuid: null,
    revision: 1, status: selectedOptionId ? 'selected' : 'open', options: [{ id: 'retry' }],
    resume_control_status: 'active', selected_option_id: selectedOptionId, selected_option: selectedOptionId ? { id: selectedOptionId } : {},
    delivery_status: deliveryStatus, description: null, meta_data: {}, opened_at: '2026-09-25T00:00:00Z',
    create_time: '2026-09-25T00:00:00Z', update_time: '2026-09-25T00:00:01Z', decided_at: null, delivered_at: null
  }
}

function task(uuid: string): Record<string, unknown> {
  return {
    uuid, workflow_uuid: 'workflow-1', execution_kind: 'workflow', status: 'running', run_mode: 'normal',
    control_status: 'active', cleanup_status: 'none', create_time: '2026-09-25T00:00:00Z', update_time: '2026-09-25T00:01:00Z'
  }
}

function job(uuid: string): Record<string, unknown> {
  return {
    uuid, workflow_node_uuid: 'node-1', topological_index: 0, executor_kind: 'device_action', status: 'running',
    attempt: 1, current_attempt: true, control_data: {}, error_info: [], wait_reason: {}, expected_change_set: {},
    finished_at: null
  }
}
