import { spawnSync } from 'node:child_process'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireDesktopUpdateUrl } from './update-publish.mjs'

const MEBIBYTE = 1024 * 1024

export const MIN_WINDOWS_INSTALLER_BYTES = 10 * MEBIBYTE
export const MAX_PACKAGED_APP_BYTES = 56 * MEBIBYTE

const desktopDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDirectory = join(desktopDirectory, 'release')

export function resolvePackagingCliPaths() {
  return {
    electronViteCli: join(
      desktopDirectory,
      'node_modules',
      'electron-vite',
      'bin',
      'electron-vite.js'
    ),
    electronBuilderCli: join(
      desktopDirectory,
      'node_modules',
      'electron-builder',
      'out',
      'cli',
      'cli.js'
    )
  }
}

export function validateWindowsInstaller(
  installerPath,
  minimumBytes = MIN_WINDOWS_INSTALLER_BYTES
) {
  if (!existsSync(installerPath)) {
    throw new Error(`Windows 安装包不存在：${installerPath}`)
  }

  const size = statSync(installerPath).size
  if (size < minimumBytes) {
    throw new Error(
      `Windows 安装包不完整：${basename(installerPath)} 仅 ${formatMebibytes(size)} MiB`
    )
  }

  const header = Buffer.alloc(2)
  const descriptor = openSync(installerPath, 'r')
  try {
    readSync(descriptor, header, 0, header.length, 0)
  } finally {
    closeSync(descriptor)
  }
  if (header.toString('ascii') !== 'MZ') {
    throw new Error(`Windows 安装包缺少 PE 文件头：${installerPath}`)
  }

  return { path: installerPath, size }
}

export function validatePackagedApp(
  outputDirectory,
  maximumBytes = MAX_PACKAGED_APP_BYTES
) {
  const archivePath = join(
    outputDirectory,
    'win-unpacked',
    'resources',
    'app.asar'
  )
  if (!existsSync(archivePath)) {
    throw new Error(`Windows 应用归档不存在：${archivePath}`)
  }

  const size = statSync(archivePath).size
  if (size > maximumBytes) {
    throw new Error(
      `app.asar 超出 ${formatMebibytes(maximumBytes)} MiB 预算，当前为 ${formatMebibytes(size)} MiB；请检查生产依赖是否被重复打包`
    )
  }

  return { path: archivePath, size }
}

export function findWindowsInstaller(outputDirectory) {
  const candidates = readdirSync(outputDirectory)
    .filter((name) => /-setup\.exe$/i.test(name))
    .map((name) => join(outputDirectory, name))

  if (candidates.length !== 1) {
    throw new Error(
      `Windows 安装包数量异常：预期 1 个，实际 ${candidates.length} 个`
    )
  }

  return validateWindowsInstaller(candidates[0])
}

export function publishWindowsArtifacts(outputDirectory, destinationDirectory) {
  const installer = findWindowsInstaller(outputDirectory)
  validatePackagedApp(outputDirectory)
  mkdirSync(destinationDirectory, { recursive: true })

  const artifactNames = readdirSync(outputDirectory).filter((name) =>
    /(?:-setup\.exe(?:\.blockmap)?|latest\.yml)$/i.test(name)
  )
  requireNamedArtifact(artifactNames, 'latest.yml')
  requireMatchingArtifact(artifactNames, /-setup\.exe\.blockmap$/i, 'Windows blockmap')
  for (const name of artifactNames) {
    copyFileSync(join(outputDirectory, name), join(destinationDirectory, name))
  }

  return validateWindowsInstaller(
    join(destinationDirectory, basename(installer.path))
  )
}

function runCli(entryPath, args) {
  const result = spawnSync(process.execPath, [entryPath, ...args], {
    cwd: desktopDirectory,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(entryPath)} 执行失败，退出码 ${result.status}`)
  }
}

export function packageWindows() {
  requireDesktopUpdateUrl()
  const outputDirectory = mkdtempSync(join(tmpdir(), 'unilab-win-package-'))
  const { electronViteCli, electronBuilderCli } = resolvePackagingCliPaths()

  try {
    runCli(electronViteCli, ['build'])
    runCli(electronBuilderCli, [
      '--win',
      '--publish',
      'never',
      `--config.directories.output=${outputDirectory}`
    ])

    const appArchive = validatePackagedApp(outputDirectory)
    const installer = publishWindowsArtifacts(
      outputDirectory,
      releaseDirectory
    )
    console.log(
      `Windows 安装包已发布：${installer.path}（${formatMebibytes(installer.size)} MiB），app.asar ${formatMebibytes(appArchive.size)} MiB`
    )
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
}

function requireNamedArtifact(names, expected) {
  if (!names.includes(expected)) {
    throw new Error(`桌面更新产物缺少 ${expected}`)
  }
}

function requireMatchingArtifact(names, pattern, label) {
  if (!names.some((name) => pattern.test(name))) {
    throw new Error(`桌面更新产物缺少 ${label}`)
  }
}

function formatMebibytes(bytes) {
  return (bytes / MEBIBYTE).toFixed(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    packageWindows()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
