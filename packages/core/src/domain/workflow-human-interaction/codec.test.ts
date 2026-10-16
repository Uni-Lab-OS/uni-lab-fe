import { describe, expect, it } from 'vitest'
import {
  buildHumanInteractionReply,
  decodeHumanInteraction,
  HumanInteractionInputError,
} from './codec'
import { WorkflowHumanInteractionClient } from './client'
import type { RequestTransport, TransportRequest, TransportResponse } from '../../transport/request'

/** 与设备包 photoscrape_process 的 human.review 请求同形。 */
export const REVIEW_ROW = {
  uuid: 'interaction-1',
  job_uuid: 'job-1',
  task_uuid: 'task-1',
  kind: 'review',
  status: 'pending',
  opened_at: '2026-10-16T08:00:00+00:00',
  deadline_at: '2026-10-17T08:00:00+00:00',
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
}

const review = decodeHumanInteraction(REVIEW_ROW)

describe('decodeHumanInteraction', () => {
  it('keeps options, forms and numeric defaults of a review request', () => {
    expect(review.interactionKind).toBe('review')
    expect(review.options.map((option) => [option.value, option.form])).toEqual([
      ['dispatch', 'none'],
      ['select_band', 'text'],
      ['reanalyze', 'numbers'],
      ['sketch', 'sketch'],
      ['skip', 'none'],
      ['abort', 'none'],
    ])
    expect(review.textDefault).toBe('band_01')
    expect(review.numberDefaults).toEqual([0, 1, 0.5, 5, -2.43])
  })

  it('maps numbers and text arguments onto the shared fields', () => {
    const numbers = decodeHumanInteraction({
      ...REVIEW_ROW,
      kind: 'numbers',
      arguments: { prompt: '体积', labels: ['A', 'B'], defaults: [1, 2] },
    })
    expect(numbers.numberLabels).toEqual(['A', 'B'])
    expect(numbers.options).toEqual([])
    const text = decodeHumanInteraction({
      ...REVIEW_ROW,
      kind: 'text',
      arguments: { prompt: '备注', default: 'x' },
    })
    expect(text.textDefault).toBe('x')
  })

  it('rejects malformed requests instead of guessing', () => {
    expect(() =>
      decodeHumanInteraction({
        ...REVIEW_ROW,
        arguments: { ...REVIEW_ROW.arguments, forms: ['none'] },
      }),
    ).toThrow(HumanInteractionInputError)
    expect(() => decodeHumanInteraction({ ...REVIEW_ROW, kind: 'approve' })).toThrow(
      HumanInteractionInputError,
    )
  })
})

describe('buildHumanInteractionReply (mirrors OS HumanInteractionStore.validate)', () => {
  it('sends all seven review fields with defaults and empty coordinates for a plain choice', () => {
    expect(buildHumanInteractionReply(review, { choice: 'dispatch' })).toEqual({
      choice: 'dispatch',
      text: 'band_01',
      values: [0, 1, 0.5, 5, -2.43],
      x: [],
      y: [],
      corner_x: [],
      corner_y: [],
    })
  })

  it('uses operator text and numbers only for the matching form', () => {
    expect(
      buildHumanInteractionReply(review, {
        choice: 'select_band',
        text: 'band_02',
        values: [9, 9, 9, 9, 9],
      }),
    ).toMatchObject({ text: 'band_02', values: [0, 1, 0.5, 5, -2.43] })
    expect(
      buildHumanInteractionReply(review, { choice: 'reanalyze', values: [90, 0, 1, 4, 0] }),
    ).toMatchObject({
      text: 'band_01',
      values: [90, 0, 1, 4, 0],
    })
  })

  it('validates sketches before they reach the OS', () => {
    const sketch = { x: [1, 2, 3], y: [4, 5, 6], cornerX: [], cornerY: [] }
    expect(buildHumanInteractionReply(review, { choice: 'sketch', sketch })).toMatchObject({
      choice: 'sketch',
      x: [1, 2, 3],
      corner_x: [],
    })
    expect(() =>
      buildHumanInteractionReply(review, {
        choice: 'sketch',
        sketch: { ...sketch, x: [1, 2], y: [1, 2] },
      }),
    ).toThrow('至少需要 3 个点')
    expect(() =>
      buildHumanInteractionReply(review, {
        choice: 'sketch',
        sketch: { ...sketch, cornerX: [1], cornerY: [1] },
      }),
    ).toThrow('4 个')
  })

  it('rejects unknown choices and wrong value counts', () => {
    expect(() => buildHumanInteractionReply(review, { choice: 'approve' })).toThrow('选项')
    expect(() => buildHumanInteractionReply(review, { choice: 'reanalyze', values: [1] })).toThrow(
      '5 个数值',
    )
    expect(() =>
      buildHumanInteractionReply(review, { choice: 'reanalyze', values: [1, 2, Number.NaN, 4, 5] }),
    ).toThrow('最小矫正角')
  })
})

describe('WorkflowHumanInteractionClient', () => {
  it('lists and replies through the OS v1 routes and unwraps the envelope', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(input: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(input)
        const data = input.method === 'GET' ? [REVIEW_ROW] : { ...REVIEW_ROW, status: 'answered' }
        return { status: 200, headers: {}, data: { code: 0, data } as Value }
      },
    }
    const client = new WorkflowHumanInteractionClient(
      transport,
      'http://127.0.0.1:4180/__unilab_backend',
    )
    const items = await client.listForTask('task/1')
    const answered = await client.reply('interaction-1', { choice: 'skip' })
    expect(requests.map((item) => [item.method, item.url])).toEqual([
      ['GET', '/api/v1/workflow-tasks/task%2F1/human-interactions'],
      ['POST', '/api/v1/workflow-human-interactions/interaction-1/reply'],
    ])
    expect(items[0]?.interactionUuid).toBe('interaction-1')
    expect(answered.status).toBe('answered')
  })

  it('resolves OS image paths against the backend base and refuses local file paths', () => {
    const client = new WorkflowHumanInteractionClient(
      { request: async () => ({ status: 200, headers: {}, data: null as never }) },
      'http://127.0.0.1:4180/__unilab_backend/',
    )
    expect(client.resolveImageUrl('/api/vision/image/a.png')).toBe(
      'http://127.0.0.1:4180/__unilab_backend/api/vision/image/a.png',
    )
    expect(client.resolveImageUrl('/Users/dp/results/after.jpg')).toBeNull()
    expect(client.resolveImageUrl('http://evil.example/a.png')).toBeNull()
    expect(client.resolveImageUrl('')).toBeNull()
  })
})

describe('captured OS response', () => {
  it('decodes a review list produced by the real OS scheduler bridge', async () => {
    // 由 OS TaskSchedulerBridge + workflow_api 实际生成（2026-10-16，Uni-Lab-OS 23ad5c4b）。
    const captured = (await import('./os-review-list.fixture.json')).default
    const [item] = captured.data.map(decodeHumanInteraction)
    expect(item).toMatchObject({
      interactionKind: 'review',
      status: 'pending',
      textDefault: 'band_01',
    })
    expect(buildHumanInteractionReply(item!, { choice: 'dispatch' })).toEqual({
      choice: 'dispatch',
      text: 'band_01',
      values: [0, 1, 0.5, 5, -2.43],
      x: [],
      y: [],
      corner_x: [],
      corner_y: [],
    })
  })
})
