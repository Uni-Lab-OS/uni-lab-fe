import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect, type Socket } from 'node:net'
import { spawn } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'

import type {
  DeviceCardAgentBridgeDescriptor,
  DeviceCardAgentErrorPayload,
  DeviceCardAgentMethod,
  DeviceCardAgentRpcResponse
} from '@unilab/device-card-sdk'

const CLIENT_VERSION = '0.1.0'

export class AgentCliError extends Error {
  constructor(readonly payload: DeviceCardAgentErrorPayload) {
    super(payload.message)
    this.name = 'AgentCliError'
  }
}
export async function callElectronBridge(
  method: DeviceCardAgentMethod,
  params: Record<string, unknown>,
  options: { launchElectron: boolean }
): Promise<unknown> {
  let descriptor: DeviceCardAgentBridgeDescriptor
  try {
    descriptor = await readDescriptor()
  } catch (error) {
    if (options.launchElectron) {
      await launchElectronAndWait()
      descriptor = await readDescriptor()
    } else {
      throw cliError(
        'ELECTRON_NOT_RUNNING',
        'Uni-Lab Electron 未运行。',
        true,
        error
      )
    }
  }
  if (descriptor.protocolVersion !== 1) {
    throw cliError(
      'PROTOCOL_MISMATCH',
      `CLI 不支持 Agent Protocol ${String(descriptor.protocolVersion)}。`
    )
  }

  const socket = await connectSocket(descriptor.endpoint)
  const lines = createInterface({ input: socket, crlfDelay: Infinity })
  const iterator = lines[Symbol.asyncIterator]()
  try {
    await rpc(socket, iterator, 'agent.handshake', {
      protocolVersion: 1,
      clientVersion: CLIENT_VERSION,
      clientPid: process.pid,
      nonce: randomUUID(),
      capabilityToken: descriptor.capabilityToken
    })
    return await rpc(socket, iterator, method, params)
  } finally {
    lines.close()
    socket.end()
  }
}

async function rpc(
  socket: Socket,
  iterator: AsyncIterator<string>,
  method: 'agent.handshake' | DeviceCardAgentMethod,
  params: Record<string, unknown>
): Promise<unknown> {
  const id = randomUUID()
  socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  const next = await iterator.next()
  if (next.done) {
    throw cliError('ELECTRON_NOT_RUNNING', 'Electron Bridge 提前断开。', true)
  }
  const response = JSON.parse(next.value) as DeviceCardAgentRpcResponse
  if (response.id !== id) {
    throw cliError('INTERNAL_ERROR', 'Electron Bridge 响应 requestId 不匹配。')
  }
  if ('error' in response) throw new AgentCliError(response.error)
  return response.result
}

async function connectSocket(endpoint: string): Promise<Socket> {
  return new Promise<Socket>((resolveSocket, reject) => {
    const socket = connect(endpoint)
    socket.once('connect', () => resolveSocket(socket))
    socket.once('error', (error) => reject(cliError(
      'ELECTRON_NOT_RUNNING',
      `无法连接 Uni-Lab Electron：${error.message}`,
      true,
      error
    )))
  })
}

async function readDescriptor(): Promise<DeviceCardAgentBridgeDescriptor> {
  const path = descriptorPath()
  const descriptor = JSON.parse(
    await readFile(path, 'utf8')
  ) as DeviceCardAgentBridgeDescriptor
  if (
    descriptor.schemaVersion !== 'device-card-agent-bridge/v1' ||
    typeof descriptor.endpoint !== 'string' ||
    typeof descriptor.capabilityToken !== 'string'
  ) {
    throw new Error('Bridge descriptor 无效。')
  }
  return descriptor
}

function descriptorPath(): string {
  const explicit = process.env['UNILAB_CARD_AGENT_DESCRIPTOR']
  if (explicit) return explicit
  if (process.platform === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'Uni-Lab',
      'device-cards',
      'agent',
      'bridge.json'
    )
  }
  if (process.platform === 'win32') {
    return join(
      process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'),
      'Uni-Lab',
      'device-cards',
      'agent',
      'bridge.json'
    )
  }
  return join(
    process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'),
    'Uni-Lab',
    'device-cards',
    'agent',
    'bridge.json'
  )
}

async function launchElectronAndWait(): Promise<void> {
  const executable = process.env['UNILAB_ELECTRON_EXECUTABLE']
  if (!executable) {
    throw cliError(
      'ELECTRON_NOT_RUNNING',
      'CLI 未配置 Uni-Lab Electron 可执行文件，无法使用 --launch-electron。',
      true
    )
  }
  const child = spawn(executable, [], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined
    }
  })
  child.unref()
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      await readDescriptor()
      return
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  throw cliError(
    'ELECTRON_NOT_RUNNING',
    '启动 Electron 后等待 Bridge 超时。',
    true
  )
}

function cliError(
  code: DeviceCardAgentErrorPayload['code'],
  message: string,
  retryable = false,
  cause?: unknown
): AgentCliError {
  const error = new AgentCliError({
    code,
    message,
    retryable,
    details: {}
  })
  if (cause !== undefined) error.cause = cause
  return error
}
