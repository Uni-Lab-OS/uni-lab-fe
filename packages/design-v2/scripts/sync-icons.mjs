#!/usr/bin/env node

/**
 * Rebuild and validate the checked-in Figma icon package in one command.
 *
 * Usage:
 *   pnpm --dir packages/design-v2 icons:sync -- --source-dir /path/to/export/clean
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, '..')

function run(script, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(scriptDir, script), ...args], {
      cwd: packageRoot,
      stdio: 'inherit'
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${script} terminated by ${signal}`))
      } else if (code !== 0) {
        reject(new Error(`${script} exited with code ${code}`))
      } else {
        resolvePromise()
      }
    })
  })
}

const sourceDirIndex = process.argv.indexOf('--source-dir')
const sourceDir = sourceDirIndex >= 0 ? process.argv[sourceDirIndex + 1] : undefined
if (!sourceDir) {
  console.error('Missing --source-dir. Pass the complete Figma export directory, for example --source-dir /tmp/figma-export/clean')
  process.exitCode = 1
} else {
  const outputDirIndex = process.argv.indexOf('--output-dir')
  const outputDir = outputDirIndex >= 0 ? process.argv[outputDirIndex + 1] : 'src/icons'
  const expectedCountIndex = process.argv.indexOf('--expected-count')
  const expectedCount = expectedCountIndex >= 0 ? process.argv[expectedCountIndex + 1] : undefined
  const buildArgs = ['--source-dir', sourceDir, '--output-dir', outputDir]
  const validateArgs = expectedCount ? ['--expected-count', expectedCount] : []

  try {
    await run('build-icon-assets.mjs', buildArgs)
    await run('validate-icons.mjs', validateArgs)
    console.log('\nIcon sync complete. Review git diff, then run design-v2 typecheck and preview build before opening a PR.')
  } catch (error) {
    console.error(`\nIcon sync failed: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
