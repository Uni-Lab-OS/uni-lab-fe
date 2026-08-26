import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  createPackagedResourceReport,
  logPackagedResourceReport,
  measurePathBytes
} from './package-size-report.mjs'

test('reports packaged resources in descending byte order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'unilab-package-size-'))
  try {
    await mkdir(join(root, 'runtime-installer'))
    await mkdir(join(root, 'workbench'))
    await writeFile(join(root, 'runtime-installer', 'runtime.exe'), '123456')
    await writeFile(join(root, 'workbench', 'frontend.js'), '123')
    await writeFile(join(root, 'app.asar'), '12')

    assert.equal(measurePathBytes(join(root, 'runtime-installer')), 6)
    assert.deepEqual(createPackagedResourceReport(root), {
      schemaVersion: 1,
      totalBytes: 11,
      entries: [
        { name: 'runtime-installer', bytes: 6 },
        { name: 'workbench', bytes: 3 },
        { name: 'app.asar', bytes: 2 }
      ]
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not traverse symbolic links while measuring resources', async t => {
  if (process.platform === 'win32') return t.skip('Windows CI may deny symlink creation')
  const root = await mkdtemp(join(tmpdir(), 'unilab-package-size-link-'))
  try {
    await writeFile(join(root, 'source.bin'), '123456789')
    await symlink('source.bin', join(root, 'source-link'))

    assert.equal(
      measurePathBytes(join(root, 'source-link')),
      Buffer.byteLength('source.bin')
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('logs the total and every top-level resource', () => {
  const messages = []
  logPackagedResourceReport({
    totalBytes: 3 * 1024 * 1024,
    entries: [{ name: 'runtime-installer', bytes: 2 * 1024 * 1024 }]
  }, message => messages.push(message))

  assert.deepEqual(messages, [
    'Workbench resources total: 3.0 MiB',
    '  runtime-installer: 2.0 MiB (2097152 bytes)'
  ])
})
