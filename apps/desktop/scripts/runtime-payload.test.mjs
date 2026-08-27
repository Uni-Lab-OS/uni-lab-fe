import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, it } from 'vitest'

import { prepareRuntimePayload } from './runtime-payload.mjs'

const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('runtime payload', () => {
  it('copies one Constructor installer and writes its immutable manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'unilab-runtime-payload-'))
    temporaryDirectories.push(root)
    const installer = join(root, 'Uni-Lab-OS-0.11.3-linux-64.sh')
    const destination = join(root, 'payload')
    writeFileSync(installer, 'constructor fixture')

    const result = prepareRuntimePayload({
      installerPath: installer,
      runtimeVersion: '0.11.3',
      platform: 'linux-64',
      destinationDirectory: destination
    })

    assert.equal(basename(result.installerPath), basename(installer))
    assert.deepEqual(
      JSON.parse(readFileSync(result.manifestPath, 'utf8')),
      {
        schemaVersion: 1,
        runtimeVersion: '0.11.3',
        platform: 'linux-64',
        installerFile: basename(installer),
        sha256: 'c14e46b0910821cea36c7911df493bbec8cfac1f91c770ae1972600ee85ddd23'
      }
    )
  })

  it('writes a verified download manifest without embedding the Constructor', () => {
    const root = mkdtempSync(join(tmpdir(), 'unilab-runtime-download-payload-'))
    temporaryDirectories.push(root)
    const installer = join(root, 'Uni-Lab-OS-0.11.3-win-64.exe')
    const destination = join(root, 'payload')
    writeFileSync(installer, 'constructor fixture')

    const result = prepareRuntimePayload({
      installerPath: installer,
      runtimeVersion: '0.11.3',
      platform: 'win-64',
      destinationDirectory: destination,
      delivery: 'download',
      downloadUrl:
        'https://github.com/Uni-Lab-OS/uni-lab-fe/releases/download/workbench-runtime-download-test-0.11.3/Uni-Lab-OS-0.11.3-win-64.exe'
    })

    assert.equal(result.installerPath, null)
    assert.equal(existsSync(join(destination, basename(installer))), false)
    assert.deepEqual(JSON.parse(readFileSync(result.manifestPath, 'utf8')), {
      schemaVersion: 2,
      delivery: 'download',
      runtimeVersion: '0.11.3',
      platform: 'win-64',
      installerFile: basename(installer),
      sha256: 'c14e46b0910821cea36c7911df493bbec8cfac1f91c770ae1972600ee85ddd23',
      downloadUrl:
        'https://github.com/Uni-Lab-OS/uni-lab-fe/releases/download/workbench-runtime-download-test-0.11.3/Uni-Lab-OS-0.11.3-win-64.exe'
    })
  })

  it('rejects credentialed or mutable Runtime download URLs', () => {
    const root = mkdtempSync(join(tmpdir(), 'unilab-runtime-download-url-'))
    temporaryDirectories.push(root)
    const installer = join(root, 'Uni-Lab-OS-0.11.3-win-64.exe')
    writeFileSync(installer, 'constructor fixture')

    assert.throws(() => prepareRuntimePayload({
      installerPath: installer,
      runtimeVersion: '0.11.3',
      platform: 'win-64',
      destinationDirectory: join(root, 'payload'),
      delivery: 'download',
      downloadUrl: 'https://token@example.com/runtime.exe?latest=1'
    }), /不含凭据、查询或片段的 HTTPS URL/u)
  })
})
