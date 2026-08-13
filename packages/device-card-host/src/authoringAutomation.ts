import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import {
  createDeviceCardAuthoringContext,
  createDeviceCardAuthoringKit,
  summarizeDeviceCardAuthoringTarget
} from '@unilab/device-card-authoring-kit'
import type {
  DeviceCardAuthoringProfile,
  DeviceCardAuthoringSessionStatus,
  DeviceCardAuthoringTarget,
  DeviceCardAuthoringTargetSummary,
  DeviceCardInstallApproval,
  ExportedDeviceCardKit,
  ExportedDeviceCardSource,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'
import {
  createDeviceCardWorkspace,
  type DeviceCardWorkspaceArtifact
} from './workspace'
import type { ActiveSession, DeviceCardAuthoringAutomation, DeviceCardAuthoringPrincipal, ExportDeviceCardKitInput, GetDeviceCardAuthoringStatusInput, LocalDeviceCardAuthoringAutomationOptions, PrepareDeviceCardAuthoringInput } from './authoringAutomationTypes'
import {
  authoringError,
  DeviceCardAuthoringError
} from './authoringAutomationError'
import {
  DEVICE_CARD_AUTHORING_PROFILES,
  assertCreatableTarget,
  assertExistingProject,
  assertNonSymlinkDestination,
  authoringVersions,
  materializeProject,
  normalizeTimeout,
  publicInstalledRecord,
  requireReadyArtifact,
  requiredString,
  samePath,
  writeCurrentContext
} from './authoringAutomationSupport'

export type { DeviceCardAuthoringPrincipal, DeviceCardAuthoringTargetPort, DeviceCardAuthoringApprovalPort, PrepareDeviceCardAuthoringInput, GetDeviceCardAuthoringStatusInput, ExportDeviceCardKitInput, DeviceCardAuthoringAutomation, LocalDeviceCardAuthoringAutomationOptions } from './authoringAutomationTypes'
export { DeviceCardAuthoringError, toDeviceCardAgentError } from './authoringAutomationError'

export class LocalDeviceCardAuthoringAutomation
implements DeviceCardAuthoringAutomation {
  private active: ActiveSession | null = null
  private readonly listeners = new Set<() => void>()
  private mutationTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly options: LocalDeviceCardAuthoringAutomationOptions
  ) {}

  async listTargets(): Promise<DeviceCardAuthoringTargetSummary[]> {
    return (await this.readTargets())
      .map(summarizeDeviceCardAuthoringTarget)
      .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
  }

  async prepare(
    input: PrepareDeviceCardAuthoringInput
  ): Promise<DeviceCardAuthoringSessionStatus> {
    return this.runExclusive(() => this.prepareExclusive(input))
  }

  private async prepareExclusive(
    input: PrepareDeviceCardAuthoringInput
  ): Promise<DeviceCardAuthoringSessionStatus> {
    const deviceId = requiredString(input.deviceId, 'deviceId')
    const projectDir = resolve(requiredString(input.projectDir, 'projectDir'))
    const profile = input.profile ?? 'vue-web-component-v1'
    if (!DEVICE_CARD_AUTHORING_PROFILES.includes(profile)) {
      throw authoringError('INVALID_ARGUMENT', '不支持的卡片开发 Profile。', {
        profile
      })
    }
    const target = await this.requireTarget(deviceId)
    assertCreatableTarget(target)

    let activeToReplace: ActiveSession | null = null
    if (this.active) {
      if (samePath(this.active.session.projectDir, projectDir)) {
        return this.snapshot(this.active)
      }
      if (!input.replace) {
        throw authoringError(
          'WORKSPACE_ACTIVE',
          `已有活动工作区：${this.active.session.projectDir}`,
          { projectDir: this.active.session.projectDir }
        )
      }
      activeToReplace = this.active
    }

    const approved = await this.options.approvals.authorizeDirectory({
      operation: input.mode,
      path: projectDir,
      principal: input.principal,
      target,
      ...(activeToReplace
        ? { replacesProjectDir: activeToReplace.session.projectDir }
        : {})
    })
    if (!approved) {
      throw authoringError('AUTHORIZATION_DENIED', '用户拒绝了源码目录授权。')
    }
    if (activeToReplace) {
      await this.closeExclusive(activeToReplace.session.sessionId)
    }

    const context = createDeviceCardAuthoringContext(target)
    if (input.mode === 'bootstrap') {
      await materializeProject(projectDir, context, profile)
    } else {
      await assertExistingProject(projectDir)
      await writeCurrentContext(projectDir, context)
    }

    let record: ActiveSession | null = null
    const workspace = await createDeviceCardWorkspace({
      projectDir,
      workRoot: this.options.workRoot,
      authoringContext: context,
      contextAuthority: 'host',
      onStatus: () => {
        if (!record || this.active !== record) return
        this.syncSession(record)
        this.publish(record)
      }
    })
    const workspaceStatus = workspace.getStatus()
    record = {
      session: {
        schemaVersion: 'device-card-authoring-session/v1',
        sessionId: `card-session-${randomUUID()}`,
        deviceId: target.deviceId,
        definitionFqid: target.definition.fqid,
        deviceTypeId: target.definition.fqid,
        profile: workspaceStatus.card?.authoringProfile ?? profile,
        projectDir: workspaceStatus.projectDir,
        contextPath: resolve(workspaceStatus.projectDir, 'authoring-context.json'),
        manifestPath: resolve(workspaceStatus.projectDir, 'card.manifest.json'),
        diagnosticsPath: workspaceStatus.diagnosticsPath,
        state: workspaceStatus.state,
        revision: workspaceStatus.revision,
        previewMode: 'mock',
        createdAt: new Date().toISOString(),
        versions: authoringVersions()
      },
      workspace,
      target,
      context
    }
    this.active = record
    this.publish(record)
    return this.snapshot(record)
  }

  async getStatus(
    input: GetDeviceCardAuthoringStatusInput
  ): Promise<DeviceCardAuthoringSessionStatus> {
    const record = this.requireSession(input.locator)
    const afterRevision = input.afterRevision
    if (
      afterRevision !== undefined &&
      record.workspace.getStatus().revision <= afterRevision
    ) {
      await this.waitForRevision(
        record,
        afterRevision,
        normalizeTimeout(input.timeoutMs)
      )
    }
    this.syncSession(record)
    return this.snapshot(record)
  }

  async recheck(locator: string): Promise<DeviceCardAuthoringSessionStatus> {
    return this.runExclusive(async () => {
      const record = this.requireSession(locator)
      await record.workspace.rebuild()
      this.syncSession(record)
      this.publish(record)
      return this.snapshot(record)
    })
  }

  async exportKit(
    input: ExportDeviceCardKitInput
  ): Promise<ExportedDeviceCardKit> {
    if (!DEVICE_CARD_AUTHORING_PROFILES.includes(input.profile)) {
      throw authoringError('INVALID_ARGUMENT', '不支持的卡片开发 Profile。')
    }
    const target = await this.requireTarget(requiredString(input.deviceId, 'deviceId'))
    assertCreatableTarget(target)
    const destination = resolve(requiredString(input.destination, 'destination'))
    await assertNonSymlinkDestination(destination)
    const approved = await this.options.approvals.authorizeDirectory({
      operation: 'export-kit',
      path: destination,
      principal: input.principal,
      target
    })
    if (!approved) {
      throw authoringError('AUTHORIZATION_DENIED', '用户拒绝了开发包导出授权。')
    }
    const kit = await createDeviceCardAuthoringKit({
      context: createDeviceCardAuthoringContext(target),
      profile: input.profile
    })
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, kit.archive)
    return {
      path: destination,
      fileName: basename(destination),
      authoringContextDigest: kit.metadata.authoringContextDigest,
      bytes: kit.archive.byteLength,
      versions: authoringVersions()
    }
  }

  async exportSource(
    locator: string,
    destinationValue: string,
    principal: DeviceCardAuthoringPrincipal
  ): Promise<ExportedDeviceCardSource> {
    return this.runExclusive(() => this.exportSourceExclusive(
      locator,
      destinationValue,
      principal
    ))
  }

  private async exportSourceExclusive(
    locator: string,
    destinationValue: string,
    principal: DeviceCardAuthoringPrincipal
  ): Promise<ExportedDeviceCardSource> {
    const record = this.requireSession(locator)
    requireReadyArtifact(record)
    const destination = resolve(requiredString(destinationValue, 'destination'))
    await assertNonSymlinkDestination(destination)
    const approved = await this.options.approvals.authorizeDirectory({
      operation: 'export-source',
      path: destination,
      principal,
      target: record.target
    })
    if (!approved) {
      throw authoringError('AUTHORIZATION_DENIED', '用户拒绝了源码包导出授权。')
    }
    const artifact = await record.workspace.exportSourceArchive(destination)
    return {
      path: destination,
      bytes: (await stat(destination)).size,
      sourceHash: artifact.metadata.sourceHash
    }
  }

  async requestInstall(
    locator: string,
    principal: DeviceCardAuthoringPrincipal
  ): Promise<DeviceCardInstallApproval> {
    return this.runExclusive(() => this.requestInstallExclusive(
      locator,
      principal
    ))
  }

  private async requestInstallExclusive(
    locator: string,
    principal: DeviceCardAuthoringPrincipal
  ): Promise<DeviceCardInstallApproval> {
    const record = this.requireSession(locator)
    const artifact = requireReadyArtifact(record)
    const approvalId = `card-approval-${randomUUID()}`
    const manifest = artifact.metadata.manifest
    const approved = await this.options.approvals.approveInstall({
      approvalId,
      principal,
      session: structuredClone(record.session),
      sourceHash: artifact.metadata.sourceHash,
      cardId: manifest.id,
      cardVersion: manifest.version,
      permissions: structuredClone(manifest.permissions)
    })
    if (!approved) return { approvalId, status: 'denied' }
    const approvedArtifact = requireReadyArtifact(record)
    if (approvedArtifact.metadata.sourceHash !== artifact.metadata.sourceHash) {
      throw authoringError(
        'CURRENT_SOURCE_NOT_READY',
        '确认期间源码已变化，请重新检查并再次确认安装。',
        {
          approvedSourceHash: artifact.metadata.sourceHash,
          currentSourceHash: approvedArtifact.metadata.sourceHash
        },
        undefined,
        true
      )
    }
    let installed: InstalledDeviceCard
    try {
      installed = await this.options.installArchive({
        archivePath: approvedArtifact.sourceArchivePath,
        storeRoot: this.options.storeRoot,
        authoringContext: record.context,
        contextAuthority: 'host'
      })
    } catch (error) {
      throw authoringError(
        'BUILD_FAILED',
        error instanceof Error ? error.message : '生产构建失败。',
        {},
        error
      )
    }
    return {
      approvalId,
      status: 'approved',
      installed: publicInstalledRecord(installed)
    }
  }

  async close(locator: string): Promise<void> {
    await this.runExclusive(() => this.closeExclusive(locator))
  }

  private async closeExclusive(locator: string): Promise<void> {
    const record = this.requireSession(locator)
    this.active = null
    this.notifyWaiters()
    await record.workspace.close()
    this.options.onStatus?.(null)
  }

  getPreviewArtifact(locator?: string): DeviceCardWorkspaceArtifact {
    const record = this.requireSession(locator ?? this.active?.session.sessionId ?? '')
    return record.workspace.getPreviewArtifact()
  }

  getActiveStatus(): DeviceCardAuthoringSessionStatus | null {
    if (!this.active) return null
    this.syncSession(this.active)
    return this.snapshot(this.active)
  }

  async destroy(): Promise<void> {
    if (!this.active) return
    await this.close(this.active.session.sessionId)
  }

  private async readTargets(): Promise<DeviceCardAuthoringTarget[]> {
    try {
      const targets = await this.options.targets.listTargets()
      if (!Array.isArray(targets)) throw new Error('设备目录返回值不是数组。')
      return targets.map((target) => structuredClone(target))
    } catch (error) {
      if (error instanceof DeviceCardAuthoringError) throw error
      throw authoringError(
        'OS_UNAVAILABLE',
        error instanceof Error ? error.message : '无法读取 OS 设备目录。',
        {},
        error,
        true
      )
    }
  }

  private async requireTarget(deviceId: string): Promise<DeviceCardAuthoringTarget> {
    const target = (await this.readTargets()).find(
      (candidate) => candidate.deviceId === deviceId
    )
    if (!target) {
      throw authoringError('DEVICE_NOT_FOUND', `未找到设备：${deviceId}`, {
        deviceId
      }, undefined, true)
    }
    return target
  }

  private requireSession(locator: string): ActiveSession {
    const value = requiredString(locator, 'session/project')
    const record = this.active
    if (
      !record ||
      (record.session.sessionId !== value &&
        !samePath(record.session.projectDir, value))
    ) {
      throw authoringError('WORKSPACE_NOT_FOUND', '未找到活动卡片工作区。', {
        locator: value
      }, undefined, true)
    }
    return record
  }

  private syncSession(record: ActiveSession): void {
    const status = record.workspace.getStatus()
    record.session = {
      ...record.session,
      projectDir: status.projectDir,
      diagnosticsPath: status.diagnosticsPath,
      state: status.state,
      revision: status.revision,
      profile: status.card?.authoringProfile ?? record.session.profile
    }
  }

  private snapshot(record: ActiveSession): DeviceCardAuthoringSessionStatus {
    return {
      session: structuredClone(record.session),
      workspace: record.workspace.getStatus()
    }
  }

  private publish(record: ActiveSession): void {
    this.options.onStatus?.(this.snapshot(record))
    this.notifyWaiters()
  }

  private notifyWaiters(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private waitForRevision(
    record: ActiveSession,
    afterRevision: number,
    timeoutMs: number
  ): Promise<void> {
    return new Promise<void>((resolveWait, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const finish = (): void => {
        clearTimeout(timer)
        this.listeners.delete(check)
      }
      const check = (): void => {
        if (this.active !== record) {
          finish()
          reject(authoringError(
            'WORKSPACE_NOT_FOUND',
            '等待期间工作区已关闭。',
            {},
            undefined,
            true
          ))
          return
        }
        if (record.workspace.getStatus().revision > afterRevision) {
          finish()
          resolveWait()
        }
      }
      timer = setTimeout(() => {
        this.listeners.delete(check)
        reject(authoringError(
          'APPROVAL_TIMEOUT',
          `等待工作区更新超时（${timeoutMs}ms）。`,
          { afterRevision, timeoutMs },
          undefined,
          true
        ))
      }, timeoutMs)
      this.listeners.add(check)
      check()
    })
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release = (): void => {}
    this.mutationTail = new Promise<void>((resolveRelease) => {
      release = resolveRelease
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
