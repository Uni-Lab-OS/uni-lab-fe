import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkflowRuntimePort, WorkflowTask, WorkflowTaskExecutionLocks, WorkflowExecutionLockPort } from '@unilab/services'
import { loadDeviceTaskLocks, projectDeviceTaskLocks } from './deviceTaskLocks'
import { DeviceTaskUnlockDialog, unlockSelectedTasks } from './DeviceTaskUnlockDialog'

const task = (uuid = 'task-1', status = 'failed') => ({ uuid, status, description: '故障任务' }) as WorkflowTask
const locks = (taskUuid = 'task-1', ids = ['device-1', 'device-2']): WorkflowTaskExecutionLocks => ({
  workflow_task_uuid: taskUuid, task_status: 'failed', active_device_tenancy_count: 0,
  locks: ids.map((material_uuid, index) => ({ uuid: `lease-${index}`, workflow_task_uuid: taskUuid,
    workflow_node_job_uuid: `job-${index}`, claim_uuid: 'claim', lock_key: `unrelated-legacy-key-${index}`,
    material_uuid, site_uuid: null, scope: 'device', state: 'uncertain', fencing_token: 1,
    job_status: 'failed', claim_state: 'uncertain', can_release: false,
    release_block_reason: '连续区间需要任务级解锁' }))
})
const instruments = new Set(['device-1', 'device-2', 'device-3'])
const owner = (id = 'task-1') => projectDeviceTaskLocks(task(id), locks(id), instruments)
const empty = (id: string) => ({ ...locks(id), locks: [] })

describe('task-owned instrument locks', () => {
  it('uses authoritative material identities, retains continuous locks and excludes other materials', () => {
    const value = projectDeviceTaskLocks(task(), locks('task-1', ['device-1', 'plate', 'device-1']), instruments)
    expect(value.deviceIds).toEqual(['device-1'])
    expect(value.canUnlock).toBe(true) // per-lease can_release=false is a different command
    expect(projectDeviceTaskLocks(task(), { ...locks(), task_status: 'running' }, instruments).canUnlock).toBe(false)
  })
  it('reads every task page including terminal owners and marks unresolved tenancy identities partial', async () => {
    const list = vi.fn().mockResolvedValueOnce({ items: [task('one')], total: 2 }).mockResolvedValueOnce({ items: [task('two')], total: 2 })
    const runtime = { listWorkflowTasks: list, executionLocks: { list: vi.fn()
      .mockResolvedValueOnce(locks('one')).mockResolvedValueOnce({ ...locks('two'), locks: [], active_device_tenancy_count: 1 }) } } as unknown as WorkflowRuntimePort
    const value = await loadDeviceTaskLocks(runtime, instruments)
    expect(list.mock.calls.map(call => call[0].page)).toEqual([1, 2])
    expect([...value.lockedDeviceIds]).toEqual(['device-1', 'device-2'])
    expect(value.known).toBe(false)
    expect(value.owners).toHaveLength(2)
  })
  it('does not convert partial fetch failure into zero locked devices', async () => {
    const runtime = { listWorkflowTasks: vi.fn().mockResolvedValue({ items: [task()], total: 1 }),
      executionLocks: { list: vi.fn().mockRejectedValue(new Error('读取失败')) } } as unknown as WorkflowRuntimePort
    await expect(loadDeviceTaskLocks(runtime, instruments)).rejects.toThrow('读取失败')
  })
  it('keeps a task-wide confirmation, inaccessible running choices and native dialog semantics', () => {
    const running = { ...owner('active'), canUnlock: false, status: 'running' }
    const html = renderToStaticMarkup(<DeviceTaskUnlockDialog owners={[owner(), running]} devices={[]}
      port={{} as WorkflowExecutionLockPort} onClose={() => {}} onRefresh={async () => {}} />)
    expect(html).toContain('<dialog')
    expect(html).toContain('全选')
    expect(html).toContain('取消全选')
    expect(html).toContain('全部设备、物料及库位资源锁')
    expect(html).toContain('现场处置说明')
    expect(html).toContain('<fieldset disabled=""')
    expect(html).toContain('任务仍在运行')
    expect(html).toContain('确认解锁所选任务')
  })
  it('sends one task command for two devices and verifies release before showing success', async () => {
    const unlockResources = vi.fn().mockResolvedValue({ status: 'succeeded' })
    const list = vi.fn().mockResolvedValue(empty('task-1'))
    const result = await unlockSelectedTasks({ unlockResources, list } as WorkflowExecutionLockPort,
      [owner()], '现场已停止', new Map([['task-1', 'stable-key']]))
    expect(unlockResources).toHaveBeenCalledTimes(1)
    expect(unlockResources).toHaveBeenCalledWith('task-1', {
      idempotency_key: 'stable-key', reason: '现场已停止', physical_safe_confirmed: true })
    expect(list).toHaveBeenCalledWith('task-1')
    expect(result[0]?.state).toBe('success')
  })
  it('preserves partial rejection and never labels accepted or still locked tasks released', async () => {
    const unlockResources = vi.fn().mockResolvedValueOnce({ status: 'pending' }).mockRejectedValueOnce(new Error('任务仍有运行作业'))
    const list = vi.fn().mockResolvedValue(locks('one'))
    const results = await unlockSelectedTasks({ unlockResources, list } as WorkflowExecutionLockPort,
      [owner('one'), owner('two')], '已核对', new Map([['one', 'k1'], ['two', 'k2']]))
    expect(results.map(result => result.state)).toEqual(['pending', 'error'])
    expect(results[1]?.message).toContain('运行作业')
  })
})
