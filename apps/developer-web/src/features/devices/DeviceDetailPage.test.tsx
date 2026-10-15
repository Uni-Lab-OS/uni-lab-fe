import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DeviceSummary } from '@unilab-fe/core'
import { DeviceDetail } from './DeviceDetailPage'
import { DeviceActionSummary } from './DeviceActionSummary'
import { runView } from './deviceActionRunView.fixture'
import { decodeDeviceActionPresentations } from '@unilab-fe/core'

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
const payload = {
  version: 1,
  control_mode: 'RUN',
  categories,
  devices: {
    feedlift: {
      label: '板仓升降',
      actions: {
        preflight: {
          ref: 'feedlift.preflight',
          label: '板仓-发动作前可见前置自检',
          category: 'read',
          desc: '执行步骤：读输入字节 IX8 与 PLC_Ready。按板仓比对。\n前置与安全：纯读动作，不驱动轴运动。\n完成与异常：返回各开关现值。\n实现核对：runtime/bootstrap.py::_feedlift_preflight',
          result_fields: [{ name: 'ok', label: '是否成功', type: 'bool' }],
        },
      },
    },
    robot: {
      label: '机械臂',
      actions: {
        enable: {
          ref: 'robot.enable',
          label: '使能机械臂',
          category: 'debug',
          modes: ['DEBUG'],
          desc: '执行步骤：调用 EnableRobot。',
        },
      },
    },
  },
}

// 替身须保持引用稳定：useBackendQuery 的副作用依赖 backend 与 report*，每次渲染换新会无限重取。
const { backend, startRun, getActionRun, connection } = vi.hoisted(() => {
  const startRun = vi.fn()
  const getActionRun = vi.fn()
  return {
    startRun,
    getActionRun,
    connection: { reportSuccess: () => undefined, reportError: () => undefined },
    backend: {
      getCapabilityStatus: () => ({ available: true }),
      core: {
        deviceActions: {
          getActionDefinition: vi.fn().mockRejectedValue(new Error('no definition in test')),
          getActionRun,
        },
        deviceActionPresentations: { getActionPresentations: vi.fn() },
        deviceActionDebugging: { startRun },
      },
    },
  }
})
vi.mock('../../app/BackendProvider', () => ({
  useBackend: () => ({ backend, ...connection }),
}))
vi.mock('../../app/navigation', () => ({ navigateTo: vi.fn() }))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

beforeEach(() => {
  startRun.mockReset()
  getActionRun.mockReset()
  backend.core.deviceActionPresentations.getActionPresentations.mockResolvedValue(
    decodeDeviceActionPresentations(payload),
  )
})

function feedlift(overrides: Partial<DeviceSummary> = {}): DeviceSummary {
  return {
    kind: 'device_summary',
    source: 'os',
    deviceUuid: 'device-feedlift',
    materialUuid: 'material-feedlift',
    resourceTemplateUuid: 'template-feedlift',
    deviceKey: 'feedlift',
    namespace: '',
    label: '板仓升降',
    online: true,
    edgeStatus: null,
    dispatchable: true,
    dispatchBlockReason: null,
    executionOccupancies: null,
    actions: [
      {
        actionName: 'preflight',
        actionRef: 'feedlift.preflight',
        label: '板仓-发动作前可见前置自检',
        actionType: 'device_action',
        actionDefinitionUuid: 'uuid-preflight',
        isBusy: false,
        busyStatusKnown: true,
        currentJobUuid: null,
        raw: { inputSchema: { type: 'object', properties: {} } },
      },
    ],
    raw: {},
    ...overrides,
  }
}

describe('DeviceDetail', () => {
  it('runs a parameterless read action in one click and shows the reading', async () => {
    startRun.mockResolvedValue({ acceptedRun: { taskUuid: 'task-1', jobUuid: 'job-1' } })
    getActionRun.mockResolvedValue(
      runView({ status: 'succeeded' }, { status: 'succeeded', raw: { return_info: { ok: true } } }),
    )
    render(<DeviceDetail device={feedlift()} onBack={vi.fn()} />)
    const run = await screen.findByRole('button', { name: /^执\s*行$/ })
    await waitFor(() => expect(run).toBeEnabled())
    fireEvent.click(run)
    await waitFor(() => expect(startRun).toHaveBeenCalledTimes(1))
    expect(startRun.mock.calls[0]![1]).toMatchObject({
      materialUuid: 'material-feedlift',
      workflowNodeTemplateUuid: 'uuid-preflight',
      param: {},
      description: '板仓升降 · 板仓-发动作前可见前置自检',
    })
    expect(await screen.findByText('是否成功')).toBeInTheDocument()
    expect(screen.getByText('是')).toBeInTheDocument()
  })

  it('explains why an offline device cannot dispatch and disables execution', async () => {
    render(
      <DeviceDetail
        device={feedlift({ online: false, dispatchable: false, dispatchBlockReason: 'PLC 未连接' })}
        onBack={vi.fn()}
      />,
    )
    expect(await screen.findByText('设备离线，当前不能下发动作')).toBeInTheDocument()
    expect(screen.getByText('PLC 未连接')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /^执\s*行$/ })).toBeDisabled()
    expect(startRun).not.toHaveBeenCalled()
  })
})

describe('DeviceActionSummary', () => {
  it('leads with a one-line summary, opens safety and tucks technical notes away', () => {
    const presentations = decodeDeviceActionPresentations(payload)
    render(
      <DeviceActionSummary
        presentation={presentations.devices.feedlift!.actions.preflight!}
        presentations={presentations}
      />,
    )
    expect(screen.getByText('读输入字节 IX8 与 PLC_Ready。')).toBeInTheDocument()
    expect(screen.getByText('纯读动作，不驱动轴运动。')).toBeVisible()
    expect(screen.getByText('执行步骤')).toBeInTheDocument()
    expect(screen.getByText('技术信息')).toBeInTheDocument()
    expect(screen.queryByText(/runtime\/bootstrap\.py/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('技术信息'))
    expect(screen.getByText(/runtime\/bootstrap\.py/)).toBeInTheDocument()
  })

  it('warns when the station control mode does not allow the action', () => {
    const presentations = decodeDeviceActionPresentations(payload)
    render(
      <DeviceActionSummary
        presentation={presentations.devices.robot!.actions.enable!}
        presentations={presentations}
      />,
    )
    expect(screen.getByText(/当前站级控制模式为 RUN，该动作需要 DEBUG 模式/)).toBeInTheDocument()
  })
})
