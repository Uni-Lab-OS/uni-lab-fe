import { randomUUID } from 'node:crypto'
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'

import {
  DEVICE_CARD_SDK_VERSION,
  DEVICE_CARD_TOOLING_VERSION,
  DEVICE_CARD_UI_CATALOG_VERSION,
  createDeviceCardAuthoringContext,
  createDeviceCardAuthoringKit,
  createDeviceCardProjectFiles,
  summarizeDeviceCardAuthoringTarget
} from '@unilab/device-card-authoring-kit'
import type {
  DeviceCardAgentErrorCode,
  DeviceCardAgentErrorPayload,
  DeviceCardAuthoringProfile,
  DeviceCardAuthoringSession,
  DeviceCardAuthoringSessionStatus,
  DeviceCardAuthoringTarget,
  DeviceCardAuthoringTargetSummary,
  DeviceCardAuthoringVersions,
  DeviceCardInstallApproval,
  ExportedDeviceCardKit,
  ExportedDeviceCardSource,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'
import { DEVICE_CARD_BUILDER_VERSION } from '@unilab/device-card-builder'

import {
  createDeviceCardWorkspace,
  type DeviceCardWorkspace,
  type DeviceCardWorkspaceArtifact
} from './workspace'

const PROFILES: readonly DeviceCardAuthoringProfile[] = [
  'vue-web-component-v1',
  'react-web-component-v1',
  'web-component-lite-v1'
]

export type DeviceCardAuthoringPrincipal = 'renderer' | 'agent'

export interface DeviceCardAuthoringTargetPort {
  listTargets(): Promise<DeviceCardAuthoringTarget[]>
}

export interface DeviceCardAuthoringApprovalPort {
  authorizeDirectory(input: {
    operation: 'bootstrap' | 'attach' | 'export-kit' | 'export-source'
    path: string
    principal: DeviceCardAuthoringPrincipal
    target: DeviceCardAuthoringTarget
    replacesProjectDir?: string
  }): Promise<boolean>
  approveInstall(input: {
    approvalId: string
    principal: DeviceCardAuthoringPrincipal
    session: DeviceCardAuthoringSession
    sourceHash: string
    cardId: string
    cardVersion: string
    permissions: {
      state: string[]
      actions: string[]
      media: string[]
    }
  }): Promise<boolean>
}

export interface PrepareDeviceCardAuthoringInput {
  mode: 'bootstrap' | 'attach'
  deviceId: string
  profile?: DeviceCardAuthoringProfile
  projectDir: string
  principal: DeviceCardAuthoringPrincipal
  replace?: boolean
}

export interface GetDeviceCardAuthoringStatusInput {
  locator: string
  afterRevision?: number
  timeoutMs?: number
}

export interface ExportDeviceCardKitInput {
  deviceId: string
  profile: DeviceCardAuthoringProfile
  destination: string
  principal: DeviceCardAuthoringPrincipal
}

export interface DeviceCardAuthoringAutomation {
  listTargets(): Promise<DeviceCardAuthoringTargetSummary[]>
  prepare(
    input: PrepareDeviceCardAuthoringInput
  ): Promise<DeviceCardAuthoringSessionStatus>
  getStatus(
    input: GetDeviceCardAuthoringStatusInput
  ): Promise<DeviceCardAuthoringSessionStatus>
  recheck(locator: string): Promise<DeviceCardAuthoringSessionStatus>
  exportKit(input: ExportDeviceCardKitInput): Promise<ExportedDeviceCardKit>
  exportSource(
    locator: string,
    destination: string,
    principal: DeviceCardAuthoringPrincipal
  ): Promise<ExportedDeviceCardSource>
  requestInstall(
    locator: string,
    principal: DeviceCardAuthoringPrincipal
  ): Promise<DeviceCardInstallApproval>
  close(locator: string): Promise<void>
}

interface ActiveSession {
  session: DeviceCardAuthoringSession
  workspace: DeviceCardWorkspace
  target: DeviceCardAuthoringTarget
  context: ReturnType<typeof createDeviceCardAuthoringContext>
}

export interface LocalDeviceCardAuthoringAutomationOptions {
  targets: DeviceCardAuthoringTargetPort
  approvals: DeviceCardAuthoringApprovalPort
  workRoot: string
  storeRoot: string
  installArchive(input: {
    archivePath: string
    storeRoot: string
    authoringContext: ReturnType<typeof createDeviceCardAuthoringContext>
    contextAuthority: 'host'
  }): Promise<InstalledDeviceCard>
  onStatus?: (status: DeviceCardAuthoringSessionStatus | null) => void
}

export class DeviceCardAuthoringError extends Error {
  readonly code: DeviceCardAgentErrorCode
  readonly retryable: boolean
  readonly details: Record<string, unknown>

  constructor(
    code: DeviceCardAgentErrorCode,
    message: string,
    options: {
      retryable?: boolean
      details?: Record<string, unknown>
      cause?: unknown
    } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = 'DeviceCardAuthoringError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.details = options.details ?? {}
  }
}

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
    if (!PROFILES.includes(profile)) {
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
        deviceTypeId: target.deviceTypeId,
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
    if (!PROFILES.includes(input.profile)) {
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

export function toDeviceCardAgentError(error: unknown): DeviceCardAgentErrorPayload {
  if (error instanceof DeviceCardAuthoringError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: structuredClone(error.details)
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    details: {}
  }
}

function assertCreatableTarget(target: DeviceCardAuthoringTarget): void {
  if (!target.deviceId.trim()) {
    throw authoringError('DEVICE_ID_MISSING', '目标设备缺少稳定 Device ID。')
  }
  if (!target.deviceTypeId.trim()) {
    throw authoringError(
      'DEVICE_TYPE_UNRESOLVED',
      '目标设备缺少稳定 Device Type。'
    )
  }
}

async function materializeProject(
  projectDir: string,
  context: ReturnType<typeof createDeviceCardAuthoringContext>,
  profile: DeviceCardAuthoringProfile
): Promise<void> {
  let createdDirectory = false
  if (await exists(projectDir)) {
    const info = await lstat(projectDir)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw authoringError('INVALID_ARGUMENT', '项目目标必须是普通目录。')
    }
    if ((await readdir(projectDir)).length > 0) {
      throw authoringError('DIRECTORY_NOT_EMPTY', 'bootstrap 目标目录不是空目录。', {
        projectDir
      })
    }
  } else {
    await mkdir(projectDir, { recursive: true })
    createdDirectory = true
  }

  const files = createDeviceCardProjectFiles(context, profile)
  const written: string[] = []
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const destination = resolve(projectDir, relativePath)
      if (!isInside(projectDir, destination)) {
        throw authoringError('DIRECTORY_OUTSIDE_GRANT', '模板路径越过授权目录。')
      }
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, content, { encoding: 'utf8', flag: 'wx' })
      written.push(destination)
    }
  } catch (error) {
    await Promise.all(written.reverse().map((path) => rm(path, { force: true })))
    if (createdDirectory) await rm(projectDir, { recursive: true, force: true })
    if (error instanceof DeviceCardAuthoringError) throw error
    throw authoringError(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : '项目生成失败。',
      {},
      error
    )
  }
}

async function assertExistingProject(projectDir: string): Promise<void> {
  let info
  try {
    info = await lstat(projectDir)
  } catch (error) {
    throw authoringError('INVALID_ARGUMENT', '接入的项目目录不存在。', {
      projectDir
    }, error)
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw authoringError('INVALID_ARGUMENT', '接入目标必须是普通目录。')
  }
  try {
    await access(resolve(projectDir, 'card.manifest.json'))
  } catch (error) {
    throw authoringError('INVALID_ARGUMENT', '项目缺少 card.manifest.json。', {}, error)
  }
}

async function writeCurrentContext(
  projectDir: string,
  context: ReturnType<typeof createDeviceCardAuthoringContext>
): Promise<void> {
  const path = resolve(projectDir, 'authoring-context.json')
  if (!isInside(projectDir, path)) {
    throw authoringError('DIRECTORY_OUTSIDE_GRANT', 'Context 路径越过授权目录。')
  }
  if (await exists(path) && (await lstat(path)).isSymbolicLink()) {
    throw authoringError(
      'DIRECTORY_OUTSIDE_GRANT',
      'authoring-context.json 不能是符号链接。'
    )
  }
  await writeFile(path, `${JSON.stringify(context, null, 2)}\n`, 'utf8')
}

function requireReadyArtifact(record: ActiveSession): DeviceCardWorkspaceArtifact {
  try {
    return record.workspace.getReadyArtifact()
  } catch (error) {
    throw authoringError(
      'CURRENT_SOURCE_NOT_READY',
      error instanceof Error ? error.message : '当前源码尚未检查通过。',
      { state: record.workspace.getStatus().state },
      error,
      true
    )
  }
}

function publicInstalledRecord(record: InstalledDeviceCard): InstalledDeviceCard {
  return {
    key: record.key,
    id: record.id,
    version: record.version,
    title: record.title,
    deviceTypes: [...record.deviceTypes],
    authoringProfile: record.authoringProfile,
    installedAt: record.installedAt
  }
}

function authoringVersions(): DeviceCardAuthoringVersions {
  return {
    protocolVersion: 1,
    kitVersion: 1,
    sdkVersion: DEVICE_CARD_SDK_VERSION,
    toolingVersion: DEVICE_CARD_TOOLING_VERSION,
    hostProtocolVersion: 1,
    uiCatalogVersion: DEVICE_CARD_UI_CATALOG_VERSION,
    builderVersion: DEVICE_CARD_BUILDER_VERSION
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return 120_000
  if (!Number.isFinite(value) || value < 1 || value > 10 * 60_000) {
    throw authoringError('INVALID_ARGUMENT', 'timeout 必须在 1ms 到 10 分钟之间。')
  }
  return Math.floor(value)
}

function requiredString(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw authoringError('INVALID_ARGUMENT', `${name} 不能为空。`)
  }
  return value.trim()
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right)
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return pathFromRoot === '' || (
    !pathFromRoot.startsWith('..') &&
    !pathFromRoot.startsWith('/') &&
    !pathFromRoot.startsWith('\\')
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function assertNonSymlinkDestination(path: string): Promise<void> {
  if (await exists(path) && (await lstat(path)).isSymbolicLink()) {
    throw authoringError(
      'DIRECTORY_OUTSIDE_GRANT',
      '导出目标不能是符号链接。',
      { path }
    )
  }
}

function authoringError(
  code: DeviceCardAgentErrorCode,
  message: string,
  details: Record<string, unknown> = {},
  cause?: unknown,
  retryable = false
): DeviceCardAuthoringError {
  return new DeviceCardAuthoringError(code, message, {
    retryable,
    details,
    cause
  })
}
