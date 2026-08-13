import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDiagnosticLogSessionId } from './diagnosticLogSession'
import {
  LocalRuntimeManager,
  type LocalRuntimeManagerOptions,
  type ManagedRuntimePort
} from './localRuntimeManager'
import {
  cleanupLocalRuntimeTestArtifacts,
  createLocalRuntimeTestFixture
} from './localRuntimeManager.testSupport'

/** 清理托管运行时测试创建的全部临时设备包目录。 */
afterEach(cleanupLocalRuntimeTestArtifacts)

const logSessionId = createDiagnosticLogSessionId(
  new Date('2026-08-06T01:02:03.004Z')
)

/** 覆盖私有运行时（Runtime）与持久 Supervisor 的桌面控制合同。 */
describe('LocalRuntimeManager managed Runtime', () => {
  it('uses development mode while an external environment is selected', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const manager = createManager(
      fixture.szlabRoot,
      managedRuntimePort({}),
      { useManagedRuntime: () => false }
    )

    await expect(manager.getModeInfo()).resolves.toMatchObject({
      mode: 'development'
    })
    expect(manager.persistsAfterAppQuit()).toBe(false)
  })

  /** 证明托管 Edge 不依赖用户拉取 OS 源码或配置 Conda 路径。 */
  it('starts a workspace without Conda or OS source paths', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const managedWorkingRoot = join(fixture.szlabRoot, 'managed-data')
    const startWorker = vi.fn(async () => workerSnapshot('running'))
    const stopWorker = vi.fn(async () => workerSnapshot('idle'))
    const manager = createManager(fixture.szlabRoot, {
      ...managedRuntimePort({ startWorker, stopWorker })
    }, {
      managedWorkingRoot,
      waitForEdgeReadiness: async () => undefined
    })

    await expect(manager.startEdge({
      ...fixture.config,
      osProjectPath: '',
      environmentPath: ''
    })).resolves.toMatchObject({ phase: 'ready', edgeRunning: true })
    expect(startWorker).toHaveBeenCalledWith({
      workspacePath: fixture.szlabRoot,
      graphPath: fixture.graphPath,
      configPath: join(fixture.szlabRoot, 'deployment', 'local_config.py'),
      workingDirectory: expect.stringMatching(
        new RegExp(`^${escapeRegExp(managedWorkingRoot)}`)
      ),
      backend: 'ros'
    })

    await expect(manager.stopEdge()).resolves.toMatchObject({
      phase: 'idle',
      edgeRunning: false
    })
    expect(stopWorker).toHaveBeenCalledTimes(1)
  })

  /** 证明 PLC-Sim 可由 Supervisor 单独启动和停止。 */
  it('lets the persistent Supervisor own a source PLC-Sim', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const startSimulator = vi.fn(async () => simulatorSnapshot('running'))
    const stopSimulator = vi.fn(async () => simulatorSnapshot('idle'))
    const manager = createManager(fixture.szlabRoot, managedRuntimePort({
      startSimulator,
      stopSimulator
    }), {
      waitForSimulatorReadiness: async () => undefined
    })

    await expect(manager.startSimulator({
      ...fixture.config,
      environmentPath: ''
    })).resolves.toMatchObject({
      phase: 'simulator_ready',
      simulatorRunning: true
    })
    expect(startSimulator).toHaveBeenCalledWith({
      kind: 'source',
      path: fixture.simulatorRoot
    })

    await manager.stopSimulator()
    expect(stopSimulator).toHaveBeenCalledTimes(1)
  })

  /** 证明 PLC-Sim 与领域侧 Edge 可同时受控，且停止 PLC 不影响 Edge。 */
  it('controls PLC-Sim while the isolated Runtime Worker remains running', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const manager = createManager(fixture.szlabRoot, managedRuntimePort({
      startWorker: vi.fn(async () => workerSnapshot('running')),
      startSimulator: vi.fn(async () => bothRunningSnapshot()),
      stopSimulator: vi.fn(async () => workerSnapshot('running'))
    }), {
      waitForEdgeReadiness: async () => undefined,
      waitForSimulatorReadiness: async () => undefined
    })

    await manager.startEdge(fixture.config)
    await expect(manager.startSimulator(fixture.config)).resolves.toMatchObject({
      phase: 'ready',
      simulatorRunning: true,
      edgeRunning: true
    })
    await expect(manager.stopSimulator()).resolves.toMatchObject({
      phase: 'ready',
      simulatorRunning: false,
      edgeRunning: true
    })
  })

  /** 证明用户触发设备包验收后，默认清理本次 PLC 与 Edge 进程。 */
  it('runs package acceptance and cleans up managed processes', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const stopWorker = vi.fn(async () => simulatorSnapshot('running'))
    const stopSimulator = vi.fn(async () => simulatorSnapshot('idle'))
    const runAcceptance = vi.fn(async () => ({
      status: 'verified' as const,
      message: 'PLC-Sim 与设备包启动验收通过。',
      checkedAt: 1_785_499_200_000,
      descriptorPath: join(fixture.szlabRoot, 'unilab.acceptance.json'),
      packageName: 'plc-reference',
      packageVersion: '1.0.0'
    }))
    const manager = createManager(fixture.szlabRoot, managedRuntimePort({
      startWorker: vi.fn(async () => bothRunningSnapshot()),
      stopWorker,
      startSimulator: vi.fn(async () => bothRunningSnapshot()),
      stopSimulator
    }), {
      waitForEdgeReadiness: async () => undefined,
      waitForSimulatorReadiness: async () => undefined,
      runAcceptance
    })

    await manager.startSimulator(fixture.config)
    await manager.startEdge(fixture.config)
    await expect(manager.runAcceptance(fixture.config)).resolves.toMatchObject({
      phase: 'idle',
      simulatorRunning: false,
      edgeRunning: false,
      acceptance: { status: 'verified', packageName: 'plc-reference' }
    })
    expect(runAcceptance).toHaveBeenCalledWith(fixture.szlabRoot)
    expect(stopWorker).toHaveBeenCalledTimes(1)
    expect(stopSimulator).toHaveBeenCalledTimes(1)
  })
})

type RuntimeOverrides = Partial<Pick<
  ManagedRuntimePort,
  'startWorker' | 'stopWorker' | 'startSimulator' | 'stopSimulator'
>>

/** 构造可按用例覆盖进程操作的最小托管 Runtime 测试端口。 */
function managedRuntimePort(
  overrides: RuntimeOverrides
): ManagedRuntimePort {
  return {
    getModeInfo: async () => ({
      mode: 'managed',
      label: '内置 Runtime',
      runtimeVersion: '0.11.3'
    }),
    getRuntimePaths: async () => {
      throw new Error('测试不应直接读取 Runtime 路径')
    },
    startWorker: async () => workerSnapshot('running'),
    stopWorker: async () => workerSnapshot('idle'),
    startSimulator: async () => simulatorSnapshot('running'),
    stopSimulator: async () => simulatorSnapshot('idle'),
    ...overrides
  }
}

/** 创建注入托管 Runtime 与无网络就绪桩的本地运行管理器。 */
function createManager(
  fixtureRoot: string,
  managedRuntime: ManagedRuntimePort,
  options: Omit<LocalRuntimeManagerOptions, 'managedRuntime'>
): LocalRuntimeManager {
  return new LocalRuntimeManager(
    join(fixtureRoot, 'logs'),
    vi.fn(),
    logSessionId,
    {
      edgeHttp: 58_103,
      hostLink: 58_104,
      simulatorGui: 58_105,
      simulatorOpcUa: 58_106
    },
    { managedRuntime, ...options }
  )
}

/** 构造只含 Worker 状态的 Supervisor 快照。 */
function workerSnapshot(status: 'idle' | 'running') {
  return {
    status,
    worker: status === 'running' ? { pid: 42 } : null,
    error: null,
    simulator: { status: 'idle' as const, pid: null, error: null }
  }
}

/** 构造只含 PLC-Sim 状态的 Supervisor 快照。 */
function simulatorSnapshot(status: 'idle' | 'running') {
  return {
    status: 'idle' as const,
    worker: null,
    error: null,
    simulator: {
      status,
      pid: status === 'running' ? 84 : null,
      error: null
    }
  }
}

/** 构造 PLC-Sim 与 Worker 同时运行的 Supervisor 快照。 */
function bothRunningSnapshot() {
  return {
    status: 'running' as const,
    worker: { pid: 42 },
    error: null,
    simulator: { status: 'running' as const, pid: 84, error: null }
  }
}

/** 转义动态测试目录，使其可安全嵌入正则表达式。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
