import { describe, expect, it } from 'vitest'
import {
  applyActionPresentation,
  decodeDeviceActionPresentations,
  describeActionResult,
  findActionPresentation,
  groupActionsByCategory,
} from './action-presentation'
import { DeviceActionClient } from './client'
import { deviceActionParametersFromSchema, normalizeDeviceActionParameters } from './parameters'
import { resolveServerCapabilities } from '../../capabilities'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

const categories = {
  read: { label: '查看与采集', confirm: false, manual: true },
  compute: { label: '计算与分析', confirm: false, manual: true },
  actuate: { label: '驱动机构', confirm: true, manual: true },
  configure: { label: '写入参数', confirm: true, manual: true },
  safety: { label: '停止与恢复', confirm: true, manual: true },
  debug: { label: '调试（需 DEBUG 模式）', confirm: true, manual: true },
  flow: { label: '流程辅助', confirm: true, manual: false },
  hook: { label: '资源钩子', confirm: true, manual: false },
}

const raw = {
  version: 1,
  control_mode: 'DEBUG',
  categories,
  devices: {
    feedlift: {
      label: '板仓',
      actions: {
        read_pos: {
          ref: 'feedlift.read_pos',
          label: '板仓-读升降轴位置',
          category: 'read',
          confirm: false,
          manual: true,
          executable: true,
          params: [
            {
              name: 'magazine',
              label: '板仓',
              type: 'enum',
              required: true,
              options: [
                { value: 'feed', label: '上料仓' },
                { value: 'waste', label: '下料仓' },
              ],
            },
          ],
          result_fields: [
            { name: 'magazine', label: '板仓', type: 'str' },
            { name: 'z_mm', label: '位置 (mm)', type: 'float' },
          ],
        },
      },
    },
    sampling: {
      label: '上样工位',
      actions: {
        aspirate: {
          ref: 'sampling.aspirate',
          label: '上样-吸取样品',
          category: 'actuate',
          confirm: true,
          station: 'sampling',
          action_code: 21,
          params: [
            {
              name: 'plate_no',
              label: '盘位号',
              type: 'enum',
              required: false,
              default: 1,
              options: [
                { value: 1, label: '1' },
                { value: 2, label: '2' },
              ],
            },
            {
              name: 'sample_volume_ml',
              label: '相对回抽样品体积',
              type: 'float',
              required: false,
              default: 5,
              minimum: 0.1,
              maximum: 15,
              unit: 'mL',
            },
          ],
        },
        vacuum_on: { ref: 'pump.vacuum_on', label: '真空泵-开', category: 'hook', manual: false },
      },
    },
  },
}

const schema = {
  type: 'object',
  properties: {
    plate_no: { type: 'integer' },
    sample_volume_ml: { type: 'number' },
  },
}

describe('device action presentation', () => {
  it('decodes the device package payload', () => {
    const presentations = decodeDeviceActionPresentations(raw)
    expect(presentations.controlMode).toBe('DEBUG')
    expect(presentations.devices.feedlift?.label).toBe('板仓')
    const readPos = findActionPresentation(presentations, 'feedlift', 'read_pos')
    expect(readPos?.category).toBe('read')
    expect(readPos?.confirm).toBe(false)
    expect(readPos?.params[0]?.options.map((option) => option.label)).toEqual(['上料仓', '下料仓'])
    expect(findActionPresentation(presentations, 'sampling', 'aspirate')?.actionCode).toBe(21)
  })

  it('rejects malformed payloads instead of half-decoding them', () => {
    expect(() => decodeDeviceActionPresentations({ ...raw, version: 2 })).toThrow('版本')
    expect(() =>
      decodeDeviceActionPresentations({
        ...raw,
        devices: { feedlift: { actions: { read_pos: { ref: 'x', label: 'y', category: 'teleport' } } } },
      }),
    ).toThrow('类别未知')
  })

  it('merges labels, ranges, units and options into the OS schema parameters', () => {
    const presentations = decodeDeviceActionPresentations(raw)
    const parameters = applyActionPresentation(
      deviceActionParametersFromSchema(schema),
      findActionPresentation(presentations, 'sampling', 'aspirate'),
    )
    expect(parameters.map((parameter) => parameter.title)).toEqual(['盘位号', '相对回抽样品体积'])
    const volume = parameters[1]!
    expect(volume.schema.minimum).toBe(0.1)
    expect(volume.schema.maximum).toBe(15)
    expect(volume.description).toContain('mL')
    expect(volume.defaultValue).toBe(5)
    const plate = parameters[0]!
    expect(plate.schema.enum).toEqual([1, 2])
    expect(plate.schema['x-enum-labels']).toEqual(['1', '2'])
  })

  it('keeps parameters untouched without presentation metadata', () => {
    const parameters = deviceActionParametersFromSchema(schema)
    expect(applyActionPresentation(parameters, undefined)).toBe(parameters)
  })

  it('restores enum value types and validates numeric ranges before sending', () => {
    const presentations = decodeDeviceActionPresentations(raw)
    const parameters = applyActionPresentation(
      deviceActionParametersFromSchema(schema),
      findActionPresentation(presentations, 'sampling', 'aspirate'),
    )
    expect(normalizeDeviceActionParameters({ plate_no: '2', sample_volume_ml: 3 }, parameters)).toEqual({
      plate_no: 2,
      sample_volume_ml: 3,
    })
    expect(() => normalizeDeviceActionParameters({ plate_no: '9' }, parameters)).toThrow('须从选项中选择')
    expect(() => normalizeDeviceActionParameters({ sample_volume_ml: 20 }, parameters)).toThrow(
      '须在 0.1 – 15 之间',
    )
  })

  it('labels returned values in declared order and keeps unknown fields', () => {
    const presentations = decodeDeviceActionPresentations(raw)
    const entries = describeActionResult(
      { z_mm: 494, magazine: 'feed', axis: '1Z' },
      findActionPresentation(presentations, 'feedlift', 'read_pos'),
    )
    expect(entries).toEqual([
      { name: 'magazine', label: '板仓', value: 'feed' },
      { name: 'z_mm', label: '位置 (mm)', value: 494 },
      { name: 'axis', label: 'axis', value: '1Z' },
    ])
  })

  it('groups actions by category in operator order', () => {
    const presentations = decodeDeviceActionPresentations(raw)
    const groups = groupActionsByCategory(
      [{ actionName: 'vacuum_on' }, { actionName: 'aspirate' }, { actionName: 'unknown' }],
      presentations,
      'sampling',
    )
    expect(groups.map((group) => [group.category, group.actions.map((a) => a.actionName)])).toEqual([
      ['actuate', ['aspirate', 'unknown']],
      ['hook', ['vacuum_on']],
    ])
    expect(groups[1]?.info.manual).toBe(false)
  })

  it('reads the presentation route through the OS envelope', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(request: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(request)
        return { status: 200, headers: {}, data: { code: 0, data: raw } as Value }
      },
    }
    const presentations = await new DeviceActionClient(transport).getActionPresentations()
    expect(requests[0]?.url).toBe('/api/v1/device-action-presentations')
    expect(presentations.devices.sampling?.label).toBe('上样工位')
  })

  it('declares the capability only for the pTLC native profile', () => {
    expect(resolveServerCapabilities({ id: 'ptlc-native' }).has('deviceAction.presentation')).toBe(true)
    expect(resolveServerCapabilities({ id: 'ptlc-native' }).has('inventory.dispenseReagent')).toBe(true)
    expect(resolveServerCapabilities({ id: 'local-python' }).has('deviceAction.presentation')).toBe(false)
  })
})
