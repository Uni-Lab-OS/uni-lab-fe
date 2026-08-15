import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { it } from 'node:test'

import { afterPack } from '../../desktop/scripts/after-pack.mjs'

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
