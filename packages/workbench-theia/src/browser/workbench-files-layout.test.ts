import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  FILES_EDITOR_SPLIT_MODE,
  isLeftContentPanelCollapsed,
  shouldKeepFilesLayout,
  shouldMoveEditorBesideExplorer
} from './workbench-files-layout'

let contributionSource = ''
let widgetSource = ''

beforeAll(async () => {
  ;[contributionSource, widgetSource] = await Promise.all([
    readFile(
      fileURLToPath(new URL('./workbench-files-contribution.ts', import.meta.url)),
      'utf8'
    ),
    readFile(
      fileURLToPath(new URL('./unilab-workbench-widget.tsx', import.meta.url)),
      'utf8'
    )
  ])
})

describe('workbench files leftover layout', () => {
  it('keeps the files column only when the left panel is expanded', () => {
    expect(shouldKeepFilesLayout(true, false)).toBe(true)
    expect(shouldKeepFilesLayout(true, true)).toBe(false)
    expect(shouldKeepFilesLayout(false, false)).toBe(false)
    expect(shouldKeepFilesLayout(false, true)).toBe(false)
  })

  it('treats a collapsed Theia left panel as closed', () => {
    const panel = (collapsed: boolean): Element => ({
      classList: {
        contains: (name: string) => collapsed && name === 'theia-mod-collapsed'
      }
    } as Element)

    expect(isLeftContentPanelCollapsed(panel(true))).toBe(true)
    expect(isLeftContentPanelCollapsed(panel(false))).toBe(false)
    expect(isLeftContentPanelCollapsed(null)).toBe(false)
  })

  it('closes product files state when Theia collapses the explorer', () => {
    expect(contributionSource).toContain('syncFilesWithLeftPanel')
    expect(contributionSource).toContain("collapsePanel('left')")
    expect(contributionSource).toContain('clearFilesLayoutReservation')
    expect(contributionSource).toContain('isLeftContentPanelCollapsed')
  })

  it('places source beside the explorer instead of to the right of workflow debug', () => {
    expect(FILES_EDITOR_SPLIT_MODE).toBe('split-left')
    expect(shouldMoveEditorBesideExplorer({
      sameTabBar: false,
      editorLeft: 800,
      workbenchLeft: 400
    })).toBe(true)
    expect(shouldMoveEditorBesideExplorer({
      sameTabBar: true,
      editorLeft: 400,
      workbenchLeft: 400
    })).toBe(true)
    expect(shouldMoveEditorBesideExplorer({
      sameTabBar: false,
      editorLeft: 400,
      workbenchLeft: 800
    })).toBe(false)
    expect(contributionSource).toContain('FILES_EDITOR_SPLIT_MODE')
    expect(contributionSource).toContain('shouldMoveEditorBesideExplorer')
    expect(contributionSource).not.toContain("mode: 'split-right'")
    expect(widgetSource).toContain('FILES_EDITOR_SPLIT_MODE')
    expect(widgetSource).not.toContain("mode: 'split-right'")
  })
})
