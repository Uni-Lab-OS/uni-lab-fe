import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'

import { theiaBuildEnvironment } from './theia-build-environment.mjs'

const require = createRequire(import.meta.url)
const { copyFileWithNativeGuard } = require('./theia-native-copy-guard.cjs')
const roots = []

after(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true
  })))
})

describe('Theia Windows native copy guard', () => {
  it('skips only an unchanged Workbench node-pty prebuild', async () => {
    const fixture = await createFixture('same native bytes')
    let copyCalls = 0
    await copyFileWithNativeGuard(
      fixture.source,
      fixture.target,
      undefined,
      {
        platform: 'win32',
        copyFile: async () => { copyCalls += 1 }
      }
    )
    assert.equal(copyCalls, 0)
  })

  it('does not hide a changed native payload or non-Windows copy', async () => {
    const fixture = await createFixture('source bytes', 'target bytes')
    let copyCalls = 0
    const copyFile = async () => { copyCalls += 1 }
    await copyFileWithNativeGuard(
      fixture.source,
      fixture.target,
      undefined,
      { platform: 'win32', copyFile }
    )
    await copyFileWithNativeGuard(
      fixture.source,
      fixture.target,
      undefined,
      { platform: 'darwin', copyFile }
    )
    assert.equal(copyCalls, 2)
  })

  it('explains when a changed native payload is genuinely locked', async () => {
    const fixture = await createFixture('source bytes', 'target bytes')
    await assert.rejects(
      copyFileWithNativeGuard(
        fixture.source,
        fixture.target,
        undefined,
        {
          platform: 'win32',
          copyFile: async () => {
            throw Object.assign(new Error('locked'), { code: 'EBUSY' })
          }
        }
      ),
      /原生终端模块已变更.*关闭该 Workbench 窗口/u
    )
  })

  it('preserves existing NODE_OPTIONS while loading the guard', () => {
    const environment = theiaBuildEnvironment({
      NODE_OPTIONS: '--trace-warnings'
    })
    assert.match(environment.NODE_OPTIONS, /^--trace-warnings /u)
    assert.match(environment.NODE_OPTIONS, /theia-native-copy-guard\.cjs/u)
  })

  it('waits for the extension compiler before starting the bundle watcher', async () => {
    const desktopScript = await readFile(
      new URL('./dev-desktop.mjs', import.meta.url),
      'utf8'
    )
    const extensionReady = desktopScript.indexOf(
      'await waitForOutput(extensionWatcher'
    )
    const bundleStart = desktopScript.indexOf("start('theia-bundle'")
    assert.ok(extensionReady >= 0)
    assert.ok(bundleStart > extensionReady)
  })
})

async function createFixture(sourceBytes, targetBytes = sourceBytes) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-native-copy-'))
  roots.push(root)
  const source = path.join(
    root,
    'node-pty',
    'prebuilds',
    'win32-x64',
    'conpty.node'
  )
  const target = path.join(
    root,
    'apps',
    'workbench',
    'lib',
    'prebuilds',
    'win32-x64',
    'conpty.node'
  )
  await Promise.all([
    mkdir(path.dirname(source), { recursive: true }),
    mkdir(path.dirname(target), { recursive: true })
  ])
  await Promise.all([
    writeFile(source, sourceBytes),
    writeFile(target, targetBytes)
  ])
  return { source, target }
}
