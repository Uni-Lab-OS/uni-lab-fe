import { access, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'electron-vite'

const desktopDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = join(desktopDirectory, 'out')

// Workbench renders Theia from its loopback server. The Kernel Web renderer is
// neither loaded nor packaged by this shell, so do not spend time or disk space
// building it for `pnpm workbench:desktop`.
await rm(join(outputDirectory, 'renderer'), { recursive: true, force: true })
await build({
  root: desktopDirectory,
  mode: 'workbench-shell',
  // The missing renderer is intentional for this loopback-hosted surface.
  ignoreConfigWarning: true
})
await Promise.all([
  access(join(outputDirectory, 'main', 'index.js')),
  access(join(outputDirectory, 'preload', 'index.js')),
  access(join(outputDirectory, 'preload', 'deviceCard.js'))
])

const mainSource = await readFile(
  join(outputDirectory, 'main', 'index.js'),
  'utf8'
)
for (const optionalTemplateEngine of ['velocityjs', 'dustjs-linkedin']) {
  if (mainSource.includes(`require("${optionalTemplateEngine}")`)) {
    throw new Error(
      `Workbench 主进程错误绑定了可选模板引擎：${optionalTemplateEngine}`
    )
  }
}
