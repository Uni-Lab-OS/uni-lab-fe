import { describe, expect, it, vi } from 'vitest'
import { createWorkflowRuntime } from './workflow'
import { getDefaultBackend } from './backends'
import { createWorkflowRecoveryPort, recoveryRequestDefinitive } from './workflowRecovery'
import { decisionIntent, type StationSnapshot, type StationError } from './workflowRecoveryContracts'
import { ServiceError } from './errors'
import type { WorkflowSseTransport } from './workflowSse'

const snapshot = { station_version: 4, error_epoch: 2, snapshot_id: 'local:4:2', active_session: null } as StationSnapshot
const error = { decision_id: 'error/1', decision_version: 3 } as StationError
function fixture() {
  const request = vi.fn().mockResolvedValue({ code: 0, data: { command_uuid: 'command', status: 'APPLIED', result: {} } })
  const subscribe = vi.fn().mockReturnValue(() => undefined)
  const port = createWorkflowRecoveryPort({ request }, getDefaultBackend(), { subscribe } as unknown as WorkflowSseTransport, new Set())
  return { port, request, subscribe }
}
describe('OS 异常处置接口', () => {
  it('始终向 OS 暴露恢复端口', () => {
    for (const id of ['local-python', 'local-go', 'cloud', 'unknown']) {
      expect(createWorkflowRuntime(
        { request: vi.fn() },
        { ...getDefaultBackend(), id, apiUrl: 'http://127.0.0.1:18003' }
      ).recovery).toBeDefined()
    }
  })
  it('决定携带版本与快照，未确认时不会恢复工站', async () => {
    const intent = decisionIntent(snapshot, error, 'retry_current_node', false, '检查完成')
    expect(intent.body).toMatchObject({ expected_station_version: 4, expected_decision_version: 3, observed_error_epoch: 2, operator_confirmed: false, resume_requested: false })
    expect(intent.body).not.toHaveProperty('confirm_snapshot_id')
    const confirmed = decisionIntent(snapshot, error, 'cancel_task', true, '')
    expect(confirmed.body.confirm_snapshot_id).toBe('local:4:2')
    expect(decisionIntent(snapshot, error, 'enter_manual_handling', true, '').body.resume_requested).toBe(false)
  })
  it('保存原幂等键和完整操作体，并拒绝跨接口路径', async () => {
    const { port, request } = fixture()
    const intent = { path: '/errors/error-1/decision', key: 'original', label: '重试', body: { expected_station_version: 4, action: 'retry_current_node' } }
    await port.submit(intent)
    expect(request).toHaveBeenCalledWith('/api/v1/stations/local/errors/error-1/decision', expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': 'original' }), body: JSON.stringify(intent.body) }))
    for (const path of ['/../../commands', '//evil/resume', '/resume?other=1', '/sessions/a%2fb/complete']) await expect(port.submit({ ...intent, path })).rejects.toThrow()
  })
  it('人工确认只发送 action，使用稳定 Job UUID', async () => {
    const { port, request } = fixture()
    await port.confirmNode('job/1', 'approve')
    expect(request).toHaveBeenCalledWith('/api/v1/workflow-node-jobs/job%2F1/manual-confirmation', expect.objectContaining({ body: '{"action":"approve"}' }))
  })
  it('任务解锁校验返回的请求身份和业务状态', async () => {
    const { port, request } = fixture()
    request.mockResolvedValue({ code: 0, data: { uuid: 'cmd', workflow_task_uuid: 'task', type: 'unlock_resources', idempotency_key: 'same', status: 'pending' } })
    await expect(port.unlockTask('task', '设备已停止', 'same')).resolves.toMatchObject({ status: 'pending' })
    await expect(port.unlockTask('other', '设备已停止', 'same')).rejects.toThrow('可确认')
  })
  it('复用全局 SSE，去重且只把事件用作补读信号', () => {
    const { port, subscribe } = fixture()
    const refresh = vi.fn(); const onError = vi.fn()
    const subscription = port.subscribe(refresh, onError)
    const handler = subscribe.mock.calls[0][0]
    handler.onOpen({ lastEventId: '', reconnected: true })
    const frame = { id: '10', event: 'station.error_handling.changed', data: '{"station_id":"local"}' }
    handler.onFrame(frame); handler.onFrame(frame)
    handler.onFrame({ id: '11', event: 'station.error_handling.changed', data: '{"station_id":"other"}' })
    handler.onFrame({ id: '12', event: 'manual_confirmation.required', data: '{"task_uuid":"task","job_uuid":"job"}' })
    expect(refresh).toHaveBeenCalledTimes(3)
    handler.onDisconnected(); expect(onError).toHaveBeenCalled()
    subscription.dispose()
  })
  it('超时和服务端异常不作为明确拒绝', () => {
    for (const status of [408, 500, 503]) expect(recoveryRequestDefinitive(new ServiceError({ code: 'error', message: 'error', status }))).toBe(false)
    expect(recoveryRequestDefinitive(new ServiceError({ code: 'conflict', message: '状态变化', status: 409 }))).toBe(true)
  })
})

describe('7.6 恢复能力对齐', () => {
  it('读取命令详情，并按原 Claim/Fence 释放指定租约，不虚构幂等协议', async () => {
    const { port, request } = fixture()
    await port.loadCommand('cmd/1')
    expect(request).toHaveBeenLastCalledWith('/api/v1/stations/local/control-commands/cmd%2F1', undefined)
    request.mockResolvedValue({ code: 0, data: { status: 'released', released_lock_uuids: ['lease'] } })
    const body = { expected_claim_uuid: 'claim-original', expected_fencing_token: 7, reason: '现场核验完成', physical_settlement_confirmed: true }
    await port.forceReleaseLock('task/1', 'lease/1', body)
    expect(request).toHaveBeenLastCalledWith('/api/v1/workflow-tasks/task%2F1/execution-locks/lease%2F1/force-release', expect.objectContaining({ body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }))
    request.mockResolvedValue({ code: 0, data: { status: 'already_released' } })
    await expect(port.forceReleaseLock('task', 'lease', body)).resolves.toMatchObject({ status: 'already_released' })
    request.mockResolvedValue({ code: 0, data: { status: 'pending' } })
    await expect(port.forceReleaseLock('task', 'lease', body)).rejects.toThrow('未确认')
  })
  it('跨页组合物料和动作模板，使用物料 UUID，排除未绑定设备和控制模板', async () => {
    const { port, request } = fixture()
    request.mockImplementation(async (path: string) => ({ code: 0, data: path.includes('workflow-node-templates') ? {
      items: [{ resource_template: { uuid: 'robot' } }, { node_type: 'condition', resource_template: { uuid: 'control' } }], has_more: false
    } : path.includes('page=1&') ? {
      items: [{ uuid: 'material-uuid', name: '机械臂', resource_template_uuid: 'robot', meta_data: { source_node_id: 'local-robot' } }, { uuid: 'unbound', resource_template_uuid: 'robot' }], has_more: true
    } : { items: [{ uuid: 'wrong-type', resource_template_uuid: 'control', meta_data: { source_node_id: 'x' } }], has_more: false } }))
    await expect(port.loadDevices()).resolves.toEqual([{ id: 'material-uuid', name: '机械臂 · local-robot' }])
    expect(request).toHaveBeenCalledWith('/api/v1/materials?page=2&page_size=100', undefined)
    expect(request.mock.calls.some(([path]) => path.includes('device-catalog'))).toBe(false)
  })
  it('目录读取失败时不返回部分候选列表', async () => {
    const { port, request } = fixture()
    request.mockRejectedValue(new Error('offline'))
    await expect(port.loadDevices()).rejects.toThrow('offline')
  })
})
