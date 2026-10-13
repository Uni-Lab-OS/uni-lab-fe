import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SummaryStrip } from './OverviewSections'
import type { TaskRow } from './taskPresentation'

const row = (status: string): TaskRow =>
  ({
    name: `任务 ${status}`,
    workflowName: '工作流',
    status,
    progress: 0,
    time: '2026-10-13 10:00:00',
    task: { taskUuid: `uuid-${status}` },
  }) as never

describe('overview summary strip', () => {
  it('counts attention and failed tasks in the 异常 metric', () => {
    render(<SummaryStrip rows={[row('attention'), row('failed'), row('running')]} />)

    const metric = screen.getByText('异常').closest('div')
    expect(metric).not.toBeNull()
    expect(metric?.textContent).toContain('异常2')
  })

  it('carries the station entry on the 异常 metric instead of a page-wide banner', () => {
    const onHandle = vi.fn()
    const onSeeAll = vi.fn()
    render(
      <SummaryStrip
        rows={[row('failed')]}
        stationAlert={{
          hint: '工站调度已暂停',
          primary: { label: '去处置', onClick: onHandle },
          secondary: { label: '查看全部', onClick: onSeeAll },
        }}
      />,
    )

    expect(screen.getByText('工站调度已暂停')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '去处置' }))
    expect(onHandle).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))
    expect(onSeeAll).toHaveBeenCalledTimes(1)
  })

  it('stays a plain metric while the station needs no action', () => {
    render(<SummaryStrip rows={[row('failed')]} />)

    expect(screen.queryByRole('button', { name: '去处置' })).not.toBeInTheDocument()
    expect(screen.queryByText('工站调度已暂停')).not.toBeInTheDocument()
  })
})
