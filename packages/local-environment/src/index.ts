import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, readdir, readFile, realpath } from 'node:fs/promises'
import {
  delimiter,
  dirname,
  join,
  normalize,
  posix,
  win32,
  resolve
} from 'node:path'

export interface EnvironmentDiscoveryOptions {
  environment?: NodeJS.ProcessEnv
  homeDirectory: string
  platform?: NodeJS.Platform
}

/**
 * 从当前激活状态、PATH 和常见安装目录发现可用的 unilab Conda 环境。
 *
 * @param options 环境变量、用户主目录和目标平台。
 * @returns 首个同时包含 Python 与 unilab 的真实环境路径，未找到时返回 null。
 * @throws 不抛出候选路径访问错误；不可用候选会被忽略。
 * @safety 只读取固定候选与 PATH 中的可执行文件，不修改激活状态。
 */
export async function discoverDefaultCondaEnvironment({
  environment = process.env,
  homeDirectory,
  platform = process.platform
}: EnvironmentDiscoveryOptions): Promise<string | null> {
  return (await discoverCondaEnvironments({
    environment,
    homeDirectory,
    platform
  }))[0] ?? null
}

/**
 * Discover every usable Conda environment instead of assuming its name is
 * `unilab`. Conda's registry and common `envs` roots cover custom names such
 * as `szlab-unilab` even when a desktop launch does not inherit Conda's PATH.
 */
export async function discoverCondaEnvironments({
  environment = process.env,
  homeDirectory,
  platform = process.platform
}: EnvironmentDiscoveryOptions): Promise<string[]> {
  const roots = environmentRootCandidates(environment, homeDirectory, platform)
  const candidates = [
    environment['CONDA_PREFIX'],
    ...await pathEnvironmentCandidates(environment['PATH'], platform),
    ...namedEnvironmentCandidates(environment, homeDirectory, platform),
    ...await registeredEnvironmentCandidates(homeDirectory),
    ...await childEnvironmentCandidates(roots)
  ]
  const visited = new Set<string>()
  const discovered: string[] = []

  for (const candidate of candidates) {
    if (!candidate) continue
    const normalizedCandidate = normalize(resolve(candidate))
    if (visited.has(normalizedCandidate)) continue
    visited.add(normalizedCandidate)

    const environmentPath = await validRuntimeEnvironment(
      normalizedCandidate,
      platform
    )
    if (environmentPath && !discovered.includes(environmentPath)) {
      discovered.push(environmentPath)
    }
  }
  return discovered
}

/**
 * 从 PATH 中已安装的 unilab 可执行文件反推 Conda 环境根目录。
 *
 * @param pathValue 当前进程 PATH 值。
 * @param platform 目标平台，用于选择分隔符与可执行文件名。
 * @returns 保持 PATH 顺序的候选环境根目录。
 * @throws 不抛出单个 PATH 项访问错误。
 * @safety 只解析真实路径，不执行候选程序。
 */
async function pathEnvironmentCandidates(
  pathValue: string | undefined,
  platform: NodeJS.Platform
): Promise<string[]> {
  if (!pathValue) return []
  const candidates: string[] = []
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const executableName = platform === 'win32' ? 'unilab.exe' : 'unilab'
  for (const pathDirectory of pathValue.split(pathDelimiter)) {
    if (!pathDirectory) continue
    try {
      const executable = await realpath(join(pathDirectory, executableName))
      candidates.push(dirname(dirname(executable)))
    } catch {
      // PATH 中不存在可用的 unilab 时继续检查下一个目录。
    }
  }
  return candidates
}

/**
 * 生成 Conda、Mamba 与常见用户安装位置中的命名环境候选。
 *
 * @param environment 当前进程环境变量。
 * @param homeDirectory Electron 提供的用户主目录。
 * @param platform 目标平台，用于选择环境根目录分隔符。
 * @returns 按显式配置优先的 unilab 环境候选路径。
 * @throws 不抛出异常。
 * @safety 只拼接候选路径，不访问文件系统。
 */
function namedEnvironmentCandidates(
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
  platform: NodeJS.Platform
): string[] {
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const condaEnvironmentRoots = (environment['CONDA_ENVS_PATH'] ?? '')
    .split(pathDelimiter)
    .filter(Boolean)
  const mambaRoot = environment['MAMBA_ROOT_PREFIX']

  return [
    ...condaEnvironmentRoots.map((root) => join(root, 'unilab')),
    ...(mambaRoot ? [join(mambaRoot, 'envs', 'unilab')] : []),
    join(homeDirectory, 'miniforge3', 'envs', 'unilab'),
    join(homeDirectory, 'mambaforge', 'envs', 'unilab'),
    join(homeDirectory, 'miniconda3', 'envs', 'unilab'),
    join(homeDirectory, 'anaconda3', 'envs', 'unilab'),
    join(homeDirectory, '.conda', 'envs', 'unilab'),
    join(homeDirectory, '.micromamba', 'envs', 'unilab'),
    '/opt/homebrew/Caskroom/miniforge/base/envs/unilab',
    '/opt/homebrew/Caskroom/miniconda/base/envs/unilab'
  ]
}

/** Return Conda roots whose direct children may be named environments. */
function environmentRootCandidates(
  environment: NodeJS.ProcessEnv,
  homeDirectory: string,
  platform: NodeJS.Platform
): string[] {
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const configuredRoots = (environment['CONDA_ENVS_PATH'] ?? '')
    .split(pathDelimiter)
    .filter(Boolean)
  const mambaRoot = environment['MAMBA_ROOT_PREFIX']
  return [
    ...configuredRoots,
    ...(mambaRoot ? [join(mambaRoot, 'envs')] : []),
    join(homeDirectory, 'miniforge3', 'envs'),
    join(homeDirectory, 'mambaforge', 'envs'),
    join(homeDirectory, 'miniconda3', 'envs'),
    join(homeDirectory, 'anaconda3', 'envs'),
    join(homeDirectory, '.conda', 'envs'),
    join(homeDirectory, '.micromamba', 'envs'),
    '/opt/homebrew/Caskroom/miniforge/base/envs',
    '/opt/homebrew/Caskroom/miniconda/base/envs'
  ]
}

/** Read Conda's per-user registry without requiring `conda` on PATH. */
async function registeredEnvironmentCandidates(
  homeDirectory: string
): Promise<string[]> {
  try {
    return (await readFile(
      join(homeDirectory, '.conda', 'environments.txt'),
      'utf8'
    )).split(/\r?\n/u).map(path => path.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** Enumerate named environments below known roots on Windows and POSIX. */
async function childEnvironmentCandidates(roots: string[]): Promise<string[]> {
  const children = await Promise.all(roots.map(async root => {
    try {
      return (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
        .map(entry => join(root, entry.name))
    } catch {
      return []
    }
  }))
  return children.flat()
}

/**
 * 校验候选环境同时包含可执行的 Python 与 unilab。
 *
 * @param environmentPath 已规范化的候选 Conda 环境根目录。
 * @param platform 目标平台，用于选择可执行文件布局。
 * @returns 有效环境的真实路径；任一合同不满足时返回 null。
 * @throws 不向调用方传播文件访问或真实路径解析错误。
 * @safety 只检查读与执行权限，不运行文件。
 */
export async function validRuntimeEnvironment(
  environmentPath: string,
  platform: NodeJS.Platform
): Promise<string | null> {
  try {
    const { pythonExecutable, unilabExecutable } = runtimeExecutablePaths(
      environmentPath,
      platform
    )
    await Promise.all([
      access(pythonExecutable, fsConstants.R_OK | fsConstants.X_OK),
      access(unilabExecutable, fsConstants.R_OK | fsConstants.X_OK)
    ])
    return await realpath(environmentPath)
  } catch {
    return null
  }
}

export interface RuntimeEnvironmentValidationOptions {
  platform?: NodeJS.Platform
  timeoutMs?: number
  inheritedEnvironment?: NodeJS.ProcessEnv
  runCommand?: (
    executable: string,
    args: string[],
    options: { environment: NodeJS.ProcessEnv; timeoutMs: number }
  ) => Promise<void>
}

/**
 * Require the selected environment to provide the actual OS and PLC imports,
 * not merely executable filenames. This keeps failures on the selection page.
 */
export async function validateRuntimeEnvironment(
  environmentPath: string,
  options: RuntimeEnvironmentValidationOptions = {}
): Promise<string> {
  const platform = options.platform ?? process.platform
  const resolved = await validRuntimeEnvironment(environmentPath, platform)
  if (!resolved) {
    throw new Error('所选目录不是可用的 UniLab 环境（缺少 Python 或 unilab）')
  }
  const executables = runtimeExecutablePaths(resolved, platform)
  const environment = activatedCondaEnvironment(
    resolved,
    platform,
    options.inheritedEnvironment
  )
  const timeoutMs = options.timeoutMs ?? 15_000
  const runCommand = options.runCommand ?? runRuntimeValidationCommand
  try {
    await Promise.all([
      runCommand(executables.unilabExecutable, ['-h'], {
        environment,
        timeoutMs
      }),
      runCommand(executables.pythonExecutable, [
        '-c',
        [
          'from unilabos.app.main import main',
          'from opcua import Client, ua',
          'from fastapi import FastAPI',
          'from pydantic import BaseModel',
          'import uvicorn, yaml'
        ].join('; ')
      ], {
        environment,
        timeoutMs
      })
    ])
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`所选 UniLab 环境依赖验证失败：${detail}`, { cause: error })
  }
  return resolved
}

function runRuntimeValidationCommand(
  executable: string,
  args: string[],
  options: { environment: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(executable, args, {
      env: options.environment,
      timeout: options.timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    }, error => {
      if (error) reject(error)
      else resolvePromise()
    })
  })
}

/**
 * 构造边缘执行（Edge）需要的 Conda 与 Python 模块搜索环境。
 *
 * @param environmentPath 已校验的 Conda 环境根目录。
 * @param platform 当前目标平台。
 * @param osProjectPath Uni-Lab-OS 项目根目录。
 * @param devicePackagePath 可选领域设备包项目根目录。
 * @returns 包含激活 PATH、PYTHONPATH 与无缓冲输出设置的环境。
 * @throws 不抛出异常。
 * @safety 只扩展当前进程环境的副本，不修改 process.env。
 */
export function runtimeEnvironment(
  environmentPath: string,
  platform: NodeJS.Platform,
  osProjectPath: string,
  devicePackagePath: string
): NodeJS.ProcessEnv {
  const environment = activatedCondaEnvironment(environmentPath, platform)
  return {
    ...environment,
    PYTHONPATH: mergePathList([
      osProjectPath,
      devicePackagePath,
      environmentValue(environment, 'PYTHONPATH')
    ], platform === 'win32' ? ';' : ':'),
    PYTHONUNBUFFERED: '1'
  }
}

/**
 * 构造跨平台 Conda 激活后的子进程环境。
 *
 * @param environmentPath 已校验的 Conda 环境根目录。
 * @param platform 当前目标平台。
 * @param inheritedEnvironment 要继承的基线环境，默认当前进程环境。
 * @returns 不修改基线对象的激活环境副本。
 * @throws 不抛出异常。
 * @safety Windows 下先移除大小写等价的旧 Conda 变量，避免环境串用。
 */
export function activatedCondaEnvironment(
  environmentPath: string,
  platform: NodeJS.Platform,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const platformPath = runtimePathApi(environmentPath, platform)
  if (platform !== 'win32') {
    return {
      ...inheritedEnvironment,
      PATH: mergePathList([
        platformPath.join(environmentPath, 'bin'),
        environmentValue(inheritedEnvironment, 'PATH')
      ])
    }
  }

  const inheritedPath = environmentValue(inheritedEnvironment, 'PATH')
  const environment = Object.fromEntries(
    Object.entries(inheritedEnvironment).filter(
      /** 移除 Windows 中旧的 PATH 与 Conda 激活状态。 */
      ([key]) => !isWindowsCondaEnvironmentKey(key)
    )
  )
  const environmentName = platformPath.basename(environmentPath)
  return {
    ...environment,
    CONDA_PREFIX: environmentPath,
    CONDA_DEFAULT_ENV: environmentName,
    CONDA_SHLVL: '1',
    CONDA_PROMPT_MODIFIER: `(${environmentName}) `,
    PATH: mergePathList([
      environmentPath,
      platformPath.join(environmentPath, 'Library', 'mingw-w64', 'bin'),
      platformPath.join(environmentPath, 'Library', 'usr', 'bin'),
      platformPath.join(environmentPath, 'Library', 'bin'),
      platformPath.join(environmentPath, 'Scripts'),
      platformPath.join(environmentPath, 'bin'),
      inheritedPath
    ], ';')
  }
}

/**
 * 合并用户环境覆盖，并处理 Windows 名称大小写。
 *
 * @param baseEnvironment Conda、PATH 与 PYTHONPATH 基线环境。
 * @param overrides 已通过主进程安全校验的用户环境变量覆盖。
 * @param platform 当前目标平台。
 * @returns 不含重复名称、可继续写入启动器权威变量的环境副本。
 * @throws 不抛出异常。
 * @safety 只合并内存对象；保留值原文但不会执行其中内容。
 */
export function mergeCustomEdgeEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  overrides: Array<{ name: string; value: string }>,
  platform: NodeJS.Platform
): NodeJS.ProcessEnv {
  if (overrides.length === 0) return baseEnvironment
  if (platform !== 'win32') {
    return {
      ...baseEnvironment,
      ...Object.fromEntries(overrides.map(
        /** 把已校验覆盖项转换为环境变量键值对。 */
        ({ name, value }) => [name, value]
      ))
    }
  }
  const overrideNames = new Set(overrides.map(
    /** Windows 环境变量名称比较统一使用大写。 */
    ({ name }) => name.toUpperCase()
  ))
  const withoutShadowedNames = Object.fromEntries(
    Object.entries(baseEnvironment).filter(
      /** 删除将由用户覆盖的同名 Windows 环境变量。 */
      ([name]) => !overrideNames.has(name.toUpperCase())
    )
  )
  return {
    ...withoutShadowedNames,
    ...Object.fromEntries(overrides.map(
      /** 恢复用户声明的原始环境变量名称和值。 */
      ({ name, value }) => [name, value]
    ))
  }
}

/**
 * 解析 Conda 环境内跨平台 Python 与 unilab 可执行文件路径。
 *
 * @param environmentPath Conda 环境根目录。
 * @param platform 当前目标平台。
 * @returns Python 与 unilab 的预期绝对路径。
 * @throws 不抛出异常；存在性由调用方单独校验。
 * @safety 只拼接固定相对路径。
 */
export function runtimeExecutablePaths(
  environmentPath: string,
  platform: NodeJS.Platform
): { pythonExecutable: string; unilabExecutable: string } {
  const platformPath = runtimePathApi(environmentPath, platform)
  if (platform === 'win32') {
    return {
      pythonExecutable: platformPath.join(environmentPath, 'python.exe'),
      unilabExecutable: platformPath.join(
        environmentPath,
        'Scripts',
        'unilab.exe'
      )
    }
  }
  return {
    pythonExecutable: platformPath.join(environmentPath, 'bin', 'python'),
    unilabExecutable: platformPath.join(environmentPath, 'bin', 'unilab')
  }
}

/**
 * Keep host filesystem paths usable when tests exercise a foreign target while
 * still emitting native Windows paths for drive-letter and UNC environments.
 */
function runtimePathApi(environmentPath: string, platform: NodeJS.Platform) {
  if (
    platform === 'win32' &&
    /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/u.test(environmentPath)
  ) {
    return win32
  }
  return posix
}

/**
 * 判断 Windows 环境变量是否属于本轮需要替换的 Conda 激活状态。
 *
 * @param key 继承环境中的原始变量名称。
 * @returns PATH 或任一 Conda 激活变量返回 true。
 * @throws 不抛出异常。
 * @safety 只比较变量名称，不读取变量值。
 */
function isWindowsCondaEnvironmentKey(key: string): boolean {
  const normalizedKey = key.toUpperCase()
  return normalizedKey === 'PATH'
    || normalizedKey === 'CONDA_PREFIX'
    || normalizedKey === 'CONDA_DEFAULT_ENV'
    || normalizedKey === 'CONDA_SHLVL'
    || normalizedKey === 'CONDA_PROMPT_MODIFIER'
    || /^CONDA_PREFIX_\d+$/.test(normalizedKey)
}

/**
 * 按不区分大小写的名称读取首个非空进程环境变量。
 *
 * @param environment 环境变量映射。
 * @param name 目标变量名称。
 * @returns 首个非空匹配值；不存在时返回 undefined。
 * @throws 不抛出异常。
 * @safety 只读取内存值，不记录或执行内容。
 */
function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string
): string | undefined {
  const normalizedName = name.toUpperCase()
  return Object.entries(environment).find(
    /** 环境变量名称按 Windows 兼容规则比较，并忽略空值。 */
    ([key, value]) => key.toUpperCase() === normalizedName && Boolean(value)
  )?.[1]
}

/**
 * 合并 PATH 或 PYTHONPATH 片段，保留输入顺序并移除空值。
 *
 * @param values 候选路径片段。
 * @param separator 当前平台的路径分隔符。
 * @returns 保持输入顺序的路径列表字符串。
 * @throws 不抛出异常。
 * @safety 不规范化路径，避免改变用户声明的搜索顺序。
 */
function mergePathList(
  values: Array<string | undefined>,
  separator = delimiter
): string {
  return values.filter(
    /** 只保留非空路径片段，并收窄为字符串。 */
    (value): value is string => Boolean(value)
  ).join(separator)
}

export const PLC_SIMULATOR_HOST = '127.0.0.1'
export const PLC_SIMULATOR_GUI_PORT = 18_765
export const PLC_SIMULATOR_OPC_UA_PORT = 4_855

export interface PlcSimulatorLaunchOptions {
  environmentPath: string
  projectPath: string
  platform?: NodeJS.Platform
  inheritedEnvironment?: NodeJS.ProcessEnv
  guiPort?: number
  opcUaPort?: number
}

export interface PlcSimulatorLaunchPlan {
  command: string
  args: string[]
  cwd: string
  environment: NodeJS.ProcessEnv
  projectPath: string
  guiUrl: string
  opcUaUrl: string
  guiPort: number
  opcUaPort: number
}

/** Resolve the one cross-platform PLC-Sim launch contract shared by desktop and Workbench. */
export async function resolvePlcSimulatorLaunch(
  options: PlcSimulatorLaunchOptions
): Promise<PlcSimulatorLaunchPlan> {
  const platform = options.platform ?? process.platform
  const environmentPath = normalize(resolve(options.environmentPath))
  const validEnvironmentPath = await validRuntimeEnvironment(
    environmentPath,
    platform
  )
  if (!validEnvironmentPath) {
    throw new Error('所选 Python 环境不可用，必须同时包含 Python 与 unilab CLI')
  }
  const projectPath = await realDirectory(
    options.projectPath,
    'PLC-Sim 项目目录不存在'
  )
  const cwd = await plcSimulatorWorkingDirectory(projectPath)
  const guiPort = validPort(
    options.guiPort ?? PLC_SIMULATOR_GUI_PORT,
    'PLC-Sim Web GUI'
  )
  const opcUaPort = validPort(
    options.opcUaPort ?? PLC_SIMULATOR_OPC_UA_PORT,
    'PLC-Sim OPC UA'
  )
  const { pythonExecutable } = runtimeExecutablePaths(environmentPath, platform)
  return {
    command: pythonExecutable,
    args: [
      '-m',
      'gui.backend',
      '--host',
      PLC_SIMULATOR_HOST,
      '--port',
      String(guiPort)
    ],
    cwd,
    environment: {
      ...activatedCondaEnvironment(
        environmentPath,
        platform,
        options.inheritedEnvironment
      ),
      PYTHONUNBUFFERED: '1'
    },
    projectPath,
    guiUrl: `http://${PLC_SIMULATOR_HOST}:${guiPort}`,
    opcUaUrl: `opc.tcp://${PLC_SIMULATOR_HOST}:${opcUaPort}`,
    guiPort,
    opcUaPort
  }
}

async function plcSimulatorWorkingDirectory(projectPath: string): Promise<string> {
  for (const candidate of [join(projectPath, 'OpcUaSim'), projectPath]) {
    try {
      await access(join(candidate, 'gui', 'backend.py'), fsConstants.R_OK)
      await realpath(candidate)
      return candidate
    } catch {
      // Accept either the repository root or its OpcUaSim directory.
    }
  }
  throw new Error(`所选目录不是有效的 PLC-Sim 项目：${projectPath}`)
}

async function realDirectory(candidate: string, message: string): Promise<string> {
  if (!candidate.trim()) throw new Error('请选择 PLC-Sim 项目目录')
  try {
    const directory = normalize(resolve(candidate))
    await realpath(directory)
    await access(directory, fsConstants.R_OK | fsConstants.X_OK)
    return directory
  } catch {
    throw new Error(`${message}：${candidate}`)
  }
}

function validPort(port: number, label: string): number {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} 不是有效 TCP 端口：${port}`)
  }
  return port
}
