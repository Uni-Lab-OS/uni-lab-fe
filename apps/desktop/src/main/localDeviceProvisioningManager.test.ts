import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalRuntimeManager } from './localRuntimeManager'

const digest = `sha256:${'a'.repeat(64)}`
const catalogDigest = `sha256:${'b'.repeat(64)}`
const templateUuid = '50afbb58-0f53-4ad6-9f73-24cfeb90a834'

const ports = vi.hoisted(() => ({
  listDevices: vi.fn(),
  getDeviceDetail: vi.fn(),
  resolvePackageCandidate: vi.fn(),
  listPackages: vi.fn(),
  getOnlineDevices: vi.fn(),
  download: vi.fn(),
  stage: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  inspect: vi.fn(),
  upload: vi.fn(),
  squareEnvironments: [] as string[]
}))

vi.mock('./localDeviceProvisioningAdapters', () => ({
  createCloudDeviceSquare: (environment: string) => {
    ports.squareEnvironments.push(environment)
    return {
      listDevices: ports.listDevices,
      getDeviceDetail: ports.getDeviceDetail,
      resolvePackageCandidate: ports.resolvePackageCandidate,
      listPackages: ports.listPackages
    }
  },
  createLocalAuthoringLaboratory: () => ({
    getOnlineDevices: ports.getOnlineDevices
  }),
  devicePackageCliConfig: (runtime: unknown) => runtime,
  provisioningErrorMessage: (error: unknown) => (
    error instanceof Error ? error.message : String(error)
  ),
  provisioningErrorRetryable: (error: unknown) => (
    !error
    || typeof error !== 'object'
    || !('retryable' in error)
    || (error as { retryable?: unknown }).retryable !== false
  ),
  provisioningRetryAction: (stage: string | undefined) => {
    if (stage === 'configuration_required') return 'configure'
    if (stage === 'activating' || stage === 'driver_ready') return 'activate'
    if (stage === 'removing') return 'remove'
    if (stage === 'removed' || stage === 'ready') return 'restore'
    return 'download'
  },
  confirmPublishedDevicePackage: vi.fn(async () => true)
}))

vi.mock('./devicePackageCli', () => ({
  downloadDevicePackageWithCli: ports.download,
  stageDeviceWithCli: ports.stage,
  removeDeviceWithCli: ports.remove,
  restoreDeviceGraphWithCli: ports.restore
}))

vi.mock('./devicePackagePublishCli', () => ({
  inspectDevicePackageWorkspace: ports.inspect,
  uploadDevicePackageWorkspace: ports.upload
}))

import { LocalDeviceProvisioningManager } from './localDeviceProvisioningManager'
import { LocalDeviceProvisioningStore } from './localDeviceProvisioningStore'

const temporaryDirectories: string[] = []

/** 重置所有测试端口并清理显式临时目录。 */
beforeEach(() => {
  vi.clearAllMocks()
  ports.squareEnvironments.length = 0
  ports.getDeviceDetail.mockResolvedValue(deviceDetail())
  ports.resolvePackageCandidate.mockResolvedValue(packageCandidate())
  ports.download.mockResolvedValue(downloadResult())
  ports.stage.mockResolvedValue(graphResult('graph_staged'))
  ports.remove.mockResolvedValue(graphResult('removed'))
  ports.restore.mockResolvedValue(graphResult('graph_restored'))
  ports.getOnlineDevices.mockResolvedValue([onlineDevice(false)])
})

/** 清理每个用例创建的 Main 持久化目录。 */
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true
  })))
})

/** 覆盖“添加心愿单”从下载到 Action 对账的 Main 状态机。 */
describe('LocalDeviceProvisioningManager', () => {
  /** 验证下载、配置、写图、受控重启和本地 Action 目录形成完整成功闭环。 */
  it('把云端模板推进为本地可运行设备', async () => {
    const { manager, runtime } = await createManager()

    const downloaded = await manager.start({
      cloudEnvironment: 'test',
      templateUuid
    })
    const staged = await manager.configure({
      provisioningId: downloaded.provisioningId,
      instanceId: 'local-pump-1',
      displayName: '本地泵 1',
      configuration: { endpoint: 'serial:///dev/ttyUSB0' }
    })
    const ready = await manager.activate(downloaded.provisioningId)

    expect(downloaded.status).toBe('configuration_required')
    expect(downloaded.cloudEnvironment).toBe('test')
    expect(staged.status).toBe('restart_required')
    expect(ready).toMatchObject({
      status: 'ready',
      instanceId: 'local-pump-1',
      actionCount: 1
    })
    expect(ports.stage.mock.calls[0]?.[1]).toMatchObject({
      graphPath: '/runtime/device-graph.json',
      definitionFqid: 'community.review_lab.pump',
      configuration: { endpoint: 'serial:///dev/ttyUSB0' }
    })
    expect(runtime.stopEdge).toHaveBeenCalledOnce()
    expect(runtime.startEdge).toHaveBeenCalledOnce()
    await expect(manager.list()).resolves.toEqual([
      expect.objectContaining({ status: 'ready' })
    ])
  })

  /** 验证旧包解析失败仍保留云端身份，并禁止无意义的自动重试。 */
  it('在旧设备包不兼容时保留设备详情与不可重试诊断', async () => {
    const incompatible = Object.assign(
      new Error('当前发布缺少 source_fqid，属于旧版设备包，请使用当前 CLI 重新发布'),
      { code: 'DEVICE_PACKAGE_INCOMPATIBLE', retryable: false }
    )
    ports.resolvePackageCandidate.mockRejectedValue(incompatible)
    const { manager } = await createManager()

    const failed = await manager.start({
      cloudEnvironment: 'test',
      templateUuid
    })

    expect(failed).toMatchObject({
      status: 'failed',
      cloudDeviceName: 'pump',
      cloudDisplayName: '蠕动泵',
      displayName: '蠕动泵',
      diagnostic: {
        stage: 'resolving',
        retryable: false
      }
    })
    expect(failed.diagnostic?.message).toContain('旧版设备包')
    expect(ports.download).not.toHaveBeenCalled()
    await expect(manager.retry(failed.provisioningId)).rejects.toThrow(
      '不能自动重试'
    )
  })

  /** 验证任意本地 Action 忙碌时拒绝重启且不伪造 ready。 */
  it('在运行中 Action 存在时失败关闭激活', async () => {
    ports.getOnlineDevices.mockResolvedValue([onlineDevice(true)])
    const { manager, runtime } = await createManager()
    const downloaded = await manager.start({
      cloudEnvironment: 'test',
      templateUuid
    })
    await manager.configure({
      provisioningId: downloaded.provisioningId,
      instanceId: 'local-pump-1',
      displayName: '本地泵 1',
      configuration: { endpoint: 'serial:///dev/ttyUSB0' }
    })

    const failed = await manager.activate(downloaded.provisioningId)

    expect(failed.status).toBe('failed')
    expect(failed.diagnostic?.message).toContain('正在运行，禁止重启')
    expect(runtime.stopEdge).not.toHaveBeenCalled()
    expect(runtime.startEdge).not.toHaveBeenCalled()
  })

  /** 验证移除必须确认设备目录消失，离线恢复则明确等待下一次受控启动。 */
  it('对账移除结果并把离线恢复推进到待重启', async () => {
    ports.getOnlineDevices
      .mockResolvedValueOnce([onlineDevice(false)])
      .mockResolvedValueOnce([onlineDevice(false)])
      .mockResolvedValueOnce([onlineDevice(false)])
      .mockResolvedValueOnce([])
    const { manager, runtime } = await createManager()
    const downloaded = await manager.start({
      cloudEnvironment: 'test',
      templateUuid
    })
    await manager.configure({
      provisioningId: downloaded.provisioningId,
      instanceId: 'local-pump-1',
      displayName: '本地泵 1',
      configuration: { endpoint: 'serial:///dev/ttyUSB0' }
    })
    await manager.activate(downloaded.provisioningId)

    const removed = await manager.remove(downloaded.provisioningId)
    await runtime.stopEdge()
    const restored = await manager.restore(downloaded.provisioningId)

    expect(removed.status).toBe('removed')
    expect(restored.status).toBe('restart_required')
    expect(ports.getOnlineDevices).toHaveBeenCalledTimes(4)
  })

  /** 验证失败重试使用持久记录的原环境，不跟随页面后来切换。 */
  it('把下载重试固定在原 UAT 环境', async () => {
    ports.download
      .mockRejectedValueOnce(new Error('temporary network error'))
      .mockResolvedValueOnce(downloadResult())
    const { manager } = await createManager()

    const failed = await manager.start({
      cloudEnvironment: 'uat',
      templateUuid
    })
    const recovered = await manager.retry(failed.provisioningId)

    expect(failed.status).toBe('failed')
    expect(recovered.status).toBe('configuration_required')
    expect(recovered.cloudEnvironment).toBe('uat')
    expect(ports.squareEnvironments).toEqual(['uat', 'uat'])
  })
})

/** 创建带真实原子 Store 和可观察 Runtime 的接入编排器。 */
async function createManager(): Promise<{
  manager: LocalDeviceProvisioningManager
  runtime: ReturnType<typeof fakeRuntime>
}> {
  const root = await mkdtemp(join(tmpdir(), 'unilab-provisioning-manager-'))
  temporaryDirectories.push(root)
  const runtime = fakeRuntime()
  const manager = new LocalDeviceProvisioningManager(
    new LocalDeviceProvisioningStore(join(root, 'state.json')),
    runtime as unknown as LocalRuntimeManager,
    vi.fn()
  )
  return { manager, runtime }
}

/** 生成已成功启动一次且当前 Edge 正在运行的 Runtime 权威端口。 */
function fakeRuntime() {
  let edgeRunning = true
  return {
    getDeviceProvisioningRuntime: vi.fn(() => ({
      launchConfig: { marker: 'launch-config' },
      runtime: {
        graphPath: '/runtime/device-graph.json',
        unilabExecutable: '/env/bin/unilab',
        commandWorkingDirectory: '/workspace/Uni-Lab-OS',
        managedWorkingDirectory: '/runtime',
        localConfigPath: '/runtime/local_config.py',
        localApiUrl: 'http://127.0.0.1:18003/api/v1'
      }
    })),
    getSnapshot: vi.fn(() => ({ edgeRunning })),
    stopEdge: vi.fn(async () => {
      edgeRunning = false
      return { edgeRunning }
    }),
    startEdge: vi.fn(async () => {
      edgeRunning = true
      return { edgeRunning }
    })
  }
}

/** 生成现有设备广场详情投影。 */
function deviceDetail() {
  return {
    templateUuid,
    name: 'pump',
    displayName: '蠕动泵',
    cover: '',
    icon: '',
    description: '测试泵',
    tags: ['liquid'],
    resourceType: 'device',
    createdAt: '2026-08-05T00:00:00.000Z',
    manufacturer: null,
    model: {},
    deviceParams: {},
    packageInfo: {},
    sourceRegistry: {},
    effectiveTemplate: {}
  }
}

/** 生成 Main 从详情重新解析出的可信包候选。 */
function packageCandidate() {
  return {
    templateUuid,
    definitionFqid: 'community.review_lab.pump',
    artifactDigest: digest,
    packageName: 'review-lab',
    version: '1.2.0',
    classNamespace: 'community.review_lab',
    catalogDigest
  }
}

/** 生成 OS CLI 下载并校验后的固定缓存结果。 */
function downloadResult() {
  return {
    status: 'package_cached',
    cacheKey: `community.review_lab@1.2.0#${digest}`,
    cacheHit: false,
    distribution: 'review-lab',
    version: '1.2.0',
    namespace: 'community.review_lab',
    definitionFqid: 'community.review_lab.pump',
    catalogDigest,
    configurationSchema: {
      type: 'object',
      required: ['endpoint'],
      properties: { endpoint: { type: 'string' } }
    }
  }
}

/** 生成设备图新增、移除或恢复结果。 */
function graphResult(status: 'graph_staged' | 'removed' | 'graph_restored') {
  return {
    status,
    instanceId: status === 'graph_restored' ? '' : 'local-pump-1',
    instanceUuid: status === 'graph_restored' ? '' : 'instance-uuid',
    definitionFqid: status === 'graph_restored' ? '' : 'community.review_lab.pump',
    graphFingerprint: `sha256:${'c'.repeat(64)}`,
    backupPath: '/runtime/device-graph.backup.json',
    changed: true
  }
}

/** 生成本地 authoring 诊断目录的在线设备与一个可忙碌 Action。 */
function onlineDevice(isBusy: boolean) {
  return {
    id: 'local-pump-1',
    online: true,
    actions: [{
      actionRef: 'local-pump-1::run',
      displayName: '运行',
      isBusy
    }]
  }
}
