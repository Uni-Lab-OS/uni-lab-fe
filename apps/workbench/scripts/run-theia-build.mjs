import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { theiaBuildEnvironment } from './theia-build-environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workbenchDirectory = path.resolve(scriptDirectory, '..')
const workbenchRequire = createRequire(path.join(workbenchDirectory, 'package.json'))
const theiaCli = workbenchRequire.resolve('@theia/cli/bin/theia.js')
const child = spawn(process.execPath, [
  theiaCli,
  'build',
  ...process.argv.slice(2)
], {
  cwd: workbenchDirectory,
  env: theiaBuildEnvironment(),
  stdio: 'inherit',
  windowsHide: true
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    process.exitCode = signal ? 1 : code ?? 1
    resolve()
  })
})
