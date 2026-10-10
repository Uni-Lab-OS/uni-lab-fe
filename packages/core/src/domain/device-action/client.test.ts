import { describe, expect, it } from 'vitest'
import { DeviceActionClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

describe('DeviceActionClient', () => {
  it('uses the node template catalog routes', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        return {
          status: 200,
          headers: {},
          data: request.url.includes('?')
            ? {
                items: [
                  {
                    uuid: 'action-1',
                    resource_template: { uuid: 'device-template-1' },
                    name: 'pipette',
                    display_name: 'Pipette',
                    type: 'device_action',
                    node_type: 'device_action',
                  },
                ],
              }
            : {
                template: {
                  uuid: 'action-1',
                  resource_template_uuid: 'device-template-1',
                  name: 'pipette',
                  display_name: 'Pipette',
                  type: 'device_action',
                  node_type: 'device_action',
                  schema: {},
                  goal: {},
                  goal_default: {},
                },
                handles: [],
              },
        } as TransportResponse<Value>
      },
    }

    const client = new DeviceActionClient(transport)
    const summaries = await client.listActionDefinitions({ page: 2, pageSize: 20 })
    const detail = await client.getActionDefinition('action/1')

    expect(requests[0]?.url).toBe(
      '/api/v1/workflow-node-templates?page=2&page_size=20&node_type=device_action',
    )
    expect(requests[1]?.url).toBe('/api/v1/workflow-node-templates/action%2F1')
    expect(summaries[0]?.actionUuid).toBe('action-1')
    expect(detail.actionUuid).toBe('action-1')
  })

  it('reads devices and serializes an action run at the domain boundary', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        return {
          status: 200,
          headers: {},
          data:
            request.url === '/api/v1/devices'
              ? {
                  code: 0,
                  data: [
                    {
                      material: {
                        uuid: 'material-1',
                        resource_template_uuid: 'device-template-1',
                      },
                      binding: { local_id: 'robot-1', edge_uuid: 'edge-1' },
                      actions: [],
                    },
                  ],
                }
              : {
                  code: 0,
                  data: {
                    created: true,
                    task: { uuid: 'task-1' },
                    job: { uuid: 'job-1' },
                  },
                },
        } as TransportResponse<Value>
      },
    }

    const client = new DeviceActionClient(transport)
    await expect(client.listDevices()).resolves.toHaveLength(1)
    await expect(
      client.createActionRun({
        materialUuid: 'material-1',
        workflowNodeTemplateUuid: 'action-1',
        param: { durationSeconds: 5 },
        executionPolicy: { mode: 'queue' },
        idempotencyKey: 'request-1',
        metadata: { source: 'device-debug' },
      }),
    ).resolves.toMatchObject({ taskUuid: 'task-1', jobUuid: 'job-1' })

    expect(requests[0]).toMatchObject({ method: 'GET', url: '/api/v1/devices' })
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: '/api/v1/device-action-runs',
      body: {
        material_uuid: 'material-1',
        workflow_node_template_uuid: 'action-1',
        param: { durationSeconds: 5 },
        execution_policy: { mode: 'queue' },
        idempotency_key: 'request-1',
        meta_data: { source: 'device-debug' },
      },
    })
  })

  it('falls back to the authoring device catalog when the runtime device list is empty', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        if (request.url === '/api/v1/devices') {
          return {
            status: 200,
            headers: {},
            data: { code: 0, data: [] },
          } as TransportResponse<Value>
        }
        if (request.url === '/api/v1/authoring/device-catalog') {
          return {
            status: 200,
            headers: {},
            data: {
              code: 0,
              data: {
                items: [
                  {
                    id: 'szlab_mixer_stirrer',
                    materialUuid: 'material-runtime-1',
                    deviceTypeId: 'community.szlab_poly_studio.szlab_mixer_stirrer',
                    deviceKey: '/devices/szlab_mixer_stirrer/szlab_mixer_stirrer',
                    namespace: '/devices/szlab_mixer_stirrer',
                    name: 'S04 磁搅',
                    online: false,
                    actions: [
                      {
                        id: 'run_stirring',
                        actionRef: 'szlab_mixer_stirrer.run_stirring',
                        name: '运行搅拌',
                        typeName: 'UniLabJsonCommand',
                        busy: false,
                        inputSchema: {
                          type: 'object',
                          properties: { duration: { type: 'number' } },
                        },
                        outputSchema: { type: 'object' },
                      },
                    ],
                  },
                ],
              },
            },
          } as TransportResponse<Value>
        }
        return {
          status: 200,
          headers: {},
          data: {
            code: 0,
            data: {
              items: [
                {
                  uuid: 'template-run-stirring',
                  resource_template: { uuid: 'device-template-1' },
                  name: 'run_stirring',
                  display_name: '运行搅拌',
                  type: 'UniLabJsonCommand',
                  node_type: 'ILab',
                },
              ],
            },
          },
        } as TransportResponse<Value>
      },
    }

    const client = new DeviceActionClient(transport)
    await expect(client.listDevices()).resolves.toMatchObject([
      {
        deviceUuid: 'material-runtime-1',
        label: 'S04 磁搅',
        online: null,
        dispatchable: null,
        actions: [
          {
            actionName: 'run_stirring',
            actionDefinitionUuid: 'template-run-stirring',
            actionRef: 'szlab_mixer_stirrer.run_stirring',
            isBusy: null,
            busyStatusKnown: false,
            currentJobUuid: null,
          },
        ],
      },
    ])
    expect(requests.map((request) => request.url)).toEqual([
      '/api/v1/devices',
      '/api/v1/authoring/device-catalog',
      '/api/v1/workflow-node-templates?page=1&page_size=200',
    ])
  })

  it('composes action run reads from the standard task and job port', async () => {
    const executionRead = {
      async getTaskDetail(taskUuid) {
        return {
          kind: 'task_runtime_detail',
          source: 'os',
          taskUuid,
          workflowUuid: null,
          executionKind: 'device_action',
          status: 'pending',
          runMode: 'single_action',
          controlStatus: 'active',
          cleanupStatus: 'none',
          createdAt: 'now',
          updatedAt: 'now',
          raw: {},
        }
      },
      async listTaskJobs(taskUuid) {
        return [
          {
            kind: 'task_job_summary',
            source: 'os',
            jobUuid: 'job-1',
            workflowNodeUuid: 'node-1',
            topologicalIndex: 0,
            executorKind: 'device',
            status: 'pending',
            attempt: 0,
            currentAttempt: true,
            controlData: {},
            errorInfo: [],
            waitReason: {},
            expectedChangeSet: {},
            raw: { taskUuid },
          },
        ]
      },
    }
    const client = new DeviceActionClient(
      {
        request: async () => {
          throw new Error('transport should not be used')
        },
      },
      executionRead,
    )

    await expect(client.getActionRun('task-1')).resolves.toMatchObject({
      kind: 'device_action_run_view',
      task: { taskUuid: 'task-1' },
      job: { jobUuid: 'job-1' },
    })
  })

  it('rejects action runs whose task projection has zero or multiple jobs', async () => {
    const task = {
      kind: 'task_runtime_detail',
      source: 'os',
      taskUuid: 'task-1',
      workflowUuid: null,
      executionKind: 'device_action',
      status: 'pending',
      runMode: 'single_action',
      controlStatus: 'active',
      cleanupStatus: 'none',
      createdAt: 'now',
      updatedAt: 'now',
      raw: {},
    } as const
    const executionRead = {
      async getTaskDetail() { return task },
      async listTaskJobs() { return [] },
    }
    const client = new DeviceActionClient({ request: async () => { throw new Error('unused') } }, executionRead)
    await expect(client.getActionRun('task-1')).rejects.toMatchObject({
      code: 'INVALID_ACTION_RUN_RESPONSE',
    })

    const multipleJobsClient = new DeviceActionClient({ request: async () => { throw new Error('unused') } }, {
      async getTaskDetail() { return task },
      async listTaskJobs() { return [{}, {}] },
    } as never)
    await expect(multipleJobsClient.getActionRun('task-1')).rejects.toMatchObject({
      code: 'INVALID_ACTION_RUN_RESPONSE',
    })
  })
})
