import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import { resolveManagedSessionProcessIds } from './managed-session-cleanup.mjs'

describe('managed Workbench session cleanup', () => {
  it('returns managed children before Backend only for the current launcher and workspace', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'unilab-cleanup-'))
    const runtimePath = path.join(workspacePath, '.unilabos', 'runtime', 'workbench')
    await mkdir(runtimePath, { recursive: true })
    await writeFile(path.join(runtimePath, 'session.json'), JSON.stringify({
      schemaVersion: 1,
      ownerPid: 42,
      launcherPid: 24,
      identity: { workspacePath, pid: 101 },
      edgeRuntime: { pid: 202 },
      plcSimulator: { pid: 303 },
      agentRuntime: { pid: 404 }
    }))

    assert.deepEqual(await resolveManagedSessionProcessIds({
      workspacePath,
      launcherPid: 24
    }), [202, 303, 404, 101])
    assert.deepEqual(await resolveManagedSessionProcessIds({
      workspacePath,
      launcherPid: 25
    }), [])
  })

  it('never treats Workspace Host components as launcher-owned children', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'unilab-host-cleanup-'))
    const runtimePath = path.join(workspacePath, '.unilabos', 'runtime', 'workbench')
    await mkdir(runtimePath, { recursive: true })
    await writeFile(path.join(runtimePath, 'session.json'), JSON.stringify({
      schemaVersion: 'unilab-workspace-host/v1',
      workspacePath,
      host: { pid: 501 },
      components: {
        backend: { pid: 502 },
        edge: { pid: 503 },
        plc: { pid: 504 }
      }
    }))

    assert.deepEqual(await resolveManagedSessionProcessIds({
      workspacePath,
      launcherPid: 24
    }), [])
  })
})
