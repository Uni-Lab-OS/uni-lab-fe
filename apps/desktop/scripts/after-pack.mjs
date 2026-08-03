import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const MACOS_ELECTRON_LANGUAGES = new Set([
  'en.lproj',
  'zh_CN.lproj'
])

export async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appDirectory = (await readdir(context.appOutDir, {
    withFileTypes: true
  })).find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
  if (!appDirectory) {
    throw new Error(`macOS .app 不存在：${context.appOutDir}`)
  }

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
}
