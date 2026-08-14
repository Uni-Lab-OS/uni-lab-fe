import type {
  DeviceCardRobotCommissioningCommand,
  JsonObject
} from '@unilab/device-card-sdk'

import type { HttpClient, HttpRequestInit } from './http'

const ROBOT_COMMISSIONING_EXECUTION_TIMEOUT_MS = 300_000

/** OS 暴露的唯一机械臂调试传输；MoveIt/PLC/SDK 均隐藏在 RuntimeBinding 后。 */
export interface RobotCommissioningService {
  open(
    deviceId: string,
    ownerId: string,
    deploymentMode: 'simulation' | 'maintenance'
  ): Promise<JsonObject>
  snapshot(deviceId: string, sessionId: string): Promise<JsonObject>
  execute(
    deviceId: string,
    sessionId: string,
    command: DeviceCardRobotCommissioningCommand
  ): Promise<JsonObject>
  close(deviceId: string, sessionId: string): Promise<void>
}

export function createRobotCommissioningService(
  http: HttpClient
): RobotCommissioningService {
  return {
    open: (deviceId, ownerId, deploymentMode) => http.request(
      `${base(deviceId)}/sessions`,
      jsonRequest('POST', {
        owner_id: ownerId,
        requested_deployment_mode: deploymentMode
      })
    ),
    snapshot: (deviceId, sessionId) => http.request(
      `${base(deviceId)}/sessions/${encodeURIComponent(sessionId)}/snapshot`
    ),
    execute: (deviceId, sessionId, command) => http.request(
      `${base(deviceId)}/sessions/${encodeURIComponent(sessionId)}/commands`,
      {
        ...jsonRequest('POST', command),
        timeoutMs: ROBOT_COMMISSIONING_EXECUTION_TIMEOUT_MS
      }
    ),
    close: (deviceId, sessionId) => http.request<void>(
      `${base(deviceId)}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' }
    )
  }
}

function base(deviceId: string): string {
  return `/api/v1/robot-commissioning/${encodeURIComponent(deviceId)}`
}

function jsonRequest(method: string, body: unknown): HttpRequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }
}
