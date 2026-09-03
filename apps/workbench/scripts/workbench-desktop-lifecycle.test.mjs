import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('cleans up the detached Theia backend when the desktop app quits', async () => {
  const source = await readFile(
    new URL('../desktop/main.mjs', import.meta.url),
    'utf8',
  )

  assert.match(source, /app\.on\('window-all-closed'/u)
  assert.match(source, /app\.on\('before-quit'/u)
  assert.match(source, /event\.preventDefault\(\)/u)
  assert.match(source, /stopBackendProcess\(backendProcess\)/u)
  assert.match(source, /app\.quit\(\)/u)
})
