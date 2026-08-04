import { describe, expect, it } from 'vitest'
import type {
  DeviceAction,
  WorkflowActionCatalogSnapshot,
  WorkflowActionNodeTemplate
} from '@unilab/services'

import {
  getD1AS1UnsupportedReason,
  matchDeviceActionTemplate,
  serializeDeviceActionInput,
  supportsD1AS1
} from './deviceActionRun'

describe('device Action D1A preparation', () => {
  it('joins live Action to exactly one stable A1 identity', () => {
    const template = actionTemplate()
    const catalog = actionCatalog([template])

    expect(matchDeviceActionTemplate(catalog, liveAction())).toBe(template)
    expect(matchDeviceActionTemplate(
      actionCatalog([template, { ...template, uuid: UUID_2 }]),
      liveAction()
    )).toBeNull()
    expect(matchDeviceActionTemplate(catalog, {
      ...liveAction(),
      typeName: 'other.Action'
    })).toBeNull()
  })

  it('fails closed for material, Site and implicit pass-through contracts', () => {
    expect(supportsD1AS1(actionTemplate())).toBe(true)
    expect(supportsD1AS1(actionTemplate({
      editorControl: 'material_port'
    }))).toBe(false)
    expect(supportsD1AS1(actionTemplate({
      editorControl: 'site_selector'
    }))).toBe(false)
    expect(supportsD1AS1(actionTemplate({
      implicitPassthrough: true
    }))).toBe(false)
    expect(supportsD1AS1(actionTemplate({
      valueSchema: { $slot: 'ResourceSlot', type: 'object' }
    }))).toBe(false)
  })

  it('reports the exact contract reason that requires Workflow execution', () => {
    expect(getD1AS1UnsupportedReason(actionTemplate({
      editorControl: 'material_port'
    }))).toBe('material_port')
    expect(getD1AS1UnsupportedReason(actionTemplate({
      editorControl: 'site_selector'
    }))).toBe('site_selector')
    expect(getD1AS1UnsupportedReason(actionTemplate({
      implicitPassthrough: true
    }))).toBe('implicit_passthrough')
    expect(getD1AS1UnsupportedReason(actionTemplate({
      valueSchema: { $slot: 'ResourceSlot', type: 'object' }
    }))).toBe('resource_slot')
    expect(getD1AS1UnsupportedReason(actionTemplate())).toBeNull()
  })

  it('serializes the existing form without convenient coercion beyond its schema', () => {
    const action = liveAction()
    action.inputSchema = {
      count: { type: 'integer', required: true },
      speed: { type: 'number', required: true },
      enabled: { type: 'boolean', required: true },
      labels: { type: 'array', required: true },
      options: { type: 'object', required: true },
      note: { type: 'string', required: false }
    }

    expect(serializeDeviceActionInput(action, {
      count: '2',
      speed: '1.5',
      enabled: true,
      labels: '["a"]',
      options: '{"safe":true}',
      note: ''
    })).toEqual({
      count: 2,
      speed: 1.5,
      enabled: true,
      labels: ['a'],
      options: { safe: true }
    })

    expect(() => serializeDeviceActionInput(action, {
      count: '2.5',
      speed: '1.5',
      enabled: true,
      labels: '["a"]',
      options: '{"safe":true}'
    })).toThrow('count 必须是整数')
    expect(() => serializeDeviceActionInput(action, {
      count: '2',
      speed: '1.5',
      enabled: true,
      labels: '{}',
      options: '{"safe":true}'
    })).toThrow('labels 必须是数组')
  })
})

const UUID_1 = '10000000-0000-4000-8000-000000000001'
const UUID_2 = '10000000-0000-4000-8000-000000000002'
const RESOURCE_UUID = '10000000-0000-4000-8000-000000000003'

function liveAction(): DeviceAction {
  return {
    actionName: 'move',
    actionRef: 'robot.move',
    displayName: '移动',
    label: '移动',
    typeName: 'demo.Move',
    isBusy: false,
    currentJobId: null,
    schema: null,
    inputSchema: {},
    outputSchema: {},
    riskLevel: 'normal'
  }
}

function actionCatalog(
  actionTemplates: WorkflowActionNodeTemplate[]
): WorkflowActionCatalogSnapshot {
  return {
    authorityId: 'os-local',
    authorityKind: 'local',
    fingerprint: `sha256:${'a'.repeat(64)}`,
    actionTemplates,
    workflowTemplates: []
  }
}

function actionTemplate(
  handle: Partial<WorkflowActionNodeTemplate['handles'][number]> = {}
): WorkflowActionNodeTemplate {
  return {
    uuid: UUID_1,
    resourceTemplateUuid: RESOURCE_UUID,
    name: 'move',
    displayName: '移动',
    actionClass: null,
    actionType: 'demo.Move',
    schema: { 'x-unilabos-action-contract': { version: 1 } },
    goal: {},
    goalDefault: {},
    handles: [{
      uuid: UUID_2,
      workflowNodeTemplateUuid: UUID_1,
      handleKey: 'position',
      ioType: 'target',
      displayName: 'Position',
      valueType: 'string',
      required: true,
      dataSource: null,
      dataKey: 'position',
      valueSchema: { type: 'string' },
      editorControl: 'variable_selector',
      allowedResourceTemplateUuids: null,
      implicitPassthrough: false,
      structuralRole: null,
      ...handle
    }]
  }
}
