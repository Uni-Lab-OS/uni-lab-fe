import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DebugActionButton } from './TaskDetailIcons'

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

describe('DebugActionButton', () => {
  it('asks for confirmation before an irreversible command', async () => {
    const onClick = vi.fn()
    render(
      <DebugActionButton
        label="取消任务"
        confirm={{ title: '取消该任务？', okText: '确认取消' }}
        onClick={onClick}
      >
        x
      </DebugActionButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }))
    expect(onClick).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /确认取消/ }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('runs plain commands directly', () => {
    const onClick = vi.fn()
    render(
      <DebugActionButton label="暂停任务" onClick={onClick}>
        x
      </DebugActionButton>,
    )
    fireEvent.click(screen.getByRole('button', { name: '暂停任务' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
