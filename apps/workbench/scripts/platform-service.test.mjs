import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const workbenchDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const readPlatformFile = (...segments) => readFile(
  path.join(workbenchDirectory, ...segments),
  'utf8'
)
const macosPlist = await readPlatformFile(
  'macos',
  'com.unilab.workbench.remote.plist'
)
const macosLauncher = await readPlatformFile(
  'macos',
  'start-remote-service.sh'
)
const windowsLauncher = await readPlatformFile(
  'windows',
  'start-remote-service.ps1'
)
const windowsInstaller = await readPlatformFile(
  'windows',
  'install-remote-task.ps1'
)
const commonLauncher = await readPlatformFile('scripts', 'start-workbench.mjs')

describe('Cross-platform remote Workbench services', () => {
  it('uses launchd to supervise the shared remote entry point on macOS', () => {
    assert.match(macosPlist, /com\.unilab\.workbench\.remote/u)
    assert.match(macosPlist, /<key>RunAtLoad<\/key>\s*<true\/>/u)
    assert.match(macosPlist, /<key>KeepAlive<\/key>/u)
    assert.match(macosPlist, /<key>UserName<\/key>\s*<string>unilab<\/string>/u)
    assert.match(macosPlist, /<key>GroupName<\/key>\s*<string>unilab<\/string>/u)
    assert.match(macosLauncher, /\. "\$config_file"/u)
    assert.match(macosLauncher, /start-workbench\.mjs"[\s\S]*--remote/u)
  })

  it('uses a machine startup task and protected config on Windows', () => {
    assert.match(windowsInstaller, /New-ScheduledTaskTrigger -AtStartup/u)
    assert.match(windowsInstaller, /-UserId 'SYSTEM'/u)
    assert.match(windowsInstaller, /-LogonType ServiceAccount/u)
    assert.match(windowsInstaller, /icacls\.exe .*\/inheritance:r/su)
    assert.match(windowsLauncher, /start-workbench\.mjs'/u)
    assert.match(windowsLauncher, /--remote/u)
    assert.match(windowsLauncher, /\^\[A-Z\]\[A-Z0-9_\]\*\$/u)
    assert.match(windowsLauncher, /icacls\.exe .*\/inheritance:r/su)
  })

  it('never embeds a remote capability in platform service definitions', () => {
    const definitions = [
      macosPlist,
      macosLauncher,
      windowsLauncher,
      windowsInstaller
    ].join('\n')
    assert.doesNotMatch(definitions, /UNILAB_REMOTE_TOKEN|#token=/u)
    assert.match(definitions, /UNILAB_REMOTE_ACCESS_URL_FILE/u)
  })

  it('starts the built Theia backend through the pinned Node process on every OS', () => {
    assert.match(
      commonLauncher,
      /'apps',\s*'workbench',\s*'lib',\s*'backend',\s*'main\.js'/u
    )
    assert.match(commonLauncher, /spawn\(process\.execPath, \[/u)
  })
})
