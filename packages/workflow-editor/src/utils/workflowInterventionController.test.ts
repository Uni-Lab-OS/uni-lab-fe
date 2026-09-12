import { describe, expect, it, vi } from 'vitest'
import type { WorkflowIntervention, WorkflowRuntimePort, WorkflowRuntimeSubscriptionOptions } from '@unilab/services'
import { createWorkflowInterventionController } from './workflowInterventionController'

const open = (): WorkflowIntervention => ({ uuid: 'i1', workflow_task_uuid: 't1', workflow_node_job_uuid: 'j1', revision: 1,
  status: 'open', description: 'TCP: 温度异常 <script>', meta_data: {}, options: [{ id: 'retry', label: '重试' }], delivery_status: 'none' })
function fixture() {
  let rows = [open()]
  let options: WorkflowRuntimeSubscriptionOptions = {}
  let invalidate: (event: any) => void = () => {}
  const list = vi.fn(async (status: string) => rows.filter(row => row.status === status))
  const get = vi.fn(async () => rows[0]!)
  const decide = vi.fn(async () => ({ intervention: rows[0]!, command_uuid: 'c1', created: true }))
  const dispose = vi.fn()
  const runtime = { interventions: { list, get, decide },
    getWorkflowNodeJob: vi.fn(async () => ({ error_info: ['TCP fallback'] })),
    subscribeWorkflowRuntime: vi.fn((callback, opts) => { invalidate = callback; options = opts; return { dispose } })
  } as unknown as WorkflowRuntimePort
  return { controller: createWorkflowInterventionController(runtime), runtime, list, get, decide, dispose,
    setRows: (next: WorkflowIntervention[]) => { rows = next }, reconnect: () => options.onOpen?.({ lastEventId: '1', reconnected: true }),
    disconnect: () => options.onError?.(new Error('SSE disconnected')),
    invalidate: () => invalidate({ event: 'workflow.runtime.changed', data: { workflow_task_uuid: 't1' } }) }
}

describe('workflow intervention controller', () => {
  it('preserves a conflict through refresh and reconnect until authoritative completion', async () => {
    const f = fixture(); const stop = f.controller.start()
    await f.controller.refresh()
    f.decide.mockRejectedValueOnce(new Error('409 库位确认冲突'))
    await f.controller.decide('i1', 'retry')
    f.controller.minimize()
    await f.controller.refresh()
    f.reconnect(); await f.controller.refresh()
    expect(f.controller.getSnapshot()).toMatchObject({ minimized: true, error: '409 库位确认冲突' })
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    f.setRows([{ ...open(), status: 'superseded' }]); await f.controller.refresh()
    expect(f.controller.getSnapshot().items).toEqual([])
    expect(f.controller.getSnapshot().error).toBeNull()
    stop()
  })

  it('keeps the pending item during submission and retains its conflict when authority cannot be read', async () => {
    const f = fixture(); await f.controller.refresh()
    let rejectDecision!: (error: Error) => void
    f.decide.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDecision = reject }))
    const pending = f.controller.decide('i1', 'retry')
    expect(f.controller.getSnapshot()).toMatchObject({ busy: 'i1', items: [open()] })
    f.list.mockRejectedValue(new Error('REST offline'))
    rejectDecision(new Error('409 当前方案冲突')); await pending
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    expect(f.controller.getSnapshot().error).toBe('REST offline\n409 当前方案冲突')
    expect(f.controller.getSnapshot().offline).toBe(true)
    expect(f.controller.getSnapshot().busy).toBeNull()
  })

  it('uses public TCP error text without rendering delivery metadata as an error', async () => {
    const f = fixture()
    const report = { error_message: 'TCP 原始异常', traceback: 'trace detail' }
    f.setRows([{ ...open(), description: '优先原始描述', meta_data: { error_report: report, delivery_payload: { option_id: 'retry' } } }])
    await f.controller.refresh()
    expect(f.controller.getSnapshot().messages.i1).toBe('优先原始描述')
    f.setRows([{ ...open(), description: undefined, meta_data: { error_report: report } }])
    await f.controller.refresh()
    expect(f.controller.getSnapshot().messages.i1).toBe('TCP 原始异常')
    expect(f.runtime.getWorkflowNodeJob).not.toHaveBeenCalled()
  })

  it('does not leave a phantom failure window when a rejected response is followed by authoritative completion', async () => {
    const f = fixture(); await f.controller.refresh()
    f.decide.mockImplementationOnce(async () => {
      f.setRows([{ ...open(), status: 'superseded' }]); throw new Error('response lost')
    })
    await f.controller.decide('i1', 'retry')
    expect(f.controller.getSnapshot().items).toEqual([])
    expect(f.controller.getSnapshot().error).toBeNull()
  })

  it('confirms only frozen loading request identity and replays the identical payload', async () => {
    const f = fixture()
    const item = { ...open(), description: undefined, options: [{ id: 'confirm_loading' }], meta_data: { loading: {
      schema_version: 1, request_uuid: 'loading-request', revision: 4,
      rows: [{ key: 'row', instrument: { id: 'instrument', label: '仪器' }, site: { id: 'site', label: '库位' },
        material: { identity: 'planned', label: '物料' }, quantity: 1, unit: '块', availability: { allowed: true } }]
    } } }
    f.setRows([item]); await f.controller.refresh()
    expect(f.runtime.getWorkflowNodeJob).not.toHaveBeenCalled()
    f.decide.mockImplementationOnce(async () => {
      f.setRows([{ ...item, status: 'selected', selected_option_id: 'confirm_loading', delivery_status: 'unknown' }])
      throw new Error('409 uncertain')
    })
    await f.controller.decide('i1', 'confirm_loading')
    expect(f.decide).toHaveBeenCalledWith('i1', { revision: 1, option_id: 'confirm_loading',
      result: { request_uuid: 'loading-request', revision: 4 } }, expect.any(String))
    await f.controller.decide('i1', 'confirm_loading')
    expect(f.decide.mock.calls[1]).toEqual(f.decide.mock.calls[0])
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    f.setRows([{ ...item, status: 'superseded' }]); await f.controller.refresh()
    expect(f.controller.getSnapshot().items).toHaveLength(0)
  })

  it('refuses malformed loading or stale authority instead of using a generic decision', async () => {
    const f = fixture(); f.setRows([{ ...open(), options: [{ id: 'confirm_loading' }], meta_data: {} }])
    await f.controller.refresh(); await f.controller.decide('i1', 'confirm_loading')
    expect(f.decide).not.toHaveBeenCalled()
    expect(f.controller.getSnapshot().error).toContain('入库明细')
    f.setRows([open()]); await f.controller.refresh()
    f.list.mockRejectedValueOnce(new Error('REST unavailable'))
    await f.controller.refresh(); await f.controller.decide('i1', 'retry')
    expect(f.controller.getSnapshot().offline).toBe(true)
    expect(f.decide).not.toHaveBeenCalled()
  })

  it('ignores host offline state when the profile has no intervention capability', () => {
    const controller = createWorkflowInterventionController({} as WorkflowRuntimePort)
    controller.setOnline(false)
    expect(controller.getSnapshot().error).toBeNull()
    expect(controller.getSnapshot().items).toEqual([])
  })
  it('replays frozen unknown delivery with the original option and key, never accepted delivery', async () => {
    const f = fixture(); await f.controller.refresh()
    const selected = { ...open(), status: 'selected' as const, selected_option_id: 'retry', delivery_status: 'unknown' as const }
    f.decide.mockImplementationOnce(async () => { f.setRows([selected]); throw new Error('409 delivery unknown') })
    await f.controller.decide('i1', 'retry')
    expect(f.controller.getSnapshot().replayable).toEqual(['i1'])
    await f.controller.decide('i1', 'different-option')
    expect(f.decide).toHaveBeenCalledTimes(1)
    f.decide.mockImplementationOnce(async () => {
      const accepted = { ...selected, delivery_status: 'accepted' as const }
      f.setRows([accepted]); return { intervention: accepted, command_uuid: 'c1', created: false }
    })
    await f.controller.decide('i1', 'retry')
    expect(f.decide.mock.calls[0]).toEqual(f.decide.mock.calls[1])
    expect(f.controller.getSnapshot().replayable).toEqual([])
    await f.controller.decide('i1', 'retry')
    expect(f.decide).toHaveBeenCalledTimes(2)
  })

  it('does not invent a replay key after rehydrating a selected unknown decision', async () => {
    const f = fixture()
    f.setRows([{ ...open(), status: 'selected', selected_option_id: 'retry', delivery_status: 'unknown' }])
    await f.controller.refresh(); await f.controller.decide('i1', 'retry')
    expect(f.controller.getSnapshot().replayable).toEqual([])
    expect(f.decide).not.toHaveBeenCalled()
  })

  it('retains minimized pending facts while host is offline and blocks decisions until ready rehydration', async () => {
    const f = fixture(); await f.controller.refresh()
    f.controller.minimize(); f.controller.setOnline(false)
    const reads = f.list.mock.calls.length
    await f.controller.refresh(); await f.controller.decide('i1', 'retry')
    expect(f.list).toHaveBeenCalledTimes(reads)
    expect(f.decide).not.toHaveBeenCalled()
    expect(f.controller.getSnapshot()).toMatchObject({ minimized: true, offline: true })
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    f.setRows([{ ...open(), status: 'selected', delivery_status: 'accepted' }])
    f.controller.setOnline(true)
    await vi.waitFor(() => expect(f.controller.getSnapshot().offline).toBe(false))
    expect(f.controller.getSnapshot().items[0]?.status).toBe('selected')
    expect(f.controller.getSnapshot().minimized).toBe(true)
  })

  it('rehydrates both open and selected and keeps accepted decisions visible', async () => {
    const f = fixture()
    f.setRows([{ ...open(), status: 'selected', delivery_status: 'accepted' }])
    await f.controller.refresh()
    expect(f.list.mock.calls.map(call => call[0])).toEqual(['open', 'selected'])
    expect(f.controller.getSnapshot().items[0]?.delivery_status).toBe('accepted')
  })
  it('minimizes and restores without removing pending items', async () => {
    const f = fixture(); await f.controller.refresh()
    f.controller.minimize(); expect(f.controller.getSnapshot().minimized).toBe(true)
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    f.controller.restore(); expect(f.controller.getSnapshot().minimized).toBe(false)
  })
  it('submits exact revision and retains accepted item until superseded REST fact', async () => {
    const f = fixture(); await f.controller.refresh()
    f.decide.mockImplementation(async () => {
      const selected = { ...open(), status: 'selected' as const, delivery_status: 'accepted' as const }
      f.setRows([selected]); return { intervention: selected, command_uuid: 'c1', created: true }
    })
    await f.controller.decide('i1', 'retry')
    expect(f.decide).toHaveBeenCalledWith('i1', { revision: 1, option_id: 'retry' }, expect.any(String))
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    f.setRows([{ ...open(), status: 'superseded' }]); await f.controller.refresh()
    expect(f.get).toHaveBeenCalledWith('i1'); expect(f.controller.getSnapshot().items).toHaveLength(0)
  })
  it('retains items on list/detail failures and exposes errors', async () => {
    const f = fixture(); await f.controller.refresh()
    f.list.mockRejectedValueOnce(new Error('503 unavailable')); await f.controller.refresh()
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    expect(f.controller.getSnapshot().error).toContain('503')
    f.setRows([]); f.get.mockRejectedValueOnce(new Error('404 uncertain')); await f.controller.refresh()
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    expect(f.controller.getSnapshot().error).toContain('404')
  })
  it('reuses idempotency key after uncertain decision and does not invent selected state', async () => {
    const f = fixture(); await f.controller.refresh()
    f.decide.mockRejectedValue(new Error('request disconnected'))
    await f.controller.decide('i1', 'retry'); await f.controller.decide('i1', 'retry')
    expect(f.decide.mock.calls[0]).toEqual(f.decide.mock.calls[1])
    expect(f.controller.getSnapshot().items[0]?.status).toBe('open')
    expect(f.controller.getSnapshot().error).toContain('disconnected')
  })
  it('blocks duplicate submissions while request is pending', async () => {
    const f = fixture(); await f.controller.refresh()
    let finish!: () => void
    f.decide.mockImplementation(() => new Promise(resolve => { finish = () => resolve({ intervention: open(), command_uuid: 'c1', created: true }) }))
    const pending = f.controller.decide('i1', 'retry'); await f.controller.decide('i1', 'retry')
    expect(f.decide).toHaveBeenCalledTimes(1); finish(); await pending
  })
  it('rehydrates after reconnect, retains minimized state and cleans up SSE', async () => {
    const f = fixture(); const stop = f.controller.start()
    await vi.waitFor(() => expect(f.controller.getSnapshot().items).toHaveLength(1))
    f.controller.minimize(); f.disconnect()
    expect(f.controller.getSnapshot().error).toContain('SSE disconnected')
    f.setRows([{ ...open(), uuid: 'i2' }]); f.reconnect(); f.invalidate()
    await vi.waitFor(() => expect(f.controller.getSnapshot().items.some(item => item.uuid === 'i2')).toBe(true))
    expect(f.controller.getSnapshot().minimized).toBe(true)
    stop(); expect(f.dispose).toHaveBeenCalledTimes(1)
  })
  it('uses job error only as fallback and surfaces partial-read failure', async () => {
    const f = fixture(); f.setRows([{ ...open(), description: undefined }]); await f.controller.refresh()
    expect(f.controller.getSnapshot().messages.i1).toBe('TCP fallback')
    vi.mocked(f.runtime.getWorkflowNodeJob).mockRejectedValueOnce(new Error('job unreadable'))
    await f.controller.refresh()
    expect(f.controller.getSnapshot().items).toHaveLength(1)
    expect(f.controller.getSnapshot().error).toBe('job unreadable')
  })
})
