import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../../..')
const temporaryRoot = await mkdtemp(path.join(
  os.tmpdir(),
  'unilab-workspace-reselection-'
))
const mainBundle = path.join(temporaryRoot, 'main.cjs')
const preloadBundle = path.join(temporaryRoot, 'preload.cjs')

try {
  await Promise.all([
    build({
      entryPoints: [path.join(
        repositoryRoot,
        'apps/desktop/e2e/workbench-workspace-reselection-main.ts'
      )],
      outfile: mainBundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
      logLevel: 'silent'
    }),
    build({
      entryPoints: [path.join(
        repositoryRoot,
        'apps/desktop/e2e/workbench-workspace-reselection-preload.ts'
      )],
      outfile: preloadBundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      external: ['electron'],
      logLevel: 'silent'
    })
  ])

  const electron = electronExecutable(repositoryRoot)
  const command = await electronCommand(electron)
  const exitCode = await run(command.executable, [
    ...command.arguments,
    '--no-sandbox',
    mainBundle
  ], {
    ...process.env,
    UNILAB_E2E_REPOSITORY_ROOT: repositoryRoot,
    UNILAB_E2E_PRELOAD_PATH: preloadBundle
  })
  if (exitCode !== 0) process.exitCode = exitCode
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

function electronExecutable(root) {
  const name = process.platform === 'win32' ? 'electron.exe' : 'electron'
  return path.join(
    root,
    'apps',
    'desktop',
    'node_modules',
    'electron',
    'dist',
    name
  )
}

async function electronCommand(electron) {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return { executable: electron, arguments: [] }
  }
  const xvfbRun = '/usr/bin/xvfb-run'
  try {
    await access(xvfbRun)
    return { executable: xvfbRun, arguments: ['-a', electron] }
  } catch {
    throw new Error('Linux 无 DISPLAY，且未安装 xvfb-run，无法执行 Electron E2E')
  }
}

function run(executable, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Electron E2E 被信号 ${signal} 终止`))
      else resolve(code ?? 1)
    })
  })
}
