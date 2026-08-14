import type {
  DeviceCardHostRobotCommissioningRequest,
  DeviceCardRobotCommissioningRun,
  JsonObject
} from '@unilab/device-card-sdk'

import type { RobotCommissioningService } from './robotCommissioning'

interface ActiveSession {
  deviceId: string
  sessionId: string
  runtimeMode: 'mock' | 'live'
}

/**
 * 主 Renderer 对 OS RobotCommissioning API 的会话适配器。
 *
 * 卡片只持有不可伪造的 sessionKey；deviceId/sessionId 始终停留在可信 Host。
 */
export class DeviceCardRobotCommissioningController {
  private readonly sessions = new Map<string, ActiveSession>()
  private readonly deviceQueues = new Map<string, Promise<void>>()
  private disposed = false

  constructor(private readonly service: RobotCommissioningService) {}

  async execute(
    request: DeviceCardHostRobotCommissioningRequest
  ): Promise<DeviceCardRobotCommissioningRun> {
    if (this.disposed) {
      return {
        requestId: request.requestId,
        status: 'CANCELLED',
        error: '机械臂调试控制器已关闭。'
      }
    }
    if (request.operation === 'open' || request.operation === 'close') {
      return this.enqueue(request.deviceId, () => this.executeNow(request))
    }
    return this.executeNow(request)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled(this.deviceQueues.values())
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(
      sessions.map(({ deviceId, sessionId }) =>
        this.service.close(deviceId, sessionId)
      )
    )
  }

  private async executeNow(
    request: DeviceCardHostRobotCommissioningRequest
  ): Promise<DeviceCardRobotCommissioningRun> {
    try {
      const result = await this.dispatch(request)
      return { requestId: request.requestId, status: 'DONE', result }
    } catch (error) {
      return {
        requestId: request.requestId,
        status: 'ERROR',
        error: error instanceof Error ? error.message : '机械臂调试请求失败。'
      }
    }
  }

  private enqueue<T>(deviceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.deviceQueues.get(deviceId) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    const tail = current.then(() => undefined, () => undefined)
    this.deviceQueues.set(deviceId, tail)
    void tail.finally(() => {
      if (this.deviceQueues.get(deviceId) === tail) {
        this.deviceQueues.delete(deviceId)
      }
    })
    return current
  }

  private async dispatch(
    request: DeviceCardHostRobotCommissioningRequest
  ): Promise<JsonObject> {
    const active = this.sessions.get(request.sessionKey)
    if (active && active.deviceId !== request.deviceId) {
      throw new Error('机械臂调试会话与当前设备不一致。')
    }
    if (active && active.runtimeMode !== request.runtimeMode) {
      throw new Error('机械臂调试会话与当前 Mock/Live 模式不一致。')
    }
    if (request.operation === 'open') {
      if (active) return this.service.snapshot(active.deviceId, active.sessionId)
      const context = await this.service.open(
        request.deviceId,
        `device-card:${request.sessionKey}`,
        request.runtimeMode === 'mock' ? 'simulation' : 'maintenance'
      )
      const sessionId = context.session_id
      if (typeof sessionId !== 'string' || !sessionId) {
        throw new Error('OS 未返回有效机械臂调试 session_id。')
      }
      this.sessions.set(request.sessionKey, {
        deviceId: request.deviceId,
        sessionId,
        runtimeMode: request.runtimeMode
      })
      return context
    }
    // View 销毁和模式切换都可能发出关闭。将 close 做成幂等操作，
    // 避免尚未 open 或已被 dispose 的会话产生虚假错误。
    if (!active && request.operation === 'close') return {}
    if (!active) throw new Error('尚未打开机械臂调试会话。')
    if (request.operation === 'snapshot') {
      return this.service.snapshot(active.deviceId, active.sessionId)
    }
    if (request.operation === 'execute') {
      if (!request.command) throw new Error('机械臂调试命令缺失。')
      const execution = await this.service.execute(
        active.deviceId,
        active.sessionId,
        request.command
      )
      assertSuccessfulExecution(execution)
      return execution
    }
    await this.service.close(active.deviceId, active.sessionId)
    this.sessions.delete(request.sessionKey)
    return {}
  }
}

function assertSuccessfulExecution(execution: JsonObject): void {
  const result = execution.result
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('OS 未返回机械臂调试执行结果。')
  }
  const state = result.state
  if (state !== 'succeeded' && state !== 'canceled') {
    const message = typeof result.message === 'string' && result.message
      ? result.message
      : `机械臂调试命令未成功：${String(state ?? 'unknown')}`
    throw new Error(message)
  }
}
