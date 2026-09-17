import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  desktopWorkspaceApi,
  type DesktopWorkspaceApi
} from './desktop-workspace'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('desktopWorkspaceApi', () => {
  it('does not expose local Workspace control to an ordinary browser', () => {
    vi.stubGlobal('window', {})

    expect(desktopWorkspaceApi()).toBeNull()
  })

  it('returns the privileged Electron preload Workspace bridge', async () => {
    const snapshot = {
      phase: 'ready' as const,
      activeWorkspace: '/workspace/one',
      recentWorkspaces: [],
      error: null
    }
    const api: DesktopWorkspaceApi = {
      getSnapshot: vi.fn(async () => snapshot),
      selectDirectory: vi.fn(async () => snapshot),
      openPath: vi.fn(async () => snapshot),
      switchToWelcome: vi.fn(async () => ({ switched: true, snapshot }))
    }
    vi.stubGlobal('window', { api: { workbenchWorkspace: api } })

    expect(desktopWorkspaceApi()).toBe(api)
    await expect(desktopWorkspaceApi()?.getSnapshot()).resolves.toEqual(snapshot)
    await expect(desktopWorkspaceApi()?.selectDirectory('production')).resolves.toEqual(snapshot)
    expect(api.selectDirectory).toHaveBeenCalledWith('production')
    await expect(
      desktopWorkspaceApi()?.openPath('/workspace/two', 'debug')
    ).resolves.toEqual(snapshot)
    expect(api.openPath).toHaveBeenCalledWith('/workspace/two', 'debug')
  })
})
