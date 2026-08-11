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

import {
  MAX_PACKAGED_APP_BYTES,
  resolvePackagingCliPaths
} from './package-windows.mjs'

const MEBIBYTE = 1024 * 1024

export const MIN_MACOS_INSTALLER_BYTES = 10 * MEBIBYTE

const desktopDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDirectory = join(desktopDirectory, 'release')

export function validateMacosInstaller(
  installerPath,
  minimumBytes = MIN_MACOS_INSTALLER_BYTES
) {
  if (!existsSync(installerPath)) {
    throw new Error(`macOS 安装包不存在：${installerPath}`)
  }

  const size = statSync(installerPath).size
  if (size < minimumBytes) {
    throw new Error(
      `macOS 安装包不完整：${basename(installerPath)} 仅 ${formatMebibytes(size)} MiB`
    )
  }

  const signature = Buffer.alloc(4)
  const descriptor = openSync(installerPath, 'r')
  try {
    readSync(descriptor, signature, 0, signature.length, size - 512)
  } finally {
    closeSync(descriptor)
  }
  if (signature.toString('ascii') !== 'koly') {
    throw new Error(`macOS 安装包缺少有效的 UDIF 尾部：${installerPath}`)
  }

  return { path: installerPath, size }
}

export function findMacosInstaller(outputDirectory) {
  const candidates = readdirSync(outputDirectory)
    .filter((name) => name.toLowerCase().endsWith('.dmg'))
    .map((name) => join(outputDirectory, name))

  if (candidates.length !== 1) {
    throw new Error(
      `macOS 安装包数量异常：预期 1 个，实际 ${candidates.length} 个`
    )
  }

  return validateMacosInstaller(candidates[0])
}

export function validatePackagedMacosApp(
  outputDirectory,
  maximumBytes = MAX_PACKAGED_APP_BYTES
) {
  const candidates = []
  for (const entry of readdirSync(outputDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('mac')) continue
    const appDirectory = readdirSync(join(outputDirectory, entry.name), {
      withFileTypes: true
    }).find((candidate) =>
      candidate.isDirectory() && candidate.name.endsWith('.app')
    )
    if (!appDirectory) continue
    const archivePath = join(
      outputDirectory,
      entry.name,
      appDirectory.name,
      'Contents',
      'Resources',
      'app.asar'
    )
    if (existsSync(archivePath)) candidates.push(archivePath)
  }

  if (candidates.length !== 1) {
    throw new Error(
      `macOS 应用归档数量异常：预期 1 个，实际 ${candidates.length} 个`
    )
  }

  const archivePath = candidates[0]
  const size = statSync(archivePath).size
  if (size > maximumBytes) {
    throw new Error(
      `app.asar 超出 ${formatMebibytes(maximumBytes)} MiB 预算，当前为 ${formatMebibytes(size)} MiB；请检查生产依赖是否被重复打包`
    )
  }

  return { path: archivePath, size }
}

export function publishMacosArtifacts(outputDirectory, destinationDirectory) {
  const installer = findMacosInstaller(outputDirectory)
  validatePackagedMacosApp(outputDirectory)
  mkdirSync(destinationDirectory, { recursive: true })

  const artifactNames = readdirSync(outputDirectory).filter((name) =>
    /(?:\.dmg(?:\.blockmap)?|\.zip(?:\.blockmap)?|latest-mac\.yml)$/i.test(name)
  )
  requireNamedArtifact(artifactNames, 'latest-mac.yml')
  requireMatchingArtifact(artifactNames, /\.zip$/i, 'macOS ZIP')
  for (const name of artifactNames) {
    copyFileSync(join(outputDirectory, name), join(destinationDirectory, name))
  }

  return validateMacosInstaller(
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

export function packageMacos() {
  requireDesktopUpdateUrl()
  const outputDirectory = mkdtempSync(join(tmpdir(), 'unilab-macos-package-'))
  const { electronViteCli, electronBuilderCli } = resolvePackagingCliPaths()

  try {
    runCli(electronViteCli, ['build'])
    runCli(electronBuilderCli, [
      '--mac',
      '--publish',
      'never',
      `--config.directories.output=${outputDirectory}`
    ])

    const appArchive = validatePackagedMacosApp(outputDirectory)
    const installer = publishMacosArtifacts(outputDirectory, releaseDirectory)
    console.log(
      `macOS 安装包已发布：${installer.path}（${formatMebibytes(installer.size)} MiB），app.asar ${formatMebibytes(appArchive.size)} MiB`
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
    packageMacos()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
