import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AsyncState } from './AsyncState'

describe('AsyncState', () => {
  it('renders default and table loading states', () => {
    const { rerender } = render(<AsyncState loading error={undefined} onRetry={vi.fn()}>content</AsyncState>)
    expect(document.querySelector('.async-state, [class*="async-state"]')).toBeInTheDocument()
    rerender(<AsyncState loading error={undefined} onRetry={vi.fn()} variant="table" tableColumns={1}>content</AsyncState>)
    expect(screen.getByRole('status', { name: '正在加载表格' })).toBeInTheDocument()
    expect(screen.getByRole('status').querySelectorAll('span')).toHaveLength(12)
    rerender(<AsyncState loading error={undefined} onRetry={vi.fn()} variant="table" loadingContent={<p>自定义加载</p>}>content</AsyncState>)
    expect(screen.getByText('自定义加载')).toBeInTheDocument()
  })

  it('presents errors, conflict messages, retry and empty states', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<AsyncState loading={false} error={new Error('普通错误')} onRetry={onRetry}>content</AsyncState>)
    expect(screen.getByText('普通错误')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledOnce()
    rerender(<AsyncState loading={false} error={new Error('develop_task_conflict:t-1:pending')} onRetry={onRetry}>content</AsyncState>)
    expect(screen.getByText(/等待中/)).toBeInTheDocument()
    rerender(<AsyncState loading={false} empty emptyDescription="没有记录" onRetry={onRetry}>content</AsyncState>)
    expect(screen.getByText('没有记录')).toBeInTheDocument()
    rerender(<AsyncState loading={false} onRetry={onRetry}>已加载</AsyncState>)
    expect(screen.getByText('已加载')).toBeInTheDocument()
  })
})
