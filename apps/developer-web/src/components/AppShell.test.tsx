import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AppShell } from './AppShell'
import { BackendProvider } from '../app/BackendProvider'

const backendDispose = vi.hoisted(() => vi.fn())

vi.mock('../app/backend', () => ({
  createStudioBackend: () => ({ dispose: backendDispose }),
}))

function renderShell(connection = 'unknown' as const) {
  return render(
    <BackendProvider>
      <AppShell route="overview" onNavigate={vi.fn()}>
        <p>内容</p>
      </AppShell>
    </BackendProvider>,
  )
}

describe('AppShell', () => {
  it('renders navigation and toggles collapsed sidebar', () => {
    const onNavigate = vi.fn()
    render(
      <BackendProvider>
        <AppShell route="workflows" onNavigate={onNavigate}><p>内容</p></AppShell>
      </BackendProvider>,
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
      <BackendProvider>
        <AppShell route="overview" onNavigate={vi.fn()}><p>内容</p></AppShell>
      </BackendProvider>,
    )
    view.unmount()
    expect(backendDispose).toHaveBeenCalledOnce()
  })
})
