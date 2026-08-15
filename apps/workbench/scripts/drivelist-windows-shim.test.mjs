import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  environmentDriveRoots,
  list,
  queryWindowsDriveRoots,
  uniqueDriveRoots
} = require('./drivelist-windows-shim.cjs')

test('returns Windows drive roots in drivelist shape', async () => {
  const drives = await list({
    roots: ['C:\\', 'D:\\']
  })
  assert.deepEqual(drives, [
    { mountpoints: [{ path: 'C:\\' }] },
    { mountpoints: [{ path: 'D:\\' }] }
  ])
})

test('normalizes and deduplicates DriveInfo output', () => {
  assert.deepEqual(uniqueDriveRoots('C:\\\r\nd:\\\r\ninvalid\r\nC:\\\r\n'), [
    'C:\\',
    'D:\\'
  ])
})

test('falls back to process environment when DriveInfo is unavailable', async () => {
  const roots = await queryWindowsDriveRoots({
    runCommand: async () => {
      throw new Error('PowerShell unavailable')
    },
    environment: {
      SystemDrive: 'C:',
      HOMEDRIVE: 'C:',
      PATH: 'D:\\tools;C:\\Windows'
    }
  })
  assert.deepEqual(roots, ['C:\\', 'D:\\'])
})

test('extracts unique drive roots from environment values', () => {
  assert.deepEqual(environmentDriveRoots({
    SystemDrive: 'C:',
    HOMEDRIVE: 'C:',
    PATH: 'D:\\tools;C:\\Windows;D:\\bin'
  }), ['C:\\', 'D:\\'])
})

test('wires the shim only into Windows backend builds', async () => {
  const esbuildSource = await readFile(
    new URL('../esbuild.mjs', import.meta.url),
    'utf8'
  )
  assert.match(
    esbuildSource,
    /if \(process\.platform === 'win32'\)[\s\S]*drivelist-windows-shim\.cjs/u
  )
})
