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
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  prepareRuntimePayloadFromEnvironment,
  validatePackagedRuntimeResources
} from '../../desktop/scripts/runtime-payload.mjs'
import {
  prepareBundledAgentPayload,
  validateBundledAgentPayload
} from './agent-payload.mjs'
import {
  requireWorkbenchUpdateUrl,
  selectPortableUpdateArtifacts
} from './update-publish.mjs'
import {
  createPackagedResourceReport,
  logPackagedResourceReport
} from './package-size-report.mjs'
import {
  allowsOversizePackagingBenchmark,
  resolveWindowsPrecompressedProfile,
  resolveWorkbenchPackageMode
} from './packaging-mode.mjs'

const MEBIBYTE = 1024 * 1024
const MIN_INSTALLER_BYTES = 50 * MEBIBYTE
export const MAX_PORTABLE_INSTALLER_BYTES = 850 * MEBIBYTE
export const PORTABLE_NODE_VERSION = '24.14.0'
export const PORTABLE_COMPRESSION_LEVELS = Object.freeze(['normal', 'maximum'])
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

/**
 * 构建当前主机对应的 portable Workbench，并生成可验证的安装器与更新元数据。
 * @param {string} targetPlatform portable 目标平台标识。
 * @returns {{mode: string, applicationDirectory: string, releaseDirectory?: string}} 已校验的应用目录与可选发布目录。
 * @throws {Error} 目标平台不匹配、资源不完整或安装器违反发布合同时抛出。
 */
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
  const updateUrl = requireWorkbenchUpdateUrl()
  const packageMode = resolveWorkbenchPackageMode(
    process.env['UNILAB_WORKBENCH_PACKAGE_MODE']
  )
  const compression = resolvePortableCompressionLevel(
    process.env['UNILAB_WORKBENCH_COMPRESSION']
  )
  const precompressedProfile = targetPlatform === 'win-64'
    ? resolveWindowsPrecompressedProfile(
      process.env['UNILAB_WORKBENCH_PRECOMPRESSED_PROFILE']
    )
    : { name: 'none', extensions: [] }

  const packagingDirectory = join(workbenchDirectory, '.packaging')
  const runtimePayloadDirectory = join(packagingDirectory, 'runtime-installer')
  const desktopRuntimeDirectory = join(packagingDirectory, 'desktop-runtime')
  const nodeRuntimeDirectory = join(packagingDirectory, 'node-runtime')
  const agentPayloadDirectory = join(packagingDirectory, 'agent-runtime')
  const deviceCardBuilderDirectory = join(
    packagingDirectory,
    'device-card-builder'
  )
  const releaseDirectory = assertSafeChildDirectory(
    resolve(
      workbenchDirectory,
      process.env['UNILAB_WORKBENCH_RELEASE_DIRECTORY']
        || (targetPlatform === 'linux-64' ? 'release-linux' : 'release-windows')
    ),
    workbenchDirectory,
    'Workbench 发布目录'
  )
  const configuredOutputDirectory = process.env[
    'UNILAB_WORKBENCH_OUTPUT_DIRECTORY'
  ]
  const outputDirectory = configuredOutputDirectory
    ? assertSafeChildDirectory(
      resolve(workbenchDirectory, configuredOutputDirectory),
      join(repositoryDirectory, '.ci-prepackaged'),
      'Workbench 基准输出目录'
    )
    : mkdtempSync(join(
      tmpdir(),
      targetPlatform === 'linux-64'
        ? 'unilab-workbench-linux-'
        : 'unilab-workbench-windows-'
    ))
  const keepOutputDirectory = Boolean(configuredOutputDirectory)
  const prepackagedApplication = packageMode === 'prepackaged'
    ? resolvePrepackagedApplication(targetPlatform)
    : undefined
  if (keepOutputDirectory) {
    rmSync(outputDirectory, { recursive: true, force: true })
    mkdirSync(outputDirectory, { recursive: true })
  }
  rmSync(packagingDirectory, { recursive: true, force: true })
  if (packageMode !== 'prepackaged') {
    mkdirSync(packagingDirectory, { recursive: true })
  }
  try {
    if (packageMode !== 'prepackaged') {
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
    }
    const builderArgs = [
      targetPlatform === 'linux-64' ? '--linux' : '--win',
      ...(packageMode === 'directory'
        ? ['--dir']
        : [targetPlatform === 'linux-64' ? 'AppImage' : 'nsis']),
      '--x64',
      '--publish',
      'never',
      `--config.directories.output=${outputDirectory}`,
      `--config.compression=${compression}`
    ]
    if (prepackagedApplication) {
      builderArgs.push('--prepackaged', prepackagedApplication)
    }
    if (precompressedProfile.extensions.length > 0) {
      builderArgs.push(
        `--config.nsis.preCompressedFileExtensions=${precompressedProfile.extensions.join(',')}`
      )
    }
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
    ], workbenchDirectory, {
      ...process.env,
      UNILAB_WORKBENCH_UPDATE_URL: updateUrl
    })

    const applicationDirectory = prepackagedApplication || join(
      outputDirectory,
      targetPlatform === 'linux-64' ? 'linux-unpacked' : 'win-unpacked'
    )
    const resources = join(applicationDirectory, 'resources')
    validatePackagedWorkbenchResources(resources, descriptor.nodeName)
    validatePackagedRuntimeResources(resources, targetPlatform)
    validateBundledAgentPayload(
      resources,
      descriptor.hostPlatform,
      descriptor.hostArchitecture
    )
    const resourceReport = createPackagedResourceReport(resources)
    logPackagedResourceReport(resourceReport)
    if (packageMode === 'directory') {
      console.log(
        `${targetPlatform} Workbench 非压缩应用目录已通过校验：${applicationDirectory}`
      )
      return { mode: packageMode, applicationDirectory }
    }
    const installer = findInstaller(
      outputDirectory,
      targetPlatform,
      allowsOversizePackagingBenchmark()
    )
    const artifacts = selectPortableUpdateArtifacts(
      readdirSync(outputDirectory),
      targetPlatform
    )
    rmSync(releaseDirectory, { recursive: true, force: true })
    mkdirSync(releaseDirectory, { recursive: true })
    for (const name of artifacts) {
      copyFileSync(join(outputDirectory, name), join(releaseDirectory, name))
    }
    writeFileSync(
      join(releaseDirectory, 'package-size-report.json'),
      `${JSON.stringify({
        ...resourceReport,
        targetPlatform,
        compression,
        packageMode,
        precompressedProfile: precompressedProfile.name,
        preCompressedFileExtensions: precompressedProfile.extensions,
        installerBytes: installer.size
      }, null, 2)}\n`
    )
    console.log(
      `${targetPlatform} Workbench 安装包已发布：${join(releaseDirectory, basename(installer.path))}`
    )
    return { mode: packageMode, applicationDirectory, releaseDirectory }
  } finally {
    if (!keepOutputDirectory) {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
    rmSync(packagingDirectory, { recursive: true, force: true })
  }
}

/**
 * 将会被递归清理的目录限制在专用父目录内，阻止配置误删工作区或系统路径。
 * @param {string} directory 待清理或重建的目录。
 * @param {string} allowedRoot 允许范围的专用父目录。
 * @param {string} label 错误消息中的目录用途。
 * @returns {string} 已确认位于专用父目录内的绝对路径。
 * @throws {Error} 目录等于父目录、逃逸父目录或使用不可比较路径时抛出。
 */
export function assertSafeChildDirectory(directory, allowedRoot, label) {
  const relativePath = relative(resolve(allowedRoot), resolve(directory))
  if (
    relativePath.length === 0
    || relativePath === '..'
    || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error(`${label} 必须位于专用目录 ${resolve(allowedRoot)} 内。`)
  }
  return resolve(directory)
}

/**
 * 解析并校验 electron-builder 复用的预构建应用目录。
 * @param {string} targetPlatform portable 目标平台标识。
 * @returns {string} 可直接生成介质的绝对应用目录。
 * @throws {Error} 环境变量缺失、目录不存在或平台不支持时抛出。
 */
function resolvePrepackagedApplication(targetPlatform) {
  if (targetPlatform !== 'win-64') {
    throw new Error('预构建介质复用目前只支持 Windows x64。')
  }
  const configured = process.env['UNILAB_WORKBENCH_PREPACKAGED_APP']
  if (!configured) {
    throw new Error('预构建模式缺少 UNILAB_WORKBENCH_PREPACKAGED_APP。')
  }
  const applicationDirectory = resolve(workbenchDirectory, configured)
  if (!existsSync(join(applicationDirectory, 'resources'))) {
    throw new Error(`预构建 Workbench 应用目录无效：${applicationDirectory}`)
  }
  return applicationDirectory
}

/**
 * 解析 portable 安装包压缩级别，只接受经过 CI 基准验证的有限集合。
 * @param {string | undefined} value 环境变量传入的候选压缩级别；省略时使用正式默认值。
 * @returns {'normal' | 'maximum'} electron-builder 可接受的压缩级别。
 * @throws {Error} 候选值不在允许集合中时抛出，避免静默生成不可比较的安装包。
 */
export function resolvePortableCompressionLevel(value) {
  const compression = value?.trim() || 'normal'
  if (!PORTABLE_COMPRESSION_LEVELS.includes(compression)) {
    throw new Error(
      `不支持的 Workbench 压缩级别：${compression}；仅支持 ${PORTABLE_COMPRESSION_LEVELS.join('、')}`
    )
  }
  return compression
}

/**
 * 删除 pnpm deploy 指回桌面应用源码目录的自链接，避免打包器递归复制开发依赖。
 * @param {string} deploymentDirectory 桌面端生产依赖的临时部署目录。
 * @returns {boolean} 是否删除了自链接。
 */
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
  rmSync(selfLink, { force: true })
  return true
}

/**
 * 收敛桌面端生产依赖，只保留运行时可达文件与由独立路径提供的原生工具。
 * @param {string} deploymentDirectory 桌面端生产依赖的部署目录。
 * @returns {{removedSelfLink: boolean, removedFiles: number, removedBytes: number}} 裁剪结果。
 */
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
      .filter((name) => name === 'esbuild' || name.startsWith('esbuild.'))
      .map((name) => join(executableDirectory, name))
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

/**
 * 删除单个不可达路径，并统计其中实际移除的文件与字节。
 * @param {string} path 待删除的文件、链接或目录。
 * @returns {{removedFiles: number, removedBytes: number}} 删除统计。
 */
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

/**
 * 递归删除生产运行时不读取的源码映射和类型声明。
 * @param {string} directory 当前扫描目录。
 * @returns {{removedFiles: number, removedBytes: number}} 删除的文件数与字节数。
 */
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

/**
 * 解析并校验设备卡构建器使用的目标平台 esbuild 二进制。
 * @param {{hostPlatform: string, esbuildPackage: string}} descriptor 平台归档描述。
 * @returns {string} 与设备卡构建器 API 版本一致的可执行文件路径。
 * @throws {Error} 清单缺少版本、二进制缺失或二进制版本不一致时抛出。
 */
export function resolveEsbuildBinary(descriptor) {
  const executable = descriptor.hostPlatform === 'win32'
    ? 'esbuild.exe'
    : 'esbuild'
  const deviceCardBuilderManifest = JSON.parse(readFileSync(
    join(repositoryDirectory, 'packages', 'device-card-builder', 'package.json'),
    'utf8'
  ))
  const esbuildVersion = deviceCardBuilderManifest.dependencies?.esbuild
  if (typeof esbuildVersion !== 'string' || esbuildVersion.length === 0) {
    throw new Error('设备卡构建器未声明 esbuild 版本')
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
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8' })
  if (version.status !== 0 || version.stdout.trim() !== esbuildVersion) {
    throw new Error(
      `设备卡构建器 esbuild 版本不一致：需要 ${esbuildVersion}，实际 ${version.stdout.trim() || '不可执行'}`
    )
  }
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
  const forbiddenDesktopWorkspace = join(
    resources,
    'desktop',
    'node_modules',
    '.pnpm',
    'node_modules',
    '@unilab',
    'desktop'
  )
  if (existsSync(forbiddenDesktopWorkspace)) {
    throw new Error(
      `Workbench 安装包误含桌面端开发工作区：${forbiddenDesktopWorkspace}`
    )
  }
}

/**
 * 查找并校验 portable Workbench 的唯一安装器及体积预算。
 * @param {string} outputDirectory electron-builder 的输出目录。
 * @param {string} targetPlatform portable 目标平台标识。
 * @param {boolean} allowOversize 是否允许隔离基准临时超过正式体积预算。
 * @returns {{path: string, size: number}} 已通过文件头与体积校验的安装器。
 * @throws {Error} 安装器缺失、重复、不完整、超出预算或文件头无效时抛出。
 */
function findInstaller(outputDirectory, targetPlatform, allowOversize = false) {
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
  if (!allowOversize && size > MAX_PORTABLE_INSTALLER_BYTES) {
    throw new Error(
      `Workbench 安装包超出 850 MiB 预算：${basename(path)} 为 ${size} bytes`
    )
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
