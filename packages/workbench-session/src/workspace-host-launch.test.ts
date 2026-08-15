import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { launchWorkspaceHostProcess } from './workspace-host-launch'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true
  })))
})

describe('Workspace Host process launch', () => {
  it('passes an opened numeric log descriptor to spawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-host-launch-'))
    roots.push(root)
    const logPath = join(root, 'workspace-host.log')
    const unref = vi.fn()
    const spawnProcess = vi.fn((_command, _args, options) => {
      expect(options.stdio).toEqual([
        'ignore',
        expect.any(Number),
        expect.any(Number)
      ])
      expect(options.stdio?.[1]).toBe(options.stdio?.[2])
      return { unref }
    })

    await launchWorkspaceHostProcess({
      command: '/fixture/python',
      args: ['-m', 'unilabos.workspace_host.host'],
      cwd: root,
      environment: { PYTHONUNBUFFERED: '1' },
      detached: true,
      logPath
    }, spawnProcess)

    expect(spawnProcess).toHaveBeenCalledOnce()
    expect(unref).toHaveBeenCalledOnce()
    expect(await readFile(logPath, 'utf8')).toBe('')
  })
})
