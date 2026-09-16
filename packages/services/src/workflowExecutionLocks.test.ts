import { describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import type { HttpClient } from './http'
import { createWorkflowRuntime } from './workflow'

function runtime(request: ReturnType<typeof vi.fn>, backendId = 'local-python') {
  const http: HttpClient = {
    request: async <T>(path: string, init?: RequestInit): Promise<T> => request(path, init)
  }
  return createWorkflowRuntime(http, { ...getDefaultBackend(backendId), apiUrl: 'http://127.0.0.1:2224' })
}

describe('task resource release adapter', () => {
  it('keeps authoritative holder, fence and task eligibility facts unchanged', async () => {
    const snapshot = {
      workflow_task_uuid: 'task/a', task_status: 'failed', active_device_tenancy_count: 1,
      locks: [{ uuid: 'lease', workflow_task_uuid: 'task/a', workflow_node_job_uuid: 'job',
        claim_uuid: 'claim', fencing_token: 7, lock_key: '/devices/material-1',
        material_uuid: 'material-1', site_uuid: null,
        state: 'uncertain', scope: 'device', job_status: 'failed', claim_state: 'uncertain',
        can_release: false, release_block_reason: 'continuous interval requires task release' }]
    }
    const request = vi.fn().mockResolvedValue({ code: 0, data: snapshot })
    expect(await runtime(request).executionLocks!.list('task/a')).toEqual(snapshot)
    expect(request).toHaveBeenCalledWith('/api/v1/workflow-tasks/task%2Fa/execution-locks', undefined)
  })

  it('reuses the supplied idempotency key for the whole-task command without legacy unlock routes', async () => {
    const command = { uuid: 'command', type: 'unlock_resources', status: 'succeeded', result: {} }
    const request = vi.fn().mockResolvedValue({ code: 0, data: command })
    const port = runtime(request).executionLocks!
    const body = { idempotency_key: 'same-attempt', reason: '设备停止并已盘点物料', physical_safe_confirmed: true }
    expect(await port.unlockResources('task/a', body)).toEqual(command)
    expect(await port.unlockResources('task/a', body)).toEqual(command)
    expect(request).toHaveBeenCalledTimes(2)
    for (const [path, init] of request.mock.calls) {
      expect(path).toBe('/api/v1/workflow-tasks/task%2Fa/commands')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ type: 'unlock_resources', target_node_uuid: null,
        idempotency_key: 'same-attempt', description: body.reason,
        meta_data: { confirmed_physical_safe: true } })
    }
  })

  it('preserves rejected command facts instead of treating HTTP acceptance as success', async () => {
    const rejected = { uuid: 'command', type: 'unlock_resources', status: 'rejected',
      result: { reason: 'task_is_not_abnormal_terminal' } }
    const request = vi.fn().mockResolvedValue({ code: 0, data: rejected })
    expect(await runtime(request).executionLocks!.unlockResources('task', {
      idempotency_key: 'attempt', reason: '检查', physical_safe_confirmed: false
    })).toEqual(rejected)
    expect(JSON.parse(request.mock.calls[0][1].body).meta_data.confirmed_physical_safe).toBe(false)
  })

  it('propagates backend business errors', async () => {
    const request = vi.fn().mockResolvedValue({ code: 3003, message: '任务状态已变化', data: null })
    await expect(runtime(request).executionLocks!.list('task')).rejects.toThrow()
  })

  it.each(['local-go', 'cloud'])('does not expose unsupported release on %s', (backendId) => {
    const request = vi.fn()
    expect(runtime(request, backendId).executionLocks).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })
})
