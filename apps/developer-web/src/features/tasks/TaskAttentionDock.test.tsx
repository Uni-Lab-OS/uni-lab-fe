import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TaskAttentionDock } from './TaskAttentionDock'

describe('TaskAttentionDock', () => {
  it('floats the pending items outside the page flow and can collapse to its header', () => {
    render(
      <TaskAttentionDock count={1} attentionKey="job-1">
        <section aria-label="待处理节点">去确认</section>
      </TaskAttentionDock>,
    )
    const dock = screen.getByRole('complementary', { name: '需要处理' })
    expect(dock).toContainElement(screen.getByRole('region', { name: '待处理节点' }))
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    expect(screen.getByRole('button', { name: '展开' })).toHaveAttribute('aria-expanded', 'false')
    // 收起后子组件仍挂载（处理中的对话框与读取状态不丢），只是不显示
    expect(screen.getByText('去确认', { selector: 'section' }).parentElement).toHaveAttribute(
      'hidden',
    )
  })

  it('expands again only when a new pending node appears', () => {
    const { rerender } = render(
      <TaskAttentionDock count={1} attentionKey="job-1">
        <section>事项</section>
      </TaskAttentionDock>,
    )
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    rerender(
      <TaskAttentionDock count={1} attentionKey="job-1">
        <section>事项</section>
      </TaskAttentionDock>,
    )
    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument()
    rerender(
      <TaskAttentionDock count={0} attentionKey="">
        <section>事项</section>
      </TaskAttentionDock>,
    )
    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument()
    rerender(
      <TaskAttentionDock count={2} attentionKey="job-1|job-2">
        <section>事项</section>
      </TaskAttentionDock>,
    )
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true')
  })
})
