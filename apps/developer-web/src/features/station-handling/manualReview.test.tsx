import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ManualActionReviewSection } from './ManualActionReviewSection'
import { ManualReviewForm } from './ManualReviewForm'
import {
  createStationPortStub,
  createStudioBackendStub,
  makeManualActionJob,
  StationProviders,
} from '../../../test/stationHandlingStub'

// 工站上下文要连真实后端替身：缺了它 useBackendQuery 会打真网络，界面只会渲染成读取失败。
const stationPort = createStationPortStub()
const backend = createStudioBackendStub({ core: { stationErrorHandling: stationPort } })
vi.mock('../../app/backend', () => ({ createStudioBackend: () => backend }))

describe('manual review form', () => {
  it('requires both the note and the on-site confirmation', async () => {
    const onSubmit = vi.fn(async () => true)
    render(<ManualReviewForm pending={false} onSubmit={onSubmit} />)

    // 勾选可能勾选，但没写说明 → 不能提交
    fireEvent.click(screen.getByLabelText(/我已现场核对/))
    fireEvent.click(screen.getByRole('button', { name: /保存核对记录/ }))
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('核对说明'), {
      target: { value: '夹爪已停止，内部无异物' },
    })
    fireEvent.click(screen.getByRole('button', { name: /保存核对记录/ }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('夹爪已停止，内部无异物'))
  })

  it('never claims the review changed the execution result', () => {
    render(<ManualReviewForm pending={false} onSubmit={vi.fn(async () => true)} />)
    expect(screen.getByText(/不会改变动作的实际执行结果/)).toBeInTheDocument()
  })
})

describe('manual action review section', () => {
  const job = makeManualActionJob()

  beforeEach(() => vi.clearAllMocks())

  it('offers the form for an ended action that has not been reviewed', async () => {
    render(<ManualActionReviewSection action={job} />, { wrapper: StationProviders })
    await waitFor(() => expect(screen.getByLabelText('核对说明')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /保存核对记录/ })).toBeInTheDocument()
  })

  it('shows the audit record instead of the form once reviewed', async () => {
    render(<ManualActionReviewSection action={makeManualActionJob({ resultReviewed: true })} />, {
      wrapper: StationProviders,
    })
    expect(await screen.findByText('结果已人工核对')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /保存核对记录/ })).not.toBeInTheDocument()
  })

  it('explains the uncertainty instead of hiding it', async () => {
    render(
      <ManualActionReviewSection
        action={makeManualActionJob({ uncertaintyReason: '设备未回传明确终态' })}
      />,
      { wrapper: StationProviders },
    )
    expect(await screen.findByText(/设备未回传明确终态/)).toBeInTheDocument()
  })
})
