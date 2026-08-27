import { createHash } from 'node:crypto'
import { execFile, type ExecFileException } from 'node:child_process'
import { constants as fsConstants, createReadStream } from 'node:fs'
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

import type { LocalRuntimeModeInfo } from '../shared/localRuntime'

const MANIFEST_SCHEMA_VERSION = 1
const INSTALL_LOCK_TIMEOUT_MS = 10 * 60 * 1_000
const INSTALL_LOCK_STALE_MS = 2 * 60 * 60 * 1_000
const INSTALL_LOCK_POLL_MS = 50

export interface ManagedRuntimeManifest {
  schemaVersion: 1
  runtimeVersion: string
  platform: 'linux-64' | 'osx-64' | 'osx-arm64' | 'win-64'
  installerFile: string
  sha256: string
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

interface ManagedRuntimeInstallationOptions {
  resourcesDirectory: string
  dataDirectory: string
  platform?: NodeJS.Platform
  architecture?: string
  runInstaller?: RuntimeInstallerRunner
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
      paths,
      selection: await this.classifySelectionAgainstCurrent(
        selectedEnvironmentPath,
        paths
      )
    }
  }

  ensureInstalled(): Promise<ManagedRuntimePaths> {
    this.pending ??= this.install()
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
  private async install(): Promise<ManagedRuntimePaths> {
    const payloadDirectory = join(this.resourcesDirectory, 'runtime-installer')
    const manifest = await this.readVerifiedManifest()
    const installerPath = join(payloadDirectory, manifest.installerFile)
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

      if (await pathExists(prefix)) {
        await rename(prefix, `${prefix}.broken-${Date.now()}`)
      }
      const logsDirectory = join(runtimeRoot, 'logs')
      await mkdir(logsDirectory, { recursive: true })
      const installerLogPath = join(
        logsDirectory,
        `constructor-install-${Date.now()}-${process.pid}.log`
      )
      try {
        await this.runInstaller(installerPath, prefix, installerLogPath)
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

  private async readVerifiedManifest(): Promise<ManagedRuntimeManifest> {
    const manifest = await this.readManifest()
    if (basename(manifest.installerFile) !== manifest.installerFile) {
      throw new Error('Runtime installerFile 必须是文件名，不能包含路径')
    }
    const installerPath = join(
      this.resourcesDirectory,
      'runtime-installer',
      manifest.installerFile
    )
    const actualSha256 = await sha256File(installerPath)
    if (actualSha256 !== manifest.sha256) {
      throw new Error(
        `Runtime 安装器校验失败：期望 ${manifest.sha256}，实际 ${actualSha256}`
      )
    }
    return manifest
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
  if (candidate.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
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
