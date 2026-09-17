import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DeviceExecutionOccupancy, WorkflowRecoveryPort } from '@unilab/services'
import { DeviceExecutionUnlock, loadDeviceExecutionLock, releaseDeviceExecutionLock } from './DeviceExecutionUnlock'

const occupancy: DeviceExecutionOccupancy = {
  leaseUuid: 'lease-1', workflowTaskUuid: 'task-1', workflowNodeJobUuid: 'job-1',
  state: 'uncertain', actionName: 'move', acquiredAt: null
}
const lock = { uuid: 'lease-1', lock_key: 'device:robot', state: 'uncertain',
  claim_uuid: 'claim-1', fencing_token: 3, can_release: true }
function port() {
  return {
    loadLocks: vi.fn(async () => ({ workflow_task_uuid: 'task-1', task_status: 'failed',
      active_device_tenancy_count: 0, locks: [lock] })),
    forceReleaseLock: vi.fn(async () => ({ status: 'released' }))
  } as unknown as WorkflowRecoveryPort
}

describe('设备执行锁解锁', () => {
  it('设备有调度占用时提供解锁入口，初次展示不提交写请求', () => {
    const recovery = port()
    const html = renderToStaticMarkup(<DeviceExecutionUnlock occupancy={occupancy}
      port={recovery} onRefresh={vi.fn()} />)
    expect(html).toContain('解锁设备')
    expect(recovery.forceReleaseLock).not.toHaveBeenCalled()
  })
  it('只读取对应任务中的确切租约', async () => {
    const recovery = port()
    await expect(loadDeviceExecutionLock(recovery, occupancy)).resolves.toEqual(lock)
    expect(recovery.loadLocks).toHaveBeenCalledWith('task-1')
    await expect(loadDeviceExecutionLock(recovery, { ...occupancy, leaseUuid: 'new-holder' }))
      .rejects.toThrow('已释放或已变化')
  })
  it('缺少身份或任务响应不匹配时禁止猜测解锁对象', async () => {
    const recovery = port()
    await expect(loadDeviceExecutionLock(recovery, { ...occupancy, workflowTaskUuid: null }))
      .rejects.toThrow('缺少任务或锁标识')
    await expect(loadDeviceExecutionLock(recovery, { ...occupancy, workflowTaskUuid: 'task-2' }))
      .rejects.toThrow('所属任务已变化')
  })
  it('保留用户确认过的持有者和版本，提交原因及现场确认', async () => {
    const recovery = port()
    await releaseDeviceExecutionLock(recovery, 'task-1', lock, '  已核对设备停止  ', true)
    expect(recovery.forceReleaseLock).toHaveBeenCalledWith('task-1', 'lease-1', {
      expected_claim_uuid: 'claim-1', expected_fencing_token: 3,
      reason: '已核对设备停止', physical_settlement_confirmed: true
    })
  })
  it('未确认、原因缺失及不可释放的锁均不提交', async () => {
    const recovery = port()
    await expect(releaseDeviceExecutionLock(recovery, 'task-1', lock, '已停止', false)).rejects.toThrow('确认')
    await expect(releaseDeviceExecutionLock(recovery, 'task-1', lock, ' ', true)).rejects.toThrow('原因')
    await expect(releaseDeviceExecutionLock(recovery, 'task-1', {
      ...lock, can_release: false, release_block_reason: '任务仍在运行'
    }, '已停止', true)).rejects.toThrow('任务仍在运行')
    expect(recovery.forceReleaseLock).not.toHaveBeenCalled()
  })
  it('后端拒绝过期持有者时保留错误，不伪造成功', async () => {
    const recovery = port()
    vi.mocked(recovery.forceReleaseLock).mockRejectedValue(new Error('持有者已变化'))
    await expect(releaseDeviceExecutionLock(recovery, 'task-1', lock, '已停止', true))
      .rejects.toThrow('持有者已变化')
  })
})
