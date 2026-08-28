import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent
} from 'electron'

import {
  UNAVAILABLE_MANAGED_RUNTIME_INSTALLATION,
  type ManagedRuntimeInstallationSnapshot
} from '../shared/managedRuntimeInstallation'
import type {
  ManagedRuntimeInstallation,
  ManagedRuntimeInspection,
  ManagedRuntimeSelection
} from './managedRuntimeInstallation'

type RuntimeEnvironmentChoice =
  ManagedRuntimeInstallationSnapshot['availableEnvironments'][number]

/** 阻止安装失败或必须升级时绕过控制面重新发现旧 Runtime。 */
export function runtimeEnvironmentFallbackAllowed(
  snapshot: ManagedRuntimeInstallationSnapshot
): boolean {
  return !(snapshot.bundled && [
    'upgrade-required',
    'installing',
    'failed'
  ].includes(snapshot.phase))
}

interface ManagedRuntimeInstallationIpcOptions {
  ipcMain: IpcMain
  installation?: ManagedRuntimeInstallation
  discoverExistingEnvironments: () => Promise<string[]>
  validateExistingEnvironment: (path: string) => Promise<string>
  chooseExistingEnvironment: () => Promise<string | null>
  readSelectedEnvironment: () => Promise<string | null>
  writeSelectedEnvironment: (path: string) => Promise<void>
  assertSender: (event: IpcMainInvokeEvent) => void
  getMainWindow: () => BrowserWindow | null
  onEnvironmentReady: (environmentPath: string) => void
  showDiagnosticLog: (path: string) => Promise<void>
  log: (message: string) => void
}

/** Electron main-process control plane for Runtime discovery and installation. */
export class ManagedRuntimeInstallationController {
  private snapshot: ManagedRuntimeInstallationSnapshot =
    UNAVAILABLE_MANAGED_RUNTIME_INSTALLATION
  private pending: Promise<ManagedRuntimeInstallationSnapshot> | null = null
  private managedEnvironment: RuntimeEnvironmentChoice | null = null
  private externalEnvironmentPaths: string[] = []

  constructor(private readonly options: ManagedRuntimeInstallationIpcOptions) {}

  async initialize(): Promise<ManagedRuntimeInstallationSnapshot> {
    const persisted = await this.options.readSelectedEnvironment().catch(error => {
      this.options.log(`读取 Runtime 环境选择失败: ${errorMessage(error)}`)
      return null
    })
    let inspection: ManagedRuntimeInspection | null = null
    let persistedSelection: ManagedRuntimeSelection | null = null
    let inspectionError: string | null = null
    if (this.options.installation) {
      try {
        inspection = await this.options.installation.inspect(persisted)
      } catch (error) {
        inspectionError = errorMessage(error)
        this.options.log(`检查内置 Runtime 失败: ${inspectionError}`)
        persistedSelection = await this.options.installation
          .classifySelection(persisted)
          .catch(classificationError => {
            this.options.log(
              `识别已选择 Runtime 归属失败: ${errorMessage(classificationError)}`
            )
            return null
          })
      }
    }

    this.managedEnvironment = inspection?.installed ? {
      kind: 'managed',
      label: `托管 Runtime ${inspection.paths.runtimeVersion}`,
      path: inspection.paths.prefix
    } : null

    const discovered = await this.options.discoverExistingEnvironments()
      .catch(error => {
        this.options.log(`发现本机 UniLab 环境失败: ${errorMessage(error)}`)
        return []
      })
    const selection = inspection?.selection ?? persistedSelection ?? (
      persisted
        ? { kind: 'external' as const, path: persisted, runtimeVersion: null }
        : { kind: 'none' as const, path: null, runtimeVersion: null }
    )
    const selectedManagedPath = selection.kind === 'current-managed'
      || selection.kind === 'outdated-managed'
      ? selection.path
      : null
    const externalDiscovered = await this.externalOnly(discovered)
    this.externalEnvironmentPaths = await this.validatedEnvironments([
      ...externalDiscovered.filter(path => path !== selectedManagedPath),
      ...(persisted
        && selection.kind !== 'current-managed'
        && selection.kind !== 'outdated-managed'
        && persisted !== this.managedEnvironment?.path
        ? [persisted]
        : [])
    ])

    if (
      this.managedEnvironment
      && (
        selection.kind === 'current-managed'
        || selection.kind === 'outdated-managed'
      )
    ) {
      let activationWarning = inspectionError
      if (persisted !== this.managedEnvironment.path) {
        try {
          await this.options.writeSelectedEnvironment(this.managedEnvironment.path)
        } catch (error) {
          activationWarning = `保存当前 Runtime 选择失败：${errorMessage(error)}`
          this.options.log(activationWarning)
        }
      }
      this.options.onEnvironmentReady(this.managedEnvironment.path)
      return this.publish(this.readySnapshot(
        this.managedEnvironment,
        inspection,
        activationWarning
      ))
    }

    if (inspection && selection.kind === 'outdated-managed') {
      const previousVersion = selection.runtimeVersion
      const currentVersion = inspection.paths.runtimeVersion
      const previousLabel = previousVersion
        ? `本地 Runtime ${previousVersion}`
        : '本地旧 Runtime'
      return this.publish({
        phase: 'upgrade-required',
        bundled: true,
        delivery: inspection.delivery,
        managed: false,
        runtimeVersion: currentVersion,
        platform: inspection.paths.platform,
        environmentPath: null,
        availableEnvironments: this.environmentChoices(),
        error: `${previousLabel} 与当前 Workbench 不兼容，需要安装 Runtime ${currentVersion}。旧环境会保留。`,
        previousRuntimeVersion: previousVersion,
        previousEnvironmentPath: selection.path,
        errorCode: 'upgrade-required',
        errorLogPath: null
      })
    }

    if (!inspection && selection.kind === 'outdated-managed') {
      return this.publish({
        phase: 'failed',
        bundled: true,
        delivery: null,
        managed: false,
        runtimeVersion: null,
        platform: null,
        environmentPath: null,
        availableEnvironments: this.environmentChoices(),
        error: inspectionError
          ?? '无法检查当前内置 Runtime，旧托管 Runtime 已停止使用。',
        previousRuntimeVersion: selection.runtimeVersion,
        previousEnvironmentPath: selection.path,
        errorCode: inspectionError
          ? classifyRuntimeError(inspectionError)
          : 'unknown',
        errorLogPath: runtimeLogPath(inspectionError)
      })
    }

    const choices = this.environmentChoices()
    const selected = choices.find(choice => choice.path === persisted)
      ?? this.managedEnvironment
      ?? choices.find(choice => choice.kind === 'external')
      ?? null
    if (selected) {
      this.options.onEnvironmentReady(selected.path)
      return this.publish(this.readySnapshot(
        selected,
        inspection,
        inspectionError
      ))
    }

    if (!this.options.installation) {
      return this.publish({
        phase: 'not-installed',
        bundled: false,
        delivery: null,
        managed: false,
        runtimeVersion: null,
        platform: null,
        environmentPath: null,
        availableEnvironments: [],
        error: null,
        previousRuntimeVersion: null,
        previousEnvironmentPath: null,
        errorCode: null,
        errorLogPath: null
      })
    }
    const initialSnapshot = this.publish({
      phase: inspectionError ? 'failed' : 'not-installed',
      bundled: true,
      delivery: inspection?.delivery ?? null,
      managed: false,
      runtimeVersion: inspection?.paths.runtimeVersion ?? null,
      platform: inspection?.paths.platform ?? null,
      environmentPath: null,
      availableEnvironments: [],
      error: inspectionError,
      previousRuntimeVersion: null,
      previousEnvironmentPath: null,
      errorCode: inspectionError ? classifyRuntimeError(inspectionError) : null,
      errorLogPath: runtimeLogPath(inspectionError)
    })
    this.installMissingOnlineRuntime(initialSnapshot)
    return initialSnapshot
  }

  getSnapshot(): ManagedRuntimeInstallationSnapshot {
    return this.snapshot
  }

  usesManagedEnvironment(): boolean {
    return this.snapshot.managed
  }

  install(): Promise<ManagedRuntimeInstallationSnapshot> {
    if (!this.options.installation) {
      return Promise.reject(new Error('当前应用没有内置 Runtime 安装载荷'))
    }
    this.pending ??= this.performInstall().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  async openDiagnosticLog(): Promise<boolean> {
    const logPath = this.snapshot.errorLogPath
    if (!logPath) return false
    await this.options.showDiagnosticLog(logPath)
    return true
  }

  async selectEnvironment(path: string): Promise<ManagedRuntimeInstallationSnapshot> {
    const selected = this.environmentChoices().find(
      environment => environment.path === path
    )
    if (!selected) {
      throw new Error('所选 UniLab 环境不可用，请刷新后重试')
    }
    const validated = selected.kind === 'external'
      ? {
          ...selected,
          path: await this.options.validateExistingEnvironment(selected.path)
        }
      : selected
    return this.activateEnvironment(validated)
  }

  async chooseEnvironment(): Promise<ManagedRuntimeInstallationSnapshot> {
    const candidate = await this.options.chooseExistingEnvironment()
    if (!candidate) return this.snapshot
    const environmentPath = await this.options.validateExistingEnvironment(candidate)
    if (!this.externalEnvironmentPaths.includes(environmentPath)) {
      this.externalEnvironmentPaths.push(environmentPath)
    }
    return this.activateEnvironment({
      kind: 'external',
      label: '手动选择的 UniLab 环境',
      path: environmentPath
    })
  }

  private async activateEnvironment(
    selected: RuntimeEnvironmentChoice
  ): Promise<ManagedRuntimeInstallationSnapshot> {
    await this.options.writeSelectedEnvironment(selected.path)
    this.options.onEnvironmentReady(selected.path)
    return this.publish(this.readySnapshot(selected, null, null))
  }

  private async performInstall(): Promise<ManagedRuntimeInstallationSnapshot> {
    const previous = this.snapshot
    this.publish({
      ...previous,
      phase: 'installing',
      bundled: true,
      managed: false,
      environmentPath: null,
      error: null,
      errorCode: null,
      errorLogPath: null
    })
    try {
      const paths = await this.options.installation!.ensureInstalled()
      this.managedEnvironment = {
        kind: 'managed',
        label: `托管 Runtime ${paths.runtimeVersion}`,
        path: paths.prefix
      }
      await this.options.writeSelectedEnvironment(paths.prefix)
      this.options.onEnvironmentReady(paths.prefix)
      return this.publish({
        phase: 'ready',
        bundled: true,
        delivery: previous.delivery ?? null,
        managed: true,
        runtimeVersion: paths.runtimeVersion,
        platform: paths.platform,
        environmentPath: paths.prefix,
        availableEnvironments: this.environmentChoices(),
        error: null,
        previousRuntimeVersion: null,
        previousEnvironmentPath: null,
        errorCode: null,
        errorLogPath: null
      })
    } catch (error) {
      const message = errorMessage(error)
      this.options.log(`安装托管 Runtime 失败: ${message}`)
      this.publish({
        ...previous,
        phase: 'failed',
        bundled: true,
        managed: false,
        environmentPath: null,
        error: message,
        errorCode: classifyRuntimeError(message),
        errorLogPath: runtimeLogPath(message)
      })
      throw error
    }
  }

  /** 在线轻量包缺少可用 Runtime 时，随 Workbench 启动一次下载；失败后保留手动重试。 */
  private installMissingOnlineRuntime(
    snapshot: ManagedRuntimeInstallationSnapshot
  ): void {
    if (
      snapshot.phase !== 'not-installed'
      || snapshot.delivery !== 'download'
    ) return

    // performInstall 已发布失败快照；这里吸收后台 Promise，避免未处理 rejection。
    void this.install().catch(() => undefined)
  }

  private async validatedEnvironments(candidates: string[]): Promise<string[]> {
    const uniqueCandidates = [...new Set(candidates.filter(Boolean))]
    const validated = await Promise.all(uniqueCandidates.map(async candidate => {
      try {
        return await this.options.validateExistingEnvironment(candidate)
      } catch (error) {
        this.options.log(
          `忽略不可用的 UniLab 环境 ${candidate}: ${errorMessage(error)}`
        )
        return null
      }
    }))
    return [...new Set(validated.filter((path): path is string => Boolean(path)))]
  }

  private async externalOnly(paths: string[]): Promise<string[]> {
    if (!this.options.installation) return paths
    const classified = await Promise.all(paths.map(async path => ({
      path,
      selection: await this.options.installation!.classifySelection(path)
        .catch(error => {
          this.options.log(`识别 Runtime 路径归属失败: ${errorMessage(error)}`)
          return null
        })
    })))
    return classified
      .filter(({ selection }) => selection?.kind === 'external')
      .map(({ path }) => path)
  }

  private environmentChoices(): RuntimeEnvironmentChoice[] {
    return [
      ...(this.managedEnvironment ? [this.managedEnvironment] : []),
      ...this.externalEnvironmentPaths
        .filter(path => path !== this.managedEnvironment?.path)
        .map((path, index) => ({
          kind: 'external' as const,
          label: this.externalEnvironmentPaths.length === 1
            ? '本机 UniLab 环境'
            : `本机 UniLab 环境 ${index + 1}`,
          path
        }))
    ]
  }

  private readySnapshot(
    selected: RuntimeEnvironmentChoice,
    inspection: ManagedRuntimeInspection | null,
    error: string | null
  ): ManagedRuntimeInstallationSnapshot {
    return {
      phase: selected.kind === 'managed' ? 'ready' : 'external',
      bundled: Boolean(this.options.installation),
      delivery: inspection?.delivery ?? this.snapshot.delivery ?? null,
      managed: selected.kind === 'managed',
      runtimeVersion: inspection?.paths.runtimeVersion
        ?? this.snapshot.runtimeVersion,
      platform: inspection?.paths.platform ?? this.snapshot.platform,
      environmentPath: selected.path,
      availableEnvironments: this.environmentChoices(),
      error,
      previousRuntimeVersion: null,
      previousEnvironmentPath: null,
      errorCode: error ? classifyRuntimeError(error) : null,
      errorLogPath: runtimeLogPath(error)
    }
  }

  private publish(
    snapshot: ManagedRuntimeInstallationSnapshot
  ): ManagedRuntimeInstallationSnapshot {
    this.snapshot = Object.freeze({
      ...snapshot,
      availableEnvironments: snapshot.availableEnvironments.map(
        environment => ({ ...environment })
      )
    })
    const window = this.options.getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('managed-runtime:snapshot', this.snapshot)
    }
    return this.snapshot
  }
}

export function registerManagedRuntimeInstallationIpc(
  options: ManagedRuntimeInstallationIpcOptions
): ManagedRuntimeInstallationController {
  const controller = new ManagedRuntimeInstallationController(options)
  options.ipcMain.handle('managed-runtime:getSnapshot', event => {
    options.assertSender(event)
    return controller.getSnapshot()
  })
  options.ipcMain.handle('managed-runtime:install', event => {
    options.assertSender(event)
    return controller.install()
  })
  options.ipcMain.handle('managed-runtime:openDiagnosticLog', event => {
    options.assertSender(event)
    return controller.openDiagnosticLog()
  })
  options.ipcMain.handle('managed-runtime:selectEnvironment', (event, path: unknown) => {
    options.assertSender(event)
    if (typeof path !== 'string') throw new Error('UniLab 环境路径无效')
    return controller.selectEnvironment(path)
  })
  options.ipcMain.handle('managed-runtime:chooseEnvironment', event => {
    options.assertSender(event)
    return controller.chooseEnvironment()
  })
  return controller
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function classifyRuntimeError(
  message: string
): NonNullable<ManagedRuntimeInstallationSnapshot['errorCode']> {
  if (/安装器执行失败/u.test(message)) return 'installation-failed'
  if (/依赖验证失败|缺少 python、unilab 或 unilab-supervisor/u.test(message)) {
    return 'health-check-failed'
  }
  if (/manifest|载荷|校验失败|平台不匹配/u.test(message)) {
    return 'payload-invalid'
  }
  return 'unknown'
}

function runtimeLogPath(message: string | null): string | null {
  if (!message) return null
  return message.match(/(?:^|；)日志：([^；\n]+)$/u)?.[1]?.trim() ?? null
}
