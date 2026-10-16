import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { decodeHumanInteraction, type WorkflowDebugTimelineItem } from '@unilab-fe/core'
import { TaskHumanInteractionPanel } from './TaskHumanInteractionPanel'
import { summarizeHumanWork, timelineSignature } from './humanInteractionModel'
import { toImagePixel } from './SketchCanvas'

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

const { listForTask, reply, capability, backend } = vi.hoisted(() => {
  const listForTask = vi.fn()
  const reply = vi.fn()
  const capability = { available: true, reason: undefined as string | undefined }
  return {
    listForTask,
    reply,
    capability,
    backend: {
      getCapabilityStatus: () => capability,
      core: {
        humanInteractions: {
          listForTask,
          reply,
          resolveImageUrl: (image: string) =>
            image.startsWith('/api/') ? `http://os.test${image}` : null,
        },
      },
    },
  }
})
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend }) }))

/** 与设备包 photoscrape_process 的 human.review 请求同形。 */
const reviewRow = (overrides: Record<string, unknown> = {}) => ({
  uuid: 'interaction-1',
  job_uuid: 'job-review',
  task_uuid: 'task-1',
  kind: 'review',
  status: 'pending',
  opened_at: '2026-10-16T08:00:00+00:00',
  deadline_at: '2099-10-17T08:00:00+00:00',
  decided_at: null,
  result: null,
  arguments: {
    prompt: '识别完成\n可选条带：band_01, band_02',
    options: ['dispatch', 'select_band', 'reanalyze', 'sketch', 'skip', 'abort'],
    labels: [
      '下发当前路径',
      '更换条带',
      '重新识别并预览',
      '手绘并预览',
      '跳过刮板',
      '中止并释放板',
    ],
    forms: ['none', 'text', 'numbers', 'sketch', 'none', 'none'],
    image: '/api/vision/image/candidates/c1/preview.png',
    text_default: 'band_01',
    number_labels: [
      '板朝向（0/90/180/270）',
      '自动矫正（0/1）',
      '最小矫正角（度）',
      '行评分阈值',
      '相机滚转角（度）',
    ],
    number_defaults: [0, 1, 0.5, 5, -2.43],
    timeout_seconds: 86400,
  },
  ...overrides,
})

const job = (overrides: Partial<WorkflowDebugTimelineItem> = {}): WorkflowDebugTimelineItem => ({
  jobUuid: 'job-review',
  workflowNodeUuid: 'node-review',
  nodeLabel: '人工复核刮取路径',
  status: 'pending',
  attempt: 1,
  topologicalIndex: 1,
  executorKind: 'workflow_command',
  startedAt: null,
  finishedAt: null,
  waitReason: {},
  errorInfo: [],
  ...overrides,
})

function renderPanel(timeline = [job()]) {
  return render(
    <TaskHumanInteractionPanel taskUuid="task-1" timeline={timeline} taskVersion="running:1" />,
  )
}

async function openDialog() {
  renderPanel()
  fireEvent.click(await screen.findByRole('button', { name: /^处\s*理$/ }))
  return screen.findByRole('dialog')
}

async function confirmSubmit(dialog: HTMLElement, label: string) {
  fireEvent.click(within(dialog).getByRole('button', { name: `提交：${label}` }))
  fireEvent.click(await screen.findByRole('button', { name: /^提\s*交$/ }))
}

beforeEach(() => {
  listForTask.mockReset().mockResolvedValue([decodeHumanInteraction(reviewRow())])
  reply.mockReset().mockResolvedValue(decodeHumanInteraction(reviewRow({ status: 'answered' })))
  capability.available = true
  capability.reason = undefined
})

describe('TaskHumanInteractionPanel', () => {
  it('surfaces a pending review at task level and submits a plain choice with all seven fields', async () => {
    const dialog = await openDialog()
    expect(within(dialog).getByText(/可选条带/)).toBeTruthy()
    fireEvent.click(within(dialog).getByLabelText('下发当前路径'))
    await confirmSubmit(dialog, '下发当前路径')
    await waitFor(() =>
      expect(reply).toHaveBeenCalledWith('interaction-1', {
        choice: 'dispatch',
        text: 'band_01',
        values: [0, 1, 0.5, 5, -2.43],
        x: [],
        y: [],
        corner_x: [],
        corner_y: [],
      }),
    )
    // 回复后重读 OS 权威状态，界面不自行宣布后续动作完成。
    await waitFor(() => expect(listForTask).toHaveBeenCalledTimes(2))
    expect(await within(dialog).findByText('已提交，OS 已记录回复')).toBeTruthy()
  })

  it('collects edited recognition parameters only for the numbers form', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByLabelText(/重新识别并预览/))
    const inputs = within(dialog).getAllByRole('spinbutton')
    expect(inputs).toHaveLength(5)
    fireEvent.change(inputs[0]!, { target: { value: '90' } })
    fireEvent.blur(inputs[0]!)
    await confirmSubmit(dialog, '重新识别并预览')
    await waitFor(() => expect(reply).toHaveBeenCalled())
    expect(reply.mock.calls[0]![1]).toMatchObject({
      choice: 'reanalyze',
      values: [90, 1, 0.5, 5, -2.43],
      x: [],
    })
  })

  it('records sketch points in original image pixels and enforces at least three points', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByLabelText(/手绘并预览/))
    const image = within(dialog).getByAltText('人工复核图片') as HTMLImageElement
    Object.defineProperty(image, 'naturalWidth', { value: 2000 })
    Object.defineProperty(image, 'naturalHeight', { value: 1000 })
    fireEvent.load(image)
    const overlay = await within(dialog).findByRole('application')
    // 图片显示为 500×250 CSS 像素：坐标需放大 4 倍回到原图像素。
    overlay.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 500, height: 250 }) as DOMRect
    expect(within(dialog).getByText('手绘轮廓至少需要 3 个点')).toBeTruthy()
    for (const [x, y] of [
      [110, 60],
      [200, 60],
      [200, 150],
    ])
      fireEvent.click(overlay, { clientX: x, clientY: y })
    await confirmSubmit(dialog, '手绘并预览')
    await waitFor(() => expect(reply).toHaveBeenCalled())
    expect(reply.mock.calls[0]![1]).toMatchObject({
      choice: 'sketch',
      x: [40, 400, 400],
      y: [40, 40, 400],
      corner_x: [],
      corner_y: [],
    })
  })

  it('explains an unloadable image and blocks sketching instead of guessing coordinates', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByLabelText(/手绘并预览/))
    fireEvent.error(within(dialog).getByAltText('人工复核图片'))
    expect(await within(dialog).findByText('图片无法加载')).toBeTruthy()
    expect(within(dialog).getByText('图片未加载，无法在原始像素坐标上手绘')).toBeTruthy()
    expect(
      (within(dialog).getByRole('button', { name: '提交：手绘并预览' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('shows the OS rejection and re-reads authoritative state when a reply is refused', async () => {
    reply.mockRejectedValueOnce(new Error('人工交互已结束、超时或任务已取消；不能提交旧轮次回复'))
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByLabelText('跳过刮板'))
    await confirmSubmit(dialog, '跳过刮板')
    expect(await within(dialog).findByText(/不能提交旧轮次回复/)).toBeTruthy()
  })

  it('hints when a workflow command waits but the OS has not opened its request yet', async () => {
    listForTask.mockResolvedValue([])
    renderPanel([job({ jobUuid: 'job-next' })])
    expect(await screen.findByText(/OS 尚未返回人工交互请求/)).toBeTruthy()
    const refresh = screen.getByRole('button', { name: /刷\s*新/ })
    await waitFor(() => expect(refresh.className).not.toContain('ant-btn-loading'))
    fireEvent.click(refresh)
    await waitFor(() => expect(listForTask).toHaveBeenCalledTimes(2))
  })

  it('fails visibly when the backend has not declared the capability', async () => {
    capability.available = false
    capability.reason = 'Uni-Lab OS 尚未声明 workflow.humanInteraction 能力'
    renderPanel()
    expect(await screen.findByText('任务在等待人工交互，但当前后端未声明该能力')).toBeTruthy()
    expect(listForTask).not.toHaveBeenCalled()
  })

  it('keeps finished requests read-only in history', async () => {
    listForTask.mockResolvedValue([
      decodeHumanInteraction(
        reviewRow({
          status: 'answered',
          result: { choice: 'skip' },
          decided_at: '2026-10-16T08:05:00+00:00',
        }),
      ),
    ])
    renderPanel([job({ status: 'succeeded' })])
    expect(await screen.findByText('已结束 1 项')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^处\s*理$/ })).toBeNull()
    await act(async () => undefined)
  })
})

describe('humanInteractionModel', () => {
  it('re-reads when the SSE-driven job snapshot changes', () => {
    expect(timelineSignature([job()])).not.toBe(timelineSignature([job({ status: 'succeeded' })]))
  })

  it('separates pending, settled and not-yet-opened requests', () => {
    const pending = decodeHumanInteraction(reviewRow())
    const summary = summarizeHumanWork(
      [job(), job({ jobUuid: 'job-2' }), job({ jobUuid: 'job-3', executorKind: 'device_action' })],
      [pending],
    )
    expect(summary.pending).toHaveLength(1)
    expect(summary.awaitingRequest.map((item) => item.jobUuid)).toEqual(['job-2'])
  })

  it('maps screen points to original pixels and ignores clicks outside the image', () => {
    const rect = { left: 0, top: 0, width: 100, height: 50 }
    expect(toImagePixel(rect, 50, 25, { width: 1000, height: 500 })).toEqual({ x: 500, y: 250 })
    expect(toImagePixel(rect, 150, 25, { width: 1000, height: 500 })).toBeNull()
  })
})
