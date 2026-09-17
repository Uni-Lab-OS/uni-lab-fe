import { describe, expect, it, vi } from 'vitest'
import { ServiceError, type WorkflowRecoveryPort, type StationSnapshot } from '@unilab/services'
import { WorkflowRecoveryController } from './WorkflowRecoveryController'
const station = { mode: 'PAUSED', station_version: 1, snapshot_id: 'local:1:1', errors: [], manual_actions: [], control_commands: [] } as unknown as StationSnapshot
function fixture() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const port = { scopeKey: 'server-A', loadStation: vi.fn().mockResolvedValue(station), submit: vi.fn().mockResolvedValue({ status: 'APPLIED', result: {}, station: { ...station, mode: 'RUNNING' } }), subscribe: vi.fn().mockReturnValue({ dispose: vi.fn() }) } as unknown as WorkflowRecoveryPort
  return { port, storage, controller: new WorkflowRecoveryController(port, storage) }
}
describe('异常处置控制器', () => {
  it('以补读事实为准，不把命令响应当成工站运行状态', async () => {
    const { controller } = fixture()
    await controller.refresh()
    expect(await controller.submit('/resume', {}, '恢复')).toBe(true)
    expect(controller.getSnapshot().station?.mode).toBe('PAUSED')
  })
  it('断网后恢复原请求，禁止创建第二条写操作', async () => {
    const { controller, port, storage } = fixture()
    vi.mocked(port.submit).mockRejectedValueOnce(new Error('network'))
    await controller.refresh()
    await controller.submit('/resume', { expected_station_version: 1 }, '恢复')
    const intent = controller.getSnapshot().unconfirmed!
    expect(intent).not.toBeNull()
    await controller.submit('/resume', {}, '第二次')
    expect(port.submit).toHaveBeenCalledTimes(1)
    const recovered = new WorkflowRecoveryController(port, storage)
    await recovered.refresh(); await recovered.retry()
    expect(port.submit).toHaveBeenLastCalledWith(intent)
    expect(recovered.getSnapshot().unconfirmed).toBeNull()
  })
  it('版本冲突清除原请求并补读，读取失败禁止提交', async () => {
    const { controller, port } = fixture()
    await controller.refresh()
    vi.mocked(port.submit).mockRejectedValue(new ServiceError({ code: 'conflict', status: 409, message: 'station_version_conflict' }))
    await controller.submit('/resume', {}, '恢复')
    expect(controller.getSnapshot().unconfirmed).toBeNull()
    expect(controller.getSnapshot().error).toContain('工站状态已变化')
    vi.mocked(port.loadStation).mockRejectedValue(new Error('offline'))
    await controller.refresh(); await controller.submit('/resume', {}, '恢复')
    expect(port.submit).toHaveBeenCalledTimes(1)
  })
  it('存储不可用时不发送操作，切换服务不恢复另一端请求', async () => {
    const { port, storage } = fixture()
    const controller = new WorkflowRecoveryController(port)
    await controller.refresh(); await controller.submit('/resume', {}, '恢复')
    expect(port.submit).not.toHaveBeenCalled()
    storage.setItem('unilab:workbench:station-intent:server-A', JSON.stringify({ path: '/resume', key: 'old', body: {}, label: '恢复' }))
    expect(new WorkflowRecoveryController({ ...port, scopeKey: 'server-B' }, storage).getSnapshot().unconfirmed).toBeNull()
  })
  it('接受但未应用时保留服务器待处理命令语义', async () => {
    const { controller, port } = fixture()
    vi.mocked(port.submit).mockResolvedValue({ status: 'PENDING', result: {}, station } as never)
    await controller.refresh()
    expect(await controller.submit('/resume', {}, '恢复')).toBe(false)
    expect(controller.getSnapshot().error).toContain('等待应用')
  })
})

describe('状态补读生命周期', () => {
  it('暂停 1.5 秒、正常 5 秒补读；无关事件游标不清空确认；最后一个消费者退出停止', async () => {
    vi.useFakeTimers()
    try {
      const { controller, port } = fixture()
      const release = controller.retain(); const releaseOther = controller.retain()
      await vi.advanceTimersByTimeAsync(0)
      const before = controller.getSnapshot()
      vi.mocked(port.loadStation).mockResolvedValue({ ...station, event_cursor: 100 } as StationSnapshot)
      await vi.advanceTimersByTimeAsync(1500)
      expect(controller.getSnapshot().revision).toBe(before.revision)
      expect(controller.getSnapshot().station).toBe(before.station)
      vi.mocked(port.loadStation).mockResolvedValue({ ...station, mode: 'RUNNING' })
      await vi.advanceTimersByTimeAsync(1500)
      const count = vi.mocked(port.loadStation).mock.calls.length
      release()
      await vi.advanceTimersByTimeAsync(4999)
      expect(port.loadStation).toHaveBeenCalledTimes(count)
      await vi.advanceTimersByTimeAsync(1)
      expect(port.loadStation).toHaveBeenCalledTimes(count + 1)
      releaseOther()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(port.loadStation).toHaveBeenCalledTimes(count + 1)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('慢请求串行，退出后到达的旧失败不污染状态', async () => {
    vi.useFakeTimers()
    try {
      const { controller, port } = fixture()
      let reject!: (error: Error) => void
      vi.mocked(port.loadStation).mockImplementation(() => new Promise((_, fail) => { reject = fail }))
      const release = controller.retain()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(port.loadStation).toHaveBeenCalledTimes(1)
      release(); reject(new Error('stale failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(controller.getSnapshot().readError).not.toBe('stale failure')
      expect(port.loadStation).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('30 秒强制对账触发任务刷新，即使工站快照未改变', async () => {
    vi.useFakeTimers()
    try {
      const { controller } = fixture()
      const release = controller.retain()
      await vi.advanceTimersByTimeAsync(0)
      const revision = controller.getSnapshot().revision
      await vi.advanceTimersByTimeAsync(30_000)
      expect(controller.getSnapshot().revision).toBeGreaterThan(revision)
      release()
    } finally { vi.useRealTimers() }
  })
})
