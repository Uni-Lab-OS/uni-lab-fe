import type {
  DeviceCardRobotCommissioningCommand,
  JsonObject
} from '@unilab/device-card-sdk'

import type { HttpClient, HttpRequestInit } from './http'

const ROBOT_COMMISSIONING_EXECUTION_TIMEOUT_MS = 300_000
/** Host 打开会话时 MoveIt 第一帧新鲜快照可能晚于 HTTP 就绪；本机 OPTIONS→会话占用约 43s。 */
const ROBOT_COMMISSIONING_SESSION_TIMEOUT_MS = 60_000

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
    open: (deviceId, ownerId, deploymentMode) => traced(
      {
        op: 'open',
        device: deviceId,
        mode: deploymentMode,
        owner: ownerId
      },
      () => http.request(
        `${base(deviceId)}/sessions`,
        {
          ...jsonRequest('POST', {
            owner_id: ownerId,
            requested_deployment_mode: deploymentMode
          }),
          timeoutMs: ROBOT_COMMISSIONING_SESSION_TIMEOUT_MS
        }
      )
    ),
    snapshot: (deviceId, sessionId) => traced(
      {
        op: 'snapshot',
        device: deviceId,
        session: sessionId
      },
      () => http.request(
        `${base(deviceId)}/sessions/${encodeURIComponent(sessionId)}/snapshot`,
        { timeoutMs: ROBOT_COMMISSIONING_SESSION_TIMEOUT_MS }
      )
    ),
    execute: (deviceId, sessionId, command) => traced(
      {
        op: 'execute',
        device: deviceId,
        session: sessionId,
        command: command.type,
        commandId: command.command_id
      },
      () => http.request(
        `${base(deviceId)}/sessions/${encodeURIComponent(sessionId)}/commands`,
        {
          ...jsonRequest('POST', command),
          timeoutMs: ROBOT_COMMISSIONING_EXECUTION_TIMEOUT_MS
        }
      )
    ),
    close: (deviceId, sessionId) => traced(
      {
        op: 'close',
        device: deviceId,
        session: sessionId
      },
      () => http.request<void>(
        `${base(deviceId)}/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: 'DELETE',
          timeoutMs: ROBOT_COMMISSIONING_SESSION_TIMEOUT_MS
        }
      )
    )
  }
}

/**
 * 机械臂调试链路的单行诊断。终端搜 `[commissioning]`。
 */
export function logRobotCommissioning(
  stage: string,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  const parts = [`[commissioning] stage=${stage}`]
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    parts.push(`${key}=${robotCommissioningDiagnosticToken(value)}`)
  }
  console.info(parts.join(' '))
}

function robotCommissioningDiagnosticToken(value: unknown): string {
  return String(value ?? 'none')
    .replace(/[^a-zA-Z0-9_.:@-]+/gu, '_')
    .slice(0, 160) || 'none'
}

async function traced<T>(
  fields: Record<string, string | number | boolean | null | undefined>,
  work: () => Promise<T>
): Promise<T> {
  const started = Date.now()
  try {
    const result = await work()
    logRobotCommissioning('http', {
      ...fields,
      status: 'ok',
      durationMs: Date.now() - started,
      ...httpResultShape(result)
    })
    return result
  } catch (error) {
    logRobotCommissioning('http', {
      ...fields,
      status: 'error',
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'request_failed'
    })
    throw error
  }
}

function httpResultShape(
  value: unknown
): Record<string, string | number | boolean | null | undefined> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const record = value as JsonObject
  const result = record.result
  const resultRecord = (
    result != null && typeof result === 'object' && !Array.isArray(result)
      ? result as JsonObject
      : undefined
  )
  const joints = record.joint_positions ?? record.jointPositions
  return {
    session: typeof record.session_id === 'string' ? record.session_id : undefined,
    online: record.online === undefined ? undefined : Boolean(record.online),
    idle: record.idle === undefined ? undefined : Boolean(record.idle),
    resultState: resultRecord && typeof resultRecord.state === 'string'
      ? resultRecord.state
      : undefined,
    hasJoints: Array.isArray(joints) ? joints.length > 0 : undefined
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
