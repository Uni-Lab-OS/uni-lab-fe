import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { decodeSchedulerTimeline, decodeTimePlan, type DeviceSummary } from '@unilab-fe/core'
import { ScheduleGantt } from './SchedulePage'

// 替身须保持引用稳定：useBackendQuery 的副作用依赖 backend 与 report*，每次渲染换新会无限重取。
// 每个用例换一个 backend 实例，避免按 backend 隔离的会话缓存把上一个用例的设备列表带过来。
const { holder, connection, navigateTo } = vi.hoisted(() => ({
  navigateTo: vi.fn(),
  connection: {
    readyEpoch: 0,
    reportSuccess: () => undefined,
    reportError: () => undefined,
  },
  holder: { current: null as unknown as ReturnType<typeof makeBackend> },
}))
function makeBackend() {
  return {
    getCapabilityStatus: (capability: string) => ({
      available: capability === 'scheduler.timePlan',
    }),
    core: {
      schedulerTimePlan: { getTimePlan: vi.fn(), getTimeline: vi.fn() },
      executionRead: { listTaskPresentations: vi.fn() },
      deviceActions: { listDevices: vi.fn() },
      deviceActionPresentations: { getActionPresentations: vi.fn() },
    },
  }
}
vi.mock('../../app/BackendProvider', () => ({
  useBackend: () => ({ backend: holder.current, ...connection }),
}))
vi.mock('../../app/navigation', () => ({ navigateTo }))

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

const NOW = Math.floor(Date.now() / 1000)

const robot: DeviceSummary = {
  kind: 'device_summary',
  source: 'os',
  deviceUuid: 'c4190b68-adb6-5c82-952f-f1ef5a37804b',
  materialUuid: 'c4190b68-adb6-5c82-952f-f1ef5a37804b',
  resourceTemplateUuid: 'tpl-robot',
  deviceKey: 'robot',
  localDeviceId: 'robot',
  namespace: 'edge-1',
  label: '机械臂',
  online: true,
  edgeStatus: null,
  dispatchable: true,
  dispatchBlockReason: null,
  executionOccupancies: null,
  actions: [],
  raw: {},
}

beforeEach(() => {
  navigateTo.mockReset()
  holder.current = makeBackend()
  const backend = holder.current
  backend.core.schedulerTimePlan.getTimePlan.mockResolvedValue(
    decodeTimePlan({ enabled: false, algorithm: 'stable-ready-order' }),
  )
  backend.core.schedulerTimePlan.getTimeline.mockResolvedValue(
    decodeSchedulerTimeline({
      now: NOW,
      completed: [
        {
          job_id: 'job-1',
          workflow_id: 'task-a',
          node_id: 'node-1',
          device_id: 'robot',
          action_name: 'pick_plate',
          started_at: NOW - 120,
          ended_at: NOW - 60,
          state: 'succeeded',
        },
        {
          job_id: 'job-2',
          workflow_id: 'task-a',
          node_id: 'node-2',
          device_id: 'staging_a',
          action_name: 'locate',
          started_at: NOW - 50,
          ended_at: NOW - 20,
          state: 'failed',
        },
      ],
    }),
  )
  backend.core.executionRead.listTaskPresentations.mockResolvedValue({ items: [] })
  backend.core.deviceActions.listDevices.mockResolvedValue([robot])
})

describe('ScheduleGantt', () => {
  it('labels device lanes with OS names and keeps the raw id visible', async () => {
    render(<ScheduleGantt />)
    expect(await screen.findByText('机械臂')).toBeInTheDocument()
    // 已知名称的设备在名称下方显示原始 ID；未知设备回退显示 ID 本身。
    expect(screen.getByText('robot')).toBeInTheDocument()
    expect(screen.getByText('staging_a').closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('OS 未提供该设备的显示名'),
    )
  })

  it('shows bar details on hover and opens the node in the task page on click', async () => {
    render(<ScheduleGantt />)
    const bar = await screen.findByRole('button', { name: /pick_plate · 实际执行 · 成功 · 机械臂/ })
    fireEvent.mouseEnter(bar, { clientX: 100, clientY: 40 })
    const tooltip = screen.getByRole('tooltip')
    expect(within(tooltip).getByText('机械臂（robot）')).toBeInTheDocument()
    expect(within(tooltip).getByText(/（1 分 0 秒）/)).toBeInTheDocument()
    fireEvent.mouseLeave(bar)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.click(bar)
    expect(navigateTo).toHaveBeenCalledWith('tasks', '?task=task-a&node=node-1&job=job-1')
    // 失败的条除了红色描边，还有文字状态。
    fireEvent.keyDown(screen.getByRole('button', { name: /locate · 实际执行 · 失败/ }), {
      key: 'Enter',
    })
    expect(navigateTo).toHaveBeenLastCalledWith('tasks', '?task=task-a&node=node-2&job=job-2')
  })

  it('uses a custom open handler and switches to a custom window when zooming', async () => {
    const onOpenBar = vi.fn()
    render(<ScheduleGantt taskId="task-a" onOpenBar={onOpenBar} />)
    fireEvent.click(await screen.findByRole('button', { name: /pick_plate/ }))
    expect(onOpenBar).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'node-1' }))
    expect(navigateTo).not.toHaveBeenCalled()

    expect(screen.queryByText('自定义视图')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '放大时间轴' }))
    expect(screen.getByText('自定义视图')).toBeInTheDocument()
    fireEvent.click(screen.getByText('全部'))
    expect(screen.queryByText('自定义视图')).not.toBeInTheDocument()
  })

  it('shows an empty state when the scheduler has no records', async () => {
    holder.current.core.schedulerTimePlan.getTimeline.mockResolvedValue(
      decodeSchedulerTimeline({ now: NOW }),
    )
    render(<ScheduleGantt />)
    expect(await screen.findByText('暂无调度记录')).toBeInTheDocument()
  })

  it('keeps showing device ids when the device list cannot be read', async () => {
    holder.current.core.deviceActions.listDevices.mockRejectedValue(new Error('devices down'))
    render(<ScheduleGantt />)
    await waitFor(() => expect(screen.getAllByText('robot').length).toBeGreaterThan(0))
    expect(screen.queryByText('机械臂')).not.toBeInTheDocument()
  })
})
