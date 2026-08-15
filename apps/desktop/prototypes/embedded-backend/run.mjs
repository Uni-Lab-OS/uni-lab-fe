import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const prototypeDirectory = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(prototypeDirectory, '../../../..')
const backendRoot = resolveRepositoryRoot(
  'UNILAB_BACKEND_ROOT',
  [
    resolve(frontendRoot, '../local-246-backend'),
    resolve(frontendRoot, '../uni-lab-backend')
  ],
  'go.mod'
)
const osRoot = resolveOptionalRepositoryRoot(
  'UNILAB_OS_ROOT',
  [
    resolve(frontendRoot, '../local-246-os'),
    resolve(frontendRoot, '../Uni-Lab-OS')
  ],
  'unilabos/app/main.py'
)
const keepArtifacts = process.argv.includes('--keep')
const probeRoot = await mkdtemp(join(tmpdir(), 'unilab-electron-backend-prototype-'))
const prototypeAppDirectory = join(probeRoot, 'app')
const payloadDirectory = join(prototypeAppDirectory, 'backend-payload')
const outputDirectory = join(probeRoot, 'electron')
const userDataDirectory = join(probeRoot, 'user-data')
const platformDirectory = `${process.platform}-${process.arch}`
const executableName = process.platform === 'win32'
  ? 'unilab-backend.exe'
  : 'unilab-backend'
const packagedBackendPath = join(
  payloadDirectory,
  platformDirectory,
  executableName
)

try {
  preparePrototypeApp(prototypeAppDirectory)
  mkdirSync(dirname(packagedBackendPath), { recursive: true })
  buildBackend(packagedBackendPath)

  const sourceEvidence = {
    frontend: gitRevision(frontendRoot),
    os: osRoot ? gitRevision(osRoot) : null,
    backend: gitRevision(backendRoot)
  }
  const manifest = {
    schemaVersion: 1,
    prototype: true,
    platform: process.platform,
    arch: process.arch,
    executable: `${platformDirectory}/${executableName}`,
    sha256: sha256(packagedBackendPath),
    bytes: statSync(packagedBackendPath).size,
    sourceEvidence
  }
  writeFileSync(
    join(payloadDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )

  packageElectron(prototypeAppDirectory, outputDirectory)
  const applicationPath = packagedApplicationPath(outputDirectory)
  const packagedResourcePath = packagedResourceBinaryPath(outputDirectory, manifest)
  if (!existsSync(packagedResourcePath)) {
    throw new Error(`Electron 产物缺少 Backend 二进制：${packagedResourcePath}`)
  }
  if (process.platform !== 'win32') chmodSync(packagedResourcePath, 0o755)

  const execution = runPackagedElectron(applicationPath, userDataDirectory)
  const result = parseProbeResult(execution.stdout)
  process.stdout.write(`${JSON.stringify({
    outcome: 'PASS',
    artifactRoot: probeRoot,
    applicationPath,
    packagedResourcePath,
    packagedResourceSha256: sha256(packagedResourcePath),
    manifest,
    electron: result
  }, null, 2)}\n`)
} finally {
  if (!keepArtifacts) rmSync(probeRoot, { recursive: true, force: true })
}

/**
 * 从显式环境变量或已知相邻工作树中定位必需仓库。
 *
 * @param {string} environmentName 可覆盖仓库位置的环境变量名。
 * @param {string[]} candidates 未覆盖时按顺序检查的候选根目录。
 * @param {string} marker 用于确认仓库类型的标记文件。
 * @returns {string} 已确认包含标记文件的绝对仓库根目录。
 * @throws 找不到仓库时抛出包含修复方式的错误。
 */
function resolveRepositoryRoot(environmentName, candidates, marker) {
  const resolved = resolveOptionalRepositoryRoot(
    environmentName,
    candidates,
    marker
  )
  if (resolved) return resolved
  throw new Error(
    `找不到所需仓库；请设置 ${environmentName} 为包含 ${marker} 的绝对路径`
  )
}

/**
 * 从环境变量或候选目录中定位可选仓库。
 *
 * @param {string} environmentName 可覆盖仓库位置的环境变量名。
 * @param {string[]} candidates 未覆盖时按顺序检查的候选根目录。
 * @param {string} marker 用于确认仓库类型的标记文件。
 * @returns {string|null} 找到时返回绝对根目录，否则返回 null。
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
 * 使用当前原生平台工具链构建带 SQLite 支持的 Go Backend。
 *
 * @param {string} destination 仅供本次原型使用的二进制输出路径。
 * @returns {void} 构建成功后返回。
 * @throws Go 构建失败或当前工具链未启用 CGO 时抛出错误。
 */
function buildBackend(destination) {
  const version = `prototype-${gitRevision(backendRoot).slice(0, 12)}`
  runCommand(
    'go',
    [
      'build',
      '-trimpath',
      '-ldflags',
      `-s -w -X github.com/Uni-Lab-OS/uni-lab-backend/internal/command.Version=${version}`,
      '-o',
      destination,
      './cmd/server'
    ],
    backendRoot,
    { ...process.env, CGO_ENABLED: '1' }
  )
}

/**
 * 把最小 Electron 原型复制到隔离目录，使 extraResources 使用稳定相对路径。
 *
 * @param {string} destination 临时 Electron projectDir。
 * @returns {void} 三个原型入口文件复制完成后返回。
 */
function preparePrototypeApp(destination) {
  mkdirSync(destination, { recursive: true })
  for (const fileName of [
    'package.json',
    'electron-main.cjs',
    'renderer-probe.html',
    'electron-builder.yml'
  ]) {
    copyFileSync(join(prototypeDirectory, fileName), join(destination, fileName))
  }
}

/**
 * 使用独立原型配置生成当前平台的 Electron 解包目录。
 *
 * @param {string} projectDirectory 已含入口与 Backend payload 的临时 projectDir。
 * @param {string} outputDirectory Electron 解包产物的隔离输出目录。
 * @returns {void} 打包成功后返回。
 * @throws electron-builder 失败时抛出错误。
 */
function packageElectron(projectDirectory, outputDirectory) {
  const platformFlag = process.platform === 'darwin'
    ? '--mac'
    : process.platform === 'win32'
      ? '--win'
      : '--linux'
  runCommand(
    'pnpm',
    [
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
    ],
    frontendRoot,
    {
      ...process.env,
      UNILAB_PROTOTYPE_OUTPUT_DIR: outputDirectory
    }
  )
}

/**
 * 解析当前平台 electron-builder 解包产物的应用入口。
 *
 * @param {string} outputDirectory Electron 解包产物根目录。
 * @returns {string} 可直接执行的 Electron 原型应用路径。
 */
function packagedApplicationPath(outputDirectory) {
  if (process.platform === 'darwin') {
    return join(
      outputDirectory,
      process.arch === 'arm64' ? 'mac-arm64' : 'mac',
      'Uni-Lab Embedded Backend Prototype.app',
      'Contents',
      'MacOS',
      'unilab-embedded-backend-prototype'
    )
  }
  if (process.platform === 'win32') {
    return join(
      outputDirectory,
      'win-unpacked',
      'unilab-embedded-backend-prototype.exe'
    )
  }
  return join(
    outputDirectory,
    'linux-unpacked',
    'unilab-embedded-backend-prototype'
  )
}

/**
 * 解析解包产物中必须位于 asar 外部的 Backend 二进制路径。
 *
 * @param {string} outputDirectory Electron 解包产物根目录。
 * @param {{executable: string}} manifest Backend 资源清单。
 * @returns {string} 安装资源目录中的 Backend 二进制路径。
 */
function packagedResourceBinaryPath(outputDirectory, manifest) {
  if (process.platform === 'darwin') {
    return join(
      outputDirectory,
      process.arch === 'arm64' ? 'mac-arm64' : 'mac',
      'Uni-Lab Embedded Backend Prototype.app',
      'Contents',
      'Resources',
      'backend',
      manifest.executable
    )
  }
  const unpacked = process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked'
  return join(
    outputDirectory,
    unpacked,
    'resources',
    'backend',
    manifest.executable
  )
}

/**
 * 执行解包后的 Electron 原型并收集生命周期证据。
 *
 * @param {string} applicationPath 解包后的 Electron 可执行文件。
 * @param {string} userDataDirectory 本轮隔离的用户数据目录。
 * @returns {{stdout: string, stderr: string}} 子进程标准输出与标准错误。
 * @throws Electron 返回非零状态或超过两分钟时抛出错误。
 */
function runPackagedElectron(applicationPath, userDataDirectory) {
  if (!existsSync(applicationPath)) {
    throw new Error(`找不到 Electron 原型应用：${applicationPath}`)
  }
  mkdirSync(userDataDirectory, { recursive: true, mode: 0o700 })
  const baseArguments = process.platform === 'linux' && process.getuid?.() === 0
    ? ['--no-sandbox']
    : []
  const environment = {
    ...process.env,
    UNILAB_PROTOTYPE_DATA_DIR: userDataDirectory
  }
  const xvfb = process.platform === 'linux' && commandExists('xvfb-run')
  const command = xvfb ? 'xvfb-run' : applicationPath
  const arguments_ = xvfb
    ? ['-a', applicationPath, ...baseArguments]
    : baseArguments
  const result = spawnSync(command, arguments_, {
    cwd: userDataDirectory,
    env: environment,
    encoding: 'utf8',
    timeout: 120_000
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `Electron 原型执行失败 status=${String(result.status)} error=${String(result.error)}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
    )
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * 从 Electron 标准输出中提取结构化验收结果。
 *
 * @param {string} stdout Electron 原型的完整标准输出。
 * @returns {Record<string, unknown>} Electron 主进程发布的最终状态。
 * @throws 未找到结果标记或 JSON 损坏时抛出错误。
 */
function parseProbeResult(stdout) {
  const prefix = 'UNILAB_EMBEDDED_BACKEND_RESULT='
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.startsWith(prefix)) return JSON.parse(line.slice(prefix.length))
  }
  throw new Error(`Electron 未发布结构化结果：\n${stdout}`)
}

/**
 * 运行一个不经过 shell 的构建命令并透传诊断。
 *
 * @param {string} command 可执行文件名。
 * @param {string[]} arguments_ 逐项参数，禁止拼接 shell 字符串。
 * @param {string} workingDirectory 命令工作目录。
 * @param {NodeJS.ProcessEnv} environment 明确传给命令的环境变量。
 * @returns {void} 命令成功时返回。
 * @throws 命令无法启动或返回非零状态时抛出错误。
 */
function runCommand(command, arguments_, workingDirectory, environment) {
  const result = spawnSync(command, arguments_, {
    cwd: workingDirectory,
    env: environment,
    encoding: 'utf8',
    stdio: 'inherit'
  })
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} 执行失败 status=${String(result.status)} error=${String(result.error)}`
    )
  }
}

/**
 * 读取仓库当前提交，作为原型证据而不是发布版本号。
 *
 * @param {string} repositoryRoot Git 仓库根目录。
 * @returns {string} 完整提交 SHA。
 */
function gitRevision(repositoryRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
  if (result.status !== 0) {
    throw new Error(`无法读取仓库提交：${repositoryRoot}`)
  }
  return result.stdout.trim()
}

/**
 * 计算资源文件的 SHA-256，确保 extraResources 未改变二进制内容。
 *
 * @param {string} path 待校验文件路径。
 * @returns {string} 小写十六进制摘要。
 */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * 判断当前 PATH 中是否存在指定辅助命令。
 *
 * @param {string} command 待检查命令名。
 * @returns {boolean} 命令可执行时为 true。
 */
function commandExists(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(locator, [command], { stdio: 'ignore' }).status === 0
}
