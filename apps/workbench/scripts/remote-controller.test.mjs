import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import { createRemoteWorkbenchController } from './remote-controller.mjs'

const configuration = accessUrlFile => ({
  host: '127.0.0.1',
  port: 43101,
  publicOrigin: null,
  tlsCertificatePath: null,
  tlsKeyPath: null,
  authenticationRequired: true,
  tokenTtlMs: 60_000,
  accessUrlFile
})

describe('remote Workbench controller', () => {
  it('starts one facade and safely removes its delivered URL', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-remote-control-'))
    const workspacePath = path.join(root, 'workspace')
    const accessUrlFile = path.join(root, 'runtime', 'access.url')
    let starts = 0
    let closes = 0
    const controller = createRemoteWorkbenchController({
      backendPort: 43100,
      workspacePath,
      rendererUrl: 'http://127.0.0.1:43100/?workflowUuid=one#/workspace',
      configuration: configuration(accessUrlFile),
      startFacade: async options => {
        starts += 1
        assert.equal(options.rendererPath, '/?workflowUuid=one#/workspace')
        return fakeFacade(() => { closes += 1 })
      }
    })
    try {
      const [first, second] = await Promise.all([
        controller.start(),
        controller.start()
      ])
      assert.equal(starts, 1)
      assert.equal(first.phase, 'ready')
      assert.equal(second.accessUrl, first.accessUrl)
      assert.equal((await readFile(accessUrlFile, 'utf8')).trim(), first.accessUrl)

      assert.equal((await controller.stop()).phase, 'idle')
      assert.equal(closes, 1)
      await assert.rejects(readFile(accessUrlFile), { code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not delete a replacement secret delivery owned by another start', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-remote-control-'))
    const workspacePath = path.join(root, 'workspace')
    const accessUrlFile = path.join(root, 'access.url')
    const controller = createRemoteWorkbenchController({
      backendPort: 43100,
      workspacePath,
      rendererUrl: 'http://127.0.0.1:43100/#/workspace',
      configuration: configuration(accessUrlFile),
      startFacade: async () => fakeFacade()
    })
    try {
      await controller.start()
      await writeFile(accessUrlFile, 'replacement\n')
      await controller.stop()
      assert.equal(await readFile(accessUrlFile, 'utf8'), 'replacement\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('replaces a stale secret delivery with the current generation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-remote-control-'))
    const workspacePath = path.join(root, 'workspace')
    const accessUrlFile = path.join(root, 'access.url')
    await writeFile(accessUrlFile, 'stale-secret\n', { mode: 0o600 })
    const controller = createRemoteWorkbenchController({
      backendPort: 43100,
      workspacePath,
      rendererUrl: 'http://127.0.0.1:43100/#/workspace',
      configuration: configuration(accessUrlFile),
      startFacade: async () => fakeFacade()
    })
    try {
      const snapshot = await controller.start()
      assert.equal((await readFile(accessUrlFile, 'utf8')).trim(), snapshot.accessUrl)
      await controller.stop()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports a failed start without retaining a secret or facade identity', async () => {
    const controller = createRemoteWorkbenchController({
      backendPort: 43100,
      workspacePath: '/workspace',
      rendererUrl: 'http://127.0.0.1:43100/#/workspace',
      configuration: configuration(null),
      startFacade: async () => { throw new Error('TLS is required') }
    })
    await assert.rejects(controller.start(), /TLS is required/u)
    assert.deepEqual(controller.getSnapshot(), {
      phase: 'failed',
      origin: null,
      accessUrl: null,
      pid: null,
      generation: null,
      expiresAt: null,
      error: 'TLS is required'
    })
  })
})

function fakeFacade(onClose = () => undefined) {
  return {
    accessUrl: 'http://127.0.0.1:43101/__unilab/auth#token=secret',
    origin: 'http://127.0.0.1:43101',
    identity: {
      pid: 123,
      generation: 'generation-1234567890',
      expiresAt: Date.now() + 60_000
    },
    async close() { onClose() }
  }
}
