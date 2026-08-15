import { describe, expect, it } from 'vitest'
import type {
  DeviceAction,
  WorkflowActionCatalogSnapshot,
  WorkflowActionNodeTemplate
} from '@unilab/services'

import {
  deviceActionDraftStorageKey,
  matchDeviceActionTemplate,
  projectDeviceActionInputSchema,
  projectSelectedDeviceAction,
  projectDeviceActionTemplate,
  serializeDeviceActionInput,
  supportsD1AS1
} from './deviceActionRun'

describe('device Action D1A preparation', () => {
  /** 证明动作名称和类型相同仍必须按资源模板（ResourceTemplate）UUID 唯一匹配。 */
  it('joins live Action to exactly one stable A1 identity', () => {
    const template = actionTemplate()
    const catalog = actionCatalog([template])

    expect(matchDeviceActionTemplate(catalog, liveAction(), RESOURCE_UUID)).toBe(template)
    expect(matchDeviceActionTemplate(
      catalog,
      liveAction(),
      '10000000-0000-4000-8000-000000000099'
    )).toBeNull()
    expect(matchDeviceActionTemplate(
      actionCatalog([template, { ...template, uuid: UUID_2 }]),
      liveAction()
    )).toBeNull()
    expect(matchDeviceActionTemplate(catalog, {
      ...liveAction(),
      typeName: 'other.Action'
    })).toBeNull()
  })

  /** 证明选择投影与草稿键同时隔离资源模板、Backend 和目录代际。 */
  it('projects one selected Action and isolates its parameter draft generation', () => {
    const template = actionTemplate()
    const action = liveAction()
    const projection = projectSelectedDeviceAction(
      actionCatalog([template]),
      action,
      RESOURCE_UUID
    )

    expect(projection).toMatchObject({
      template,
      action: { displayName: '移动', inputSchema: { position: {} } }
    })
    expect(deviceActionDraftStorageKey(
      'local-go',
      'http://127.0.0.1:5173/__unilab_backend',
      { id: 'device-1' },
      projection.action,
      projection.template,
      'catalog-v2'
    )).toBe([
      'unilab',
      'device-action-draft',
      'local-go',
      'http://127.0.0.1:5173/__unilab_backend',
      'device-1',
      action.actionRef,
      template.uuid,
      'catalog-v2'
    ].join(':'))
  })

  /** 证明包含物料占位符（ResourceSlot）、库位（Site）或隐式透传的动作关闭失败。 */
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

  /** 证明动作合同的 goal、目标连接点和 goal_default 能生成无猜测的参数表单。 */
  it('projects the typed action contract into the device parameter form', () => {
    const template = actionTemplate()

    expect(projectDeviceActionInputSchema(template)).toEqual({
      position: {
        type: 'string',
        title: 'Position',
        description: '目标位置',
        enum: ['home', 'work'],
        required: true,
        default: 'home'
      }
    })
    expect(projectDeviceActionTemplate(liveAction(), template)).toMatchObject({
      displayName: '移动',
      label: '移动',
      schema: template.schema,
      inputSchema: {
        position: { type: 'string', default: 'home', required: true }
      }
    })
    expect(projectDeviceActionInputSchema(actionTemplate({
      dataSource: null
    }))).toBeNull()
  })

  /** 证明 Backend 平面参数 Schema 可生成表单，旧工作流连接点不影响 D1A 安全判定。 */
  it('projects the Backend flat device Action parameter schema', () => {
    const template = flatActionTemplate()

    expect(projectDeviceActionInputSchema(template)).toEqual({
      speed_rpm: {
        type: 'integer',
        title: '转速',
        minimum: 100,
        maximum: 1500,
        required: true,
        default: 600
      },
      direction: {
        type: 'string',
        title: 'direction',
        enum: ['clockwise', 'counterclockwise'],
        required: false,
        default: 'clockwise'
      }
    })
    expect(projectDeviceActionTemplate(liveAction(), template)).toMatchObject({
      displayName: '移动',
      label: '移动',
      inputSchema: {
        speed_rpm: { type: 'integer', default: 600, required: true },
        direction: { type: 'string', default: 'clockwise', required: false }
      }
    })
    expect(supportsD1AS1(template)).toBe(true)
  })

  /** 证明参数序列化只执行 Schema 明确允许的类型转换。 */
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

  /** 证明用户清空可选字段时仍提交合同默认值，不把默认语义交给 Backend 猜测。 */
  it('uses a declared schema default instead of silently delegating a cleared field to the backend', () => {
    const action = liveAction()
    action.inputSchema = {
      duration: { type: 'number', required: false, default: 30 }
    }

    expect(serializeDeviceActionInput(action, { duration: '' })).toEqual({
      duration: 30
    })
  })

  it('submits only fields declared by the frozen Action template', () => {
    const action = liveAction()
    action.inputSchema = {
      unilabos_device_id: { type: 'string', default: '' },
      sample_id: { type: 'string', default: '' },
      require_material: { type: 'boolean', default: false }
    }
    const template = {
      ...actionTemplate(),
      goal: {
        sample_id: 'sample_id',
        require_material: 'require_material'
      }
    }

    expect(serializeDeviceActionInput(action, {
      unilabos_device_id: '',
      sample_id: 'debug-sample',
      require_material: false
    }, template)).toEqual({
      sample_id: 'debug-sample',
      require_material: false
    })
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

/** 构造一个可安全执行的设备单动作调试（D1A）模板；参数覆盖目标连接点字段。 */
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
    schema: {
      type: 'object',
      properties: {
        goal: {
          type: 'object',
          properties: {
            position: {
              type: 'string',
              description: '目标位置',
              enum: ['home', 'work']
            }
          },
          required: ['position'],
          additionalProperties: false
        }
      },
      'x-unilabos-action-contract': {
        version: 1,
        input_order: ['position'],
        output_order: []
      }
    },
    goal: { position: 'position' },
    goalDefault: { position: 'home' },
    handles: [{
      uuid: UUID_2,
      workflowNodeTemplateUuid: UUID_1,
      handleKey: 'position',
      ioType: 'target',
      displayName: 'Position',
      valueType: 'string',
      required: true,
      dataSource: 'goal',
      dataKey: 'position',
      valueSchema: {
        type: 'string',
        description: '目标位置',
        enum: ['home', 'work']
      },
      editorControl: 'variable_selector',
      allowedResourceTemplateUuids: null,
      implicitPassthrough: false,
      structuralRole: null,
      ...handle
    }]
  }
}

/** 构造 Backend 当前公开的平面设备动作参数合同；无参数，返回带默认值的动作模板。 */
function flatActionTemplate(): WorkflowActionNodeTemplate {
  return {
    ...actionTemplate(),
    schema: {
      type: 'object',
      properties: {
        speed_rpm: {
          type: 'integer',
          title: '转速',
          minimum: 100,
          maximum: 1500
        },
        direction: {
          type: 'string',
          enum: ['clockwise', 'counterclockwise']
        }
      },
      required: ['speed_rpm'],
      additionalProperties: false
    },
    goal: {},
    goalDefault: { speed_rpm: 600, direction: 'clockwise' },
    handles: []
  }
}
