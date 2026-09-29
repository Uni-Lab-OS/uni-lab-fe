import { describe, expect, it } from 'vitest'
import {
  decodeActionDefinition,
  decodeActionRunAccepted,
  decodeDeviceList
} from './codec'

describe('device action codec', () => {
  it('maps a node template and its resource contract', () => {
    const action = decodeActionDefinition({
      code: 0,
      data: {
        template: {
          uuid: 'action-1',
          resource_template_uuid: 'device-template-1',
          name: 'pipette',
          display_name: 'Pipette',
          type: 'device_action',
          node_type: 'device_action',
          class: 'lab.Pipette',
          schema: { type: 'object' },
          goal: {},
          goal_default: {},
          meta_data: {
            unilab: {
              resource_contract: {
                version: 2,
                resource_params: [{ param: 'device', role: 'device' }],
                required_device_params: ['device_id'],
                order_sensitive: true
              }
            }
          }
        },
        handles: [{
          uuid: 'handle-1',
          workflow_node_template_uuid: 'action-1',
          handle_key: 'input',
          io_type: 'target',
          display_name: 'Input',
          type: 'ResourceSlot',
          required: true,
          data_source: 'goal',
          data_key: 'input',
          value_schema: { type: 'object' },
          editor_control: 'material_port',
          allowed_resource_template_uuids: null,
          implicit_passthrough: false,
          structural_role: null
        }]
      }
    })

    expect(action.kind).toBe('action_definition')
    expect(action.displayName).toBe('Pipette')
    expect(action.handles[0]?.editorControl).toBe('material_port')
    expect(action.resourceContract?.requiredDeviceParams).toEqual(['device_id'])
  })

  it('rejects an unsupported handle editor control', () => {
    expect(() => decodeActionDefinition({
      template: {
        uuid: 'action-1',
        resource_template_uuid: 'device-template-1',
        name: 'pipette',
        display_name: 'Pipette',
        type: 'device_action',
        node_type: 'device_action',
        schema: {},
        goal: {},
        goal_default: {}
      },
      handles: [{
        uuid: 'handle-1',
        workflow_node_template_uuid: 'action-1',
        handle_key: 'input',
        io_type: 'target',
        display_name: 'Input',
        type: 'ResourceSlot',
        required: true,
        data_source: null,
        data_key: null,
        value_schema: {},
        editor_control: 'unknown',
        allowed_resource_template_uuids: null,
        implicit_passthrough: false,
        structural_role: null
      }]
    })).toThrow('handle.editor_control is invalid')
  })

  it('decodes the real SZLab template shape with JSON schema and unilab handle metadata', () => {
    const action = decodeActionDefinition({
      code: 0,
      data: {
        template: {
          uuid: 'action-szlab',
          resource_template_uuid: 'device-template-1',
          name: 'run_stirring',
          display_name: '运行搅拌',
          type: 'UniLabJsonCommand',
          node_type: 'ILab',
          schema: JSON.stringify({ type: 'object', properties: { duration: { type: 'number' } } }),
          goal: { duration: 'duration' },
          goal_default: { duration: 1 }
        },
        handles: [{
          uuid: 'handle-szlab',
          workflow_node_template_uuid: 'action-szlab',
          handle_key: 'duration',
          io_type: 'target',
          display_name: 'duration',
          type: 'number',
          required: false,
          data_source: 'goal',
          data_key: 'duration',
          meta_data: {
            unilab: {
              value_schema: { type: 'number', default: 1 },
              editor_control: 'variable_selector',
              implicit_passthrough: false
            }
          }
        }]
      }
    })

    expect(action.schema).toMatchObject({ type: 'object', properties: { duration: { type: 'number' } } })
    expect(action.handles[0]).toMatchObject({
      valueSchema: { type: 'number', default: 1 },
      editorControl: 'variable_selector'
    })
  })

  it('preserves source fields returned beside the action template', () => {
    const action = decodeActionDefinition({
      template: {
        uuid: 'action-source',
        resource_template_uuid: 'device-template-1',
        name: 'inspect',
        display_name: 'Inspect',
        type: 'device_action',
        node_type: 'device_action',
        schema: {},
        goal: {},
        goal_default: {}
      },
      source_code: 'class Inspect: pass',
      handles: []
    })

    expect(action.raw.source_code).toBe('class Inspect: pass')
  })

  it('maps the Backend device projection without inventing online state', () => {
    const [device] = decodeDeviceList({
      code: 0,
      data: [{
        material: {
          uuid: 'material-1',
          resource_template_uuid: 'device-template-1',
          name: 'Robot'
        },
        binding: {
          local_id: 'robot-1',
          edge_uuid: 'edge-1'
        },
        edge_status: 'degraded',
        actions: [{
          name: 'move',
          type: 'robot.move',
          busy: false
        }]
      }]
    })

    expect(device).toMatchObject({
      kind: 'device_summary',
      deviceUuid: 'material-1',
      edgeStatus: 'degraded',
      online: null,
      dispatchable: null,
      actions: [{
        actionName: 'move',
        actionRef: 'material-1.move',
        busyStatusKnown: true,
        isBusy: false
      }]
    })
  })

  it('maps an accepted action run to standard OS identities', () => {
    expect(decodeActionRunAccepted({
      code: 0,
      data: {
        created: true,
        task: { uuid: 'task-1' },
        job: { uuid: 'job-1' }
      }
    })).toMatchObject({
      kind: 'device_action_run_accepted',
      created: true,
      taskUuid: 'task-1',
      jobUuid: 'job-1'
    })
  })
})
