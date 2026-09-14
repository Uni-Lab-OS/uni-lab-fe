/**
 * Keep Workbench Desktop alive with Theia/extension watchers.
 *
 * Initial assets still come from `pnpm build:desktop`. This script then runs:
 * - `@unilab/workbench-theia` tsc watch (extension lib/)
 * - `theia build --watch` (browser/node bundles; picks up package `src` exports)
 * - `start-workbench.mjs --desktop`
 *
 * UI package edits rebuild through Theia watch; refresh the Electron window after
 * the bundle finishes. Electron main/preload still need a full desktop rebuild.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { theiaBuildEnvironment } from './theia-build-environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const workbenchDirectory = path.resolve(scriptDirectory, '..')
const workspaceRoot = path.resolve(workbenchDirectory, '../..')
const startScript = path.join(scriptDirectory, 'start-workbench.mjs')
const theiaBuildScript = path.join(scriptDirectory, 'run-theia-build.mjs')
const productionBuildFlag = '--production-build'
const welcomeFlag = '--welcome'
const productionBuild = process.argv.includes(productionBuildFlag)
const welcome = process.argv.includes(welcomeFlag)
const forwardedArguments = process.argv.slice(2)
  .filter(argument => ![productionBuildFlag, welcomeFlag].includes(argument))
const watchMode = productionBuild ? 'production' : 'development'
const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

/** @type {{ label: string, child: import('node:child_process').ChildProcess }[]} */
const children = []
let stopping = false

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

console.log(`[UniLab Workbench] desktop watch mode: ${watchMode}`)
console.log(
  '[UniLab Workbench] package/UI edits rebuild via Theia watch; refresh Electron after rebuild'
)
console.log(
  '[UniLab Workbench] Electron main/preload changes still need `pnpm workbench:desktop` restart'
)

const extensionWatcher = start('workbench-theia', pnpmExecutable, [
  '--filter',
  '@unilab/workbench-theia',
  'watch'
], {
  cwd: workspaceRoot,
  shell: process.platform === 'win32',
  stdio: ['inherit', 'pipe', 'pipe']
})

try {
  await waitForOutput(extensionWatcher, [
    'Found 0 errors. Watching for file changes.'
  ])
  const bundleWatcher = start('theia-bundle', process.execPath, [
    theiaBuildScript,
    '--watch',
    '--mode',
    watchMode
  ], {
    cwd: workbenchDirectory,
    env: theiaBuildEnvironment(),
    stdio: ['inherit', 'pipe', 'pipe']
  })
  await waitForOutput(bundleWatcher, [
    '[watch/browser] Finished with 0 errors',
    '[watch/node] Finished with 0 errors'
  ])
  if (!stopping) {
    if (welcome) {
      const workbenchRequire = createRequire(
        path.join(workbenchDirectory, 'package.json')
      )
      const electronExecutable = workbenchRequire('electron')
      const desktopEnvironment = { ...process.env }
      delete desktopEnvironment.ELECTRON_RUN_AS_NODE
      start('desktop', electronExecutable, [
        workbenchDirectory,
        ...forwardedArguments
      ], {
        cwd: workbenchDirectory,
        env: desktopEnvironment
      })
    } else {
      start('desktop', process.execPath, [
        startScript,
        '--desktop',
        ...forwardedArguments
      ], {
        cwd: workbenchDirectory
      })
    }
  }
} catch (error) {
  if (!stopping) {
    console.error(
      `[UniLab Workbench] initial bundle watch failed: ${error.message}`
    )
    shutdown('SIGTERM')
    process.exitCode = 1
  }
}

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 */
function start(label, command, args, options = {}) {
  console.log(`[UniLab Workbench] starting ${label}`)
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    ...options
  })
  children.push({ label, child })
  child.once('error', error => {
    console.error(`[UniLab Workbench] ${label} failed: ${error.message}`)
    shutdown('SIGTERM')
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (stopping) return
    if (label === 'desktop') {
      shutdown(signal ?? 'SIGTERM')
      if (process.exitCode === undefined) {
        process.exitCode = signal ? 1 : code ?? 0
      }
      return
    }
    console.error(
      `[UniLab Workbench] ${label} exited code=${String(code)} signal=${String(signal)}`
    )
    shutdown('SIGTERM')
    process.exitCode = 1
  })
  return child
}

/**
 * Forwards a watch process while waiting for its first complete browser/node
 * build. Starting Electron sooner races its initial page load against bundle
 * replacement and can close an otherwise healthy desktop session.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {string[]} markers
 */
function waitForOutput(child, markers) {
  const pending = new Set(markers)
  let recentOutput = ''
  return new Promise((resolve, reject) => {
    const onExit = (code, signal) => reject(new Error(
      `watcher exited before ready code=${String(code)} signal=${String(signal)}`
    ))
    const forward = destination => chunk => {
      destination.write(chunk)
      recentOutput = `${recentOutput}${chunk.toString()}`.slice(-16_384)
      for (const marker of pending) {
        if (recentOutput.includes(marker)) pending.delete(marker)
      }
      if (pending.size === 0) {
        child.off('exit', onExit)
        resolve()
      }
    }

    child.once('exit', onExit)
    child.stdout?.on('data', forward(process.stdout))
    child.stderr?.on('data', forward(process.stderr))
  })
}

/** @param {NodeJS.Signals | string} signal */
function shutdown(signal) {
  if (stopping) return
  stopping = true
  for (const { child } of children) {
    if (!child.killed) {
      child.kill(signal === 'SIGINT' || signal === 'SIGTERM' ? signal : 'SIGTERM')
    }
  }
}
