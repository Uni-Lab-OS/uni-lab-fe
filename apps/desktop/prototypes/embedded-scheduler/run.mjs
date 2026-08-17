import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveTimescaleRoot } from './build-timescaledb.mjs'
import { stageRuntimePayload } from './stage-runtime.mjs'

const prototypeDirectory = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(prototypeDirectory, '../../../..')
const backendRoot = resolveRepositoryRoot(
  'UNILAB_BACKEND_ROOT',
  [resolve(frontendRoot, '../local-246-backend'), resolve(frontendRoot, '../uni-lab-backend')],
  'go.mod'
)
const osRoot = resolveOptionalRepositoryRoot(
  'UNILAB_OS_ROOT',
  [resolve(frontendRoot, '../local-246-os'), resolve(frontendRoot, '../Uni-Lab-OS')],
  'unilabos/app/main.py'
)
const cacheRoot = resolve(
  process.env.UNILAB_PROTOTYPE_CACHE?.trim() ||
    join(homedir(), '.cache', 'unilab-electron-prototype')
)
const postgresRoot = resolve(process.env.UNILAB_POSTGRES_ROOT?.trim() || '/usr')
const keepArtifacts = process.argv.includes('--keep')
const probeRoot = await mkdtemp(join(tmpdir(), 'unilab-electron-scheduler-prototype-'))
const prototypeAppDirectory = join(probeRoot, 'app')
const payloadDirectory = join(prototypeAppDirectory, 'runtime-payload')
const outputDirectory = join(probeRoot, 'electron')
const userDataDirectory = join(probeRoot, 'user-data')
const backendBuildPath = join(probeRoot, 'unilab-backend')
const platformDirectory = `${process.platform}-${process.arch}`

try {
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    chmodSync(probeRoot, 0o755)
  }
  mkdirSync(cacheRoot, { recursive: true })
  preparePrototypeApp(prototypeAppDirectory)
  buildBackend(backendBuildPath)
  const timescaleRoot = resolveTimescaleRoot(cacheRoot)
  const sourceEvidence = {
    frontend: gitRevision(frontendRoot),
    os: osRoot ? gitRevision(osRoot) : null,
    backend: gitRevision(backendRoot)
  }
  const manifest = stageRuntimePayload({
    destination: payloadDirectory,
    postgresRoot,
    timescaleRoot,
    backendPath: backendBuildPath,
    platformDirectory,
    sourceEvidence,
    licenseNoticePath: join(prototypeDirectory, 'PROTOTYPE-NOTICES.txt')
  })

  packageElectron(prototypeAppDirectory, outputDirectory)
  const applicationPath = packagedApplicationPath(outputDirectory)
  const resourcesPath = packagedResourcesPath(outputDirectory)
  if (!existsSync(join(resourcesPath, 'runtime', 'manifest.json'))) {
    throw new Error(`Electron 产物缺少运行时清单：${resourcesPath}`)
  }
  const execution = runPackagedElectron(applicationPath, userDataDirectory)
  const result = parseProbeResult(execution.stdout)
  process.stdout.write(`${JSON.stringify({
    outcome: 'PASS',
    artifactRoot: probeRoot,
    applicationPath,
    payloadBytes: directoryBytes(join(resourcesPath, 'runtime')),
    integrityFileCount: manifest.files.length,
    sourceEvidence,
    postgres: manifest.postgres,
    timescale: manifest.timescale,
    electron: result
  }, null, 2)}\n`)
} finally {
  if (!keepArtifacts) rmSync(probeRoot, { recursive: true, force: true })
}

/**
 * 定位必需仓库并在缺失时给出显式环境变量修复方式。
 *
 * @param {string} environmentName 仓库路径覆盖变量名。
 * @param {string[]} candidates 默认候选根目录。
 * @param {string} marker 仓库类型标记文件。
 * @returns {string} 已验证仓库绝对路径。
 */
function resolveRepositoryRoot(environmentName, candidates, marker) {
  const resolved = resolveOptionalRepositoryRoot(environmentName, candidates, marker)
  if (resolved) return resolved
  throw new Error(`找不到仓库；请设置 ${environmentName} 为包含 ${marker} 的路径`)
}

/**
 * 从环境变量或相邻工作树定位一个可选仓库。
 *
 * @param {string} environmentName 仓库路径覆盖变量名。
 * @param {string[]} candidates 默认候选根目录。
 * @param {string} marker 仓库类型标记文件。
 * @returns {string|null} 已验证路径或 null。
 */
function resolveOptionalRepositoryRoot(environmentName, candidates, marker) {
  const configured = process.env[environmentName]?.trim()
  const paths = configured ? [resolve(configured)] : candidates
  for (const candidate of paths) {
    if (existsSync(join(candidate, marker))) return candidate
  }
  return null
}

/**
 * 构建供 HTTP 与调度器（Scheduler）两个子命令共用的当前平台 Go 二进制。
 *
 * @param {string} destination 临时 Backend 二进制路径。
 * @returns {void} 构建成功时返回。
 */
function buildBackend(destination) {
  const version = `prototype-${gitRevision(backendRoot).slice(0, 12)}`
  runCommand('go', [
    'build',
    '-trimpath',
    '-ldflags',
    `-s -w -X github.com/Uni-Lab-OS/uni-lab-backend/internal/command.Version=${version}`,
    '-o',
    destination,
    './cmd/server'
  ], backendRoot, { ...process.env, CGO_ENABLED: '1' })
}

/**
 * 复制最小 Electron 入口文件到隔离 projectDir。
 *
 * @param {string} destination 临时 Electron 项目目录。
 * @returns {void} 文件复制完成时返回。
 */
function preparePrototypeApp(destination) {
  mkdirSync(destination, { recursive: true })
  for (const fileName of [
    'package.json',
    'electron-main.cjs',
    'electron-processes.cjs',
    'renderer-probe.html',
    'electron-builder.yml'
  ]) {
    copyFileSync(join(prototypeDirectory, fileName), join(destination, fileName))
  }
}

/**
 * 使用真实 electron-builder 生成当前平台解包产物。
 *
 * @param {string} projectDirectory 原型 projectDir。
 * @param {string} outputDirectory 解包产物输出目录。
 * @returns {void} 打包成功时返回。
 */
function packageElectron(projectDirectory, outputDirectory) {
  const platformFlag = process.platform === 'darwin'
    ? '--mac'
    : process.platform === 'win32'
      ? '--win'
      : '--linux'
  runCommand('pnpm', [
    '--filter',
    '@unilab/desktop',
    'exec',
    'electron-builder',
    '--projectDir',
    projectDirectory,
    '--config',
    'electron-builder.yml',
    '--dir',
    platformFlag
  ], frontendRoot, {
    ...process.env,
    UNILAB_PROTOTYPE_OUTPUT_DIR: outputDirectory
  })
}

/**
 * 解析当前平台 electron-builder 应用可执行文件路径。
 *
 * @param {string} outputDirectory 解包产物根目录。
 * @returns {string} 应用入口绝对路径。
 */
function packagedApplicationPath(outputDirectory) {
  if (process.platform === 'darwin') {
    return join(
      outputDirectory,
      process.arch === 'arm64' ? 'mac-arm64' : 'mac',
      'Uni-Lab Embedded Scheduler Prototype.app',
      'Contents',
      'MacOS',
      'unilab-embedded-scheduler-prototype'
    )
  }
  if (process.platform === 'win32') {
    return join(outputDirectory, 'win-unpacked', 'unilab-embedded-scheduler-prototype.exe')
  }
  return join(outputDirectory, 'linux-unpacked', 'unilab-embedded-scheduler-prototype')
}

/**
 * 解析当前平台应用的 Resources 目录。
 *
 * @param {string} outputDirectory 解包产物根目录。
 * @returns {string} Resources 绝对路径。
 */
function packagedResourcesPath(outputDirectory) {
  if (process.platform === 'darwin') {
    return join(
      outputDirectory,
      process.arch === 'arm64' ? 'mac-arm64' : 'mac',
      'Uni-Lab Embedded Scheduler Prototype.app',
      'Contents',
      'Resources'
    )
  }
  const unpacked = process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked'
  return join(outputDirectory, unpacked, 'resources')
}

/**
 * 执行已打包 Electron 并收集三进程生命周期结构化证据。
 *
 * @param {string} applicationPath 已打包应用入口。
 * @param {string} userDataDirectory 隔离用户数据目录。
 * @returns {{stdout: string, stderr: string}} Electron 输出。
 */
function runPackagedElectron(applicationPath, userDataDirectory) {
  mkdirSync(userDataDirectory, { recursive: true, mode: 0o700 })
  const electronArguments = process.platform === 'linux' && process.getuid?.() === 0
    ? ['--no-sandbox']
    : []
  const useXvfb = process.platform === 'linux' && commandExists('xvfb-run')
  const command = useXvfb ? 'xvfb-run' : applicationPath
  const arguments_ = useXvfb
    ? ['-a', applicationPath, ...electronArguments]
    : electronArguments
  const result = spawnSync(command, arguments_, {
    cwd: userDataDirectory,
    env: { ...process.env, UNILAB_PROTOTYPE_DATA_DIR: userDataDirectory },
    encoding: 'utf8',
    timeout: 180_000
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `Electron 原型执行失败 status=${String(result.status)} error=${String(result.error)}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
    )
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * 从 Electron stdout 读取唯一结构化验收结果。
 *
 * @param {string} stdout Electron 标准输出。
 * @returns {Record<string, unknown>} 已解析结果。
 */
function parseProbeResult(stdout) {
  const prefix = 'UNILAB_EMBEDDED_SCHEDULER_RESULT='
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.startsWith(prefix)) return JSON.parse(line.slice(prefix.length))
  }
  throw new Error(`Electron 未发布结构化结果：\n${stdout}`)
}

/**
 * 执行一个不经过 shell 的构建命令。
 *
 * @param {string} command 可执行文件名。
 * @param {string[]} arguments_ 独立参数列表。
 * @param {string} workingDirectory 命令工作目录。
 * @param {NodeJS.ProcessEnv} environment 命令环境变量。
 * @returns {void} 命令成功时返回。
 */
function runCommand(command, arguments_, workingDirectory, environment) {
  const result = spawnSync(command, arguments_, {
    cwd: workingDirectory,
    env: environment,
    encoding: 'utf8',
    stdio: 'inherit'
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} 执行失败 status=${String(result.status)}`)
  }
}

/**
 * 读取仓库当前提交作为原型输入证据。
 *
 * @param {string} repositoryRoot Git 仓库根目录。
 * @returns {string} 完整提交 SHA。
 */
function gitRevision(repositoryRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  if (result.status !== 0) throw new Error(`无法读取仓库提交：${repositoryRoot}`)
  return result.stdout.trim()
}

/**
 * 递归计算解包资源字节数。
 *
 * @param {string} root 资源目录。
 * @returns {number} 全部普通文件字节数。
 */
function directoryBytes(root) {
  let bytes = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    bytes += entry.isDirectory() ? directoryBytes(path) : statSync(path).size
  }
  return bytes
}

/**
 * 判断 PATH 中是否存在可执行命令。
 *
 * @param {string} command 可执行文件名。
 * @returns {boolean} 命令存在时返回 true。
 */
function commandExists(command) {
  return spawnSync('which', [command], { stdio: 'ignore' }).status === 0
}
