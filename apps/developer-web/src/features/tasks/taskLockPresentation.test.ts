import { describe, expect, it } from 'vitest'
import {
  buildTaskResourceUnlockCommand,
  taskResourceUnlockReadiness,
} from './taskLockPresentation'

const base = {
  taskStatus: 'failed',
  lockCount: 2,
  activeDeviceTenancyCount: 0,
}

describe('task resource unlock gate', () => {
  it('only opens for abnormal terminal tasks', () => {
    expect(taskResourceUnlockReadiness(base)).toMatchObject({ kind: 'ready' })
    for (const status of ['failed', 'canceled', 'timeout']) {
      expect(taskResourceUnlockReadiness({ ...base, taskStatus: status }).kind).toBe('ready')
    }
    // 正常跑完或还在跑的任务不该走整组解锁 —— 那时锁本来就该被持有。
    for (const status of ['succeeded', 'running', 'pending']) {
      const result = taskResourceUnlockReadiness({ ...base, taskStatus: status })
      expect(result.kind).toBe('blocked')
      expect(result.kind === 'blocked' && result.reason).toContain('异常终态')
    }
  })

  it('requires actual resources to release', () => {
    const result = taskResourceUnlockReadiness({
      ...base,
      lockCount: 0,
      activeDeviceTenancyCount: 0,
    })
    expect(result.kind).toBe('blocked')
    expect(result.kind === 'blocked' && result.reason).toContain('没有可解除的资源')
  })

  it('counts device tenancy as a releasable resource', () => {
    const result = taskResourceUnlockReadiness({
      ...base,
      lockCount: 0,
      activeDeviceTenancyCount: 3,
    })
    expect(result).toMatchObject({ kind: 'ready' })
    expect(result.kind === 'ready' && result.label).toContain('3 项设备占用')
  })

  it('recognises the handover-cleanup path instead of calling it "nothing to release"', () => {
    const result = taskResourceUnlockReadiness({
      ...base,
      lockCount: 0,
      activeDeviceTenancyCount: 0,
      cleanupStatus: 'requires_attention',
      manualReviewAttentionResolved: false,
    })
    expect(result).toMatchObject({ kind: 'cleanup' })
    // 已经了结时就不是清理路径了，回到「没有可解的资源」。
    expect(
      taskResourceUnlockReadiness({
        ...base,
        lockCount: 0,
        activeDeviceTenancyCount: 0,
        cleanupStatus: 'requires_attention',
        manualReviewAttentionResolved: true,
      }).kind,
    ).toBe('blocked')
  })

  it('always declares the operator confirmation the backend demands', () => {
    const command = buildTaskResourceUnlockCommand({
      idempotencyKey: 'k-1',
      description: '设备已停止，现场已核实',
    })
    expect(command.type).toBe('unlock_resources')
    // OS 缺少这个字段会直接 invalid_input，所以它不能是可选的。
    expect(command.metadata).toMatchObject({ confirmed_physical_safe: true })
  })
})
