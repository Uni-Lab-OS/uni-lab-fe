import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  prepareRuntimePayloadFromEnvironment,
  validatePackagedRuntimeResources
} from '../../desktop/scripts/runtime-payload.mjs'
import {
  prepareBundledAgentPayload,
  validateBundledAgentPayload
} from './agent-payload.mjs'

const MEBIBYTE = 1024 * 1024
const MIN_INSTALLER_BYTES = 50 * MEBIBYTE
export const PORTABLE_NODE_VERSION = '24.14.0'
export const PORTABLE_NODE_ARCHIVES = Object.freeze({
  'linux-64': {
    hostPlatform: 'linux',
    hostArchitecture: 'x64',
    archive: `node-v${PORTABLE_NODE_VERSION}-linux-x64.tar.xz`,
    sha256: '41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df',
    esbuildPackage: 'linux-x64',
    nodeName: 'node'
  },
  'win-64': {
    hostPlatform: 'win32',
    hostArchitecture: 'x64',
    archive: `node-v${PORTABLE_NODE_VERSION}-win-x64.zip`,
    sha256: '313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66',
    esbuildPackage: 'win32-x64',
    nodeName: 'node.exe'
  }
})

const workbenchDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = resolve(workbenchDirectory, '../..')

export function packagePortableWorkbench(targetPlatform) {
  const descriptor = PORTABLE_NODE_ARCHIVES[targetPlatform]
  if (!descriptor) throw new Error(`不支持的 Workbench 平台：${targetPlatform}`)
  if (
    process.platform !== descriptor.hostPlatform
    || process.arch !== descriptor.hostArchitecture
  ) {
    throw new Error(
      `Workbench 必须原生构建：当前 ${process.platform}/${process.arch}，目标 ${targetPlatform}`
    )
  }

  const packagingDirectory = join(workbenchDirectory, '.packaging')
  const runtimePayloadDirectory = join(packagingDirectory, 'runtime-installer')
  const desktopRuntimeDirectory = join(packagingDirectory, 'desktop-runtime')
  const nodeRuntimeDirectory = join(packagingDirectory, 'node-runtime')
  const agentPayloadDirectory = join(packagingDirectory, 'agent-runtime')
  const deviceCardBuilderDirectory = join(
    packagingDirectory,
    'device-card-builder'
  )
  const releaseDirectory = join(
    workbenchDirectory,
    targetPlatform === 'linux-64' ? 'release-linux' : 'release-windows'
  )
  const outputDirectory = mkdtempSync(join(
    tmpdir(),
    targetPlatform === 'linux-64'
      ? 'unilab-workbench-linux-'
      : 'unilab-workbench-windows-'
  ))
  rmSync(packagingDirectory, { recursive: true, force: true })
  mkdirSync(packagingDirectory, { recursive: true })
  try {
    copyFileSync(
      join(workbenchDirectory, 'package.json'),
      join(packagingDirectory, 'workbench-package.json')
    )
    prepareRuntimePayloadFromEnvironment(
      runtimePayloadDirectory,
      targetPlatform
    )
    prepareBundledAgentPayload(agentPayloadDirectory, {
      sourcePath: process.env['UNILAB_AGENT_DISTRIBUTION'],
      platform: descriptor.hostPlatform,
      architecture: descriptor.hostArchitecture
    })
    prepareNodeRuntime(descriptor, nodeRuntimeDirectory, packagingDirectory)
    runCommand(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      [
        '--config.node-linker=hoisted',
        '--filter',
        '@unilab/desktop',
        'deploy',
        '--prod',
        '--legacy',
        '--prefer-offline',
        desktopRuntimeDirectory
      ],
      repositoryDirectory,
      process.env,
      { shell: process.platform === 'win32' }
    )
    const desktopMetrics = pruneDesktopDeployment(desktopRuntimeDirectory)
    console.log(
      `桌面端生产依赖已收敛：删除 ${desktopMetrics.removedFiles} 个构建文件，${desktopMetrics.removedBytes} bytes`
    )

    const esbuildBinary = resolveEsbuildBinary(descriptor)
    mkdirSync(deviceCardBuilderDirectory, { recursive: true })
    const packagedEsbuild = join(
      deviceCardBuilderDirectory,
      descriptor.hostPlatform === 'win32' ? 'esbuild.exe' : 'esbuild'
    )
    copyFileSync(esbuildBinary, packagedEsbuild)
    if (descriptor.hostPlatform !== 'win32') chmodSync(packagedEsbuild, 0o755)
    const builderArgs = [
      targetPlatform === 'linux-64' ? '--linux' : '--win',
      targetPlatform === 'linux-64' ? 'AppImage' : 'nsis',
      '--x64',
      '--publish',
      'never',
      `--config.directories.output=${outputDirectory}`
    ]
    runCommand(process.execPath, [
      join(
        workbenchDirectory,
        'node_modules',
        'electron-builder',
        'out',
        'cli',
        'cli.js'
      ),
      ...builderArgs
    ], workbenchDirectory, process.env)

    const resources = join(
      outputDirectory,
      targetPlatform === 'linux-64' ? 'linux-unpacked' : 'win-unpacked',
      'resources'
    )
    validatePackagedWorkbenchResources(resources, descriptor.nodeName)
    validatePackagedRuntimeResources(resources, targetPlatform)
    validateBundledAgentPayload(
      resources,
      descriptor.hostPlatform,
      descriptor.hostArchitecture
    )
    const installer = findInstaller(outputDirectory, targetPlatform)
    mkdirSync(releaseDirectory, { recursive: true })
    for (const name of artifactNames(outputDirectory, targetPlatform)) {
      copyFileSync(join(outputDirectory, name), join(releaseDirectory, name))
    }
    console.log(
      `${targetPlatform} Workbench 安装包已发布：${join(releaseDirectory, basename(installer.path))}`
    )
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
    rmSync(packagingDirectory, { recursive: true, force: true })
  }
}

export function removeDesktopDeploymentSelfLink(deploymentDirectory) {
  const selfLink = join(
    deploymentDirectory,
    'node_modules',
    '.pnpm',
    'node_modules',
    '@unilab',
    'desktop'
  )
  if (!existsSync(selfLink)) return false
  if (!lstatSync(selfLink).isSymbolicLink()) {
    throw new Error(`桌面端生产依赖中的工作区自链接不是符号链接：${selfLink}`)
  }
  rmSync(selfLink, { recursive: true, force: true })
  return true
}

export function pruneDesktopDeployment(deploymentDirectory) {
  const nodeModules = join(deploymentDirectory, 'node_modules')
  if (!existsSync(nodeModules)) {
    throw new Error(`桌面端生产依赖目录不存在：${nodeModules}`)
  }
  const removedSelfLink = removeDesktopDeploymentSelfLink(deploymentDirectory)
  let removedFiles = 0
  let removedBytes = 0
  const executableDirectory = join(nodeModules, '.bin')
  const esbuildLaunchers = existsSync(executableDirectory)
    ? readdirSync(executableDirectory)
      .filter(name => name === 'esbuild' || name.startsWith('esbuild.'))
      .map(name => join(executableDirectory, name))
    : []
  for (const unreachablePath of [
    join(nodeModules, '@esbuild'),
    join(nodeModules, 'esbuild', 'bin'),
    ...esbuildLaunchers,
    join(
      nodeModules,
      '@vue',
      'compiler-sfc',
      'dist',
      'compiler-sfc.esm-browser.js'
    )
  ]) {
    const pathMetrics = removeDeploymentPath(unreachablePath)
    removedFiles += pathMetrics.removedFiles
    removedBytes += pathMetrics.removedBytes
  }
  const buildOnlyMetrics = pruneDesktopBuildOnlyFiles(nodeModules)
  return {
    removedSelfLink,
    removedFiles: removedFiles + buildOnlyMetrics.removedFiles,
    removedBytes: removedBytes + buildOnlyMetrics.removedBytes
  }
}

function removeDeploymentPath(path) {
  let entry
  try {
    entry = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return { removedFiles: 0, removedBytes: 0 }
    throw error
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    rmSync(path, { force: true })
    return { removedFiles: 1, removedBytes: entry.size }
  }
  let removedFiles = 0
  let removedBytes = 0
  for (const child of readdirSync(path)) {
    const childMetrics = removeDeploymentPath(join(path, child))
    removedFiles += childMetrics.removedFiles
    removedBytes += childMetrics.removedBytes
  }
  rmSync(path, { recursive: true, force: true })
  return { removedFiles, removedBytes }
}

function pruneDesktopBuildOnlyFiles(directory) {
  let removedFiles = 0
  let removedBytes = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      const childMetrics = pruneDesktopBuildOnlyFiles(entryPath)
      removedFiles += childMetrics.removedFiles
      removedBytes += childMetrics.removedBytes
    } else if (/\.(?:map|d\.ts|d\.mts|d\.cts|flow|tsbuildinfo)$/u.test(entry.name)) {
      removedBytes += lstatSync(entryPath).size
      rmSync(entryPath, { force: true })
      removedFiles += 1
    }
  }
  return { removedFiles, removedBytes }
}

function prepareNodeRuntime(descriptor, destination, packagingDirectory) {
  const cacheDirectory = join(homedir(), '.unilab-workbench', 'downloads')
  const archivePath = join(cacheDirectory, descriptor.archive)
  mkdirSync(cacheDirectory, { recursive: true })
  if (!hasExpectedSha256(archivePath, descriptor.sha256)) {
    rmSync(archivePath, { force: true })
    runCommand('curl', [
      '-fL',
      '--retry',
      '3',
      `https://nodejs.org/dist/v${PORTABLE_NODE_VERSION}/${descriptor.archive}`,
      '-o',
      archivePath
    ])
  }
  if (!hasExpectedSha256(archivePath, descriptor.sha256)) {
    throw new Error(`Node ${PORTABLE_NODE_VERSION} runtime SHA-256 校验失败。`)
  }
  const binaryDirectory = join(destination, 'bin')
  mkdirSync(binaryDirectory, { recursive: true })
  if (descriptor.hostPlatform === 'linux') {
    runCommand('tar', [
      '-xJf',
      archivePath,
      '-C',
      binaryDirectory,
      '--strip-components=2',
      `node-v${PORTABLE_NODE_VERSION}-linux-x64/bin/node`
    ])
  } else {
    const extractionDirectory = join(packagingDirectory, 'node-extracted')
    mkdirSync(extractionDirectory, { recursive: true })
    // Windows ships bsdtar as tar.exe. Passing the archive path directly
    // avoids powershell.exe -Command consuming trailing arguments before the
    // script can read them from $args.
    runCommand('tar.exe', [
      '-xf',
      archivePath,
      '-C',
      extractionDirectory
    ])
    copyFileSync(
      join(
        extractionDirectory,
        `node-v${PORTABLE_NODE_VERSION}-win-x64`,
        'node.exe'
      ),
      join(binaryDirectory, 'node.exe')
    )
  }
  const binaryPath = join(binaryDirectory, descriptor.nodeName)
  const version = spawnSync(binaryPath, ['--version'], { encoding: 'utf8' })
  if (version.status !== 0 || version.stdout.trim() !== `v${PORTABLE_NODE_VERSION}`) {
    throw new Error(`Node backend runtime 不可执行：${binaryPath}`)
  }
}

function resolveEsbuildBinary(descriptor) {
  const executable = descriptor.hostPlatform === 'win32'
    ? 'esbuild.exe'
    : 'esbuild'
  const workbenchManifest = JSON.parse(readFileSync(
    join(workbenchDirectory, 'package.json'),
    'utf8'
  ))
  const esbuildVersion = workbenchManifest.devDependencies?.esbuild
  if (typeof esbuildVersion !== 'string' || esbuildVersion.length === 0) {
    throw new Error('Workbench 未声明 esbuild 版本')
  }
  const binary = join(
    repositoryDirectory,
    'node_modules',
    '.pnpm',
    `@esbuild+${descriptor.esbuildPackage}@${esbuildVersion}`,
    'node_modules',
    '@esbuild',
    descriptor.esbuildPackage,
    ...(descriptor.hostPlatform === 'win32' ? [] : ['bin']),
    executable
  )
  if (!existsSync(binary)) throw new Error(`缺少目标平台 esbuild：${binary}`)
  return binary
}

function validatePackagedWorkbenchResources(resources, nodeName) {
  const required = [
    join(resources, 'app.asar'),
    join(resources, 'workbench', 'lib', 'backend', 'main.js'),
    join(resources, 'workbench', 'lib', 'frontend', 'index.html'),
    join(resources, 'workbench', 'plugins'),
    join(resources, 'node-runtime', 'bin', nodeName),
    join(resources, 'desktop', 'out', 'main', 'index.js'),
    join(resources, 'desktop', 'out', 'preload', 'index.js'),
    join(
      resources,
      'device-card-builder',
      process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'
    ),
    join(resources, 'device-card-agent', 'cli.mjs'),
    join(resources, 'workspace-skills', 'manifest.json'),
    join(resources, 'workspace-skills', 'add-device', 'SKILL.md'),
    join(resources, 'workspace-skills', 'add-resource', 'SKILL.md'),
    join(resources, 'workspace-skills', 'add-workstation', 'SKILL.md'),
    join(resources, 'workspace-skills', 'create-device-package', 'SKILL.md'),
    join(resources, 'workspace-skills', 'create-device-skill', 'SKILL.md'),
    join(
      resources,
      'workspace-skills',
      'unilab-domain-repo-builder',
      'SKILL.md'
    )
  ]
  const missing = required.filter(path => !existsSync(path))
  if (missing.length) {
    throw new Error(`Workbench 安装包缺少运行资源：${missing.join(', ')}`)
  }
}

function findInstaller(outputDirectory, targetPlatform) {
  const matcher = targetPlatform === 'linux-64'
    ? /\.AppImage$/iu
    : /-setup\.exe$/iu
  const candidates = readdirSync(outputDirectory)
    .filter(name => matcher.test(name))
    .map(name => join(outputDirectory, name))
  if (candidates.length !== 1) {
    throw new Error(`Workbench 安装包数量异常：${candidates.length}`)
  }
  const path = candidates[0]
  const size = statSync(path).size
  if (size < MIN_INSTALLER_BYTES) {
    throw new Error(`Workbench 安装包不完整：${basename(path)} 仅 ${size} bytes`)
  }
  const expected = targetPlatform === 'linux-64'
    ? Buffer.from([0x7f, 0x45, 0x4c, 0x46])
    : Buffer.from('MZ')
  const actual = Buffer.alloc(expected.length)
  const descriptor = openSync(path, 'r')
  try {
    readSync(descriptor, actual, 0, actual.length, 0)
  } finally {
    closeSync(descriptor)
  }
  if (!actual.equals(expected)) throw new Error(`安装包文件头无效：${path}`)
  return { path, size }
}

function artifactNames(outputDirectory, targetPlatform) {
  const matcher = targetPlatform === 'linux-64'
    ? /(?:\.AppImage(?:\.blockmap)?|latest-linux\.yml)$/iu
    : /(?:-setup\.exe(?:\.blockmap)?|latest\.yml)$/iu
  return readdirSync(outputDirectory).filter(name => matcher.test(name))
}

function hasExpectedSha256(path, expected) {
  if (!existsSync(path)) return false
  return createHash('sha256').update(readFileSync(path)).digest('hex') === expected
}

function runCommand(
  command,
  args,
  cwd = workbenchDirectory,
  environment = process.env,
  options = {}
) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
    shell: options.shell ?? false
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(command)} 执行失败，退出码 ${String(result.status)}`)
  }
}
