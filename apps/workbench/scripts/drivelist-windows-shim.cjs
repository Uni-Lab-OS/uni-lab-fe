'use strict'

const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const DRIVE_INFO_SCRIPT = [
  '[System.IO.DriveInfo]::GetDrives()',
  '| ForEach-Object { $_.RootDirectory.FullName }'
].join(' ')

/**
 * Minimal drivelist-compatible provider for Theia's drive-root picker.
 * Windows reports accessible local/mapped roots without loading a native DLL.
 */
async function list(options = {}) {
  const roots = options.roots ?? await queryWindowsDriveRoots(options)
  return roots
    .map(root => ({ mountpoints: [{ path: root }] }))
}

async function queryWindowsDriveRoots(options = {}) {
  const runCommand = options.runCommand ?? execFileAsync
  try {
    const result = await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      DRIVE_INFO_SCRIPT
    ], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true
    })
    const roots = uniqueDriveRoots(String(result.stdout ?? ''))
    if (roots.length > 0) return roots
  } catch {
    // Fall back to drive roots already visible in the process environment.
  }
  return environmentDriveRoots(options.environment ?? process.env)
}

function uniqueDriveRoots(output) {
  return [...new Set(
    output
      .split(/\r?\n/u)
      .map(value => value.trim())
      .filter(value => /^[A-Z]:\\$/iu.test(value))
      .map(value => value.toUpperCase())
  )]
}

function environmentDriveRoots(environment) {
  const values = [
    process.cwd(),
    environment.SystemDrive,
    environment.HOMEDRIVE,
    environment.PATH
  ].filter(Boolean)
  const roots = new Set()
  for (const value of values) {
    for (const match of String(value).matchAll(/(?:^|;)([A-Z]):(?:\\|$)/giu)) {
      roots.add(`${match[1].toUpperCase()}:\\`)
    }
  }
  return [...roots]
}

module.exports = {
  DRIVE_INFO_SCRIPT,
  environmentDriveRoots,
  list,
  queryWindowsDriveRoots,
  uniqueDriveRoots
}
