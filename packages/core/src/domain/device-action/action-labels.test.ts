import { describe, expect, it } from 'vitest'
import { buildDeviceActionLabelDirectory, resolveNodeActionLabel } from './action-labels'
import { decodeDeviceActionPresentations } from './action-presentation'
import { decodeDeviceList } from './codec'

const ROBOT_UUID = 'c4190b68-adb6-5c82-952f-f1ef5a37804b'
const PUMP_UUID = 'b2ef57a6-3ec3-5601-bda8-4ee1a26e9f18'

const osDevices = decodeDeviceList({
  code: 0,
  data: [
    {
      material: { uuid: ROBOT_UUID, resource_template_uuid: 'tpl-robot', name: '机械臂' },
      binding: { local_id: 'robot', edge_uuid: 'edge-1' },
      actions: [
        // OS 设备读模型的动作标签只在展示元数据缺失时补位；等于动作名时不算显示名。
        { name: 'move_to_point', type: 'UniLabJsonCommand', label: 'move_to_point' },
        { name: 'query', type: 'UniLabJsonCommand', label: '读取机械臂状态' },
      ],
    },
    {
      material: { uuid: PUMP_UUID, resource_template_uuid: 'tpl-pump', name: '真空泵' },
      binding: { local_id: 'pump', edge_uuid: 'edge-1' },
      actions: [{ name: 'vacuum_on', type: 'UniLabJsonCommand', display_name: '打开真空' }],
    },
  ],
})

const categories = Object.fromEntries(
  ['read', 'compute', 'actuate', 'configure', 'safety', 'debug', 'flow', 'hook'].map((key) => [
    key,
    { label: key },
  ]),
)
const action = (ref: string, label: string) => ({
  ref,
  label,
  category: 'actuate',
  params: [],
  result_fields: [],
})
const presentations = decodeDeviceActionPresentations({
  version: 1,
  categories,
  devices: {
    robot: {
      label: '机械臂',
      actions: {
        move_to_point: action('robot.move_to_point', '移动到点位'),
        home_ensure: action('robot.home_ensure', '确保回原点'),
        // 设备包缺中文名时 label 回退为方法名，不能当作显示名。
        dwell: action('robot.dwell', 'dwell'),
      },
    },
    rail: {
      label: '地轨',
      actions: {
        ensure: action('rail.ensure', '地轨到位'),
        home_ensure: action('rail.home_ensure', '地轨回原点'),
      },
    },
  },
})

describe('buildDeviceActionLabelDirectory', () => {
  it('maps (local device id or device UUID, action) to the device package Chinese label', () => {
    const directory = buildDeviceActionLabelDirectory({ devices: osDevices, presentations })
    expect(directory.resolve('robot', 'move_to_point')).toEqual({
      actionName: 'move_to_point',
      ref: 'robot.move_to_point',
      label: '移动到点位',
      known: true,
    })
    // 调度计划可能按物料 UUID 标识设备；与本地 ID 归并为同一设备。
    expect(directory.resolve(ROBOT_UUID, 'home_ensure')).toMatchObject({
      label: '确保回原点',
      ref: 'robot.home_ensure',
      known: true,
    })
    // 只出现在展示元数据中的设备同样可解析。
    expect(directory.resolve('rail', 'ensure')).toMatchObject({ label: '地轨到位', known: true })
  })

  it('accepts action references and scheduler device-action keys', () => {
    const directory = buildDeviceActionLabelDirectory({ presentations })
    expect(directory.resolve(null, 'robot.move_to_point')).toMatchObject({
      actionName: 'move_to_point',
      label: '移动到点位',
    })
    expect(directory.resolve('', '/devices/robot/home_ensure')).toMatchObject({
      label: '确保回原点',
    })
    // 点号前缀与给定设备不是同一设备时不拆，避免误认动作。
    expect(directory.resolve('rail', 'robot.move_to_point')).toMatchObject({ known: false })
  })

  it('resolves an action without a device only when the label is unambiguous', () => {
    const directory = buildDeviceActionLabelDirectory({ presentations })
    expect(directory.resolve(null, 'move_to_point')).toEqual({
      actionName: 'move_to_point',
      ref: 'robot.move_to_point',
      label: '移动到点位',
      known: true,
    })
    // 两台设备都有 home_ensure 且中文名不同：不猜，回退动作名。
    expect(directory.resolve(undefined, 'home_ensure')).toEqual({
      actionName: 'home_ensure',
      ref: 'home_ensure',
      label: 'home_ensure',
      known: false,
    })
  })

  it('fills labels from the OS device read model when the presentation has none', () => {
    const directory = buildDeviceActionLabelDirectory({ devices: osDevices, presentations })
    expect(directory.resolve('robot', 'query')).toMatchObject({
      label: '读取机械臂状态',
      known: true,
    })
    expect(directory.resolve(PUMP_UUID, 'vacuum_on')).toMatchObject({
      label: '打开真空',
      known: true,
    })
    // OS 读模型标签等于动作名时，以展示元数据为准。
    expect(
      buildDeviceActionLabelDirectory({ devices: osDevices }).resolve('robot', 'move_to_point'),
    ).toMatchObject({ label: 'move_to_point', known: false })
  })

  it('falls back to the action name when runtime facts carry no label', () => {
    const directory = buildDeviceActionLabelDirectory({ devices: osDevices, presentations })
    expect(directory.resolve('robot', 'dwell')).toEqual({
      actionName: 'dwell',
      ref: 'robot.dwell',
      label: 'dwell',
      known: false,
    })
    expect(directory.resolve('staging_a', 'read_presence')).toEqual({
      actionName: 'read_presence',
      ref: 'staging_a.read_presence',
      label: 'read_presence',
      known: false,
    })
    // 设备未知、元数据缺失（能力未声明或读取失败）时都只回退动作名，不抛错。
    expect(buildDeviceActionLabelDirectory({}).resolve(undefined, 'query')).toEqual({
      actionName: 'query',
      ref: 'query',
      label: 'query',
      known: false,
    })
  })
})

describe('resolveNodeActionLabel', () => {
  const directory = buildDeviceActionLabelDirectory({ devices: osDevices, presentations })
  const resolve = (facts: Parameters<typeof resolveNodeActionLabel>[0]) =>
    resolveNodeActionLabel(facts, directory, '待执行节点')

  it('prefers a meaningful node name over the action label', () => {
    expect(resolve({ nodeName: '取板', actionName: 'move_to_point', deviceId: 'robot' })).toEqual({
      text: '取板',
      source: 'node',
      actionRef: 'robot.move_to_point',
    })
  })

  it('replaces a node name that is just the raw action name with the Chinese label', () => {
    for (const nodeName of ['move_to_point', 'robot.move_to_point', undefined]) {
      expect(resolve({ nodeName, actionName: 'move_to_point', deviceId: 'robot' })).toEqual({
        text: '移动到点位',
        source: 'action',
        actionRef: 'robot.move_to_point',
      })
    }
    // 计划条没有动作名：节点名正是该设备上的动作名时同样换成中文名。
    expect(resolve({ nodeName: 'home_ensure', deviceId: ROBOT_UUID })).toEqual({
      text: '确保回原点',
      source: 'action',
      actionRef: 'robot.home_ensure',
    })
  })

  it('falls back to the action name, then the node name, then the placeholder', () => {
    expect(resolve({ actionName: 'dwell', deviceId: 'robot' })).toEqual({
      text: 'dwell',
      source: 'action_name',
      actionRef: 'robot.dwell',
    })
    expect(resolve({ nodeName: 'dwell', actionName: 'dwell', deviceId: 'robot' })).toMatchObject({
      text: 'dwell',
      source: 'action_name',
    })
    expect(resolve({ nodeName: 'mystery_step', deviceId: 'robot' })).toEqual({
      text: 'mystery_step',
      source: 'node',
      actionRef: null,
    })
    expect(resolve({ deviceId: 'robot' })).toEqual({
      text: '待执行节点',
      source: 'placeholder',
      actionRef: null,
    })
    expect(resolve({ nodeName: '  ', actionName: '' })).toMatchObject({ source: 'placeholder' })
  })

  it('works without a directory (metadata unavailable)', () => {
    expect(
      resolveNodeActionLabel(
        { nodeName: 'move_to_point', actionName: 'move_to_point', deviceId: 'robot' },
        undefined,
        '待执行节点',
      ),
    ).toEqual({ text: 'move_to_point', source: 'action_name', actionRef: 'robot.move_to_point' })
  })
})
