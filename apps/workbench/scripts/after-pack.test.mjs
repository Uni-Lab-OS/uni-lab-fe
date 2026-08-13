import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { it } from 'node:test'

import { afterPack, afterSign } from '../../desktop/scripts/after-pack.mjs'

it('removes the deployed desktop self copy from Windows resources', async () => {
  const appOutDir = await mkdtemp(join(tmpdir(), 'unilab-win-unpacked-'))
  const selfCopy = join(
    appOutDir,
    'resources',
    'desktop',
    'node_modules',
    '.pnpm',
    'node_modules',
    '@unilab',
    'desktop',
    'package.json'
  )
  try {
    await mkdir(dirname(selfCopy), { recursive: true })
    await writeFile(selfCopy, '{}')

    await afterPack({ electronPlatformName: 'win32', appOutDir })

    await assert.rejects(
      stat(dirname(selfCopy)),
      error => error?.code === 'ENOENT'
    )
  } finally {
    await rm(appOutDir, { recursive: true, force: true })
  }
})

it('records the signed Windows Runtime Constructor digest after signing', async () => {
  const appOutDir = await mkdtemp(join(tmpdir(), 'unilab-win-signed-'))
  const runtimeDirectory = join(
    appOutDir,
    'resources',
    'runtime-installer'
  )
  const installerFile = 'Uni-Lab-OS-test-win-64.exe'
  const signedBytes = Buffer.from('signed-runtime-constructor')
  try {
    await mkdir(runtimeDirectory, { recursive: true })
    await writeFile(join(runtimeDirectory, installerFile), signedBytes)
    await writeFile(join(runtimeDirectory, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      runtimeVersion: 'test',
      platform: 'win-64',
      installerFile,
      sha256: '0'.repeat(64)
    }))

    await afterSign({ electronPlatformName: 'win32', appOutDir })

    const manifest = JSON.parse(await readFile(
      join(runtimeDirectory, 'manifest.json'),
      'utf8'
    ))
    assert.equal(
      manifest.sha256,
      createHash('sha256').update(signedBytes).digest('hex')
    )
  } finally {
    await rm(appOutDir, { recursive: true, force: true })
  }
})
