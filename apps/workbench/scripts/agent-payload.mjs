import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as asar from '@electron/asar'

export const PINNED_AGENT_DISTRIBUTION_VERSION = '2.1.53'
export const EXTERNAL_ONLY_AGENT_CLIS = ['codex', 'claude']
export const SHARED_AGENT_NODE_ENV = 'UNILAB_AGENT_NODE_BINARY'

const AGENT_RENDERER_PREFIX = '/out/renderer/'

export function normalizeAgentArchiveEntry(entry) {
  return entry.replaceAll('\\', '/')
}

export function resolveAgentTarget(platform, architecture) {
  const key = `${platform}/${architecture}`
  const targets = {
    'darwin/arm64': { directory: 'darwin-arm64', executable: 'aioncore' },
    'darwin/x64': { directory: 'darwin-x64', executable: 'aioncore' },
    'linux/arm64': { directory: 'linux-arm64', executable: 'aioncore' },
    'linux/x64': { directory: 'linux-x64', executable: 'aioncore' },
    'win32/arm64': { directory: 'windows-arm64', executable: 'aioncore.exe' },
    'win32/x64': { directory: 'windows-x64', executable: 'aioncore.exe' }
  }
  const target = targets[key]
  if (!target) throw new Error(`UniLab Agent 不支持目标平台：${key}`)
  return target
}

/** Stage the exact Agent renderer and native core used by the packaged app. */
export function prepareBundledAgentPayload(destination, options = {}) {
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  const sourcePath = resolve(
    options.sourcePath
      ?? process.env['UNILAB_AGENT_DISTRIBUTION']
      ?? defaultAgentDistribution(platform)
  )
  const resources = existsSync(join(sourcePath, 'app.asar'))
    ? sourcePath
    : join(sourcePath, 'Contents', 'Resources')
  const archive = join(resources, 'app.asar')
  const target = resolveAgentTarget(platform, architecture)
  const nativeSource = join(resources, 'bundled-aioncore', target.directory)
  const executableSource = join(nativeSource, target.executable)
  const missing = [archive, executableSource].filter(path => !existsSync(path))
  if (missing.length > 0) {
    throw new Error(
      `UniLab Agent 打包源不完整（${sourcePath}）：${missing.join(', ')}`
    )
  }
  const version = readAgentDistributionVersion(archive)
  if (version !== PINNED_AGENT_DISTRIBUTION_VERSION) {
    throw new Error(
      `UniLab Agent 需要 AionUi ${PINNED_AGENT_DISTRIBUTION_VERSION}，实际为 ${version}`
    )
  }

  rmSync(destination, { recursive: true, force: true })
  mkdirSync(join(destination, 'bundled-aioncore'), { recursive: true })
  createRendererOnlyAgentArchive(archive, join(destination, 'app.asar'))
  cpSync(
    nativeSource,
    join(destination, 'bundled-aioncore', target.directory),
    {
      recursive: true,
      preserveTimestamps: true,
      // macOS code signing rejects package-internal symlinks containing `..`.
      // The pinned Node npm/npx/corepack launchers are the only such links.
      dereference: true
    }
  )
  materializePackageSymlinks(
    nativeSource,
    join(destination, 'bundled-aioncore', target.directory),
    { platform }
  )
  const managedResources = join(
    destination,
    'bundled-aioncore',
    target.directory,
    'managed-resources'
  )
  pruneManagedNodeDevelopmentResources(managedResources)
  if (options.sharedNodeExecutable && platform !== 'win32') {
    replaceManagedNodeWithSharedLauncher(
      managedResources,
      options.sharedNodeVersion
    )
  }
  // Agent CLIs are intentionally never redistributed by UniLab Workbench.
  // Aioncore and its UI remain bundled, while a user-installed CLI may be
  // selected from the host environment at runtime.
  for (const cli of EXTERNAL_ONLY_AGENT_CLIS) {
    rmSync(join(managedResources, 'cli', cli), {
      recursive: true,
      force: true
    })
  }
  rewriteManagedResourcesManifest(managedResources)
  clearMacosDownloadQuarantine(destination, platform)
  writeFileSync(join(destination, 'payload.json'), `${JSON.stringify({
    schemaVersion: 1,
    implementation: 'aioncore',
    sourceProduct: 'AionUi',
    version,
    platform,
    architecture,
    targetDirectory: target.directory,
    executable: target.executable,
    archiveScope: 'renderer-only',
    bundledClis: [],
    externalClis: EXTERNAL_ONLY_AGENT_CLIS
  }, null, 2)}\n`)
  return {
    destination,
    version,
    sourceExecutable: executableSource,
    archive: join(destination, 'app.asar'),
    executable: join(
      destination,
      'bundled-aioncore',
      target.directory,
      target.executable
    )
  }
}

export function createRendererOnlyAgentArchive(
  sourceArchive,
  destinationArchive
) {
  const stagingDirectory = resolve(
    dirname(destinationArchive),
    '.agent-renderer-archive'
  )
  rmSync(stagingDirectory, { recursive: true, force: true })
  mkdirSync(stagingDirectory, { recursive: true })
  try {
    const entries = asar.listPackage(sourceArchive).map(source => ({
      source,
      normalized: normalizeAgentArchiveEntry(source)
    }))
    if (!entries.some(entry =>
      entry.normalized === '/out/renderer/index.html'
    )) {
      throw new Error('Agent app.asar 缺少 out/renderer/index.html')
    }
    const selectedEntries = entries.filter(entry =>
      entry.normalized === '/package.json'
      || entry.normalized.startsWith(AGENT_RENDERER_PREFIX)
    )
    for (const entry of selectedEntries) {
      const relativePath = entry.normalized.slice(1)
      const sourcePath = entry.source.slice(1)
      const destination = resolve(stagingDirectory, relativePath)
      if (
        destination !== stagingDirectory
        && !destination.startsWith(`${stagingDirectory}${sep}`)
      ) {
        throw new Error(`Agent 渲染器归档路径越界：${entry.normalized}`)
      }
      const info = asar.statFile(sourceArchive, sourcePath)
      if ('files' in info) {
        mkdirSync(destination, { recursive: true })
      } else {
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, asar.extractFile(sourceArchive, sourcePath))
      }
    }

    const asarCli = fileURLToPath(import.meta.resolve('@electron/asar/bin/asar.js'))
    const result = spawnSync(process.execPath, [
      asarCli,
      'pack',
      stagingDirectory,
      destinationArchive
    ], { encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      const detail = result.error?.message || result.stderr || result.stdout
      throw new Error(`Agent 渲染器归档打包失败：${detail}`)
    }
    return validateAgentRendererArchive(destinationArchive)
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true })
  }
}

export function validateAgentRendererArchive(archive) {
  const entries = asar.listPackage(archive).map(normalizeAgentArchiveEntry)
  const required = ['/package.json', '/out/renderer/index.html']
  const missing = required.filter(entry => !entries.includes(entry))
  if (!entries.some(entry => entry.startsWith('/out/renderer/assets/'))) {
    missing.push('/out/renderer/assets/*')
  }
  if (missing.length > 0) {
    throw new Error(`Agent 渲染器归档缺少运行文件：${missing.join(', ')}`)
  }
  const allowedDirectories = new Set(['/out', '/out/renderer'])
  const forbidden = entries.filter(entry =>
    entry !== '/package.json'
    && !allowedDirectories.has(entry)
    && !entry.startsWith(AGENT_RENDERER_PREFIX)
  )
  if (forbidden.length > 0) {
    throw new Error(`Agent 渲染器归档误含不可达文件：${forbidden[0]}`)
  }
  return { path: archive, entries: entries.length }
}

/** Reuse Workbench's signed Node binary while retaining Agent's npm modules. */
function replaceManagedNodeWithSharedLauncher(managedResources, version) {
  const manifestPath = join(managedResources, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const nodeRoot = join(managedResources, String(manifest.node?.root || ''))
  const executable = join(nodeRoot, String(manifest.node?.executable || 'bin/node'))
  writeFileSync(executable, `#!/bin/sh
shared_node=\${${SHARED_AGENT_NODE_ENV}:-}
if [ -z "$shared_node" ] || [ ! -x "$shared_node" ]; then
  echo "UniLab shared Agent Node runtime is unavailable" >&2
  exit 127
fi
exec "$shared_node" "$@"
`)
  chmodSync(executable, 0o755)
  if (version) {
    manifest.node.version = version
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
}

/** Remove build-time Node resources that are not needed by Agent or npm/npx. */
function pruneManagedNodeDevelopmentResources(managedResources) {
  const manifestPath = join(managedResources, 'manifest.json')
  if (!existsSync(manifestPath)) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const nodeRoot = join(managedResources, String(manifest.node?.root || ''))
  for (const relativePath of [
    'include',
    'share',
    'CHANGELOG.md',
    'README.md'
  ]) {
    rmSync(join(nodeRoot, relativePath), { recursive: true, force: true })
  }
}

function clearMacosDownloadQuarantine(destination, platform) {
  if (platform !== 'darwin') return
  for (const attribute of [
    'com.apple.quarantine',
    'com.apple.provenance'
  ]) {
    spawnSync('xattr', ['-dr', attribute, destination], {
      stdio: 'ignore'
    })
  }
}

function materializePackageSymlinks(
  sourceDirectory,
  destinationDirectory,
  options,
  roots = { source: sourceDirectory, destination: destinationDirectory }
) {
  for (const name of readdirSync(sourceDirectory)) {
    const source = join(sourceDirectory, name)
    const destination = join(destinationDirectory, name)
    const sourceStat = lstatSync(source)
    if (sourceStat.isSymbolicLink()) {
      unlinkSync(destination)
      const resolvedSource = realpathSync(source)
      if (isManagedNodeJsLauncher(source, resolvedSource, options.platform)) {
        const resolvedDestination = join(
          roots.destination,
          relative(roots.source, resolvedSource)
        )
        const targetFromLauncher = relative(
          dirname(destination),
          resolvedDestination
        )
        writeFileSync(
          destination,
          posixManagedNodeLauncher(targetFromLauncher)
        )
        chmodSync(destination, 0o755)
      } else {
        cpSync(resolvedSource, destination, {
          recursive: true,
          preserveTimestamps: true,
          dereference: true
        })
      }
    } else if (sourceStat.isDirectory()) {
      materializePackageSymlinks(source, destination, options, roots)
    }
  }
}

function isManagedNodeJsLauncher(source, resolvedSource, platform) {
  return platform !== 'win32'
    && ['npm', 'npx', 'corepack'].includes(basename(source))
    && basename(dirname(source)) === 'bin'
    && resolvedSource.endsWith('.js')
}

function posixManagedNodeLauncher(targetFromLauncher) {
  if (!/^[A-Za-z0-9._/+\-]+$/u.test(targetFromLauncher)) {
    throw new Error(`Agent Node launcher 目标路径无效：${targetFromLauncher}`)
  }
  return `#!/bin/sh
launcher_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$launcher_dir/node" "$launcher_dir/${targetFromLauncher}" "$@"
`
}

export function validateBundledAgentPayload(
  resources,
  platform = process.platform,
  architecture = process.arch
) {
  const target = resolveAgentTarget(platform, architecture)
  const root = join(resources, 'agent-runtime')
  const archive = join(root, 'app.asar')
  const executable = join(
    root,
    'bundled-aioncore',
    target.directory,
    target.executable
  )
  const missing = [archive, executable, join(root, 'payload.json')]
    .filter(path => !existsSync(path))
  if (missing.length > 0) {
    throw new Error(`Workbench 安装包缺少 Agent 运行资源：${missing.join(', ')}`)
  }
  const version = readAgentDistributionVersion(archive)
  if (version !== PINNED_AGENT_DISTRIBUTION_VERSION) {
    throw new Error(`Workbench Agent 版本错误：${version}`)
  }
  validateAgentRendererArchive(archive)
  const payloadManifest = JSON.parse(readFileSync(
    join(root, 'payload.json'),
    'utf8'
  ))
  if (payloadManifest.archiveScope !== 'renderer-only') {
    throw new Error('Workbench Agent 载荷未声明 renderer-only 归档范围')
  }
  for (const cli of EXTERNAL_ONLY_AGENT_CLIS) {
    const forbiddenPath = join(
      root,
      'bundled-aioncore',
      target.directory,
      'managed-resources',
      'cli',
      cli
    )
    if (existsSync(forbiddenPath)) {
      throw new Error(`Workbench 安装包不得内置 ${cli}：${forbiddenPath}`)
    }
  }
  validateManagedNodeLaunchers(join(
    root,
    'bundled-aioncore',
    target.directory,
    'managed-resources'
  ), platform)
  return { root, archive, executable, version }
}

function validateManagedNodeLaunchers(managedResources, platform) {
  const manifestPath = join(managedResources, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const nodeRoot = join(managedResources, String(manifest.node?.root || ''))
  const launchers = platform === 'win32'
    ? ['npm.cmd', 'npx.cmd'].map(name => join(nodeRoot, name))
    : ['npm', 'npx'].map(name => join(nodeRoot, 'bin', name))
  for (const launcher of launchers) {
    if (!existsSync(launcher)) {
      throw new Error(`Workbench Agent Node launcher 缺失：${launcher}`)
    }
    const result = spawnSync(launcher, ['--version'], {
      encoding: 'utf8',
      shell: platform === 'win32'
    })
    if (result.error || result.status !== 0) {
      const detail = result.error?.message || result.stderr || result.stdout
      throw new Error(
        `Workbench Agent Node launcher 无法运行：${launcher}\n${detail}`
      )
    }
  }
}

function rewriteManagedResourcesManifest(managedResources) {
  const manifestPath = join(managedResources, 'manifest.json')
  if (!existsSync(manifestPath)) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.clis = []
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function readAgentDistributionVersion(archive) {
  let manifest
  try {
    manifest = JSON.parse(
      asar.extractFile(archive, 'package.json').toString('utf8')
    )
  } catch (error) {
    throw new Error(`Agent app.asar 清单无效：${basename(archive)}`, {
      cause: error
    })
  }
  if (!manifest || typeof manifest.version !== 'string') {
    throw new Error('Agent app.asar 缺少版本号')
  }
  return manifest.version.trim()
}

function defaultAgentDistribution(platform) {
  if (platform === 'darwin') return '/Applications/AionUi.app'
  throw new Error(
    '请用 UNILAB_AGENT_DISTRIBUTION 指定目标平台 AionUi 2.1.53 分发目录'
  )
}
