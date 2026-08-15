import type {
  CloudEnvironment,
  ConfigureLocalDeviceProvisioningInput,
  DevicePackageDownloadSummary,
  DevicePackageInspection,
  DevicePackageUploadRequest,
  DevicePackageUploadResult,
  LocalDeviceProvisioning,
  LocalDeviceProvisioningStatus,
  StartLocalDeviceProvisioningInput
} from '@unilab/device-provisioning'
import type {
  DeviceSquareDetail,
  DeviceSquareListQuery,
  DeviceSquarePage
} from '@unilab/services'

import { randomUUID } from 'node:crypto'

import {
  downloadDevicePackageWithCli,
  removeDeviceWithCli,
  restoreDeviceGraphWithCli,
  stageDeviceWithCli
} from './devicePackageCli'
import {
  inspectDevicePackageWorkspace,
  uploadDevicePackageWorkspace
} from './devicePackagePublishCli'
import type { LocalRuntimeManager } from './localRuntimeManager'
import {
  createCloudDeviceSquare,
  createLocalAuthoringLaboratory,
  confirmPublishedDevicePackage,
  devicePackageCliConfig,
  provisioningErrorMessage,
  provisioningErrorRetryable,
  provisioningRetryAction
} from './localDeviceProvisioningAdapters'
import { LocalDeviceProvisioningStore } from './localDeviceProvisioningStore'
import {
  resumeProvisioningDownload,
  startProvisioningDownload
} from './localDeviceProvisioningDownloads'

type ProvisioningListener = (items: LocalDeviceProvisioning[]) => void

/** Electron Main 拥有的候选本地设备接入（LocalDeviceProvisioning）深模块。 */
export class LocalDeviceProvisioningManager {
  private operation: Promise<unknown> | null = null

  /**
   * 创建应用生命周期内唯一的接入编排器。
   *
   * @param store 固定 userData 文件上的本地持久事实存储。
   * @param runtime 当前 Electron LocalRuntime 权威管理器。
   * @param onChange 每次事实提交后通知 Renderer 重新投影的回调。
   */
  constructor(
    private readonly store: LocalDeviceProvisioningStore,
    private readonly runtime: LocalRuntimeManager,
    private readonly onChange: ProvisioningListener
  ) {}

  /**
   * 读取所选环境的现有公开设备广场列表，不改变任何本地状态。
   *
   * @param environment 用户明确选择的固定云端环境。
   * @param query 现有 Backend 接受的分页和筛选字段。
   * @returns 所选环境返回的权威设备模板分页。
   */
  listCloudDevices(
    environment: CloudEnvironment,
    query: DeviceSquareListQuery = {}
  ): Promise<DeviceSquarePage> {
    return createCloudDeviceSquare(environment).listDevices(query)
  }

  /**
   * 按环境和模板 UUID 重新读取云端设备详情，不信任 Renderer 缓存。
   *
   * @param environment 用户明确选择的固定云端环境。
   * @param templateUuid 需要重新解析的云端设备模板稳定 UUID。
   * @returns 所选环境的设备模板详情。
   */
  getCloudDevice(
    environment: CloudEnvironment,
    templateUuid: string
  ): Promise<DeviceSquareDetail> {
    return createCloudDeviceSquare(environment).getDeviceDetail(templateUuid)
  }

  /** 读取全部本地设备接入持久事实。 */
  list(): Promise<LocalDeviceProvisioning[]> {
    return this.store.list()
  }

  /**
   * 下载并校验云端模板设备包，但不创建接入记录、不修改设备图。
   *
   * @param input 云端环境与设备模板稳定 UUID。
   * @returns 已进入当前 OS 受管缓存的设备包描述。
   */
  downloadOnly(
    input: StartLocalDeviceProvisioningInput
  ): Promise<DevicePackageDownloadSummary> {
    return this.exclusive(async () => {
      const active = this.runtime.getDeviceProvisioningRuntime()
      const square = createCloudDeviceSquare(input.cloudEnvironment)
      const candidate = await square.resolvePackageCandidate(input.templateUuid)
      return downloadDevicePackageWithCli(
        devicePackageCliConfig(active.runtime, input.cloudEnvironment),
        candidate
      )
    })
  }

  /**
   * 开始“添加心愿单”，下载可信设备包并停在待配置阶段。
   *
   * @param input 云端环境与设备模板稳定 UUID。
   * @returns 已持久化且带固定配置 Schema 的接入记录。
   */
  start(input: StartLocalDeviceProvisioningInput): Promise<LocalDeviceProvisioning> {
    return this.exclusive(async () => {
      const active = this.runtime.getDeviceProvisioningRuntime()
      return startProvisioningDownload(input, active, this.downloadOperations())
    })
  }

  /** 校验用户配置并通过 OS CLI 原子写入当前设备图。 */
  configure(
    input: ConfigureLocalDeviceProvisioningInput
  ): Promise<LocalDeviceProvisioning> {
    return this.exclusive(() => this.configureInternal(input))
  }

  /** 受控重启当前 Edge，并以本地设备目录和 Action 合同确认设备可运行。 */
  activate(provisioningId: string): Promise<LocalDeviceProvisioning> {
    return this.exclusive(() => this.activateInternal(provisioningId))
  }

  /**
   * 根据最后失败阶段恢复下载、写图或激活，不猜测新的配置。
   *
   * @param provisioningId 候选本地设备接入（LocalDeviceProvisioning）稳定身份。
   * @returns 原记录或按安全阶段恢复后的最新持久事实。
   * @throws 诊断不可重试或失败阶段没有安全恢复动作时抛出可行动错误。
   */
  retry(provisioningId: string): Promise<LocalDeviceProvisioning> {
    return this.exclusive(async () => {
      const record = await this.requireRecord(provisioningId)
      if (record.status !== 'failed') return record
      if (record.diagnostic?.retryable === false) {
        throw new Error(
          '该失败由旧版或不兼容发布数据造成，不能自动重试；请使用当前 CLI 重新发布设备包'
        )
      }
      const action = provisioningRetryAction(record.diagnostic?.stage)
      if (action === 'configure') return this.transition(record, 'configuration_required')
      if (action === 'activate') return this.activateInternal(provisioningId)
      if (action === 'remove') return this.removeInternal(provisioningId)
      if (action === 'restore') return this.restoreInternal(provisioningId)
      if (action === 'download') return this.resumeDownload(record)
      throw new Error('该失败阶段没有安全的自动重试动作')
    })
  }

  /** 原子移除设备实例，必要时重启并确认本地设备目录不再返回它。 */
  remove(provisioningId: string): Promise<LocalDeviceProvisioning> {
    return this.exclusive(() => this.removeInternal(provisioningId))
  }

  /** 恢复最近一次 Graph 备份，并根据恢复前状态重新对账或完成回滚。 */
  restore(provisioningId: string): Promise<LocalDeviceProvisioning> {
    return this.exclusive(() => this.restoreInternal(provisioningId))
  }

  /** 使用当前已验证 Conda CLI 只读检查用户选择的 Package Workspace。 */
  inspectWorkspace(workspacePath: string): Promise<DevicePackageInspection> {
    return this.exclusive(async () => {
      const active = this.runtime.getDeviceProvisioningRuntime()
      return inspectDevicePackageWorkspace({
        unilabExecutable: active.runtime.unilabExecutable,
        commandWorkingDirectory: active.runtime.commandWorkingDirectory
      }, workspacePath)
    })
  }

  /**
   * 复用现有上传 CLI 发布 Workspace，并用同环境广场包列表确认可见性。
   *
   * @param input 受控 Workspace、固定环境和一次性 AK/SK。
   * @returns 带发布身份、目标环境及传播可见性判断的结果。
   */
  uploadWorkspace(
    input: DevicePackageUploadRequest
  ): Promise<DevicePackageUploadResult> {
    return this.exclusive(async () => {
      const active = this.runtime.getDeviceProvisioningRuntime()
      const result = await uploadDevicePackageWorkspace({
        ...devicePackageCliConfig(active.runtime, input.cloudEnvironment)
      }, input)
      return {
        ...result,
        visibleInSquare: await confirmPublishedDevicePackage(
          result.distribution,
          input.cloudEnvironment
        )
      }
    })
  }

  /** 实现配置校验、实例去重、CLI 写图和 restart_required 状态推进。 */
  private async configureInternal(
    input: ConfigureLocalDeviceProvisioningInput
  ): Promise<LocalDeviceProvisioning> {
    let record = await this.requireRecord(input.provisioningId)
    if (
      record.status !== 'configuration_required'
      && !(
        record.status === 'failed'
        && record.diagnostic?.stage === 'configuration_required'
      )
    ) {
      throw new Error('当前接入状态不允许重新写入设备配置')
    }
    const active = this.assertRuntime(record)
    try {
      const conflict = (await this.store.list()).find((candidate) => (
        candidate.provisioningId !== record.provisioningId
        && candidate.graphPath === record.graphPath
        && candidate.instanceId === input.instanceId
        && candidate.status !== 'removed'
        && candidate.status !== 'canceled'
      ))
      if (conflict) throw new Error(`本地设备实例 ID 已由 ${conflict.cloudDisplayName} 使用`)
      const instanceUuid = record.instanceUuid || randomUUID()
      const staged = await stageDeviceWithCli(devicePackageCliConfig(
        active.runtime,
        record.cloudEnvironment
      ), {
        cacheKey: record.cacheKey,
        definitionFqid: record.definitionFqid,
        instanceId: input.instanceId,
        instanceUuid,
        graphPath: record.graphPath,
        displayName: input.displayName,
        configuration: input.configuration
      })
      record = await this.transition({
        ...record,
        configuration: structuredClone(input.configuration),
        instanceId: input.instanceId,
        instanceUuid,
        displayName: input.displayName,
        graphFingerprint: staged.graphFingerprint,
        backupPath: staged.backupPath ?? record.backupPath
      }, 'graph_staged')
      return this.transition(record, 'restart_required')
    } catch (error) {
      return this.fail(record, 'configuration_required', error)
    }
  }

  /** 实现移除的 Action 门禁、原子写图和运行时恢复，供显式操作与重试复用。 */
  private async removeInternal(
    provisioningId: string
  ): Promise<LocalDeviceProvisioning> {
    let record = await this.requireRecord(provisioningId)
    const active = this.assertRuntime(record)
    try {
      await this.assertNoBusyActions(active.runtime.localApiUrl, record.instanceId)
      record = await this.transition(record, 'removing')
      const wasRunning = this.runtime.getSnapshot().edgeRunning
      if (wasRunning) await this.runtime.stopEdge()
      const removed = await removeDeviceWithCli(devicePackageCliConfig(
        active.runtime,
        record.cloudEnvironment
      ), {
        graphPath: record.graphPath,
        instanceId: record.instanceId,
        instanceUuid: record.instanceUuid
      })
      record = await this.save({
        ...record,
        backupPath: removed.backupPath ?? record.backupPath,
        graphFingerprint: removed.graphFingerprint
      })
      if (wasRunning) {
        await this.runtime.startEdge(active.launchConfig)
        await this.reconcileRemoved(record, active.runtime.localApiUrl)
      }
      return this.transition(record, 'removed')
    } catch (error) {
      return this.fail(record, record.status, error)
    }
  }

  /** 实现设备图备份恢复，并保留原始恢复意图供失败重试使用。 */
  private async restoreInternal(
    provisioningId: string
  ): Promise<LocalDeviceProvisioning> {
    let record = await this.requireRecord(provisioningId)
    const restoringRemovedDevice = record.status === 'removed'
      || (record.status === 'failed' && record.diagnostic?.stage === 'removed')
    const previousStage = restoringRemovedDevice ? 'removed' : 'ready'
    const active = this.assertRuntime(record)
    if (!record.backupPath) throw new Error('该接入记录没有可恢复的设备图备份')
    try {
      const wasRunning = this.runtime.getSnapshot().edgeRunning
      if (wasRunning) await this.runtime.stopEdge()
      const restored = await restoreDeviceGraphWithCli(
        devicePackageCliConfig(active.runtime, record.cloudEnvironment),
        { graphPath: record.graphPath, backupPath: record.backupPath }
      )
      record = await this.save({
        ...record,
        graphFingerprint: restored.graphFingerprint,
        backupPath: restored.backupPath ?? record.backupPath
      })
      if (wasRunning) await this.runtime.startEdge(active.launchConfig)
      if (restoringRemovedDevice) {
        if (wasRunning) return this.reconcileReady(record, active.runtime.localApiUrl)
        return this.transition(record, 'restart_required')
      }
      return this.transition({ ...record, actionCount: 0 }, 'canceled')
    } catch (error) {
      return this.fail(record, previousStage, error)
    }
  }

  /** 实现运行中 Action 门禁、受控重启和权威本地设备目录对账。 */
  private async activateInternal(
    provisioningId: string
  ): Promise<LocalDeviceProvisioning> {
    let record = await this.requireRecord(provisioningId)
    if (
      record.status !== 'restart_required'
      && record.status !== 'graph_staged'
      && !(
        record.status === 'failed'
        && ['activating', 'driver_ready'].includes(record.diagnostic?.stage ?? '')
      )
    ) {
      throw new Error('当前接入状态没有待激活的设备图变更')
    }
    const active = this.assertRuntime(record)
    try {
      await this.assertNoBusyActions(active.runtime.localApiUrl)
      record = await this.transition(record, 'activating')
      if (this.runtime.getSnapshot().edgeRunning) await this.runtime.stopEdge()
      await this.runtime.startEdge(active.launchConfig)
      return this.reconcileReady(record, active.runtime.localApiUrl)
    } catch (error) {
      return this.fail(record, record.status, error)
    }
  }

  /**
   * 从持久记录重新执行安全下载，不生成第二个接入身份。
   *
   * @param record 绑定原接入身份、设备图和云端模板的持久记录。
   * @returns 下载成功后的待配置记录，或包含失败诊断的同一记录。
   */
  private async resumeDownload(
    record: LocalDeviceProvisioning
  ): Promise<LocalDeviceProvisioning> {
    const active = this.assertRuntime(record)
    return resumeProvisioningDownload(
      record,
      active,
      this.downloadOperations()
    )
  }

  /** 从本地 authoring 诊断目录确认实例在线且至少一个 Action 合同可见。 */
  private async reconcileReady(
    record: LocalDeviceProvisioning,
    apiUrl: string
  ): Promise<LocalDeviceProvisioning> {
    const devices = await createLocalAuthoringLaboratory(apiUrl).getOnlineDevices()
    const device = devices.find((candidate) => candidate.id === record.instanceId)
    if (!device?.online) throw new Error('OS 已启动，但目标设备实例未在线')
    record = await this.transition(record, 'driver_ready')
    if (!device.actions.length) throw new Error('目标设备已加载，但没有发现可运行的动作')
    return this.transition({ ...record, actionCount: device.actions.length }, 'ready')
  }

  /** 从本地 authoring 诊断目录确认已移除实例不再出现在 Driver 目录。 */
  private async reconcileRemoved(
    record: LocalDeviceProvisioning,
    apiUrl: string
  ): Promise<void> {
    const devices = await createLocalAuthoringLaboratory(apiUrl).getOnlineDevices()
    if (devices.some((candidate) => candidate.id === record.instanceId)) {
      throw new Error('OS 已重启，但已移除的设备实例仍然在线')
    }
  }

  /** 在停止/重启前拒绝任何已忙碌 Action，避免中断未知物理执行。 */
  private async assertNoBusyActions(apiUrl: string, deviceId?: string): Promise<void> {
    if (!this.runtime.getSnapshot().edgeRunning) return
    const devices = await createLocalAuthoringLaboratory(apiUrl).getOnlineDevices()
    const busy = devices.flatMap((device) => device.actions.map((action) => ({
      device,
      action
    }))).find(({ device, action }) => (
      action.isBusy && (!deviceId || device.id === deviceId)
    ))
    if (busy) throw new Error(`设备 ${busy.device.id} 的 Action ${busy.action.displayName} 正在运行，禁止重启`)
  }

  /** 验证接入记录仍绑定当前 Main 已校验的同一设备图。 */
  private assertRuntime(record: LocalDeviceProvisioning) {
    const active = this.runtime.getDeviceProvisioningRuntime()
    if (active.runtime.graphPath !== record.graphPath) {
      throw new Error('当前 LocalRuntime 设备图与接入记录不一致')
    }
    return active
  }

  /** 读取接入 UUID 对应记录，不允许 Renderer 提交完整对象覆盖持久事实。 */
  private async requireRecord(provisioningId: string): Promise<LocalDeviceProvisioning> {
    const record = await this.store.get(provisioningId)
    if (!record) throw new Error('未找到本地设备接入记录')
    return record
  }

  /** 原子保存记录并向 Renderer 发布完整只读投影。 */
  private async save(record: LocalDeviceProvisioning): Promise<LocalDeviceProvisioning> {
    const saved = await this.store.put({
      ...record,
      updatedAt: new Date().toISOString()
    })
    this.onChange(await this.store.list())
    return saved
  }

  /** 清除旧诊断并推进一个明确的接入状态。 */
  private transition(
    record: LocalDeviceProvisioning,
    status: LocalDeviceProvisioningStatus
  ): Promise<LocalDeviceProvisioning> {
    return this.save({ ...record, status, diagnostic: null })
  }

  /**
   * 把失败阶段、可行动诊断和重试语义持久化，不伪造成功状态。
   *
   * @param record 发生失败前最后一次提交的接入事实。
   * @param stage 发生错误时的接入阶段。
   * @param error 服务、CLI 或本地运行时抛出的原始异常。
   * @returns 已持久化失败阶段、正文和重试合同的同一接入记录。
   */
  private fail(
    record: LocalDeviceProvisioning,
    stage: LocalDeviceProvisioningStatus,
    error: unknown
  ): Promise<LocalDeviceProvisioning> {
    return this.save({
      ...record,
      status: 'failed',
      diagnostic: {
        stage,
        message: provisioningErrorMessage(error),
        retryable: provisioningErrorRetryable(error),
        recordedAt: new Date().toISOString()
      }
    })
  }

  /** 把持久化状态推进操作作为下载模块的最小接口。 */
  private downloadOperations() {
    return {
      save: (record: LocalDeviceProvisioning) => this.save(record),
      transition: (
        record: LocalDeviceProvisioning,
        status: LocalDeviceProvisioningStatus
      ) => this.transition(record, status),
      fail: (
        record: LocalDeviceProvisioning,
        stage: LocalDeviceProvisioningStatus,
        error: unknown
      ) => this.fail(record, stage, error)
    }
  }

  /** 串行化下载、写图、重启和上传，避免共享 Runtime 上的交叉副作用。 */
  private exclusive<Result>(operation: () => Promise<Result>): Promise<Result> {
    if (this.operation) return Promise.reject(new Error('设备包操作正在进行，请稍后再试'))
    const running = operation()
    this.operation = running
    const clear = (): void => {
      if (this.operation === running) this.operation = null
    }
    void running.then(clear, clear)
    return running
  }
}
