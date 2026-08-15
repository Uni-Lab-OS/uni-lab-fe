import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  MAX_RECENT_WORKSPACES,
  normalizeWorkbenchLaunchConfig,
  recentWorkspaceForPath,
  requireWorkbenchWorkspace,
  recordRecentWorkspace,
  WORKBENCH_LAUNCH_CONFIG_VERSION
} from './workspace-recents.mjs'

describe('Workbench recent Workspace configuration', () => {
  it('migrates the previous single Workspace selection', () => {
    assert.deepEqual(normalizeWorkbenchLaunchConfig({
      version: 1,
      workspace: '/workspace/one',
      pythonEnvironment: '/env/unilab',
      osProject: '/src/Uni-Lab-OS'
    }), {
      version: WORKBENCH_LAUNCH_CONFIG_VERSION,
      recentWorkspaces: [{
        path: '/workspace/one',
        pythonEnvironment: '/env/unilab',
        osProject: '/src/Uni-Lab-OS',
        lastOpenedAt: new Date(0).toISOString()
      }]
    })
  })

  it('promotes one canonical Workspace without duplicating it', () => {
    const first = recordRecentWorkspace(null, recent('/workspace/one', 1))
    const second = recordRecentWorkspace(first, recent('/workspace/two', 2))
    const reopened = recordRecentWorkspace(second, recent('/workspace/one', 3))

    assert.deepEqual(reopened.recentWorkspaces.map(entry => entry.path), [
      '/workspace/one',
      '/workspace/two'
    ])
    assert.equal(
      recentWorkspaceForPath(reopened, '/workspace/one')?.lastOpenedAt,
      new Date(3).toISOString()
    )
  })

  it('bounds and sanitizes persisted local history', () => {
    let config = null
    for (let index = 0; index < MAX_RECENT_WORKSPACES + 3; index += 1) {
      config = recordRecentWorkspace(config, recent(`/workspace/${index}`, index))
    }
    assert.equal(config.recentWorkspaces.length, MAX_RECENT_WORKSPACES)
    assert.equal(config.recentWorkspaces[0].path, '/workspace/10')
    assert.deepEqual(normalizeWorkbenchLaunchConfig({
      version: WORKBENCH_LAUNCH_CONFIG_VERSION,
      recentWorkspaces: [{ path: '' }, null, { path: '/valid' }]
    }).recentWorkspaces, [{
      path: '/valid',
      pythonEnvironment: null,
      osProject: null,
      lastOpenedAt: new Date(0).toISOString()
    }])
  })

  it('accepts only the domain root that contains local_config.py', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'unilab-workspace-'))
    const workspace = path.join(parent, 'Uni-Lab-SZLab')
    try {
      await mkdir(path.join(workspace, 'deployment'), { recursive: true })
      await writeFile(path.join(
        workspace,
        'deployment',
        'local_config.py'
      ), 'config = {}\n')

      assert.equal(await requireWorkbenchWorkspace(workspace), workspace)
      await assert.rejects(
        requireWorkbenchWorkspace(parent),
        error => {
          assert.match(error.message, /设备图路径.*不会改变 Workspace/)
          assert.match(error.message, new RegExp(escapeRegExp(workspace)))
          return true
        }
      )
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})

function recent(path, milliseconds) {
  return {
    path,
    pythonEnvironment: '/env/unilab',
    osProject: null,
    lastOpenedAt: new Date(milliseconds).toISOString()
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
