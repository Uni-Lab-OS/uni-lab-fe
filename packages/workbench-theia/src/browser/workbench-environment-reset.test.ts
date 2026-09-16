import { describe, expect, it, vi } from 'vitest'
import type { Services } from '@unilab/services'
import { createWorkbenchEnvironmentReset } from './workbench-environment-reset'

function fixture() {
  const calls: string[] = []
  const preview = vi.fn(async () => ({ baseline_fingerprint: 'baseline', materials: [
    { material_uuid: 'original', name: '原物料', revision: 3, reset_kind: 'baseline', needs_reset: true, site_uuid: 'slot', parent_uuid: 'device', relative_position: {} },
    { material_uuid: 'new', name: '新物料', revision: 7, reset_kind: 'delete_new', needs_reset: true, site_uuid: null, parent_uuid: null, relative_position: null }
  ] }))
  const apply = vi.fn(async () => { calls.push('apply'); return { status: 'restored', restored_count: 2, material_uuids: ['original', 'new'] } })
  let released = false
  const list = vi.fn(async (uuid: string) => ({ workflow_task_uuid: uuid, task_status: uuid === 'active' ? 'running' : 'failed', locks: [], active_device_tenancy_count: uuid === 'failed' && released ? 0 : 1 }))
  const unlockResources = vi.fn(async () => { calls.push('unlock'); released = true; return { status: 'succeeded', result: {} } })
  const services = { capabilities: { workflow: { releaseTaskResources: true } }, materials: { getGraph: vi.fn(async () => []), resetLocations: { preview, apply } }, workflow: {
    executionLocks: { list, unlockResources },
    listWorkflowTasks: vi.fn(async ({ page }: { page: number }) => ({ total: 3, items: page === 1 ? [{ uuid: 'settled', cleanup_status: 'settled' }, { uuid: 'failed' }] : [{ uuid: 'active' }] }))
  } } as unknown as Services
  const rebuild = vi.fn(async () => { calls.push('rebuild') })
  const refresh = vi.fn(async () => { calls.push('refresh') })
  return { port: createWorkbenchEnvironmentReset(services, true, rebuild, refresh), services, preview, apply, list, unlockResources, calls, rebuild, refresh }
}

describe('environment reset plan', () => {
  it('stops remaining writes when the dialog changes source during unlock', async () => {
    const f = fixture()
    const controller = new AbortController()
    f.unlockResources.mockImplementationOnce(async () => {
      controller.abort()
      return { status: 'succeeded', result: {} }
    })
    const plan = await f.port.preview({ rebuild: false, materials: true, locks: true })
    await plan.execute('现场核对', controller.signal)
    expect(f.apply).not.toHaveBeenCalled()
  })

  it('does not execute a frozen material plan after source disposal', async () => {
    const f = fixture()
    const controller = new AbortController()
    const plan = await f.port.preview({ rebuild: false, materials: true, locks: false })
    controller.abort()
    expect((await plan.execute('现场核对', controller.signal))[0].status).toBe('failed')
    expect(f.apply).not.toHaveBeenCalled()
  })
  it('previews claim-only owners across pages and freezes all revisions before unlock', async () => {
    const f = fixture()
    const plan = await f.port.preview({ rebuild: false, materials: true, locks: true })
    expect(f.calls).toEqual([])
    expect(f.list.mock.calls.map(call => call[0])).toEqual(['failed', 'active'])
    expect(plan.summary.join('\n')).toContain('删除（运行中新建物料）')
    expect(plan.summary.join('\n')).toContain('1 个其他任务不在解除范围内')
    const result = await plan.execute('实物已核对')
    expect(f.calls).toEqual(['unlock', 'apply', 'refresh'])
    expect(f.unlockResources.mock.calls).toHaveLength(1)
    expect(f.apply).toHaveBeenCalledWith({ baseline_fingerprint: 'baseline', expected_revisions: { original: 3, new: 7 }, physical_settlement_confirmed: true })
    expect(f.preview).toHaveBeenCalledTimes(1)
    expect(result.map(row => row.status)).toEqual(['completed', 'skipped', 'completed'])
  })

  it('retains completed unlock when material conflicts and never retries or rebuilds', async () => {
    const f = fixture()
    f.apply.mockRejectedValueOnce(new Error('active claim'))
    const result = await (await f.port.preview({ rebuild: false, materials: true, locks: true })).execute('现场已核对')
    expect(result.map(row => row.status)).toEqual(['completed', 'skipped', 'failed'])
    expect(result[2].message).toContain('active claim')
    expect(f.apply).toHaveBeenCalledTimes(1)
    expect(f.refresh).not.toHaveBeenCalled()
    expect(f.rebuild).not.toHaveBeenCalled()
  })

  it('stops before materials on an uncertain unlock response', async () => {
    const f = fixture()
    f.unlockResources.mockRejectedValueOnce(new Error('response lost'))
    const result = await (await f.port.preview({ rebuild: false, materials: true, locks: true })).execute('现场已核对')
    expect(result.map(row => row.status)).toEqual(['failed', 'skipped'])
    expect(f.apply).not.toHaveBeenCalled()
  })

  it('runs rebuild exactly once without separate API writes', async () => {
    const f = fixture()
    await (await f.port.preview({ rebuild: true, materials: true, locks: true })).execute('重建')
    expect(f.calls).toEqual(['rebuild'])
    expect(f.preview).not.toHaveBeenCalled()
    expect(f.list).not.toHaveBeenCalled()
  })
})
