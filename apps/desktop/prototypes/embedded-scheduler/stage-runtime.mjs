import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { timescaleEvidence } from './build-timescaledb.mjs'

const POSTGRES_MAJOR = '14'
const POSTGRES_BINARIES = [
  'createdb',
  'initdb',
  'pg_ctl',
  'pg_isready',
  'postgres',
  'psql'
]
const POSTGRES_SERVER_MODULES = ['dict_snowball.so', 'plpgsql.so']
const GLIBC_RUNTIME_PATTERN = /^(?:ld-linux|libc\.so|libdl\.so|libm\.so|libpthread\.so|libresolv\.so|librt\.so|libutil\.so)/u

/**
 * 构造 electron-builder 的完整原生运行时载荷及逐文件完整性清单。
 *
 * @param {{destination: string, postgresRoot: string, timescaleRoot: string, backendPath: string, platformDirectory: string, sourceEvidence: Record<string, string|null>, licenseNoticePath: string}} options staging 输入与证据。
 * @returns {Record<string, unknown>} 已写入 payload 根目录的资源清单。
 */
export function stageRuntimePayload(options) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('当前第二阶段原型只实现并验证 Linux x64 原生载荷')
  }
  const backendDestination = join(
    options.destination,
    'backend',
    options.platformDirectory,
    'unilab-backend'
  )
  const postgresPayloadRoot = join(
    options.destination,
    'postgres',
    options.platformDirectory,
    'root'
  )
  mkdirSync(dirname(backendDestination), { recursive: true })
  copyFileSync(options.backendPath, backendDestination)
  chmodSync(backendDestination, 0o755)

  stagePostgres(options.postgresRoot, postgresPayloadRoot)
  stageTimescale(options.timescaleRoot, postgresPayloadRoot)
  stageDynamicLibraries(postgresPayloadRoot)
  const licenseDirectory = join(options.destination, 'licenses')
  mkdirSync(licenseDirectory, { recursive: true })
  copyFileSync(
    options.licenseNoticePath,
    join(licenseDirectory, 'PROTOTYPE-NOTICES.txt')
  )

  const manifest = {
    schemaVersion: 2,
    prototype: true,
    platform: process.platform,
    arch: process.arch,
    glibcFloor: commandOutput('getconf', ['GNU_LIBC_VERSION']),
    backend: {
      executable: relative(options.destination, backendDestination)
    },
    postgres: {
      major: POSTGRES_MAJOR,
      version: commandOutput(
        join(options.postgresRoot, 'lib', 'postgresql', POSTGRES_MAJOR, 'bin', 'postgres'),
        ['--version']
      ),
      root: relative(options.destination, postgresPayloadRoot),
      binaries: Object.fromEntries(POSTGRES_BINARIES.map((name) => [
        name,
        join('usr', 'lib', 'postgresql', POSTGRES_MAJOR, 'bin', name)
      ]))
    },
    timescale: timescaleEvidence,
    sourceEvidence: options.sourceEvidence,
    files: integrityEntries(options.destination)
  }
  writeFileSync(
    join(options.destination, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
  return manifest
}

/**
 * 复制 PostgreSQL 可执行文件、服务端模块和共享数据到保持相对布局的伪根目录。
 *
 * @param {string} sourceRoot PostgreSQL 安装的文件系统根目录，通常为 /usr。
 * @param {string} destinationRoot Electron 载荷中的 PostgreSQL 伪根目录。
 * @returns {void} 所需运行文件复制完成后返回。
 */
function stagePostgres(sourceRoot, destinationRoot) {
  const sourceBinaryDirectory = join(
    sourceRoot,
    'lib',
    'postgresql',
    POSTGRES_MAJOR,
    'bin'
  )
  const sourceLibraryDirectory = join(
    sourceRoot,
    'lib',
    'postgresql',
    POSTGRES_MAJOR,
    'lib'
  )
  const sourceShareDirectory = join(
    sourceRoot,
    'share',
    'postgresql',
    POSTGRES_MAJOR
  )
  for (const requiredPath of [
    join(sourceBinaryDirectory, 'postgres'),
    sourceLibraryDirectory,
    sourceShareDirectory
  ]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`PostgreSQL 运行时缺少：${requiredPath}`)
    }
  }
  const destinationBinaryDirectory = join(
    destinationRoot,
    'usr',
    'lib',
    'postgresql',
    POSTGRES_MAJOR,
    'bin'
  )
  mkdirSync(destinationBinaryDirectory, { recursive: true })
  for (const name of POSTGRES_BINARIES) {
    const source = join(sourceBinaryDirectory, name)
    if (!existsSync(source)) throw new Error(`PostgreSQL 缺少命令：${source}`)
    const destination = join(destinationBinaryDirectory, name)
    copyFileSync(source, destination)
    chmodSync(destination, 0o755)
  }
  const destinationLibraryDirectory = join(
    destinationRoot,
    'usr',
    'lib',
    'postgresql',
    POSTGRES_MAJOR,
    'lib'
  )
  mkdirSync(destinationLibraryDirectory, { recursive: true })
  for (const name of POSTGRES_SERVER_MODULES) {
    copyRequiredFile(
      join(sourceLibraryDirectory, name),
      join(destinationLibraryDirectory, name)
    )
  }
  cpSync(sourceShareDirectory, join(
    destinationRoot,
    'usr',
    'share',
    'postgresql',
    POSTGRES_MAJOR
  ), { recursive: true, dereference: false })
}

/**
 * 把固定版本 TimescaleDB 首次安装文件覆盖进 PostgreSQL 伪根目录。
 *
 * @param {string} timescaleRoot TimescaleDB staging 的 usr 根目录。
 * @param {string} destinationRoot PostgreSQL 伪根目录。
 * @returns {void} loader、版本模块、control 与 SQL 复制完成后返回。
 */
function stageTimescale(timescaleRoot, destinationRoot) {
  const libraryNames = ['timescaledb.so', `timescaledb-${timescaleEvidence.version}.so`]
  const extensionNames = [
    'timescaledb.control',
    `timescaledb--${timescaleEvidence.version}.sql`
  ]
  for (const name of libraryNames) {
    copyRequiredFile(
      join(timescaleRoot, 'lib', 'postgresql', POSTGRES_MAJOR, 'lib', name),
      join(destinationRoot, 'usr', 'lib', 'postgresql', POSTGRES_MAJOR, 'lib', name)
    )
  }
  for (const name of extensionNames) {
    copyRequiredFile(
      join(timescaleRoot, 'share', 'postgresql', POSTGRES_MAJOR, 'extension', name),
      join(destinationRoot, 'usr', 'share', 'postgresql', POSTGRES_MAJOR, 'extension', name)
    )
  }
}

/**
 * 收集 PostgreSQL 与扩展的非 glibc ELF 依赖，供相同 Linux ABI 主机重定位加载。
 *
 * @param {string} postgresRoot 已完成核心文件 staging 的 PostgreSQL 伪根目录。
 * @returns {void} 依赖复制到 runtime-lib 后返回。
 */
function stageDynamicLibraries(postgresRoot) {
  const libraryDirectory = join(postgresRoot, 'runtime-lib')
  mkdirSync(libraryDirectory, { recursive: true })
  const candidates = walkFiles(postgresRoot).filter((path) => {
    const name = basename(path)
    return POSTGRES_BINARIES.includes(name) || name.includes('.so')
  })
  /** @type {Map<string, string>} dependencyByName 保存载荷库名到来源文件的唯一映射。 */
  const dependencyByName = new Map()
  for (const candidate of candidates) {
    for (const dependency of lddDependencies(candidate)) {
      const name = basename(dependency)
      if (GLIBC_RUNTIME_PATTERN.test(name)) continue
      const existing = dependencyByName.get(name)
      if (existing && sha256(existing) !== sha256(dependency)) {
        throw new Error(`ELF 依赖同名冲突：${name}`)
      }
      dependencyByName.set(name, dependency)
    }
  }
  for (const [name, source] of dependencyByName) {
    copyFileSync(source, join(libraryDirectory, name))
  }
}

/**
 * 解析 ldd 输出中的绝对依赖路径；非动态文件返回空集合。
 *
 * @param {string} path ELF 可执行文件或共享库路径。
 * @returns {string[]} ldd 已解析的绝对依赖路径。
 */
function lddDependencies(path) {
  const result = spawnSync('ldd', [path], { encoding: 'utf8' })
  if (result.status !== 0) return []
  const dependencies = []
  for (const line of result.stdout.split(/\r?\n/u)) {
    const match = line.match(/(?:=>\s+)?(\/[^\s(]+)/u)
    if (match) dependencies.push(match[1])
  }
  return dependencies
}

/**
 * 生成 manifest 写入前全部文件的相对路径、摘要、字节数与权限。
 *
 * @param {string} payloadRoot runtime-payload 根目录。
 * @returns {Array<{path: string, sha256: string, bytes: number, mode: number}>} 排序后的完整性条目。
 */
function integrityEntries(payloadRoot) {
  return walkFiles(payloadRoot).map((path) => {
    const stats = statSync(path)
    return {
      path: relative(payloadRoot, path),
      sha256: sha256(path),
      bytes: stats.size,
      mode: stats.mode & 0o777
    }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * 递归列出目录中的文件和文件符号链接，不跟随目录符号链接。
 *
 * @param {string} root 待遍历目录。
 * @returns {string[]} 文件绝对路径列表。
 */
function walkFiles(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(path))
    else files.push(path)
  }
  return files
}

/**
 * 复制一个必需文件并自动建立目标父目录。
 *
 * @param {string} source 来源文件。
 * @param {string} destination 目标文件。
 * @returns {void} 复制完成后返回。
 */
function copyRequiredFile(source, destination) {
  if (!existsSync(source)) throw new Error(`原生运行时缺少：${source}`)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

/**
 * 计算文件 SHA-256，用于构建与运行时的逐文件完整性验证。
 *
 * @param {string} path 文件路径。
 * @returns {string} 小写十六进制摘要。
 */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * 读取一个只读命令的标准输出作为运行时版本证据。
 *
 * @param {string} command 可执行文件路径或名称。
 * @param {string[]} arguments_ 独立参数列表。
 * @returns {string} 去除尾部空白的标准输出。
 */
function commandOutput(command, arguments_) {
  const result = spawnSync(command, arguments_, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} 无法提供运行时证据`)
  }
  return result.stdout.trim()
}
