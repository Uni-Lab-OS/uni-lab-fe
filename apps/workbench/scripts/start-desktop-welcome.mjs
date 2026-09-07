import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workbenchDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const workbenchRequire = createRequire(path.join(workbenchDirectory, 'package.json'))
const electronExecutable = workbenchRequire('electron')
const desktopEnvironment = { ...process.env }
delete desktopEnvironment.ELECTRON_RUN_AS_NODE

const child = spawn(electronExecutable, [workbenchDirectory, ...process.argv.slice(2)], {
  cwd: workbenchDirectory,
  env: desktopEnvironment,
  stdio: 'inherit'
})

child.once('error', error => {
  console.error(`[UniLab Workbench] Electron failed: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', code => {
  process.exit(code ?? 0)
})
