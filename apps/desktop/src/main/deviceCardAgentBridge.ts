import {
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto'
import {
  chmod,
  mkdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  createServer,
  type Server,
  type Socket
} from 'node:net'

import type {
  DeviceCardAgentBridgeDescriptor,
  DeviceCardAgentHandshake,
  DeviceCardAgentMethod,
  DeviceCardAgentRequestRecord,
  DeviceCardAgentRpcRequest,
  DeviceCardAgentRpcResponse,
  DeviceCardAuthoringProfile
} from '@unilab/device-card-sdk'
import {
  DeviceCardAuthoringError,
  toDeviceCardAgentError,
  type DeviceCardAuthoringAutomation
} from '@unilab/device-card-host'

const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_CONNECTIONS = 8
const MAX_REQUESTS_PER_MINUTE = 120

export interface DeviceCardAgentBridgeInfo {
  enabled: boolean
  protocolVersion: 1
  descriptorPath: string
}

export class DeviceCardAgentBridge {
  private server: Server | null = null
  private capabilityToken = ''
  private connections = 0
  private readonly sockets = new Set<Socket>()
  private requestWindowStarted = Date.now()
  private requestsInWindow = 0
  private readonly recentRequests: DeviceCardAgentRequestRecord[] = []
  readonly descriptorPath: string

  constructor(private readonly options: {
    automation: DeviceCardAuthoringAutomation
    agentRoot: string
    endpoint: string
    log: (message: string) => void
  }) {
    this.descriptorPath = join(resolve(options.agentRoot), 'bridge.json')
  }

  async start(): Promise<void> {
    if (this.server) return
    await mkdir(resolve(this.options.agentRoot), {
      recursive: true,
      mode: 0o700
    })
    await chmod(resolve(this.options.agentRoot), 0o700)
    if (process.platform !== 'win32') {
      await mkdir(dirname(this.options.endpoint), { recursive: true })
      await rm(this.options.endpoint, { force: true })
    }
    this.capabilityToken = randomBytes(32).toString('base64url')
    const server = createServer((socket) => this.accept(socket))
    server.on('error', (error) => {
      this.options.log(`Device Card Agent Bridge: ${error.message}`)
    })
    await new Promise<void>((resolveReady, reject) => {
      server.once('error', reject)
      server.listen({
        path: this.options.endpoint,
        readableAll: false,
        writableAll: false
      }, () => {
        server.removeListener('error', reject)
        resolveReady()
      })
    })
    this.server = server
    if (process.platform !== 'win32') {
      await chmod(this.options.endpoint, 0o600)
    }
    await this.writeDescriptor()
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.capabilityToken = ''
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    if (server) {
      await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
    }
    await rm(this.descriptorPath, { force: true })
    if (process.platform !== 'win32') {
      await rm(this.options.endpoint, { force: true })
    }
  }

  getInfo(): DeviceCardAgentBridgeInfo {
    return {
      enabled: this.server !== null,
      protocolVersion: 1,
      descriptorPath: this.descriptorPath
    }
  }

  getRecentRequests(): DeviceCardAgentRequestRecord[] {
    return this.recentRequests.map((request) => ({ ...request }))
  }

  private accept(socket: Socket): void {
    if (this.connections >= MAX_CONNECTIONS) {
      socket.destroy()
      return
    }
    this.connections += 1
    this.sockets.add(socket)
    socket.setNoDelay(true)
    socket.setTimeout(10 * 60_000, () => socket.destroy())
    let authenticated = false
    let buffer = Buffer.alloc(0)
    let queue = Promise.resolve()

    socket.on('data', (chunk: Buffer) => {
      if (buffer.byteLength + chunk.byteLength > MAX_MESSAGE_BYTES) {
        this.writeFailure(socket, '', new DeviceCardAuthoringError(
          'INVALID_ARGUMENT',
          'Bridge 请求超过 1 MiB。'
        ))
        socket.end()
        return
      }
      buffer = Buffer.concat([buffer, chunk])
      while (true) {
        const lineEnd = buffer.indexOf(0x0a)
        if (lineEnd < 0) break
        const line = buffer.subarray(0, lineEnd).toString('utf8')
        buffer = buffer.subarray(lineEnd + 1)
        if (!line.trim()) continue
        queue = queue.then(async () => {
          const request = parseRequest(line)
          if (!authenticated) {
            authenticated = this.handleHandshake(socket, request)
            return
          }
          this.checkRateLimit()
          if (request.method === 'agent.handshake') {
            throw new DeviceCardAuthoringError(
              'INVALID_ARGUMENT',
              '同一连接不能重复握手。'
            )
          }
          try {
            const result = await this.dispatch(request)
            this.recordRequest(request.id, request.method, 'success')
            this.write(socket, {
              jsonrpc: '2.0',
              id: request.id,
              result
            })
          } catch (error) {
            this.recordRequest(request.id, request.method, 'error')
            throw error
          }
        }).catch((error: unknown) => {
          const requestId = safeRequestId(line)
          this.writeFailure(socket, requestId, error)
        })
      }
    })
    socket.on('error', (error) => {
      if (error.message !== 'write EPIPE') {
        this.options.log(`Device Card Agent connection: ${error.message}`)
      }
    })
    socket.on('close', () => {
      this.connections = Math.max(0, this.connections - 1)
      this.sockets.delete(socket)
    })
  }

  private handleHandshake(
    socket: Socket,
    request: DeviceCardAgentRpcRequest
  ): boolean {
    if (request.method !== 'agent.handshake') {
      throw new DeviceCardAuthoringError(
        'AUTHENTICATION_FAILED',
        '第一条 Bridge 消息必须是握手。',
        { retryable: true }
      )
    }
    const handshake = request.params as unknown as DeviceCardAgentHandshake
    if (handshake.protocolVersion !== 1) {
      throw new DeviceCardAuthoringError(
        'PROTOCOL_MISMATCH',
        `不支持 Agent Protocol ${String(handshake.protocolVersion)}。`
      )
    }
    if (
      typeof handshake.clientVersion !== 'string' ||
      !Number.isInteger(handshake.clientPid) ||
      typeof handshake.nonce !== 'string' ||
      handshake.nonce.length < 8 ||
      typeof handshake.capabilityToken !== 'string' ||
      !sameSecret(handshake.capabilityToken, this.capabilityToken)
    ) {
      throw new DeviceCardAuthoringError(
        'AUTHENTICATION_FAILED',
        'Bridge capability token 无效。',
        { retryable: true }
      )
    }
    this.write(socket, {
      jsonrpc: '2.0',
      id: request.id,
      result: { protocolVersion: 1 }
    })
    return true
  }

  private async dispatch(request: DeviceCardAgentRpcRequest): Promise<unknown> {
    const params = request.params
    if (request.method === 'authoring.targets.list') {
      return { devices: await this.options.automation.listTargets() }
    }
    if (request.method === 'authoring.kit.export') {
      return this.options.automation.exportKit({
        deviceId: stringParam(params, 'deviceId'),
        profile: profileParam(params, 'profile'),
        destination: stringParam(params, 'destination'),
        principal: 'agent'
      })
    }
    if (request.method === 'authoring.session.prepare') {
      return this.options.automation.prepare({
        mode: 'bootstrap',
        deviceId: stringParam(params, 'deviceId'),
        profile: profileParam(params, 'profile'),
        projectDir: stringParam(params, 'projectDir'),
        principal: 'agent',
        replace: booleanParam(params, 'replace', false)
      })
    }
    if (request.method === 'authoring.session.attach') {
      return this.options.automation.prepare({
        mode: 'attach',
        deviceId: stringParam(params, 'deviceId'),
        projectDir: stringParam(params, 'projectDir'),
        principal: 'agent',
        replace: booleanParam(params, 'replace', false)
      })
    }
    const locator = locatorParam(params)
    if (request.method === 'authoring.session.get') {
      return this.options.automation.getStatus({
        locator,
        afterRevision: optionalIntegerParam(params, 'afterRevision'),
        timeoutMs: optionalIntegerParam(params, 'timeoutMs')
      })
    }
    if (request.method === 'authoring.session.recheck') {
      return this.options.automation.recheck(locator)
    }
    if (request.method === 'authoring.session.export') {
      return this.options.automation.exportSource(
        locator,
        stringParam(params, 'destination'),
        'agent'
      )
    }
    if (request.method === 'authoring.session.install.request') {
      return this.options.automation.requestInstall(locator, 'agent')
    }
    if (request.method === 'authoring.session.close') {
      await this.options.automation.close(locator)
      return { closed: true }
    }
    throw new DeviceCardAuthoringError(
      'INVALID_ARGUMENT',
      `Bridge 方法不在白名单中：${request.method}`
    )
  }

  private checkRateLimit(): void {
    const now = Date.now()
    if (now - this.requestWindowStarted >= 60_000) {
      this.requestWindowStarted = now
      this.requestsInWindow = 0
    }
    this.requestsInWindow += 1
    if (this.requestsInWindow > MAX_REQUESTS_PER_MINUTE) {
      throw new DeviceCardAuthoringError(
        'AUTHENTICATION_FAILED',
        'Bridge 请求频率超过限制。',
        { retryable: true }
      )
    }
  }

  private recordRequest(
    requestId: string,
    method: DeviceCardAgentMethod,
    status: DeviceCardAgentRequestRecord['status']
  ): void {
    this.recentRequests.unshift({
      requestId,
      method,
      requestedAt: new Date().toISOString(),
      status
    })
    this.recentRequests.splice(50)
  }

  private writeFailure(socket: Socket, id: string, error: unknown): void {
    this.write(socket, {
      jsonrpc: '2.0',
      id,
      error: toDeviceCardAgentError(error)
    })
  }

  private write(socket: Socket, response: DeviceCardAgentRpcResponse): void {
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`)
  }

  private async writeDescriptor(): Promise<void> {
    const descriptor: DeviceCardAgentBridgeDescriptor = {
      schemaVersion: 'device-card-agent-bridge/v1',
      protocolVersion: 1,
      endpoint: this.options.endpoint,
      capabilityToken: this.capabilityToken,
      electronPid: process.pid,
      createdAt: new Date().toISOString()
    }
    const temporary = `${this.descriptorPath}.tmp`
    await writeFile(
      temporary,
      `${JSON.stringify(descriptor, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
    await chmod(temporary, 0o600)
    await rm(this.descriptorPath, { force: true })
    await rename(temporary, this.descriptorPath)
  }
}

export function deviceCardAgentEndpoint(userDataPath: string): string {
  const digest = createHash('sha256')
    .update(resolve(userDataPath))
    .digest('hex')
    .slice(0, 20)
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\unilab-card-agent-${digest}`
  }
  const runtimeRoot = process.env['XDG_RUNTIME_DIR'] || '/tmp'
  return join(runtimeRoot, `unilab-card-agent-${digest}.sock`)
}

function parseRequest(line: string): DeviceCardAgentRpcRequest {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error) {
    throw new DeviceCardAuthoringError(
      'INVALID_ARGUMENT',
      'Bridge 消息不是合法 JSON。',
      { cause: error }
    )
  }
  if (
    !isRecord(value) ||
    value.jsonrpc !== '2.0' ||
    typeof value.id !== 'string' ||
    typeof value.method !== 'string' ||
    !isRecord(value.params)
  ) {
    throw new DeviceCardAuthoringError(
      'INVALID_ARGUMENT',
      'Bridge JSON-RPC 请求结构无效。'
    )
  }
  return value as unknown as DeviceCardAgentRpcRequest
}

function safeRequestId(line: string): string {
  try {
    const value = JSON.parse(line) as { id?: unknown }
    return typeof value.id === 'string' ? value.id : ''
  } catch {
    return ''
  }
}

function stringParam(params: Record<string, unknown>, name: string): string {
  const value = params[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DeviceCardAuthoringError(
      'INVALID_ARGUMENT',
      `${name} 不能为空。`
    )
  }
  return value
}

function locatorParam(params: Record<string, unknown>): string {
  const value = params.sessionId ?? params.projectDir
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DeviceCardAuthoringError(
      'INVALID_ARGUMENT',
      '请求必须提供 sessionId 或 projectDir。'
    )
  }
  return value
}

function profileParam(
  params: Record<string, unknown>,
  name: string
): DeviceCardAuthoringProfile {
  const value = stringParam(params, name)
  if (value === 'vue' || value === 'vue-web-component-v1') {
    return 'vue-web-component-v1'
  }
  if (value === 'react' || value === 'react-web-component-v1') {
    return 'react-web-component-v1'
  }
  if (value === 'lite' || value === 'web-component-lite-v1') {
    return 'web-component-lite-v1'
  }
  throw new DeviceCardAuthoringError(
    'INVALID_ARGUMENT',
    `${name} 必须是 vue、react 或 lite。`
  )
}

function booleanParam(
  params: Record<string, unknown>,
  name: string,
  fallback: boolean
): boolean {
  const value = params[name]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    throw new DeviceCardAuthoringError('INVALID_ARGUMENT', `${name} 必须是布尔值。`)
  }
  return value
}

function optionalIntegerParam(
  params: Record<string, unknown>,
  name: string
): number | undefined {
  const value = params[name]
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new DeviceCardAuthoringError('INVALID_ARGUMENT', `${name} 必须是非负整数。`)
  }
  return Number(value)
}

function sameSecret(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
