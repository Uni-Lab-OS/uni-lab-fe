import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const workbenchDirectory = dirname(dirname(fileURLToPath(import.meta.url)))

test('pins extension dependencies so plugin preparation works offline', async () => {
  const manifest = JSON.parse(
    await readFile(join(workbenchDirectory, 'package.json'), 'utf8'),
  )
  const excludedIds = new Set(manifest.theiaPluginsExcludeIds ?? [])

  assert.ok(
    manifest.theiaPlugins?.['vscode.git'],
    'the Git plugin must remain part of the pinned plugin set',
  )
  assert.ok(
    manifest.theiaPlugins?.['vscode.git-base'],
    'the Git base dependency must remain part of the pinned plugin set',
  )
  assert.ok(
    excludedIds.has('vscode.git-base'),
    'the Git base dependency must not trigger remote resolution during offline builds',
  )
})
