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
  ManagedRuntimeInspection
} from './managedRuntimeInstallation'

type RuntimeEnvironmentChoice =
  ManagedRuntimeInstallationSnapshot['availableEnvironments'][number]

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
    let inspection: ManagedRuntimeInspection | null = null
    let inspectionError: string | null = null
    if (this.options.installation) {
      try {
        inspection = await this.options.installation.inspect()
      } catch (error) {
        inspectionError = errorMessage(error)
        this.options.log(`检查内置 Runtime 失败: ${inspectionError}`)
      }
    }

    this.managedEnvironment = inspection?.installed ? {
      kind: 'managed',
      label: `内置 Runtime ${inspection.paths.runtimeVersion}`,
      path: inspection.paths.prefix
    } : null

    const persisted = await this.options.readSelectedEnvironment().catch(error => {
      this.options.log(`读取 Runtime 环境选择失败: ${errorMessage(error)}`)
      return null
    })
    const discovered = await this.options.discoverExistingEnvironments()
      .catch(error => {
        this.options.log(`发现本机 UniLab 环境失败: ${errorMessage(error)}`)
        return []
      })
    this.externalEnvironmentPaths = await this.validatedEnvironments([
      ...discovered,
      ...(persisted && persisted !== this.managedEnvironment?.path
        ? [persisted]
        : [])
    ])

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
        managed: false,
        runtimeVersion: null,
        platform: null,
        environmentPath: null,
        availableEnvironments: [],
        error: null
      })
    }
    return this.publish({
      phase: inspectionError ? 'failed' : 'not-installed',
      bundled: true,
      managed: false,
      runtimeVersion: inspection?.paths.runtimeVersion ?? null,
      platform: inspection?.paths.platform ?? null,
      environmentPath: null,
      availableEnvironments: [],
      error: inspectionError
    })
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
      error: null
    })
    try {
      const paths = await this.options.installation!.ensureInstalled()
      this.managedEnvironment = {
        kind: 'managed',
        label: `内置 Runtime ${paths.runtimeVersion}`,
        path: paths.prefix
      }
      await this.options.writeSelectedEnvironment(paths.prefix)
      this.options.onEnvironmentReady(paths.prefix)
      return this.publish({
        phase: 'ready',
        bundled: true,
        managed: true,
        runtimeVersion: paths.runtimeVersion,
        platform: paths.platform,
        environmentPath: paths.prefix,
        availableEnvironments: this.environmentChoices(),
        error: null
      })
    } catch (error) {
      const message = errorMessage(error)
      this.options.log(`安装内置 Runtime 失败: ${message}`)
      this.publish({
        ...previous,
        phase: 'failed',
        bundled: true,
        managed: false,
        environmentPath: null,
        error: message
      })
      throw error
    }
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
      managed: selected.kind === 'managed',
      runtimeVersion: inspection?.paths.runtimeVersion
        ?? this.snapshot.runtimeVersion,
      platform: inspection?.paths.platform ?? this.snapshot.platform,
      environmentPath: selected.path,
      availableEnvironments: this.environmentChoices(),
      error
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
