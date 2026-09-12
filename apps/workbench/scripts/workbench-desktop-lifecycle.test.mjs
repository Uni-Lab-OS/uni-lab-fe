import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

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

test('desktop remote cleanup releases ownership before awaiting and closes only once', async () => {
  const source = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8')
  const cleanup = source.match(/^async function closeRemoteAccess\(\) \{[\s\S]*?^\}/mu)?.[0]
  assert.ok(cleanup, 'desktop entry point must define its own remote cleanup')
  let closeCount = 0
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const controller = { close: () => { closeCount += 1; return pending } }
  const context = vm.createContext({ remoteAccessController: controller,
    __unilabWorkbenchRemoteAccessController: controller })
  vm.runInContext(cleanup, context)
  const first = context.closeRemoteAccess()
  assert.equal(context.remoteAccessController, undefined)
  assert.equal(context.__unilabWorkbenchRemoteAccessController, undefined)
  await context.closeRemoteAccess()
  assert.equal(closeCount, 1)
  finish()
  await first

  const failure = new Error('tunnel cleanup failed')
  context.remoteAccessController = { close: async () => { throw failure } }
  context.__unilabWorkbenchRemoteAccessController = context.remoteAccessController
  await assert.rejects(context.closeRemoteAccess(), failure)
  assert.equal(context.remoteAccessController, undefined)
  assert.equal(context.__unilabWorkbenchRemoteAccessController, undefined)
})
