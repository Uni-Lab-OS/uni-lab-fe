import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { decodeDeviceActionPresentations } from '@unilab-fe/core'
import type { DeviceActionState } from '@unilab-fe/core'
import { DeviceActionGroups } from './DeviceActionGroups'
import { DeviceActionRunResult } from './DeviceActionRunResult'
import { runView } from './deviceActionRunView.fixture'

beforeAll(() => {
  // antd Descriptions 依赖 matchMedia 做响应式列数；jsdom 未实现。
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

// vi.mock 会提升到文件顶部，替身须经 vi.hoisted 创建。
const { getActionRun, navigateTo, backend } = vi.hoisted(() => {
  const getActionRun = vi.fn()
  return {
    getActionRun,
    navigateTo: vi.fn(),
    backend: { core: { deviceActions: { getActionRun } } },
  }
})
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend }) }))
vi.mock('../../app/navigation', () => ({ navigateTo }))

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
const presentations = decodeDeviceActionPresentations({
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
          result_fields: [{ name: 'z_mm', label: '位置 (mm)', type: 'float' }],
        },
        feed_raise: { ref: 'feedlift.feed_raise', label: '上料-升轴至取料光电', category: 'actuate' },
        calib_record: { ref: 'feedlift.calib_record', label: '板仓-记一组标定样本', category: 'flow', manual: false },
      },
    },
  },
})

function action(actionName: string, label: string): DeviceActionState {
  return {
    actionName,
    actionRef: `feedlift.${actionName}`,
    label,
    actionType: 'device_action',
    actionDefinitionUuid: `uuid-${actionName}`,
    isBusy: false,
    busyStatusKnown: true,
    currentJobUuid: null,
    raw: {},
  }
}

describe('DeviceActionGroups', () => {
  it('groups actions by category and hides flow helpers until requested', () => {
    const onSelect = vi.fn()
    render(
      <DeviceActionGroups
        actions={[action('feed_raise', '上料-升轴'), action('read_pos', '读位置'), action('calib_record', '记标定')]}
        presentations={presentations}
        deviceKey="feedlift"
        onSelectAction={onSelect}
      />,
    )
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(headings).toEqual(['查看与采集1', '驱动机构1'])
    expect(screen.queryByText('记标定')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '显示流程辅助动作（1）' }))
    expect(screen.getByText('记标定')).toBeInTheDocument()
    expect(screen.getByText('由流程调用，一般不需要手动下发')).toBeInTheDocument()
    fireEvent.click(screen.getByText('读位置'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ actionName: 'read_pos' }))
  })

  it('falls back to the flat list without presentation metadata', () => {
    render(
      <DeviceActionGroups
        actions={[action('read_pos', '读位置')]}
        presentations={undefined}
        deviceKey="feedlift"
        onSelectAction={vi.fn()}
      />,
    )
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('读位置')).toBeInTheDocument()
  })
})

describe('DeviceActionRunResult', () => {
  it('shows labelled readings once the job succeeds', async () => {
    getActionRun.mockResolvedValueOnce(
      runView({ status: 'succeeded' }, { status: 'succeeded', raw: { return_info: { z_mm: 494.25, terminal: 'succeeded' } } }),
    )
    render(
      <DeviceActionRunResult
        taskUuid="task-1"
        presentation={presentations.devices.feedlift!.actions.read_pos}
      />,
    )
    await waitFor(() => expect(screen.getByText('板仓-读升降轴位置：已完成')).toBeInTheDocument())
    expect(screen.getByText('位置 (mm)')).toBeInTheDocument()
    expect(screen.getByText('494.25')).toBeInTheDocument()
    expect(screen.queryByText('terminal')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '在任务页查看详情与处置' }))
    expect(navigateTo).toHaveBeenCalledWith('tasks', '?task=task-1')
  })

  it('shows the device rejection reason when the job fails', async () => {
    getActionRun.mockResolvedValueOnce(
      runView(
        { status: 'failed' },
        { status: 'failed', errorInfo: [{ code: 'ptlc_action_rejected', message: '需 DEBUG', protocol_status: 'REJECTED' }] },
      ),
    )
    render(<DeviceActionRunResult taskUuid="task-2" presentation={undefined} />)
    await waitFor(() => expect(screen.getByText('设备动作：执行失败')).toBeInTheDocument())
    expect(screen.getByText('设备拒绝执行：')).toBeInTheDocument()
    expect(screen.getByText(/需 DEBUG/)).toBeInTheDocument()
  })
})
