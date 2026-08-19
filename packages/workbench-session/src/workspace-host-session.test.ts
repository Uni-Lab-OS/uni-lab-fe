import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWorkspaceHostWorkbenchSession } from './index'

const launchWorkspaceHostProcess = vi.hoisted(() => vi.fn())

vi.mock('./workspace-host-launch', () => ({ launchWorkspaceHostProcess }))

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve())
  })))
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true
  })))
})

describe('Workspace Host Workbench adapter', () => {
  it('does not launch the managed agent when agent support is disabled', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-host-agent-off-'))
    roots.push(workspacePath)
    const agentStarter = vi.fn()
    const session = createWorkspaceHostWorkbenchSession({
      workspacePath,
      enableAgent: false,
      agentStarter
    })

    const snapshot = await session.startAgent()

    expect(agentStarter).not.toHaveBeenCalled()
    expect(snapshot.agent).toBeNull()
  })

  /**
   * 验证适配器会提交已认证命令、投影 Host 状态，并将“仅加载外部设备包”配置更新回传为最新会话快照。
   */
  it('submits authenticated commands and observes external state changes', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-host-adapter-'))
    roots.push(workspacePath)
    const token = 'fixture-token'
    const operations = new Map<string, Record<string, unknown>>()
    const receivedCommands: string[] = []
    let receivedReleaseParameters: Record<string, unknown> | null = null
    const receivedParameters = new Map<string, Record<string, unknown>>()
    const snapshot = hostSnapshot(workspacePath)
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        sendJson(response, 401, { error: { message: 'unauthorized' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/v1/snapshot') {
        sendJson(response, 200, snapshot)
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/logs/backend') {
        sendJson(response, 200, { content: 'backend fixture log' })
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/operations') {
        const body = JSON.parse(await readBody(request)) as {
          operationId: string
          command: string
          parameters: Record<string, unknown>
        }
        receivedCommands.push(body.command)
        if (body.command === 'release.publish') {
          receivedReleaseParameters = body.parameters
        }
        receivedParameters.set(body.command, body.parameters)
        applyCommand(snapshot, body.command, body.parameters)
        const resetBlocked = body.command === 'local.reset-state'
        const operation = {
          operationId: body.operationId,
          phase: resetBlocked ? 'failed' : 'succeeded',
          result: body.command === 'release.publish'
            ? {
                releaseId: 'sha256:fixture-release',
                targetAddress: 'http://127.0.0.1:8080/api/v1',
                verified: true,
                activated: body.parameters['activate'] === true,
                counts: { templates: 3, materials: 2, workflows: 1 }
              }
            : body.command === 'release.inspect'
              ? {
                  targetAddress: String(body.parameters['backendUrl']),
                  empty: false,
                  counts: { templates: 4, materials: 2, workflows: 1 }
                }
            : { revision: snapshot.revision },
          error: resetBlocked
            ? {
                code: 'local_reset_state_blocked',
                message: '存在活动工作流或尚未收敛的 Edge 事实；本地状态未重建',
                details: {
                  stage: 'before-stop',
                  blockers: [{
                    source: 'local-edge-authority',
                    kind: 'edge-job',
                    identity: 'fixture-job',
                    status: 'unknown',
                    unknownCommandIds: ['fixture-command']
                  }]
                }
              }
            : null
        }
        operations.set(body.operationId, operation)
        sendJson(response, 202, operation)
        return
      }
      const operationId = url.pathname.match(/^\/v1\/operations\/(.+)$/)?.[1]
      if (request.method === 'GET' && operationId) {
        const operation = operations.get(decodeURIComponent(operationId))
        sendJson(response, operation ? 200 : 404, operation ?? {
          error: { message: 'not found' }
        })
        return
      }
      sendJson(response, 404, { error: { message: 'not found' } })
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing port')
    snapshot.host.endpoint = `http://127.0.0.1:${address.port}`

    const runtime = join(workspacePath, '.unilabos', 'runtime', 'workbench')
    await mkdir(runtime, { recursive: true })
    await Promise.all([
      writeFile(join(runtime, 'session.json'), JSON.stringify(snapshot)),
      writeFile(join(runtime, 'host.token'), token),
      writeFile(
        join(workspacePath, '.unilabos', 'environment.local.json'),
        JSON.stringify({
          schemaVersion: 1,
          backendUrl: 'http://127.0.0.1:8080'
        })
      )
    ])

    const session = createWorkspaceHostWorkbenchSession({
      workspacePath,
      environment: {
        UNILAB_WORKBENCH_RENDERER_URL: 'http://127.0.0.1:3100'
      }
    })
    expect(session.getSnapshot().configuredExternalDevicesOnly).toBe(true)
    await session.registerRenderer()
    const backend = await session.startWorkspaceBackend()

    expect(receivedCommands).toEqual(['renderer.attach', 'backend.start'])
    expect(backend).toMatchObject({
      phase: 'ready',
      configuredExternalDevicesOnly: true,
      identity: {
        workspacePath,
        pid: 4101,
        backendUrl: 'http://127.0.0.1:42001'
      }
    })
    expect(await session.readEnvironmentLog('workspace-backend'))
      .toBe('backend fixture log')

    const allDevices = await session.setExternalDevicesOnly(false)
    expect(receivedCommands.at(-1)).toBe('configuration.update')
    expect(allDevices.configuredExternalDevicesOnly).toBe(false)
    expect(snapshot.configuration.externalDevicesOnly).toBe(false)

    const commandsBeforeRuntimeModeChange = receivedCommands.length
    const dryRun = await session.setRuntimeMode('dry-run')
    expect(receivedCommands.slice(commandsBeforeRuntimeModeChange)).toEqual([
      'configuration.update'
    ])
    expect(receivedParameters.get('configuration.update')).toEqual({
      runtimeMode: 'dry-run'
    })
    expect(dryRun.configuredRuntimeMode).toBe('dry-run')

    const reset = await session.resetWorkflowEnvironment()
    expect(receivedCommands.at(-1)).toBe('workflow.environment-reset')
    expect(receivedParameters.get('workflow.environment-reset')).toEqual({
      backendUrl: 'http://127.0.0.1:8080'
    })
    expect(reset.environmentReset).toMatchObject({
      phase: 'succeeded',
      message: '运行前环境已复位'
    })

    await expect(session.inspectReleaseTarget('http://192.168.1.20:9000'))
      .resolves.toEqual({
        targetAddress: 'http://192.168.1.20:9000',
        empty: false,
        counts: { templates: 4, materials: 2, workflows: 1 }
      })

    const release = await session.publishRelease({
      activate: false,
      backendUrl: 'http://192.168.1.20:9000',
      resetTarget: true
    })
    expect(receivedCommands.at(-1)).toBe('release.publish')
    expect(receivedReleaseParameters).toMatchObject({
      backendUrl: 'http://192.168.1.20:9000',
      activate: false,
      verify: true,
      resetTarget: true,
      confirmation: 'CLEAR_BACKEND'
    })
    expect(release).toEqual({
      releaseId: 'sha256:fixture-release',
      targetAddress: 'http://127.0.0.1:8080/api/v1',
      verified: true,
      activated: false,
      counts: { templates: 3, materials: 2, workflows: 1 }
    })

    const workspaceBackendIdentity = session.getSnapshot().identity
    const switched = await session.setDomainAuthority('backend')
    expect(receivedCommands.at(-1)).toBe('authority.switch')
    expect(receivedParameters.get('authority.switch')).toEqual({
      mode: 'backend',
      backendUrl: 'http://127.0.0.1:8080',
      bootstrap: false
    })
    expect(switched).toMatchObject({
      configuredDomainMode: 'backend',
      configuredBackendUrl: 'http://127.0.0.1:8080'
    })
    expect(switched.identity).toEqual(workspaceBackendIdentity)

    const commandsBeforeBackendPublish = receivedCommands.length
    await session.publishRelease({
      activate: true,
      backendUrl: 'http://192.168.1.20:9000',
      resetTarget: true
    })
    expect(receivedCommands.slice(commandsBeforeBackendPublish)).toEqual([
      'authority.switch',
      'release.publish'
    ])
    expect(snapshot.configuration).toMatchObject({
      domainMode: 'backend',
      backendUrl: 'http://192.168.1.20:9000'
    })

    snapshot.components.edge = component('edge', {
      phase: 'ready',
      pid: 4102,
      generation: 'edge-generation',
      capabilities: ['device-control']
    })
    snapshot.revision += 1
    snapshot.eventCursor += 1

    await vi.waitFor(() => {
      expect(session.getSnapshot().edgeRuntime).toMatchObject({
        phase: 'ready',
        pid: 4102,
        generation: 'edge-generation'
      })
    }, { timeout: 2_000 })

    const commandsBeforeSchedulerChange = receivedCommands.length
    const customScheduler = await session.setSchedulerUrl(
      'http://127.0.0.1:39081'
    )
    expect(receivedCommands.slice(commandsBeforeSchedulerChange)).toEqual([
      'configuration.update',
      'os.restart'
    ])
    expect(receivedParameters.get('configuration.update')).toEqual({
      schedulerUrl: 'http://127.0.0.1:39081'
    })
    expect(customScheduler.configuredSchedulerUrl).toBe(
      'http://127.0.0.1:39081'
    )

    const automaticScheduler = await session.setSchedulerUrl(null)
    expect(receivedParameters.get('configuration.update')).toEqual({
      schedulerUrl: null
    })
    expect(automaticScheduler.configuredSchedulerUrl).toBeNull()

    await session.unregisterRenderer()
    expect(receivedCommands.at(-1)).toBe('renderer.detach')
    expect(snapshot.components.renderer.phase).toBe('idle')

    await expect(session.rebuildLocalData()).rejects.toThrow(
      '[local_reset_state_blocked] 存在活动工作流或尚未收敛的 Edge 事实；本地状态未重建；'
      + '阻断项：local-edge-authority/edge-job/fixture-job，状态 unknown，未确认命令 fixture-command'
    )
  })

  it('accepts a restarted Workspace Host snapshot with the same revision', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-host-restart-'))
    roots.push(workspacePath)
    const token = 'fixture-token'
    const first = hostSnapshot(workspacePath)
    const second = hostSnapshot(workspacePath)
    first.revision = 7
    second.revision = 7
    first.components.backend = component('backend', {
      phase: 'ready',
      pid: 4101,
      address: 'http://127.0.0.1:42001',
      generation: 'backend-before-host-restart'
    })
    second.components.backend = component('backend', {
      phase: 'ready',
      pid: 4201,
      address: 'http://127.0.0.1:42002',
      generation: 'backend-after-host-restart'
    })

    const firstServer = createSnapshotServer(token, first)
    const secondServer = createSnapshotServer(token, second)
    servers.push(firstServer, secondServer)
    await Promise.all([
      listen(firstServer),
      listen(secondServer)
    ])
    first.host.endpoint = serverEndpoint(firstServer)
    second.host.endpoint = serverEndpoint(secondServer)

    const runtime = join(workspacePath, '.unilabos', 'runtime', 'workbench')
    await mkdir(runtime, { recursive: true })
    await Promise.all([
      writeFile(join(runtime, 'session.json'), JSON.stringify(first)),
      writeFile(join(runtime, 'host.token'), token)
    ])

    const session = createWorkspaceHostWorkbenchSession({ workspacePath })
    await session.readEnvironmentLog('workspace-backend')
    expect(session.getSnapshot()).toMatchObject({ identity: { pid: 4101 } })

    await new Promise<void>((resolve, reject) => {
      firstServer.close(error => error ? reject(error) : resolve())
    })
    await writeFile(join(runtime, 'session.json'), JSON.stringify(second))

    await vi.waitFor(() => {
      expect(session.getSnapshot()).toMatchObject({
        identity: {
          pid: 4201,
          backendUrl: 'http://127.0.0.1:42002'
        }
      })
    }, { timeout: 2_000 })
  })

  /**
   * Theia 启动时会并发注册 renderer 与启动 Backend；首次 Host 连接必须合并，
   * 否则同一工作区会派生多个 Host，再依赖单例锁淘汰输家。
   */
  it('coalesces concurrent first connections into one Host probe', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-host-concurrent-'))
    roots.push(workspacePath)
    const token = 'fixture-token'
    const snapshot = hostSnapshot(workspacePath)
    let snapshotRequests = 0
    const server = createSnapshotServer(token, snapshot, () => {
      snapshotRequests += 1
    })
    servers.push(server)
    await listen(server)
    snapshot.host.endpoint = serverEndpoint(server)

    const runtime = join(workspacePath, '.unilabos', 'runtime', 'workbench')
    await mkdir(runtime, { recursive: true })
    await Promise.all([
      writeFile(join(runtime, 'session.json'), JSON.stringify(snapshot)),
      writeFile(join(runtime, 'host.token'), token)
    ])

    const session = createWorkspaceHostWorkbenchSession({ workspacePath })
    await expect(Promise.all([
      session.readEnvironmentLog('workspace-backend'),
      session.readEnvironmentLog('workspace-backend')
    ])).resolves.toEqual(['backend fixture log', 'backend fixture log'])
    expect(snapshotRequests).toBe(1)
  })

  /** Host 在探活后中断时也必须返回可行动诊断，不能泄漏 Node 底层文案。 */
  it('normalizes a Host transport failure after a successful probe', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-host-drop-'))
    roots.push(workspacePath)
    const token = 'fixture-token'
    const snapshot = hostSnapshot(workspacePath)
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/v1/snapshot') {
        sendJson(response, 200, snapshot)
        return
      }
      request.socket.destroy()
    })
    servers.push(server)
    await listen(server)
    snapshot.host.endpoint = serverEndpoint(server)

    const runtime = join(workspacePath, '.unilabos', 'runtime', 'workbench')
    await mkdir(runtime, { recursive: true })
    await Promise.all([
      writeFile(join(runtime, 'session.json'), JSON.stringify(snapshot)),
      writeFile(join(runtime, 'host.token'), token)
    ])

    const session = createWorkspaceHostWorkbenchSession({ workspacePath })
    const failure = await session.readEnvironmentLog('workspace-backend').then(
      () => null,
      error => error instanceof Error ? error : new Error(String(error))
    )
    expect(failure?.message).toContain(
      `Workspace Host 不可达：${snapshot.host.endpoint}`
    )
    expect(failure?.message).not.toContain('fetch failed')
  })

  /**
   * 磁盘中的 Host 会话可能在桌面应用重启后仍然格式合法，但其进程和端口已经失效。
   * 适配器应启动并连接替代 Host，而不是把底层 fetch 错误泄漏给环境操作。
   */
  it('replaces a stale Host once across concurrent operations', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'unilab-host-stale-'))
    roots.push(workspacePath)
    const token = 'fixture-token'
    const stale = hostSnapshot(workspacePath)
    stale.host.endpoint = 'http://127.0.0.1:1'
    const replacement = hostSnapshot(workspacePath)
    const operations = new Map<string, Record<string, unknown>>()
    const server = createServer(async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        sendJson(response, 401, { error: { message: 'unauthorized' } })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === '/v1/snapshot') {
        sendJson(response, 200, replacement)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/operations') {
        const body = JSON.parse(await readBody(request)) as {
          operationId: string
          command: string
          parameters: Record<string, unknown>
        }
        applyCommand(replacement, body.command, body.parameters)
        const operation = {
          operationId: body.operationId,
          phase: 'succeeded',
          result: { revision: replacement.revision },
          error: null
        }
        operations.set(body.operationId, operation)
        sendJson(response, 202, operation)
        return
      }
      const operationId = url.pathname.match(/^\/v1\/operations\/(.+)$/)?.[1]
      if (request.method === 'GET' && operationId) {
        const operation = operations.get(decodeURIComponent(operationId))
        sendJson(response, operation ? 200 : 404, operation ?? {
          error: { message: 'not found' }
        })
        return
      }
      sendJson(response, 404, { error: { message: 'not found' } })
    })
    servers.push(server)
    await listen(server)
    replacement.host.endpoint = serverEndpoint(server)

    const runtime = join(workspacePath, '.unilabos', 'runtime', 'workbench')
    await mkdir(runtime, { recursive: true })
    await Promise.all([
      writeFile(join(runtime, 'session.json'), JSON.stringify(stale)),
      writeFile(join(runtime, 'host.token'), token)
    ])
    launchWorkspaceHostProcess.mockImplementationOnce(async () => {
      await writeFile(join(runtime, 'session.json'), JSON.stringify(replacement))
    })

    const session = createWorkspaceHostWorkbenchSession({ workspacePath })
    const snapshots = await Promise.all([
      session.startWorkspaceBackend(),
      session.startWorkspaceBackend()
    ])

    expect(launchWorkspaceHostProcess).toHaveBeenCalledOnce()
    expect(snapshots).toHaveLength(2)
    for (const snapshot of snapshots) {
      expect(snapshot).toMatchObject({
        phase: 'ready',
        identity: {
          pid: 4101,
          backendUrl: 'http://127.0.0.1:42001'
        }
      })
    }
  })
})

function createSnapshotServer(
  token: string,
  snapshot: ReturnType<typeof hostSnapshot>,
  onSnapshot: () => void = () => undefined
) {
  return createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      sendJson(response, 401, { error: { message: 'unauthorized' } })
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/v1/snapshot') {
      onSnapshot()
      sendJson(response, 200, snapshot)
      return
    }
    if (request.method === 'GET' && url.pathname === '/v1/logs/backend') {
      sendJson(response, 200, { content: 'backend fixture log' })
      return
    }
    sendJson(response, 404, { error: { message: 'not found' } })
  })
}

async function listen(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
}

function serverEndpoint(server: ReturnType<typeof createServer>): string {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  return `http://127.0.0.1:${address.port}`
}

/**
 * 构造 Workspace Host 测试快照。
 * @param workspacePath 测试工作区的绝对路径。
 * @returns 带有默认外部设备包策略及空闲组件的可变 Host 快照。
 */
function hostSnapshot(workspacePath: string) {
  return {
    schemaVersion: 'unilab-workspace-host/v1' as const,
    revision: 1,
    eventCursor: 1,
    workspacePath,
    updatedAt: '2026-08-13T00:00:00Z',
    host: {
      phase: 'ready',
      pid: process.pid,
      endpoint: '',
      tokenPath: join(workspacePath, 'host.token'),
      platform: process.platform
    },
    configuration: {
      graphPath: 'deployment/graphs/fixture.json',
      externalDevicesOnly: true,
      runtimeMode: 'normal',
      domainMode: 'local',
      backendUrl: null as string | null,
      schedulerUrl: null as string | null
    },
    components: {
      backend: component('backend'),
      edge: component('edge'),
      plc: component('plc'),
      renderer: component('renderer')
    },
    workflowEnvironmentReset: {
      phase: 'idle',
      message: '运行前环境尚未复位',
      baselineFingerprint: null as string | null,
      receiptUuid: null as string | null,
      error: null as Record<string, unknown> | null
    }
  }
}

function component(
  name: string,
  change: Partial<ReturnType<typeof componentShape>> = {}
) {
  return { ...componentShape(name), ...change }
}

function componentShape(name: string) {
  return {
    name,
    phase: 'idle',
    pid: null as number | null,
    address: null as string | null,
    generation: null as string | null,
    logPath: null as string | null,
    diagnostic: null as string | null,
    capabilities: [] as string[],
    metadata: {} as Record<string, unknown>
  }
}

/**
 * 将收到的 Host 命令投影到测试快照。
 * @param snapshot 代表 Workspace Host 当前权威状态的测试快照。
 * @param command 被适配器提交的命令名。
 * @param parameters 命令携带的配置或操作参数。
 */
function applyCommand(
  snapshot: ReturnType<typeof hostSnapshot>,
  command: string,
  parameters: Record<string, unknown>
) {
  if (command === 'backend.start') {
    snapshot.components.backend = component('backend', {
      phase: 'ready',
      pid: 4101,
      address: 'http://127.0.0.1:42001',
      generation: 'backend-generation',
      logPath: '/tmp/backend.log',
      capabilities: ['authoring', 'inventory', 'workflow-run'],
      metadata: {
        graphPath: 'deployment/graphs/fixture.json',
        graphFingerprint: 'fixture-fingerprint'
      }
    })
  } else if (command === 'renderer.attach') {
    snapshot.components.renderer = component('renderer', {
      phase: 'ready',
      pid: Number(parameters['pid']),
      address: String(parameters['address']),
      generation: String(parameters['generation']),
      capabilities: ['workbench-ui', 'theia-rpc']
    })
  } else if (command === 'renderer.detach') {
    snapshot.components.renderer = component('renderer')
  } else if (command === 'configuration.update') {
    Object.assign(snapshot.configuration, parameters)
  } else if (command === 'authority.switch') {
    snapshot.configuration.domainMode = String(parameters['mode'])
    snapshot.configuration.backendUrl = parameters['backendUrl'] == null
      ? null
      : String(parameters['backendUrl'])
  } else if (command === 'release.publish' && parameters['activate'] === true) {
    snapshot.configuration.domainMode = 'backend'
    snapshot.configuration.backendUrl = String(parameters['backendUrl'])
  } else if (command === 'workflow.environment-reset') {
    snapshot.workflowEnvironmentReset = {
      phase: 'succeeded',
      message: '运行前环境已复位',
      baselineFingerprint: 'sha256:baseline',
      receiptUuid: '74000000-0000-4000-8000-000000000001',
      error: null
    }
  }
  snapshot.revision += 1
  snapshot.eventCursor += 1
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown
) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}
