import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runDevicePackageAcceptance } from './devicePackageAcceptance'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(
    directory,
    { recursive: true, force: true }
  )))
})

describe('device package acceptance', () => {
  it('reports an optional missing descriptor as unverified', async () => {
    const workspace = await fixtureWorkspace()

    await expect(runDevicePackageAcceptance(workspace, {
      canConnect: vi.fn(),
      fetchJson: vi.fn()
    })).resolves.toMatchObject({
      status: 'unverified',
      message: expect.stringContaining('未提供')
    })
  })

  it('verifies PLC-Sim and expected devices through fixed loopback checks', async () => {
    const workspace = await fixtureWorkspace()
    await writeFile(join(workspace, 'unilab.acceptance.json'), JSON.stringify({
      schemaVersion: 1,
      package: { name: 'plc-reference', version: '1.0.0' },
      acceptance: {
        requiresSimulator: true,
        expectedDeviceIds: ['plc-reference-device']
      }
    }))
    const canConnect = vi.fn(async () => true)
    const fetchJson = vi.fn(async () => ({
      code: 0,
      data: {
        schemaVersion: 'device-catalog/v1',
        items: [{ id: 'plc-reference-device' }]
      }
    }))

    await expect(runDevicePackageAcceptance(workspace, {
      canConnect,
      fetchJson
    })).resolves.toMatchObject({
      status: 'verified',
      packageName: 'plc-reference',
      packageVersion: '1.0.0'
    })
    expect(canConnect).toHaveBeenCalledWith('127.0.0.1', 18_765)
    expect(fetchJson).toHaveBeenCalledWith(
      'http://127.0.0.1:18003/api/v1/authoring/device-catalog'
    )
  })

  it('returns failed when an expected device is absent', async () => {
    const workspace = await fixtureWorkspace()
    await writeFile(join(workspace, 'unilab.acceptance.json'), JSON.stringify({
      schemaVersion: 1,
      package: { name: 'plc-reference', version: '1.0.0' },
      acceptance: {
        requiresSimulator: false,
        expectedDeviceIds: ['missing-device']
      }
    }))

    await expect(runDevicePackageAcceptance(workspace, {
      canConnect: vi.fn(),
      fetchJson: async () => ({ devices: [{ id: 'another-device' }] })
    })).resolves.toMatchObject({
      status: 'failed',
      message: expect.stringContaining('missing-device')
    })
  })
})

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'unilab-acceptance-'))
  temporaryDirectories.push(root)
  await mkdir(root, { recursive: true })
  return root
}
