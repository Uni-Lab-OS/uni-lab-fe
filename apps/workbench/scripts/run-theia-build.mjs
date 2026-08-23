import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
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

async function normalizeContainerModuleInterop() {
  const bundlePath = path.join(workbenchDirectory, 'lib', 'frontend', 'bundle.js')
  const bundle = await readFile(bundlePath, 'utf8')
  const original = 'container.load(containerModule.default)'
  const normalized = 'container.load(containerModule.default?.registry ? containerModule.default : containerModule.default?.default)'
  if (!bundle.includes(original)) {
    throw new Error('Theia frontend container-module loader was not found in bundle.js')
  }
  await writeFile(bundlePath, bundle.replaceAll(original, normalized))
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}

const buildExitCode = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    resolve(signal ? 1 : code ?? 1)
  })
})

if (buildExitCode === 0) {
  await normalizeContainerModuleInterop()
} else {
  process.exitCode = buildExitCode
}
