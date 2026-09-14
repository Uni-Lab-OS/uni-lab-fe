import { describe, expect, it, vi } from 'vitest'

import { switchWorkbenchWorkspaceToWelcome } from './workbenchWorkspaceTransition'

describe('switchWorkbenchWorkspaceToWelcome', () => {
  it('lands on a clean welcome document and reveals the window after deactivation', async () => {
    const events: string[] = []
    const welcomeUrl = new URL('file:///Applications/UniLab%20Workbench.app/Contents/Resources/app.asar/desktop/welcome.html')
    const snapshot = {
      phase: 'welcome' as const,
      activeWorkspace: null,
      recentWorkspaces: [],
      error: null,
    }
    const window = {
      isDestroyed: vi.fn(() => false),
      loadURL: vi.fn(async (url: string) => {
        events.push(`load:${url}`)
      }),
      show: vi.fn(() => events.push('show')),
      focus: vi.fn(() => events.push('focus')),
    }
    const controller = {
      welcomeUrl: welcomeUrl.toString(),
      getSnapshot: vi.fn(() => snapshot),
      deactivate: vi.fn(async () => {
        events.push('deactivate')
        return snapshot
      }),
    }
    const publishSnapshot = vi.fn(() => events.push('publish'))

    const result = await switchWorkbenchWorkspaceToWelcome({
      window,
      controller,
      publishSnapshot,
    })

    const switchingUrl = new URL(welcomeUrl.toString())
    switchingUrl.searchParams.set('switching', '1')
    expect(result).toEqual({ switched: true, snapshot })
    expect(events).toEqual([
      `load:${switchingUrl.toString()}`,
      'deactivate',
      `load:${welcomeUrl.toString()}`,
      'publish',
      'show',
      'focus',
    ])
  })

  it('does not reveal or publish to a destroyed window', async () => {
    const window = {
      isDestroyed: vi.fn(() => true),
      loadURL: vi.fn(async () => undefined),
      show: vi.fn(),
      focus: vi.fn(),
    }
    const controller = {
      welcomeUrl: 'file:///welcome.html',
      getSnapshot: vi.fn(() => ({
        phase: 'welcome' as const,
        activeWorkspace: null,
        recentWorkspaces: [],
        error: null,
      })),
      deactivate: vi.fn(async () => ({
        phase: 'welcome' as const,
        activeWorkspace: null,
        recentWorkspaces: [],
        error: null,
      })),
    }
    const publishSnapshot = vi.fn()

    const result = await switchWorkbenchWorkspaceToWelcome({
      window,
      controller,
      publishSnapshot,
    })

    expect(result.switched).toBe(false)
    expect(controller.deactivate).not.toHaveBeenCalled()
    expect(publishSnapshot).not.toHaveBeenCalled()
    expect(window.show).not.toHaveBeenCalled()
  })

  it('hands directory selection to the fresh welcome renderer', async () => {
    const loadedUrls: string[] = []
    const snapshot = {
      phase: 'welcome' as const,
      activeWorkspace: null,
      recentWorkspaces: [],
      error: null,
    }
    const welcomeUrl = 'file:///Applications/UniLab%20Workbench.app/Contents/Resources/app.asar/desktop/welcome.html'

    const result = await switchWorkbenchWorkspaceToWelcome({
      window: {
        isDestroyed: () => false,
        loadURL: async (url) => { loadedUrls.push(url) },
        show: vi.fn(),
        focus: vi.fn(),
      },
      controller: {
        welcomeUrl,
        getSnapshot: () => snapshot,
        deactivate: async () => snapshot,
      },
      selectDirectory: true,
      publishSnapshot: vi.fn(),
    })

    const selectingUrl = new URL(welcomeUrl)
    selectingUrl.searchParams.set('selectDirectory', '1')
    expect(result).toEqual({ switched: true, snapshot })
    expect(loadedUrls.at(-1)).toBe(selectingUrl.toString())
  })
})
