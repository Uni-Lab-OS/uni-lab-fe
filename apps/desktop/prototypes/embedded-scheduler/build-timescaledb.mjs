import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const POSTGRES_MAJOR = '14'
const TIMESCALE_VERSION = '2.19.3'
const TIMESCALE_COMMIT = '95861e123bd439ed3c04dc5eeb86fef841bdf93b'

/**
 * 定位或构建与 PostgreSQL 14 匹配的 Apache 2 TimescaleDB 探针载荷。
 *
 * @param {string} cacheRoot 可安全重复使用的原型构建缓存根目录。
 * @returns {string} 含 usr/lib 与 usr/share 安装布局的根目录。
 */
export function resolveTimescaleRoot(cacheRoot) {
  const configured = process.env.UNILAB_TIMESCALE_ROOT?.trim()
  const candidates = configured ? [resolve(configured)] : ['/usr']
  for (const candidate of candidates) {
    if (isTimescaleRoot(candidate)) return candidate
  }
  if (configured) {
    throw new Error(
      `UNILAB_TIMESCALE_ROOT 不含 TimescaleDB ${TIMESCALE_VERSION} 的 PostgreSQL ${POSTGRES_MAJOR} 文件：${configured}`
    )
  }
  return buildTimescale(cacheRoot)
}

/**
 * 判断候选目录是否包含本原型需要的扩展二进制、控制文件与首次安装 SQL。
 *
 * @param {string} root 候选文件系统根目录。
 * @returns {boolean} 三类文件都存在时返回 true。
 */
function isTimescaleRoot(root) {
  return existsSync(join(
    root,
    'lib',
    'postgresql',
    POSTGRES_MAJOR,
    'lib',
    `timescaledb-${TIMESCALE_VERSION}.so`
  )) && existsSync(join(
    root,
    'share',
    'postgresql',
    POSTGRES_MAJOR,
    'extension',
    'timescaledb.control'
  )) && existsSync(join(
    root,
    'share',
    'postgresql',
    POSTGRES_MAJOR,
    'extension',
    `timescaledb--${TIMESCALE_VERSION}.sql`
  ))
}

/**
 * 在用户缓存中从官方固定 tag 构建扩展，不改写系统 PostgreSQL 安装。
 *
 * @param {string} cacheRoot 原型专用缓存根目录。
 * @returns {string} 构建完成的伪文件系统 usr 根目录。
 */
function buildTimescale(cacheRoot) {
  requireCommand('git')
  requireCommand('cmake')
  requireCommand('dpkg-deb')
  requireCommand('apt-get')
  requirePostgres14()

  const buildRoot = join(
    cacheRoot,
    `timescaledb-${TIMESCALE_VERSION}-pg${POSTGRES_MAJOR}-apache`
  )
  const sourceDirectory = join(buildRoot, 'source')
  const buildDirectory = join(buildRoot, 'build')
  const installDirectory = join(buildRoot, 'install')
  const installRoot = join(installDirectory, 'usr')
  if (isTimescaleRoot(installRoot)) return installRoot

  mkdirSync(buildRoot, { recursive: true })
  if (!existsSync(join(sourceDirectory, '.git'))) {
    runCommand('git', [
      'clone',
      '--depth',
      '1',
      '--branch',
      TIMESCALE_VERSION,
      'https://github.com/timescale/timescaledb.git',
      sourceDirectory
    ], buildRoot)
  }
  const sourceCommit = commandOutput(
    'git',
    ['rev-parse', 'HEAD'],
    sourceDirectory
  )
  if (sourceCommit !== TIMESCALE_COMMIT) {
    throw new Error(`TimescaleDB tag 提交不匹配：${sourceCommit}`)
  }

  const postgresHeaders = extractAptPackage(
    buildRoot,
    'postgresql-server-dev-14',
    'postgres-dev'
  )
  const opensslHeaders = extractAptPackage(buildRoot, 'libssl-dev', 'openssl-dev')
  const serverInclude = join(
    postgresHeaders,
    'usr',
    'include',
    'postgresql',
    POSTGRES_MAJOR,
    'server'
  )
  const opensslInclude = join(opensslHeaders, 'usr', 'include')
  const opensslArchitectureInclude = join(
    opensslInclude,
    'x86_64-linux-gnu'
  )
  const pgConfigWrapper = join(buildRoot, 'pg_config')
  writeFileSync(pgConfigWrapper, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--includedir" || "\${1:-}" == "--includedir-server" ]]; then
  printf '%s\\n' '${serverInclude}'
  exit 0
fi
exec /usr/bin/pg_config "$@"
`, { encoding: 'utf8', mode: 0o755 })
  chmodSync(pgConfigWrapper, 0o755)

  runCommand('cmake', [
    '-S',
    sourceDirectory,
    '-B',
    buildDirectory,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DPG_CONFIG=${pgConfigWrapper}`,
    '-DAPACHE_ONLY=1',
    '-DREGRESS_CHECKS=OFF',
    `-DCMAKE_C_FLAGS=-I${opensslInclude} -I${opensslArchitectureInclude}`
  ], buildRoot)
  runCommand('cmake', [
    '--build',
    buildDirectory,
    '--parallel',
    '4'
  ], buildRoot)
  runCommand('cmake', ['--install', buildDirectory], buildRoot, {
    ...process.env,
    DESTDIR: installDirectory
  })
  if (!isTimescaleRoot(installRoot)) {
    throw new Error('TimescaleDB 构建完成但 staging 文件不完整')
  }
  return installRoot
}

/**
 * 下载并解开一个 Debian 构建依赖到原型缓存，不执行系统安装。
 *
 * @param {string} buildRoot TimescaleDB 构建缓存根目录。
 * @param {string} packageName Debian 包名。
 * @param {string} directoryName 本地缓存子目录名。
 * @returns {string} 解包后的文件系统根目录。
 */
function extractAptPackage(buildRoot, packageName, directoryName) {
  const packageRoot = join(buildRoot, directoryName)
  const extractionRoot = join(packageRoot, 'extracted')
  mkdirSync(packageRoot, { recursive: true })
  let archive = readdirSync(packageRoot).find((name) => name.endsWith('.deb'))
  if (!archive) {
    runCommand('apt-get', ['download', packageName], packageRoot)
    archive = readdirSync(packageRoot).find((name) => name.endsWith('.deb'))
  }
  if (!archive) throw new Error(`未下载到 Debian 包：${packageName}`)
  if (!existsSync(join(extractionRoot, 'usr'))) {
    mkdirSync(extractionRoot, { recursive: true })
    runCommand(
      'dpkg-deb',
      ['-x', join(packageRoot, archive), extractionRoot],
      packageRoot
    )
  }
  return extractionRoot
}

/**
 * 确认系统构建目标确实是 PostgreSQL 14，避免扩展 ABI 混用。
 *
 * @returns {void} 版本匹配时返回。
 */
function requirePostgres14() {
  requireCommand('pg_config')
  const version = commandOutput('pg_config', ['--version'], process.cwd())
  if (!version.startsWith(`PostgreSQL ${POSTGRES_MAJOR}.`)) {
    throw new Error(`本原型只验证 PostgreSQL ${POSTGRES_MAJOR}，实际为 ${version}`)
  }
}

/**
 * 确认 PATH 中存在外部构建命令。
 *
 * @param {string} command 待检查的可执行文件名。
 * @returns {void} 命令存在时返回。
 */
function requireCommand(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' })
  if (result.status !== 0) throw new Error(`缺少原型构建命令：${command}`)
}

/**
 * 执行不经过 shell 的命令并在失败时保留完整诊断。
 *
 * @param {string} command 可执行文件名。
 * @param {string[]} arguments_ 独立参数列表。
 * @param {string} workingDirectory 命令工作目录。
 * @param {NodeJS.ProcessEnv} [environment] 可选环境变量。
 * @returns {void} 命令成功时返回。
 */
function runCommand(command, arguments_, workingDirectory, environment = process.env) {
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
 * 执行只读命令并返回去除尾部空白的标准输出。
 *
 * @param {string} command 可执行文件名。
 * @param {string[]} arguments_ 独立参数列表。
 * @param {string} workingDirectory 命令工作目录。
 * @returns {string} 命令标准输出。
 */
function commandOutput(command, arguments_, workingDirectory) {
  const result = spawnSync(command, arguments_, {
    cwd: workingDirectory,
    encoding: 'utf8'
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} 无法提供构建证据`)
  }
  return result.stdout.trim()
}

export const timescaleEvidence = Object.freeze({
  version: TIMESCALE_VERSION,
  commit: TIMESCALE_COMMIT,
  licenseMode: 'Apache-2.0-only-for-prototype'
})
