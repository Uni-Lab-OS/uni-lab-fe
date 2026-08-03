import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import type {
  DeviceCardAuthoringTarget,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DeviceCardAuthoringError,
  LocalDeviceCardAuthoringAutomation,
  type DeviceCardAuthoringApprovalPort
} from './authoringAutomation'

const roots: string[] = []
const target: DeviceCardAuthoringTarget = {
  deviceId: 'robot-01',
  deviceTypeId: 'robot-arm',
  title: 'Robot',
  online: true,
  actions: [],
  stateSchema: { status: { type: 'string' } },
  sampleState: { status: 'idle' }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ))
})

describe('DeviceCardAuthoringAutomation interface', () => {
  it('bootstraps, builds and returns only absolute agent paths', async () => {
    const root = await temporaryRoot()
    const automation = createAutomation(root)
    const result = await automation.prepare({
      mode: 'bootstrap',
      deviceId: target.deviceId,
      profile: 'web-component-lite-v1',
      projectDir: join(root, 'frontend/cards/robot-card'),
      principal: 'agent'
    })

    expect(result.workspace.state).toBe('ready')
    expect([
      result.session.projectDir,
      result.session.contextPath,
      result.session.manifestPath,
      result.session.diagnosticsPath
    ].every(isAbsolute)).toBe(true)
    expect(result.session).toMatchObject({
      deviceId: 'robot-01',
      deviceTypeId: 'robot-arm',
      previewMode: 'mock'
    })

    await automation.destroy()
  })

  it('does not modify a non-empty bootstrap directory', async () => {
    const root = await temporaryRoot()
    const projectDir = join(root, 'existing')
    await mkdir(projectDir)
    await writeFile(join(projectDir, 'keep.txt'), 'keep', 'utf8')
    const automation = createAutomation(root)

    await expect(automation.prepare({
      mode: 'bootstrap',
      deviceId: target.deviceId,
      profile: 'vue-web-component-v1',
      projectDir,
      principal: 'agent'
    })).rejects.toMatchObject({ code: 'DIRECTORY_NOT_EMPTY' })
  })

  it('keeps one active workspace and requires install approval', async () => {
    const root = await temporaryRoot()
    let installCalls = 0
    const automation = createAutomation(root, {
      approvals: approvals(false),
      install: async () => {
        installCalls += 1
        return installedCard()
      }
    })
    const first = await automation.prepare({
      mode: 'bootstrap',
      deviceId: target.deviceId,
      projectDir: join(root, 'first'),
      principal: 'agent'
    })

    await expect(automation.prepare({
      mode: 'bootstrap',
      deviceId: target.deviceId,
      projectDir: join(root, 'second'),
      principal: 'agent'
    })).rejects.toMatchObject({ code: 'WORKSPACE_ACTIVE' })

    await expect(automation.requestInstall(
      first.session.sessionId,
      'agent'
    )).resolves.toMatchObject({ status: 'denied' })
    expect(installCalls).toBe(0)
    await automation.destroy()
  })

  it('maps unknown targets to a stable error', async () => {
    const root = await temporaryRoot()
    const automation = createAutomation(root)

    await expect(automation.prepare({
      mode: 'bootstrap',
      deviceId: 'missing',
      projectDir: join(root, 'missing'),
      principal: 'agent'
    })).rejects.toEqual(expect.objectContaining({
      code: 'DEVICE_NOT_FOUND',
      retryable: true
    } satisfies Partial<DeviceCardAuthoringError>))
  })

  it('serializes concurrent mutations into the single-workspace invariant', async () => {
    const root = await temporaryRoot()
    const automation = createAutomation(root)
    const results = await Promise.allSettled([
      automation.prepare({
        mode: 'bootstrap',
        deviceId: target.deviceId,
        projectDir: join(root, 'concurrent-a'),
        principal: 'agent'
      }),
      automation.prepare({
        mode: 'bootstrap',
        deviceId: target.deviceId,
        projectDir: join(root, 'concurrent-b'),
        principal: 'agent'
      })
    ])

    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected'))
      .toMatchObject({ reason: { code: 'WORKSPACE_ACTIVE' } })
    await automation.destroy()
  })
})

function createAutomation(
  root: string,
  overrides: {
    approvals?: DeviceCardAuthoringApprovalPort
    install?: () => Promise<InstalledDeviceCard>
  } = {}
): LocalDeviceCardAuthoringAutomation {
  return new LocalDeviceCardAuthoringAutomation({
    targets: { listTargets: async () => [target] },
    approvals: overrides.approvals ?? approvals(true),
    workRoot: join(root, 'work'),
    storeRoot: join(root, 'store'),
    installArchive: overrides.install ?? (async () => installedCard())
  })
}

function approvals(installApproved: boolean): DeviceCardAuthoringApprovalPort {
  return {
    authorizeDirectory: async () => true,
    approveInstall: async () => installApproved
  }
}

function installedCard(): InstalledDeviceCard {
  return {
    key: 'robot.card:0.1.0:hash',
    id: 'robot.card',
    version: '0.1.0',
    title: 'Robot card',
    deviceTypes: ['robot-arm'],
    authoringProfile: 'web-component-lite-v1',
    installedAt: new Date().toISOString()
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'unilab-card-authoring-'))
  roots.push(root)
  return root
}
