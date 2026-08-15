import { spawnSync } from 'node:child_process'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MACOS_ELECTRON_LANGUAGES = new Set([
  'en.lproj',
  'zh_CN.lproj'
])

const ADHOC_SIGNING_ENVIRONMENT = 'UNILAB_WORKBENCH_ADHOC_SIGN'
const MACOS_ENTITLEMENTS = fileURLToPath(
  new URL('../../workbench/build/entitlements.mac.plist', import.meta.url)
)

export async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    await removePackagedDesktopSelfLinkFromResources(join(
      context.appOutDir,
      'resources'
    ))
    return
  }

  const appDirectory = (await readdir(context.appOutDir, {
    withFileTypes: true
  })).find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
  if (!appDirectory) {
    throw new Error(`macOS .app 不存在：${context.appOutDir}`)
  }
  const appPath = join(context.appOutDir, appDirectory.name)

  const frameworkResources = join(
    context.appOutDir,
    appDirectory.name,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  )
  const entries = await readdir(frameworkResources, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    if (
      !entry.isDirectory()
      || !entry.name.endsWith('.lproj')
      || MACOS_ELECTRON_LANGUAGES.has(entry.name)
    ) {
      return
    }
    await rm(join(frameworkResources, entry.name), {
      recursive: true,
      force: true
    })
  }))

  await removePackagedDesktopSelfLink(appPath)

  if (process.env[ADHOC_SIGNING_ENVIRONMENT] === '1') {
    adHocSignApplication(appPath)
  }
}

export async function removePackagedDesktopSelfLink(appPath) {
  await removePackagedDesktopSelfLinkFromResources(join(
    appPath,
    'Contents',
    'Resources'
  ))
}

export async function removePackagedDesktopSelfLinkFromResources(resourcesPath) {
  await rm(join(
    resourcesPath,
    'desktop',
    'node_modules',
    '.pnpm',
    'node_modules',
    '@unilab',
    'desktop'
  ), { recursive: true, force: true })
}

export function adHocSignApplication(appPath) {
  runCodeSign([
    '--force',
    '--deep',
    '--sign',
    '-',
    '--timestamp=none',
    '--options',
    'runtime',
    '--entitlements',
    MACOS_ENTITLEMENTS,
    appPath
  ], 'Workbench ad-hoc 签名失败')
  runCodeSign([
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    appPath
  ], 'Workbench ad-hoc 严格验签失败')
}

function runCodeSign(args, message) {
  const result = spawnSync('codesign', args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${message}，codesign 退出码 ${result.status}`)
  }
}
