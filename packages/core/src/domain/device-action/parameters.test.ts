import { describe, expect, it } from 'vitest'
import type { ActionDefinition } from './model'
import {
  deviceActionDefaults,
  deviceActionParameters,
  deviceActionParametersFromSchema,
  normalizeDeviceActionParameters,
} from './parameters'

function definition(): ActionDefinition {
  return {
    kind: 'action_definition',
    source: 'fixture',
    actionUuid: 'action-1',
    name: 'inspect',
    displayName: 'Inspect',
    actionType: 'UniLabJsonCommand',
    nodeType: 'ILab',
    resourceTemplateUuid: 'device-1',
    actionClass: null,
    schema: {
      type: 'object',
      required: ['beaker'],
      properties: {
        beaker: { type: 'object', 'x-unilabos-material-lock': true },
        sample_id: { type: 'string', default: 'sample-01' },
        enabled: { type: 'boolean', default: true },
      },
    },
    goal: {},
    goalDefault: { sample_id: 'sample-01', enabled: true },
    handles: [
      {
        uuid: 'handle-1',
        workflowNodeTemplateUuid: 'action-1',
        handleKey: 'beaker',
        ioType: 'target',
        displayName: '烧杯',
        valueType: 'ResourceSlot',
        required: true,
        dataSource: 'goal',
        dataKey: 'beaker',
        valueSchema: { type: 'object', 'x-unilabos-material-lock': true },
        editorControl: 'material_port',
        allowedResourceTemplateUuids: null,
        implicitPassthrough: false,
        structuralRole: null,
      },
    ],
    resourceContract: null,
    raw: {},
  }
}

describe('device action parameter projection', () => {
  it('merges action handles and schema in stable order', () => {
    const parameters = deviceActionParameters(definition())
    expect(parameters.map((parameter) => parameter.name)).toEqual([
      'beaker',
      'sample_id',
      'enabled',
    ])
    expect(parameters[0]).toMatchObject({ title: '烧杯', required: true })
  })

  it('hydrates defaults and normalizes resource values', () => {
    const parameters = deviceActionParameters(definition())
    expect(deviceActionDefaults(parameters)).toEqual({
      sample_id: 'sample-01',
      enabled: true,
    })
    expect(
      normalizeDeviceActionParameters(
        { beaker: 'material-1', sample_id: 'sample-02', enabled: false },
        parameters,
      ),
    ).toEqual({
      beaker: { uuid: 'material-1' },
      sample_id: 'sample-02',
      enabled: false,
    })
  })

  it('rejects missing required and malformed structured values', () => {
    const parameters = deviceActionParametersFromSchema({
      type: 'object',
      properties: { sample: { type: 'object', title: '样品' } },
      required: ['sample'],
    })
    expect(() => normalizeDeviceActionParameters({}, parameters)).toThrow('请输入样品')
    expect(() => normalizeDeviceActionParameters({ sample: '{' }, parameters)).toThrow(
      '必须是合法 JSON',
    )
  })

  it('handles absent definitions, nullable schemas, optional empty values and object defaults', () => {
    expect(deviceActionParameters()).toEqual([])
    const parameters = deviceActionParametersFromSchema({
      properties: {
        count: { type: ['null', 'number'], default: 0 },
        payload: { type: ['null', 'object'], default: { enabled: true } },
        resource: { $slot: 'ResourceSlot', default: { uuid: 'resource-1' } },
        optional: { type: 'string' },
      },
      required: ['count', 42],
    })

    expect(deviceActionDefaults(parameters)).toEqual({
      count: 0,
      payload: '{\n  "enabled": true\n}',
      resource: 'resource-1',
    })
    expect(
      normalizeDeviceActionParameters(
        { count: 0, payload: { enabled: false }, resource: { uuid: 'resource-2' }, optional: '' },
        parameters,
      ),
    ).toEqual({ count: 0, payload: { enabled: false }, resource: { uuid: 'resource-2' } })
  })
})
