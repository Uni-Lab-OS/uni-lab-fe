import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  list,
  queryDarwinDriveRoots,
  uniqueDarwinMountRoots
} = require('./drivelist-darwin-shim.cjs')

test('returns macOS mount roots in drivelist shape', async () => {
  const drives = await list({ roots: ['/', '/Volumes/USB'] })
  assert.deepEqual(drives, [
    { mountpoints: [{ path: '/' }] },
    { mountpoints: [{ path: '/Volumes/USB' }] }
  ])
})

test('discovers directory and symbolic-link volumes', async () => {
  const roots = await queryDarwinDriveRoots({
    readDirectory: async () => [
      dirent('External', 'directory'),
      dirent('Linked', 'link'),
      dirent('metadata', 'file')
    ]
  })
  assert.deepEqual(roots, [
    '/',
    '/Volumes/External',
    '/Volumes/Linked'
  ])
})

test('falls back to the filesystem root when /Volumes is unavailable', async () => {
  const roots = await queryDarwinDriveRoots({
    readDirectory: async () => {
      throw new Error('Volumes unavailable')
    }
  })
  assert.deepEqual(roots, ['/'])
})

test('normalizes and deduplicates macOS mount roots', () => {
  assert.deepEqual(
    uniqueDarwinMountRoots(['/', '/Volumes/USB/', '/Volumes/USB']),
    ['/', '/Volumes/USB']
  )
})

test('wires the shim into macOS backend builds and removes the native binding', async () => {
  const esbuildSource = await readFile(
    new URL('../esbuild.mjs', import.meta.url),
    'utf8'
  )
  assert.match(
    esbuildSource,
    /if \(process\.platform === 'darwin'\)[\s\S]*delete nativeBindings\.drivelist[\s\S]*drivelist-darwin-shim\.cjs/u
  )
})

function dirent(name, kind) {
  return {
    name,
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'link'
  }
}
