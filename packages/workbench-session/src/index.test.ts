import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createManagedLocalWorkbenchSession,
  defaultPlcSimulatorProjectPath,
  WORKBENCH_OS_READINESS_TIMEOUT_MS,
  type WorkbenchSession
} from './index'

const sessions: WorkbenchSession[] = []
const fixtureRoots: string[] = []

afterEach(async () => {
  await Promise.allSettled(sessions.splice(0).map(session => session.stopAll()))
  await Promise.all(fixtureRoots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true
  })))
})

describe('managed local Workbench session', () => {
  it('allows managed exact workflow composition to finish before readiness expires', () => {
    expect(WORKBENCH_OS_READINESS_TIMEOUT_MS).toBe(600_000)
  })

  it('pre-fills the conventional sibling PLC-Sim path for a new workspace', async () => {
    const fixture = await createFixture()
    expect(defaultPlcSimulatorProjectPath(fixture.workspacePath))
      .toBe(fixture.plcSimulatorPath)
  })

  it('owns the Workspace Agent independently from the OS lifecycle', async () => {
    const fixture = await createFixture()
    let agentStopCalls = 0
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      enableAgent: true,
      agentStarter: async options => ({
        identity: {
          implementation: 'aioncore',
          productName: 'UniLab Agent',
          distributionVersion: 'fixture',
          phase: 'ready',
          url: 'http://127.0.0.1:19000',
          iconUrl: null,
          pid: 99,
          dataDir: join(options.workspacePath, '.unilabos', 'agent', 'aionui'),
          workDir: options.workspacePath,
          logPath: join(options.workspacePath, '.unilabos', 'agent', 'agent.log'),
          diagnostic: null
        },
        stop: async () => { agentStopCalls += 1 }
      }),
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)

    const agentReady = await session.startAgent()
    expect(agentReady).toMatchObject({
      phase: 'idle',
      identity: null,
      agent: {
        phase: 'ready',
        workDir: fixture.workspacePath,
        pid: 99
      }
    })

    await session.start()
    await session.stop()
    expect(agentStopCalls).toBe(0)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      identity: null,
      agent: { phase: 'ready', pid: 99 }
    })

    await session.stopAgent()
    expect(agentStopCalls).toBe(1)
    expect(session.getSnapshot().agent).toBeNull()
  })

  it('publishes normalized identity and diagnostics only after OS readiness', async () => {
    const fixture = await createFixture()
    const phases: string[] = []
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)
    session.onDidChange(snapshot => phases.push(snapshot.phase))

    const ready = await session.start()

    expect(phases).toEqual([
      'validating',
      'starting',
      'waiting',
      'ready'
    ])
    expect(ready).toMatchObject({
      phase: 'ready',
      diagnostic: null,
      identity: {
        workspacePath: fixture.workspacePath,
        osProjectPath: fixture.osProjectPath,
        environmentPath: fixture.environmentPath,
        graphPath: join(
          fixture.workspacePath,
          'deployment',
          'graphs',
          'szlab-local-debug.json'
        ),
        mode: 'normal'
      }
    })
    expect(ready.identity?.pid).toBeGreaterThan(0)
    expect(ready.identity?.generation).toMatch(/^[0-9a-f-]{36}$/)
    expect(ready.identity?.backendUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(ready.identity?.packageMounts).toMatchObject({
      schemaVersion: 'workspace-package-mounts/v1',
      editablePackageId: 'fixture_lab',
      items: [{
        packageId: 'fixture_lab',
        editable: true,
        readOnly: false,
        packageRootUri: `file://${fixture.workspacePath}/fixture_lab`
      }]
    })
    expect(ready.identity?.logPath).toBe(join(
      fixture.workspacePath,
      '.unilabos',
      'logs',
      'workbench',
      `${ready.identity?.generation}.log`
    ))
    await expect(readFile(
      join(fixture.workspacePath, '.unilabos', '.gitignore'),
      'utf8'
    )).resolves.toMatch(/(^|\n)agent\/\n/)
  })

  it('launches an installed OS from the selected Python environment without a source checkout', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)

    const ready = await session.start()

    expect(ready).toMatchObject({
      phase: 'ready',
      identity: {
        osProjectPath: '',
        osRuntimeSource: 'environment',
        environmentPath: fixture.environmentPath
      }
    })
  })

  it('fails closed when the explicitly selected Python environment is invalid', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: join(fixture.environmentPath, 'missing'),
      environment: {
        PATH: join(fixture.environmentPath, 'bin')
      },
      readinessTimeoutMs: 1_000
    })
    sessions.push(session)

    await expect(session.start()).rejects.toThrow(
      '显式选择的 Python 环境不可用'
    )
    expect(session.getSnapshot()).toMatchObject({
      phase: 'failed',
      identity: null,
      diagnostic: {
        code: 'python_environment_not_found'
      }
    })
  })

  it('fails closed when the persisted local environment configuration is corrupt', async () => {
    const fixture = await createFixture()
    const configurationRoot = join(fixture.workspacePath, '.unilabos')
    await mkdir(configurationRoot, { recursive: true })
    await writeFile(
      join(configurationRoot, 'environment.local.json'),
      '{not-json}\n'
    )
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      readinessTimeoutMs: 1_000
    })
    sessions.push(session)

    await expect(session.start()).rejects.toThrow(
      '本地环境配置不是有效 JSON'
    )
    expect(session.getSnapshot()).toMatchObject({
      phase: 'failed',
      identity: null,
      diagnostic: { code: 'invalid_workspace' }
    })
  })

  it('does not change selected launch settings when persistence fails', async () => {
    const fixture = await createFixture()
    const configurationPath = join(
      fixture.workspacePath,
      '.unilabos',
      'environment.local.json'
    )
    await mkdir(configurationPath, { recursive: true })
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)

    await expect(session.configureGraph(
      'deployment/graphs/not-recorded.json'
    )).rejects.toThrow()
    await expect(session.setExternalDevicesOnly(false)).rejects.toThrow()
    await expect(session.setRuntimeMode('dry-run')).rejects.toThrow()
    expect(session.getSnapshot().configuredGraphPath).toBe(
      join('deployment', 'graphs', 'szlab-local-debug.json')
    )
    expect(session.getSnapshot().configuredExternalDevicesOnly).toBe(true)

    await rm(configurationPath, { recursive: true, force: true })
    const ready = await session.start()
    expect(ready.identity).toMatchObject({
      graphPath: join(
        fixture.workspacePath,
        'deployment',
        'graphs',
        'szlab-local-debug.json'
      ),
      mode: 'normal'
    })
  })

  it('fails closed without touching a process that owns an explicit port', async () => {
    const fixture = await createFixture()
    const owner = createServer()
    await new Promise<void>((resolveListen, reject) => {
      owner.once('error', reject)
      owner.listen(0, '127.0.0.1', resolveListen)
    })
    const address = owner.address()
    if (!address || typeof address === 'string') {
      owner.close()
      throw new Error('fixture server did not expose a TCP port')
    }
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      backendPort: address.port,
      readinessTimeoutMs: 1_000
    })
    sessions.push(session)

    try {
      await expect(session.start()).rejects.toThrow('已被占用')
      expect(session.getSnapshot()).toMatchObject({
        phase: 'failed',
        identity: null,
        diagnostic: {
          code: 'port_conflict'
        }
      })
      expect(owner.listening).toBe(true)
    } finally {
      await new Promise<void>(resolveClose => owner.close(() => resolveClose()))
    }
  })

  it('deduplicates starts and restarts with a new process generation', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)

    const [first, duplicate] = await Promise.all([session.start(), session.start()])
    expect(duplicate.identity?.generation).toBe(first.identity?.generation)
    const firstPid = first.identity?.pid ?? 0
    const restarted = await session.restart()

    expect(restarted.phase).toBe('ready')
    expect(restarted.identity?.generation).not.toBe(first.identity?.generation)
    expect(restarted.identity?.pid).not.toBe(firstPid)
    expect(await session.readLogTail()).toContain(
      `generation=${restarted.identity?.generation}`
    )
    await session.stop()
    expect(session.getSnapshot()).toEqual({
      phase: 'idle',
      message: 'Uni-Lab OS 已停止',
      configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
      configuredExternalDevicesOnly: true,
      configuredRuntimeMode: 'normal',
      identity: null,
      agent: null,
      diagnostic: null,
      plcSimulator: {
        phase: 'idle',
        message: 'PLC-Sim 尚未启动',
        projectPath: fixture.plcSimulatorPath,
        variableTablePath: '',
        variableTableCandidates: [],
        handshakeProfile: 'szlab',
        pid: null,
        guiUrl: 'http://127.0.0.1:18765',
        opcUaUrl: 'opc.tcp://127.0.0.1:4855',
        logPath: '',
        diagnostic: null
      }
    })
  })

  it('serializes a new OS start behind an in-flight stop', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)
    const first = await session.start()

    const stopping = session.stop()
    const startingAgain = session.start()
    const [stopped, restarted] = await Promise.all([stopping, startingAgain])

    expect(stopped.phase).toBe('idle')
    expect(restarted).toMatchObject({ phase: 'ready' })
    expect(restarted.identity?.generation).not.toBe(first.identity?.generation)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      identity: { generation: restarted.identity?.generation }
    })
  })

  it('keeps PLC-Sim independent from OS stop and cleans both on stopAll', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorGuiPort: fixture.plcSimulatorGuiPort,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)

    await session.start()
    await session.configurePlcSimulator(fixture.plcSimulatorPath)
    const plcReady = await session.startPlcSimulator()

    expect(plcReady.plcSimulator).toMatchObject({
      phase: 'ready',
      projectPath: fixture.plcSimulatorPath,
      guiUrl: `http://127.0.0.1:${fixture.plcSimulatorGuiPort}`,
      opcUaUrl: `opc.tcp://127.0.0.1:${fixture.plcSimulatorOpcUaPort}`
    })
    expect(plcReady.plcSimulator.pid).toBeGreaterThan(0)
    await expect(session.readEnvironmentLog('plc-sim')).resolves.toContain(
      'starting PLC-Sim'
    )

    await session.stop()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      plcSimulator: { phase: 'ready' }
    })
    await session.stopAll()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      plcSimulator: { phase: 'idle', pid: null }
    })
    await expect(readFile(
      join(fixture.workspacePath, '.unilabos', 'environment.local.json'),
      'utf8'
    )).resolves.toContain(fixture.plcSimulatorPath)
  })

  it('starts PLC-Sim with the recommended Workspace CSV and handshake before OS', async () => {
    const fixture = await createFixture()
    const requestLogPath = join(fixture.workspacePath, '.unilabos', 'plc-api.log')
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorGuiPort: fixture.plcSimulatorGuiPort,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000,
      environment: {
        ...process.env,
        UNILAB_FIXTURE_PLC_REQUEST_LOG: requestLogPath
      }
    })
    sessions.push(session)

    await session.configurePlcSimulator(fixture.plcSimulatorPath)
    const beforeOs = await session.startPlcSimulator()

    expect(beforeOs).toMatchObject({
      phase: 'idle',
      identity: null,
      plcSimulator: {
        phase: 'ready',
        handshakeProfile: 'szlab',
        variableTablePath: fixture.plcVariableTablePath
      }
    })
    const requests = await readFile(requestLogPath, 'utf8')
    expect(requests).toContain('POST /api/server/start')
    expect(requests).toContain('POST /api/agent/start')
    expect(requests).not.toContain('/api/csv/upload')

    await expect(session.start()).resolves.toMatchObject({
      phase: 'ready',
      plcSimulator: { phase: 'ready' }
    })
  })

  it('cleans OS and PLC-Sim even when Agent teardown rejects', async () => {
    const fixture = await createFixture()
    let agentStopCalls = 0
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      enableAgent: true,
      agentStarter: async options => ({
        identity: {
          implementation: 'aioncore',
          productName: 'UniLab Agent',
          distributionVersion: 'fixture',
          phase: 'ready',
          url: 'http://127.0.0.1:19000',
          iconUrl: null,
          pid: 99,
          dataDir: join(options.workspacePath, '.unilabos', 'agent', 'aionui'),
          workDir: options.workspacePath,
          logPath: join(options.workspacePath, '.unilabos', 'agent', 'agent.log'),
          diagnostic: null
        },
        stop: async () => {
          agentStopCalls += 1
          throw new Error('fixture agent teardown failed')
        }
      }),
      plcSimulatorGuiPort: fixture.plcSimulatorGuiPort,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)
    await session.startAgent()
    await session.start()
    await session.configurePlcSimulator(fixture.plcSimulatorPath)
    await session.startPlcSimulator()

    await expect(session.stopAll()).rejects.toThrow(
      'Workbench 环境停止时发生错误'
    )
    expect(agentStopCalls).toBe(1)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      identity: null,
      plcSimulator: { phase: 'idle', pid: null }
    })
  })

  it('serializes a new PLC-Sim start behind an in-flight stop', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorGuiPort: fixture.plcSimulatorGuiPort,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)
    await session.start()
    await session.configurePlcSimulator(fixture.plcSimulatorPath)
    const first = await session.startPlcSimulator()
    const firstPid = first.plcSimulator.pid

    const stopping = session.stopPlcSimulator()
    const startingAgain = session.startPlcSimulator()
    const [stopped, restarted] = await Promise.all([stopping, startingAgain])

    expect(stopped.plcSimulator.phase).toBe('idle')
    expect(restarted.plcSimulator.phase).toBe('ready')
    expect(restarted.plcSimulator.pid).not.toBe(firstPid)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(session.getSnapshot().plcSimulator).toMatchObject({
      phase: 'ready',
      pid: restarted.plcSimulator.pid
    })
  })

  it('does not block Workbench authoring when the HostNode has no online devices', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorGuiPort: fixture.plcSimulatorGuiPort,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000,
      environment: {
        ...process.env,
        UNILAB_FIXTURE_NO_ONLINE_DEVICES: '1'
      }
    })
    sessions.push(session)
    await expect(session.start()).resolves.toMatchObject({
      phase: 'ready',
      diagnostic: null
    })
  })

  it('does not publish ready while the HostNode device catalog is unavailable', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorGuiPort: fixture.plcSimulatorGuiPort,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 800,
      environment: {
        ...process.env,
        UNILAB_FIXTURE_DEVICES_NOT_READY: '1'
      }
    })
    sessions.push(session)

    await expect(session.start()).rejects.toThrow('/api/v1/devices')
    expect(session.getSnapshot()).toMatchObject({
      phase: 'failed',
      diagnostic: { code: 'os_readiness_failed' }
    })
  })

  it('starts PLC-Sim independently after authoring becomes ready', async () => {
    const fixture = await createFixture()
    const plcReadyFile = join(fixture.workspacePath, '.unilabos', 'plc-ready')
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorGuiPort: fixture.plcSimulatorGuiPort,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 2_000,
      environment: {
        ...process.env,
        UNILAB_FIXTURE_PLC_READY_FILE: plcReadyFile
      }
    })
    sessions.push(session)
    await session.configureGraph('deployment/graphs/szlab-plc-sim-local.json')
    await session.configurePlcSimulator(fixture.plcSimulatorPath)
    const initial = await session.start()
    const withPlc = await session.startPlcSimulator()

    expect(initial.phase).toBe('ready')
    expect(withPlc).toMatchObject({
      phase: 'ready',
      identity: {
        graphPath: join(
          fixture.workspacePath,
          'deployment',
          'graphs',
          'szlab-plc-sim-local.json'
        )
      },
      plcSimulator: { phase: 'ready' }
    })
  })

  it('defaults to normal actions and exposes isolated Dry-run as an explicit restart', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorGuiPort: fixture.plcSimulatorGuiPort,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)

    const normal = await session.start()
    expect(normal.identity?.mode).toBe('normal')
    const dryRun = await session.setRuntimeMode('dry-run')

    expect(dryRun.identity).toMatchObject({
      mode: 'dry-run',
      graphPath: join(
        fixture.workspacePath,
        'deployment',
        'graphs',
        'szlab-local-debug.json'
      )
    })
    await session.configurePlcSimulator(fixture.plcSimulatorPath)
    await session.startPlcSimulator()
    const normalAgain = await session.setRuntimeMode('normal')

    expect(normalAgain.identity).toMatchObject({
      mode: 'normal',
      graphPath: join(
        fixture.workspacePath,
        'deployment',
        'graphs',
        'szlab-local-debug.json'
      )
    })
    await expect(readFile(
      join(fixture.workspacePath, '.unilabos', 'environment.local.json'),
      'utf8'
    )).resolves.toContain('"runtimeMode": "normal"')
  })

  it('projects the configured runtime mode before OS startup', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath
    })
    sessions.push(session)

    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      configuredRuntimeMode: 'normal',
      identity: null
    })

    await session.setRuntimeMode('dry-run')

    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      configuredRuntimeMode: 'dry-run',
      identity: null
    })
  })

  it('allows any Workspace graph and records its immutable launch generation', async () => {
    const fixture = await createFixture()
    const argumentLogPath = join(fixture.workspacePath, 'unilab-args.json')
    const selectedGraphPath = join(
      fixture.workspacePath,
      'deployment',
      'graphs',
      'custom-real-device.json'
    )
    await writeFile(
      selectedGraphPath,
      `${JSON.stringify({
        nodes: [{
          id: 'fixture_plc',
          class: 'community.fixture_lab.szlab_poly_plc',
          config: {
            url: 'opc.tcp://192.168.1.10:4840',
            auto_connect: true
          }
        }]
      })}\n`
    )
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      readinessTimeoutMs: 5_000,
      environment: {
        ...process.env,
        UNILAB_FIXTURE_ARGUMENT_LOG: argumentLogPath
      }
    })
    sessions.push(session)
    await session.configureGraph('deployment/graphs/custom-real-device.json')

    const ready = await session.start()

    expect(ready).toMatchObject({
      phase: 'ready',
      configuredGraphPath: 'deployment/graphs/custom-real-device.json',
      identity: {
        graphPath: selectedGraphPath,
        mode: 'normal'
      }
    })
    const manifest = await readFile(
      join(
        fixture.workspacePath,
        '.unilabos',
        'runtime',
        'workbench',
        'session.json'
      ),
      'utf8'
    )
    expect(manifest).toContain(selectedGraphPath)
    expect(manifest).toContain(ready.identity?.graphFingerprint)
    const launchArguments = JSON.parse(
      await readFile(argumentLogPath, 'utf8')
    ) as string[]
    expect(launchArguments).toContain('--resource_graph_source_id')
    expect(launchArguments[
      launchArguments.indexOf('--resource_graph_source_id') + 1
    ]).toBe('custom-real-device.json')
    await expect(readFile(
      join(
        fixture.workspacePath,
        '.unilabos',
        'runtime',
        'workbench',
        'os',
        ready.identity?.generation ?? '',
        'selected-graph.json'
      ),
      'utf8'
    )).resolves.toContain('192.168.1.10')
  })

  it('defaults to external-only loading and persists an explicit opt-out', async () => {
    const fixture = await createFixture()
    const argumentLogPath = join(fixture.workspacePath, 'unilab-args.json')
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      readinessTimeoutMs: 5_000,
      environment: {
        ...process.env,
        UNILAB_FIXTURE_ARGUMENT_LOG: argumentLogPath
      }
    })
    sessions.push(session)

    expect(session.getSnapshot().configuredExternalDevicesOnly).toBe(true)
    await expect(session.start()).resolves.toMatchObject({ phase: 'ready' })
    expect(JSON.parse(await readFile(argumentLogPath, 'utf8'))).toContain(
      '--external_devices_only'
    )

    await session.stop()
    await session.setExternalDevicesOnly(false)
    expect(session.getSnapshot().configuredExternalDevicesOnly).toBe(false)
    await expect(session.start()).resolves.toMatchObject({ phase: 'ready' })

    const argumentsUsed = JSON.parse(await readFile(argumentLogPath, 'utf8'))
    expect(argumentsUsed).not.toContain('--external_devices_only')
    await expect(readFile(
      join(fixture.workspacePath, '.unilabos', 'environment.local.json'),
      'utf8'
    )).resolves.toContain('"externalDevicesOnly": false')
  })

  it('cancels PLC-Sim while its launch plan is still validating', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)

    await session.start()
    await session.configurePlcSimulator(fixture.plcSimulatorPath)
    const starting = session.startPlcSimulator()
    await session.stopPlcSimulator()

    await expect(starting).resolves.toMatchObject({
      phase: 'ready',
      message: 'Workspace 与 Uni-Lab OS 已就绪',
      plcSimulator: { phase: 'idle', pid: null }
    })
  })

  it('stops during readiness without publishing a false failure', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)
    const waiting = new Promise<void>(resolveWaiting => {
      const disposable = session.onDidChange(snapshot => {
        if (snapshot.phase !== 'waiting') return
        disposable.dispose()
        resolveWaiting()
      })
    })

    const starting = session.start()
    await waiting
    await session.stop()

    await expect(starting).resolves.toMatchObject({ phase: 'idle' })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      identity: null,
      diagnostic: null
    })
  })

  it('fails closed with logs when OS exits before readiness', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      environment: { UNILAB_FIXTURE_EXIT_BEFORE_READY: '1' },
      readinessTimeoutMs: 1_000
    })
    sessions.push(session)

    await expect(session.start()).rejects.toThrow(/就绪前退出|fetch failed/)
    const failed = session.getSnapshot()
    expect(failed).toMatchObject({
      phase: 'failed',
      diagnostic: { code: 'os_readiness_failed' }
    })
    expect(failed.identity?.logPath).toContain('/.unilabos/logs/workbench/')
  })

  it('does not publish ready for an empty MaterialSource contract', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      environment: {
        ...process.env,
        UNILAB_FIXTURE_INVALID_MATERIAL_SOURCE_CATALOG: '1'
      },
      readinessTimeoutMs: 1_500
    })
    sessions.push(session)

    await expect(session.start()).rejects.toThrow(
      'workflow-node-templates?limit=100&node_type=material_source'
    )
    expect(session.getSnapshot()).toMatchObject({
      phase: 'failed',
      diagnostic: { code: 'os_readiness_failed' }
    })
  })

  it('publishes an actionable failure and clears the child after a runtime crash', async () => {
    const fixture = await createFixture()
    const session = createManagedLocalWorkbenchSession({
      workspacePath: fixture.workspacePath,
      osProjectPath: fixture.osProjectPath,
      environmentPath: fixture.environmentPath,
      plcSimulatorOpcUaPort: fixture.plcSimulatorOpcUaPort,
      environment: {
        ...process.env,
        UNILAB_FIXTURE_EXIT_AFTER_READY_MS: '250'
      },
      readinessTimeoutMs: 5_000
    })
    sessions.push(session)
    const failed = new Promise<void>(resolveFailed => {
      const disposable = session.onDidChange(snapshot => {
        if (snapshot.phase !== 'failed') return
        disposable.dispose()
        resolveFailed()
      })
    })

    await session.start()
    await failed
    expect(session.getSnapshot()).toMatchObject({
      phase: 'failed',
      diagnostic: { code: 'os_exited' }
    })
    await expect(session.stop()).resolves.toMatchObject({ phase: 'idle' })
  })
})

async function createFixture(): Promise<{
  workspacePath: string
  osProjectPath: string
  environmentPath: string
  plcSimulatorPath: string
  plcVariableTablePath: string
  plcSimulatorGuiPort: number
  plcSimulatorOpcUaPort: number
}> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'unilab-workbench-session-'))
  )
  fixtureRoots.push(root)
  const workspacePath = join(root, 'Uni-Lab-SZLab')
  const osProjectPath = join(root, 'Uni-Lab-OS')
  const environmentPath = join(root, 'unilab-env')
  const plcSimulatorPath = join(root, 'PLC-Sim')
  const plcVariableTablePath = join(
    workspacePath,
    'szlab_poly_studio',
    'devices',
    'szlab_poly_plc',
    'szlab_plc_0807.csv'
  )
  const plcSimulatorGuiPort = await findAvailableLoopbackPort()
  const plcSimulatorOpcUaPort = await findAvailableLoopbackPort(
    plcSimulatorGuiPort
  )
  await Promise.all([
    mkdir(join(workspacePath, 'deployment', 'graphs'), { recursive: true }),
    mkdir(join(osProjectPath, 'unilabos'), { recursive: true }),
    mkdir(join(environmentPath, 'bin'), { recursive: true }),
    mkdir(join(plcSimulatorPath, 'OpcUaSim', 'gui'), { recursive: true }),
    mkdir(dirname(plcVariableTablePath), { recursive: true })
  ])
  await Promise.all([
    writeFile(join(workspacePath, 'deployment', 'local_config.py'), 'class BasicConfig:\n    pass\n'),
    writeFile(
      join(workspacePath, 'deployment', 'graphs', 'szlab-local-debug.json'),
      '{}\n'
    ),
    writeFile(
      join(workspacePath, 'deployment', 'graphs', 'szlab-plc-sim-local.json'),
      `${JSON.stringify({
        nodes: [{
          id: 'fixture_plc',
          class: 'community.fixture_lab.szlab_poly_plc',
          config: {
            url: `opc.tcp://127.0.0.1:${plcSimulatorOpcUaPort}/fixture_sim/`,
            auto_connect: true
          }
        }]
      }, null, 2)}\n`
    ),
    writeFile(join(environmentPath, 'bin', 'python'), fakePlcSimulatorExecutable()),
    writeFile(join(environmentPath, 'bin', 'unilab'), fakeUnilabExecutable()),
    writeFile(
      join(plcSimulatorPath, 'OpcUaSim', 'gui', 'backend.py'),
      '# fixture\n'
    ),
    writeFile(plcVariableTablePath, '变量名,数据类型\n工站初始化,BOOL\n')
  ])
  await Promise.all([
    chmod(join(environmentPath, 'bin', 'python'), 0o755),
    chmod(join(environmentPath, 'bin', 'unilab'), 0o755)
  ])
  return {
    workspacePath,
    osProjectPath,
    environmentPath,
    plcSimulatorPath,
    plcVariableTablePath,
    plcSimulatorGuiPort,
    plcSimulatorOpcUaPort
  }
}

async function findAvailableLoopbackPort(excludedPort?: number): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('fixture server did not expose a TCP port')
  }
  await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  if (address.port === excludedPort) return findAvailableLoopbackPort(excludedPort)
  return address.port
}

function fakePlcSimulatorExecutable(): string {
  return `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
if (process.env.UNILAB_FIXTURE_PLC_READY_FILE) {
  fs.mkdirSync(path.dirname(process.env.UNILAB_FIXTURE_PLC_READY_FILE), { recursive: true })
  fs.writeFileSync(process.env.UNILAB_FIXTURE_PLC_READY_FILE, 'ready\\n')
}
const server = http.createServer((request, response) => {
  if (process.env.UNILAB_FIXTURE_PLC_REQUEST_LOG) {
    fs.mkdirSync(path.dirname(process.env.UNILAB_FIXTURE_PLC_REQUEST_LOG), { recursive: true })
    fs.appendFileSync(
      process.env.UNILAB_FIXTURE_PLC_REQUEST_LOG,
      request.method + ' ' + request.url + '\\n'
    )
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok: true }))
})
server.listen(port, '127.0.0.1')
const stop = () => server.close(() => process.exit(0))
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
`
}

function fakeUnilabExecutable(): string {
  return `#!/usr/bin/env node
const http = require('node:http')
const fs = require('node:fs')
const args = process.argv.slice(2)
if (process.env.UNILAB_FIXTURE_ARGUMENT_LOG) {
  fs.writeFileSync(process.env.UNILAB_FIXTURE_ARGUMENT_LOG, JSON.stringify(args))
}
const port = Number(args[args.indexOf('--port') + 1])
const graphPath = args[args.indexOf('--graph') + 1]
if (process.env.UNILAB_FIXTURE_EXIT_BEFORE_READY === '1') process.exit(17)
let exitScheduled = false
const json = (response, body) => {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}
const server = http.createServer((request, response) => {
  if (request.url === '/api/v1/health') return json(response, { status: 'ok' })
  if (request.url === '/api/v1/workflow-node-templates') {
    return json(response, { code: 0, data: { items: [] } })
  }
  if (request.url === '/api/v1/workflow-node-templates?limit=100&node_type=material_source') {
    return json(response, {
      code: 0,
      data: {
        items: process.env.UNILAB_FIXTURE_INVALID_MATERIAL_SOURCE_CATALOG === '1'
          ? []
          : [{
              uuid: '21000000-0000-4000-8000-000000000001',
              node_type: 'material_source',
              resource_template: {
                uuid: '31000000-0000-4000-8000-000000000001',
                name: 'host_node'
              }
            }]
      }
    })
  }
  if (request.url === '/api/v1/resource-templates?limit=1') {
    return json(response, {
      code: 0,
      data: {
        items: [{
          uuid: '31000000-0000-4000-8000-000000000001',
          name: 'fixture_resource'
        }]
      }
    })
  }
  if (request.url === '/api/v1/devices') {
    if (process.env.UNILAB_FIXTURE_DEVICES_NOT_READY === '1') {
      return json(response, { code: 2001, data: {}, message: 'Host node not initialized' })
    }
    const plcIsOnline = !process.env.UNILAB_FIXTURE_PLC_READY_FILE
      || fs.existsSync(process.env.UNILAB_FIXTURE_PLC_READY_FILE)
    return json(response, {
      code: 0,
      data: {
        schemaVersion: 'device-catalog/v1',
        items: process.env.UNILAB_FIXTURE_NO_ONLINE_DEVICES === '1' || !plcIsOnline
          ? []
          : [{ id: 'fixture_device', actions: ['ping'] }]
      }
    })
  }
  if (request.url === '/api/v1/workspace/package-mounts') {
    if (process.env.UNILAB_FIXTURE_EXIT_AFTER_READY_MS && !exitScheduled) {
      exitScheduled = true
      setTimeout(() => process.exit(23), Number(process.env.UNILAB_FIXTURE_EXIT_AFTER_READY_MS))
    }
    return json(response, {
      code: 0,
      data: {
        schemaVersion: 'workspace-package-mounts/v1',
        editablePackageId: 'fixture_lab',
        dependencyRevision: 'sha256:none',
        catalogRevision: 'sha256:catalog',
        mountRevision: 'sha256:mount',
        items: [{
          packageId: 'fixture_lab',
          distributionName: 'fixture-lab',
          version: '1.0.0',
          namespace: 'community.fixture_lab',
          editable: true,
          readOnly: false,
          sourceKind: 'workspace',
          importRootUri: 'file://' + process.cwd(),
          packageRootUri: 'file://' + process.cwd() + '/fixture_lab',
          contentDigest: 'sha256:content',
          catalogDigest: 'sha256:catalog'
        }]
      }
    })
  }
  response.writeHead(404)
  response.end()
})
server.listen(port, '127.0.0.1')
const stop = () => server.close(() => process.exit(0))
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
`
}
