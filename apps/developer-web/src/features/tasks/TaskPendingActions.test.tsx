import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { pendingOperatorEvents, TaskPendingActions } from './TaskPendingActions'
import type { TimelineEvent } from './taskDetailModel'

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

const event = (
  id: string,
  status: TimelineEvent['status'],
  extra: Partial<TimelineEvent> = {},
): TimelineEvent => ({
  id,
  time: '未开始',
  title: `节点 ${id}`,
  group: 'manual_confirm',
  description: '',
  status,
  duration: '',
  ...extra,
})

describe('TaskPendingActions', () => {
  it('lists only current-attempt manual confirmations and unknown results', () => {
    const events = [
      event('a', 'manual'),
      event('b', 'unknown'),
      event('c', 'running'),
      event('d', 'manual', { currentAttempt: false }),
    ]
    expect(pendingOperatorEvents(events).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('opens the node from the strip and hides when nothing waits', () => {
    const onOpen = vi.fn()
    const { rerender, container } = render(
      <TaskPendingActions events={[event('a', 'manual')]} onOpen={onOpen} />,
    )
    expect(screen.getByText('待处理 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /去确认/ }))
    expect(onOpen).toHaveBeenCalledWith('a')
    rerender(<TaskPendingActions events={[event('a', 'success')]} onOpen={onOpen} />)
    expect(container.textContent).toBe('')
  })
})

describe('activeEventsLabel', () => {
  it('lists parallel active nodes with their device and folds the rest', async () => {
    const { activeEventsLabel } = await import('./TaskDetailSummary')
    const events = ['a', 'b', 'c', 'd'].map((id) => event(id, 'running', { device: 'robot' }))
    expect(activeEventsLabel(events.slice(0, 2))).toBe('robot·节点 a，robot·节点 b')
    expect(activeEventsLabel(events)).toBe('robot·节点 a，robot·节点 b，robot·节点 c 等 4 个')
  })
})
