import { createHash } from 'node:crypto'
import { execFile, type ExecFileException } from 'node:child_process'
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream
} from 'node:fs'
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32
} from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import type { Net } from 'electron'

import type { LocalRuntimeModeInfo } from '../shared/localRuntime'
import type {
  ManagedRuntimeInstallationProgress
} from '../shared/managedRuntimeInstallation'

const INSTALL_LOCK_TIMEOUT_MS = 10 * 60 * 1_000
const INSTALL_LOCK_STALE_MS = 2 * 60 * 60 * 1_000
const INSTALL_LOCK_POLL_MS = 50
const RUNTIME_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024
const RUNTIME_DOWNLOAD_SOCKET_TIMEOUT_MS = 30_000
const RUNTIME_DOWNLOAD_UNKNOWN_SIZE_REPORT_BYTES = 4 * 1024 * 1024

export interface ManagedRuntimeManifest {
  schemaVersion: 1 | 2
  delivery: 'bundled' | 'download'
  runtimeVersion: string
  platform: 'linux-64' | 'osx-64' | 'osx-arm64' | 'win-64'
  installerFile: string
  sha256: string
  downloadUrl?: string
}

export interface ManagedRuntimePaths {
  prefix: string
  runtimeVersion: string
  platform: ManagedRuntimeManifest['platform']
  pythonExecutable: string
  unilabExecutable: string
  supervisorExecutable: string
  manifestSha256: string
}

export interface ManagedRuntimeInspection {
  installed: boolean
  delivery?: ManagedRuntimeManifest['delivery']
  paths: ManagedRuntimePaths
  selection: ManagedRuntimeSelection
}

export type ManagedRuntimeSelection =
  | { kind: 'none'; path: null; runtimeVersion: null }
  | { kind: 'current-managed'; path: string; runtimeVersion: string }
  | { kind: 'outdated-managed'; path: string; runtimeVersion: string | null }
  | { kind: 'external'; path: string; runtimeVersion: null }

/** 执行 Constructor 载荷，把 Runtime 安装到 prefix，并把诊断信息写入 logPath。 */
export type RuntimeInstallerRunner = (
  installerPath: string,
  prefix: string,
  logPath: string
) => Promise<void>

export type RuntimeInstallationVerifier = (
  paths: ManagedRuntimePaths
) => Promise<void>

export type RuntimeInstallationProgressReporter = (
  progress: ManagedRuntimeInstallationProgress
) => void

/** 把固定 URL 的 Runtime 安装器写入目标临时文件。 */
export type RuntimeInstallerDownloader = (
  url: string,
  destination: string,
  reportProgress: RuntimeInstallationProgressReporter
) => Promise<void>

type ElectronRuntimeNet = Pick<Net, 'fetch'>
type ElectronRuntimeResponse = Awaited<ReturnType<Net['fetch']>>

interface ManagedRuntimeInstallationOptions {
  resourcesDirectory: string
  dataDirectory: string
  platform?: NodeJS.Platform
  architecture?: string
  runInstaller?: RuntimeInstallerRunner
  downloadInstaller?: RuntimeInstallerDownloader
  verifyInstallation?: RuntimeInstallationVerifier
}

/**
 * Constructor rejects several characters that may legally occur in Electron's
 * userData path. In particular, the scoped package name makes the Workbench
 * path contain `@unilab` on Windows. Keep the managed Runtime in the existing
 * per-user UniLab state directory on every platform instead of coupling its
 * prefix to Electron's application name.
 */
export function resolveManagedRuntimeDataDirectory(options: {
  platform: NodeJS.Platform
  homeDirectory: string
  userDataDirectory: string
}): string {
  const platformPath = options.platform === 'win32' ? win32 : posix
  return platformPath.join(options.homeDirectory, '.unilabos', 'workbench')
}

/**
 * 校验随桌面端分发的 Constructor 载荷，并把私有 Runtime 原子安装到用户目录。
 * 调用方只需要 `ensureInstalled`；平台参数、校验和修复细节全部留在模块内。
 */
export class ManagedRuntimeInstallation {
  private readonly resourcesDirectory: string
  private readonly dataDirectory: string
  private readonly platform: NodeJS.Platform
  private readonly architecture: string
  private readonly runInstaller: RuntimeInstallerRunner
  private readonly downloadInstaller: RuntimeInstallerDownloader
  private readonly verifyInstallation: RuntimeInstallationVerifier
  private pending: Promise<ManagedRuntimePaths> | null = null

  constructor(options: ManagedRuntimeInstallationOptions) {
    this.resourcesDirectory = resolve(options.resourcesDirectory)
    this.dataDirectory = resolve(options.dataDirectory)
    this.platform = options.platform ?? process.platform
    this.architecture = options.architecture ?? process.arch
    this.runInstaller = options.runInstaller ?? runConstructorInstaller(
      this.platform
    )
    this.downloadInstaller = options.downloadInstaller
      ?? unavailableRuntimeInstallerDownloader
    this.verifyInstallation = options.verifyInstallation
      ?? verifyRuntimeInstallation
  }

  /** 检查载荷、固定版本前缀及已选择环境，不执行安装或修复。 */
  async inspect(
    selectedEnvironmentPath: string | null = null
  ): Promise<ManagedRuntimeInspection> {
    const manifest = await this.readManifest()
    if (basename(manifest.installerFile) !== manifest.installerFile) {
      throw new Error('Runtime installerFile 必须是文件名，不能包含路径')
    }
    const paths = this.pathsFor(manifest)
    return {
      installed: await this.isValidInstallation(paths),
      delivery: manifest.delivery,
      paths,
      selection: await this.classifySelectionAgainstCurrent(
        selectedEnvironmentPath,
        paths
      )
    }
  }

  ensureInstalled(
    reportProgress: RuntimeInstallationProgressReporter = () => undefined
  ): Promise<ManagedRuntimePaths> {
    this.pending ??= this.install(reportProgress)
    return this.pending.catch((error: unknown) => {
      this.pending = null
      throw error
    })
  }

  async getModeInfo(): Promise<LocalRuntimeModeInfo> {
    const manifest = await this.readManifest()
    const workspacePath = join(this.resourcesDirectory, 'default-workspace')
    const graphPath = join(
      workspacePath,
      'deployment',
      'graphs',
      'device.json'
    )
    await Promise.all([
      access(join(workspacePath, 'package.yaml'), fsConstants.R_OK),
      access(
        join(workspacePath, 'deployment', 'local_config.py'),
        fsConstants.R_OK
      ),
      access(graphPath, fsConstants.R_OK)
    ])
    return {
      mode: 'managed',
      label: '内置 Runtime',
      runtimeVersion: manifest.runtimeVersion,
      defaultLaunchConfig: {
        graphPath,
        osProjectPath: '',
        szlabProjectPath: workspacePath,
        environmentPath: '',
        simulatorProjectPath: '',
        edgeCommandMode: 'generated',
        customEdgeCommand: {
          executable: '',
          workingDirectory: '{{workspace}}',
          args: [],
          environment: []
        }
      }
    }
  }

  /**
   * 在安装锁内校验并安装 Runtime，返回稳定且可直接执行的最终版本目录。
   * Constructor 会把绝对前缀写入入口脚本，因此安装过程必须直接使用最终前缀。
   */
  private async install(
    reportProgress: RuntimeInstallationProgressReporter
  ): Promise<ManagedRuntimePaths> {
    reportProgress(runtimeInstallationProgress('preparing'))
    const manifest = await this.readManifest()
    const result = this.pathsFor(manifest)
    const versionsDirectory = join(this.dataDirectory, 'managed-runtime', 'versions')
    const prefix = result.prefix
    const runtimeRoot = join(this.dataDirectory, 'managed-runtime')
    await mkdir(versionsDirectory, { recursive: true })
    const releaseLock = await acquireInstallLock(
      join(runtimeRoot, 'install.lock')
    )
    try {
      if (await this.isValidInstallation(result)) {
        await this.writeActive(result)
        return result
      }

      const logsDirectory = join(runtimeRoot, 'logs')
      await mkdir(logsDirectory, { recursive: true })
      const installerLogPath = join(
        logsDirectory,
        `constructor-install-${Date.now()}-${process.pid}.log`
      )
      const installerPath = await this.resolveVerifiedInstaller(
        manifest,
        runtimeRoot,
        installerLogPath,
        reportProgress
      )
      if (await pathExists(prefix)) {
        await rename(prefix, `${prefix}.broken-${Date.now()}`)
      }
      try {
        reportProgress(runtimeInstallationProgress('installing'))
        await this.runInstaller(installerPath, prefix, installerLogPath)
        reportProgress(runtimeInstallationProgress('validating'))
        await this.requireValidInstallation(result)
        await this.writeActive(result)
        return result
      } catch (error) {
        await rm(prefix, { recursive: true, force: true })
        throw error
      }
    } finally {
      await releaseLock()
    }
  }

  private async readManifest(): Promise<ManagedRuntimeManifest> {
    const manifestPath = join(
      this.resourcesDirectory,
      'runtime-installer',
      'manifest.json'
    )
    const manifest = parseManifest(await readFile(manifestPath, 'utf8'))
    const expectedPlatform = constructorPlatform(
      this.platform,
      this.architecture
    )
    if (manifest.platform !== expectedPlatform) {
      throw new Error(
        `Runtime 载荷平台不匹配：当前 ${expectedPlatform}，载荷 ${manifest.platform}`
      )
    }
    return manifest
  }

  private async resolveVerifiedInstaller(
    manifest: ManagedRuntimeManifest,
    runtimeRoot: string,
    logPath: string,
    reportProgress: RuntimeInstallationProgressReporter
  ): Promise<string> {
    const bundledPath = join(
      this.resourcesDirectory,
      'runtime-installer',
      manifest.installerFile
    )
    if (manifest.delivery === 'bundled') {
      reportProgress(runtimeInstallationProgress('verifying'))
      await requireInstallerDigest(bundledPath, manifest.sha256)
      return bundledPath
    }

    const downloadUrl = manifest.downloadUrl
    if (!downloadUrl) throw new Error('Runtime 下载清单缺少 downloadUrl')
    const cacheDirectory = join(
      runtimeRoot,
      'downloads',
      manifest.sha256
    )
    const cachedPath = join(cacheDirectory, manifest.installerFile)
    await mkdir(cacheDirectory, { recursive: true })
    if (await pathExists(cachedPath)) {
      try {
        reportProgress(runtimeInstallationProgress('verifying'))
        await requireInstallerDigest(cachedPath, manifest.sha256)
        return cachedPath
      } catch {
        await rm(cachedPath, { force: true })
      }
    }

    const temporaryPath = join(
      cacheDirectory,
      `.${manifest.installerFile}.${process.pid}.${Date.now()}.download`
    )
    try {
      reportProgress(runtimeDownloadProgress(0, null))
      await this.downloadInstaller(downloadUrl, temporaryPath, reportProgress)
    } catch (error) {
      await rm(temporaryPath, { force: true })
      await writeRuntimeDownloadLog(logPath, downloadUrl, error)
      throw new Error(
        `Runtime 下载失败：${errorMessage(error)}；日志：${logPath}`,
        { cause: error }
      )
    }
    try {
      reportProgress(runtimeInstallationProgress('verifying'))
      await requireInstallerDigest(temporaryPath, manifest.sha256)
      await rename(temporaryPath, cachedPath)
      return cachedPath
    } catch (error) {
      await rm(temporaryPath, { force: true })
      await writeRuntimeDownloadLog(logPath, downloadUrl, error)
      throw new Error(`${errorMessage(error)}；日志：${logPath}`, {
        cause: error
      })
    }
  }

  private pathsFor(manifest: ManagedRuntimeManifest): ManagedRuntimePaths {
    const versionName = [
      manifest.runtimeVersion,
      manifest.platform,
      manifest.sha256.slice(0, 16)
    ].join('-')
    return runtimePaths(join(
      this.dataDirectory,
      'managed-runtime',
      'versions',
      versionName
    ), manifest)
  }

  /**
   * 识别持久化路径是否属于当前或历史托管 Runtime；外部环境保持用户所有。
   * 历史版本只读取模块自己的 active.json，不执行其中的任何程序。
   */
  async classifySelection(
    selectedEnvironmentPath: string | null
  ): Promise<ManagedRuntimeSelection> {
    return this.classifySelectionAgainstCurrent(selectedEnvironmentPath, null)
  }

  private async classifySelectionAgainstCurrent(
    selectedEnvironmentPath: string | null,
    current: ManagedRuntimePaths | null
  ): Promise<ManagedRuntimeSelection> {
    if (!selectedEnvironmentPath?.trim()) {
      return { kind: 'none', path: null, runtimeVersion: null }
    }
    const selected = resolve(selectedEnvironmentPath)
    if (current && selected === resolve(current.prefix)) {
      return {
        kind: 'current-managed',
        path: selected,
        runtimeVersion: current.runtimeVersion
      }
    }
    const versionsDirectory = resolve(
      this.dataDirectory,
      'managed-runtime',
      'versions'
    )
    const relativePath = relative(versionsDirectory, selected)
    const managed = relativePath.length > 0
      && relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath)
    if (!managed) {
      return { kind: 'external', path: selected, runtimeVersion: null }
    }
    return {
      kind: 'outdated-managed',
      path: selected,
      runtimeVersion: await this.readManagedRuntimeVersion(selected, current)
    }
  }

  private async readManagedRuntimeVersion(
    selected: string,
    current: ManagedRuntimePaths | null
  ): Promise<string | null> {
    try {
      const active = JSON.parse(await readFile(join(
        this.dataDirectory,
        'managed-runtime',
        'active.json'
      ), 'utf8')) as Record<string, unknown>
      if (
        active.schemaVersion === 1
        && typeof active.prefix === 'string'
        && resolve(active.prefix) === selected
        && typeof active.runtimeVersion === 'string'
        && active.runtimeVersion.trim()
      ) {
        return active.runtimeVersion.trim()
      }
    } catch {
      // 旧安装可能没有 active.json；目录名仍由本模块的固定规则生成。
    }
    const platform = current?.platform ?? constructorPlatform(
      this.platform,
      this.architecture
    )
    const suffix = `-${platform}-`
    const name = basename(selected)
    const suffixIndex = name.lastIndexOf(suffix)
    const digest = suffixIndex >= 0 ? name.slice(suffixIndex + suffix.length) : ''
    return suffixIndex > 0 && /^[0-9a-f]{16}$/u.test(digest)
      ? name.slice(0, suffixIndex)
      : null
  }

  private async isValidInstallation(paths: ManagedRuntimePaths): Promise<boolean> {
    if (!await validInstallation(paths, this.platform)) return false
    try {
      await this.verifyInstallation(paths)
      return true
    } catch {
      return false
    }
  }

  private async requireValidInstallation(paths: ManagedRuntimePaths): Promise<void> {
    if (!await validInstallation(paths, this.platform)) {
      throw new Error('Constructor 完成后缺少 python、unilab 或 unilab-supervisor')
    }
    try {
      await this.verifyInstallation(paths)
    } catch (error) {
      throw new Error('Constructor 完成后 Runtime 依赖验证失败', { cause: error })
    }
  }

  private async writeActive(result: ManagedRuntimePaths): Promise<void> {
    const root = join(this.dataDirectory, 'managed-runtime')
    const target = join(root, 'active.json')
    const temporary = join(root, `.active-${process.pid}.tmp`)
    await mkdir(root, { recursive: true })
    await writeFile(temporary, `${JSON.stringify({
      schemaVersion: 1,
      ...result
    }, null, 2)}\n`, 'utf8')
    await replaceFile(temporary, target, this.platform)
  }
}

function parseManifest(raw: string): ManagedRuntimeManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error('Runtime manifest 不是有效 JSON', { cause: error })
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Runtime manifest 必须是 JSON object')
  }
  const candidate = parsed as Record<string, unknown>
  if (![1, 2].includes(Number(candidate.schemaVersion))) {
    throw new Error('Runtime manifest schemaVersion 不受支持')
  }
  if (
    typeof candidate.runtimeVersion !== 'string'
    || !candidate.runtimeVersion.trim()
    || typeof candidate.installerFile !== 'string'
    || !candidate.installerFile.trim()
    || typeof candidate.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(candidate.sha256)
    || ![
      'linux-64',
      'osx-64',
      'osx-arm64',
      'win-64'
    ].includes(String(candidate.platform))
  ) {
    throw new Error('Runtime manifest 字段无效')
  }
  if (candidate.schemaVersion === 1) {
    return {
      ...(candidate as unknown as Omit<ManagedRuntimeManifest, 'delivery'>),
      delivery: 'bundled'
    }
  }
  if (
    !['bundled', 'download'].includes(String(candidate.delivery))
    || (candidate.delivery === 'download'
      && !validRuntimeDownloadUrl(candidate.downloadUrl))
  ) {
    throw new Error('Runtime manifest 交付配置无效')
  }
  return candidate as unknown as ManagedRuntimeManifest
}

function constructorPlatform(
  platform: NodeJS.Platform,
  architecture: string
): ManagedRuntimeManifest['platform'] {
  if (platform === 'win32' && architecture === 'x64') return 'win-64'
  if (platform === 'linux' && architecture === 'x64') return 'linux-64'
  if (platform === 'darwin' && architecture === 'x64') return 'osx-64'
  if (platform === 'darwin' && architecture === 'arm64') return 'osx-arm64'
  throw new Error(`不支持的 Runtime 平台：${platform}/${architecture}`)
}

function runtimePaths(
  prefix: string,
  manifest: ManagedRuntimeManifest
): ManagedRuntimePaths {
  const windows = manifest.platform === 'win-64'
  return {
    prefix,
    runtimeVersion: manifest.runtimeVersion,
    platform: manifest.platform,
    pythonExecutable: windows
      ? join(prefix, 'python.exe')
      : join(prefix, 'bin', 'python'),
    unilabExecutable: windows
      ? join(prefix, 'Scripts', 'unilab.exe')
      : join(prefix, 'bin', 'unilab'),
    supervisorExecutable: windows
      ? join(prefix, 'Scripts', 'unilab-supervisor.exe')
      : join(prefix, 'bin', 'unilab-supervisor'),
    manifestSha256: manifest.sha256
  }
}

/**
 * 校验 Runtime 必需入口可读可执行，并拒绝旧版本遗留的 staging 绝对路径。
 */
async function validInstallation(
  paths: ManagedRuntimePaths,
  platform: NodeJS.Platform
): Promise<boolean> {
  const mode = platform === 'win32'
    ? fsConstants.R_OK
    : fsConstants.R_OK | fsConstants.X_OK
  try {
    await Promise.all([
      access(paths.pythonExecutable, mode),
      access(paths.unilabExecutable, mode),
      access(paths.supervisorExecutable, mode)
    ])
    if (platform !== 'win32') {
      const entrypoints = await Promise.all([
        readFile(paths.unilabExecutable, 'utf8'),
        readFile(paths.supervisorExecutable, 'utf8')
      ])
      if (entrypoints.some((content) => content.includes('.installing-'))) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

/** 根据宿主平台生成静默 Constructor Runner，并保留完整安装诊断。 */
function runConstructorInstaller(
  platform: NodeJS.Platform
): RuntimeInstallerRunner {
  return async (installerPath, prefix, logPath) => {
    const command = platform === 'win32' ? installerPath : 'bash'
    const args = platform === 'win32'
      ? [
          '/S',
          '/InstallationType=JustMe',
          '/NoRegistry=1',
          '/NoShortcuts=1',
          '/RegisterPython=0',
          `/D=${prefix}`
        ]
      : [installerPath, '-b', '-p', prefix]
    await run(command, args, logPath)
  }
}

/** 以干净 PYTHONPATH 验收 CLI 与 PLC-Sim 所需的 OPC UA 模块。 */
async function verifyRuntimeInstallation(paths: ManagedRuntimePaths): Promise<void> {
  const runtimePath = [
    dirname(paths.unilabExecutable),
    dirname(paths.pythonExecutable),
    process.env['PATH']
  ].filter((value): value is string => Boolean(value)).join(delimiter)
  const environment = {
    ...process.env,
    PATH: runtimePath,
    PYTHONPATH: ''
  }
  await execFileChecked(paths.unilabExecutable, ['-h'], environment)
  await execFileChecked(paths.pythonExecutable, [
    '-c',
    'from opcua import Client, ua'
  ], environment)
}

/** 无 shell 执行单条 Runtime 验收命令。 */
function execFileChecked(
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(executable, args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
      env: environment
    }, (error) => {
      if (error) reject(error)
      else resolvePromise()
    })
  })
}

/**
 * 无 shell 执行安装器，记录 stdout/stderr；失败时返回可直接展示的摘要和日志路径。
 */
function run(
  command: string,
  args: string[],
  logPath: string
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    /** 持久化一次安装结果，并把进程结果映射为公开 Promise。 */
    const onComplete = (
      error: ExecFileException | null,
      stdout: string,
      stderr: string
    ): void => {
      const log = [
        `command=${JSON.stringify([command, ...args])}`,
        '',
        '[stdout]',
        stdout,
        '',
        '[stderr]',
        stderr
      ].join('\n')
      void writeFile(logPath, log, {
        encoding: 'utf8',
        mode: 0o600
      }).then(() => {
        if (!error) {
          resolvePromise()
          return
        }
        const code = 'code' in error ? error.code : null
        const signal = 'signal' in error ? error.signal : null
        const detail = summarizeInstallerOutput(stderr || stdout || error.message)
        reject(new Error(
          `Runtime 安装器执行失败：code=${String(code)} signal=${String(signal)}`
          + `；详情：${detail}；日志：${logPath}`,
          { cause: error }
        ))
      }, (logError: unknown) => {
        reject(new Error(
          `Runtime 安装器日志写入失败：${logPath}`,
          { cause: logError }
        ))
      })
    }
    execFile(command, args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    }, onComplete)
  })
}

/** 把多行安装器输出折叠为适合 IPC 错误提示的末尾摘要。 */
function summarizeInstallerOutput(output: string): string {
  const normalized = output.trim().replace(/\s+/g, ' ')
  return normalized.slice(-4_096) || '安装器未输出诊断信息'
}

/**
 * 使用 Electron 的 Chromium 网络栈创建下载器，使 Runtime 下载遵循系统代理。
 */
export function createElectronRuntimeInstallerDownloader(
  electronNet: ElectronRuntimeNet
): RuntimeInstallerDownloader {
  return (url, destination, reportProgress) => downloadRuntimeInstaller(
    electronNet,
    url,
    destination,
    reportProgress
  )
}

const unavailableRuntimeInstallerDownloader: RuntimeInstallerDownloader =
  async () => {
    throw new Error('Runtime 下载需要 Electron 网络服务')
  }

/** 通过 Chromium 网络栈流式下载 Runtime，限制空闲时间与最大体积。 */
async function downloadRuntimeInstaller(
  electronNet: ElectronRuntimeNet,
  url: string,
  destination: string,
  reportProgress: RuntimeInstallationProgressReporter
): Promise<void> {
  const { response, abortController } = await openRuntimeDownload(
    electronNet,
    new URL(url)
  )
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  const contentLength = Number.isSafeInteger(declaredLength)
    && declaredLength > 0
    ? declaredLength
    : null
  if (
    contentLength !== null && contentLength > RUNTIME_DOWNLOAD_MAX_BYTES
  ) {
    abortController.abort()
    throw new Error(`Runtime 下载文件超过 ${RUNTIME_DOWNLOAD_MAX_BYTES} bytes`)
  }
  if (!response.body) {
    abortController.abort()
    throw new Error('Runtime 下载响应缺少内容')
  }
  let receivedBytes = 0
  let lastReportedBytes = -1
  let lastReportedPercentage: number | null = null
  const reportDownloadProgress = (force = false): void => {
    const progress = runtimeDownloadProgress(receivedBytes, contentLength)
    const crossedUnknownSizeBoundary = contentLength === null
      && receivedBytes - lastReportedBytes
        >= RUNTIME_DOWNLOAD_UNKNOWN_SIZE_REPORT_BYTES
    const percentageChanged = progress.percentage !== lastReportedPercentage
    if (
      !force
      && !crossedUnknownSizeBoundary
      && !percentageChanged
    ) return
    if (
      receivedBytes === lastReportedBytes
      && progress.percentage === lastReportedPercentage
    ) return
    lastReportedBytes = receivedBytes
    lastReportedPercentage = progress.percentage
    reportProgress(progress)
  }
  reportDownloadProgress(true)
  const source = Readable.fromWeb(
    response.body as unknown as NodeReadableStream<Uint8Array>
  )
  let inactivityTimeout: NodeJS.Timeout | undefined
  const resetInactivityTimeout = (): void => {
    clearTimeout(inactivityTimeout)
    inactivityTimeout = setTimeout(() => {
      const error = new Error('Runtime 下载连接超时')
      abortController.abort()
      source.destroy(error)
    }, RUNTIME_DOWNLOAD_SOCKET_TIMEOUT_MS)
  }
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      resetInactivityTimeout()
      receivedBytes += chunk.length
      if (receivedBytes > RUNTIME_DOWNLOAD_MAX_BYTES) {
        callback(new Error(
          `Runtime 下载文件超过 ${RUNTIME_DOWNLOAD_MAX_BYTES} bytes`
        ))
        return
      }
      reportDownloadProgress()
      callback(null, chunk)
    }
  })
  try {
    resetInactivityTimeout()
    await pipeline(
      source,
      limit,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 })
    )
    reportDownloadProgress(true)
  } catch (error) {
    abortController.abort()
    await rm(destination, { force: true })
    throw error
  } finally {
    clearTimeout(inactivityTimeout)
  }
}

export function runtimeDownloadProgress(
  downloadedBytes: number,
  totalBytes: number | null
): ManagedRuntimeInstallationProgress {
  const validTotal = totalBytes !== null
    && Number.isSafeInteger(totalBytes)
    && totalBytes > 0
    ? totalBytes
    : null
  const validDownloaded = Number.isFinite(downloadedBytes)
    ? Math.max(0, Math.floor(downloadedBytes))
    : 0
  return {
    stage: 'downloading',
    downloadedBytes: validDownloaded,
    totalBytes: validTotal,
    percentage: validTotal === null
      ? null
      : Math.min(100, Math.floor((validDownloaded / validTotal) * 100))
  }
}

function runtimeInstallationProgress(
  stage: Exclude<ManagedRuntimeInstallationProgress['stage'], 'downloading'>
): ManagedRuntimeInstallationProgress {
  return {
    stage,
    downloadedBytes: null,
    totalBytes: null,
    percentage: null
  }
}

async function openRuntimeDownload(
  electronNet: ElectronRuntimeNet,
  url: URL
): Promise<{
  response: ElectronRuntimeResponse
  abortController: AbortController
}> {
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Runtime 下载地址必须使用无凭据 HTTPS')
  }
  const abortController = new AbortController()
  let connectionTimedOut = false
  const connectionTimeout = setTimeout(() => {
    connectionTimedOut = true
    abortController.abort()
  }, RUNTIME_DOWNLOAD_SOCKET_TIMEOUT_MS)
  let response: ElectronRuntimeResponse
  try {
    response = await electronNet.fetch(url.href, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      bypassCustomProtocolHandlers: true,
      signal: abortController.signal,
      headers: {
        'User-Agent': 'UniLab-Workbench-Runtime-Installer',
        Accept: 'application/octet-stream'
      }
    })
  } catch (error) {
    if (connectionTimedOut) {
      throw new Error('Runtime 下载连接超时', { cause: error })
    }
    throw error
  } finally {
    clearTimeout(connectionTimeout)
  }
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new Error(`Runtime 下载返回 HTTP ${response.status}`)
  }
  return { response, abortController }
}

function validRuntimeDownloadUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.href === value
      && url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

async function requireInstallerDigest(
  path: string,
  expectedSha256: string
): Promise<void> {
  let actualSha256: string
  try {
    actualSha256 = await sha256File(path)
  } catch (error) {
    throw new Error(`Runtime 安装器不可读：${path}`, { cause: error })
  }
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Runtime 安装器校验失败：期望 ${expectedSha256}，实际 ${actualSha256}`
    )
  }
}

async function writeRuntimeDownloadLog(
  logPath: string,
  url: string,
  error: unknown
): Promise<void> {
  await writeFile(logPath, [
    '[runtime-download]',
    `url=${url}`,
    `error=${errorMessage(error)}`,
    ''
  ].join('\n'), { encoding: 'utf8', mode: 0o600 })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.once('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('end', () => resolvePromise(hash.digest('hex')))
  })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function acquireInstallLock(path: string): Promise<() => Promise<void>> {
  const startedAt = Date.now()
  while (true) {
    try {
      const handle = await open(path, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        startedAt: Date.now()
      })}\n`, 'utf8')
      return async () => {
        await handle.close()
        await rm(path, { force: true })
      }
    } catch (error) {
      if (!isFileExistsError(error)) throw error
      if (await installLockIsStale(path)) {
        await rm(path, { force: true })
        continue
      }
      if (Date.now() - startedAt >= INSTALL_LOCK_TIMEOUT_MS) {
        throw new Error('等待其他桌面进程安装 Runtime 超时')
      }
      await delay(INSTALL_LOCK_POLL_MS)
    }
  }
}

async function installLockIsStale(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as { startedAt?: unknown }
    if (typeof parsed.startedAt === 'number') {
      return Date.now() - parsed.startedAt >= INSTALL_LOCK_STALE_MS
    }
  } catch {
    // 写入中或旧格式锁：退回文件时间判断，避免误删活跃锁。
  }
  try {
    const metadata = await stat(path)
    return Date.now() - metadata.mtimeMs >= INSTALL_LOCK_STALE_MS
  } catch {
    return false
  }
}

async function replaceFile(
  source: string,
  target: string,
  platform: NodeJS.Platform
): Promise<void> {
  if (platform !== 'win32' || !await pathExists(target)) {
    await rename(source, target)
    return
  }

  const backup = `${target}.previous-${process.pid}-${Date.now()}`
  await rename(target, backup)
  try {
    await rename(source, target)
    await rm(backup, { force: true })
  } catch (error) {
    if (!await pathExists(target) && await pathExists(backup)) {
      await rename(backup, target)
    }
    throw error
  }
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && error.code === 'EEXIST'
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds)
  })
}
