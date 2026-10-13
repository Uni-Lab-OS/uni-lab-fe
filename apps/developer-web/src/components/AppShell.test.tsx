import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AppShell } from './AppShell'
import {
  createStationPortStub,
  createStudioBackendStub,
  makeStationError,
  makeStationSnapshot,
  StationProviders,
} from '../../test/stationHandlingStub'

const backendDispose = vi.hoisted(() => vi.fn())

const stationPort = createStationPortStub()
const backend = createStudioBackendStub({
  dispose: backendDispose,
  core: { stationErrorHandling: stationPort },
})
vi.mock('../app/backend', () => ({ createStudioBackend: () => backend }))

beforeEach(() => {
  stationPort.getSnapshot.mockReset()
  stationPort.getSnapshot.mockResolvedValue(makeStationSnapshot())
})

describe('AppShell', () => {
  it('renders navigation and toggles collapsed sidebar', () => {
    const onNavigate = vi.fn()
    render(
      <StationProviders>
        <AppShell route="workflows" onNavigate={onNavigate}>
          <p>内容</p>
        </AppShell>
      </StationProviders>,
    )
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '工作流' }).className).toContain('is-active')
    fireEvent.click(screen.getByRole('button', { name: '设备' }))
    expect(onNavigate).toHaveBeenCalledWith('devices')
    const toggle = screen.getByRole('button', { name: '收起侧边栏' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '总览' })).toBeInTheDocument()
  })

  it('marks the overview navigation item when a task needs attention', () => {
    render(
      <StationProviders>
        <AppShell route="tasks" onNavigate={vi.fn()} hasOverviewAttention>
          <p>内容</p>
        </AppShell>
      </StationProviders>,
    )
    expect(screen.getByRole('navigation', { name: '主导航' })).toHaveTextContent('总览1')
  })

  it('does not render a persistent station banner on any route', async () => {
    stationPort.getSnapshot.mockResolvedValue(
      makeStationSnapshot({ mode: 'PAUSED', errors: [makeStationError()] }),
    )
    // role=status 的文本不参与可访问名，按内容过滤而不是按 name 匹配。
    const banners = () =>
      screen.queryAllByRole('status').filter((node) => node.textContent?.includes('工站调度已暂停'))

    const overview = render(
      <StationProviders>
        <AppShell route="overview" onNavigate={vi.fn()}>
          <p>内容</p>
        </AppShell>
      </StationProviders>,
    )
    await waitFor(() => expect(stationPort.getSnapshot).toHaveBeenCalled())
    // 总览异常指标卡承担入口，应用壳不再渲染常驻横幅。
    expect(banners()).toHaveLength(0)
    overview.unmount()

    render(
      <StationProviders>
        <AppShell route="tasks" onNavigate={vi.fn()}>
          <p>内容</p>
        </AppShell>
      </StationProviders>,
    )
    await waitFor(() => expect(stationPort.getSnapshot).toHaveBeenCalled())
    expect(banners()).toHaveLength(0)
  })

  it('rejects useBackend outside provider', async () => {
    const { useBackend } = await import('../app/BackendProvider')
    function Consumer() {
      useBackend()
      return null
    }
    expect(() => render(<Consumer />)).toThrow('useBackend 必须在 BackendProvider 内使用')
  })

  it('disposes the backend composition when the provider unmounts', () => {
    backendDispose.mockClear()
    const view = render(
      <StationProviders>
        <AppShell route="overview" onNavigate={vi.fn()}>
          <p>内容</p>
        </AppShell>
      </StationProviders>,
    )
    view.unmount()
    expect(backendDispose).toHaveBeenCalledOnce()
  })
})
