import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import {
  codeNavigationHandler,
  WORKBENCH_CODE_NAVIGATION_ACTIONS
} from './workbench-code-navigation'

const [contributionSource, moduleSource] = await Promise.all([
  readFile(fileURLToPath(new URL(
    './workbench-code-navigation-contribution.ts',
    import.meta.url
  )), 'utf8'),
  readFile(fileURLToPath(new URL(
    './unilab-workbench-frontend-module.ts',
    import.meta.url
  )), 'utf8')
])

describe('Workbench code navigation contribution', () => {
  it('delegates availability and execution to the language-service command', async () => {
    const commands = {
      executeCommand: vi.fn().mockResolvedValue('done'),
      isEnabled: vi.fn().mockReturnValue(true),
      isVisible: vi.fn().mockReturnValue(false)
    }
    const handler = codeNavigationHandler(
      commands as never,
      'editor.action.revealDefinition'
    )

    expect(handler.isEnabled?.('selection')).toBe(true)
    expect(handler.isVisible?.('selection')).toBe(false)
    await expect(handler.execute('selection')).resolves.toBe('done')
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'editor.action.revealDefinition',
      'selection'
    )
  })

  it('registers definition, references and call hierarchy as one navigation surface', () => {
    expect(WORKBENCH_CODE_NAVIGATION_ACTIONS.map(action => (
      action.targetCommand
    ))).toEqual([
      'editor.action.revealDefinition',
      'editor.action.goToReferences',
      'callhierarchy:open'
    ])
    expect(WORKBENCH_CODE_NAVIGATION_ACTIONS.map(action => (
      action.keybinding
    ))).toEqual(['f12', 'shift+f12', 'ctrlcmd+f1'])
    expect(WORKBENCH_CODE_NAVIGATION_ACTIONS.map(action => (
      action.command.label
    ))).toEqual(['转到函数定义', '查找函数引用', '查看函数调用层次'])
  })

  it('publishes Chinese context-menu actions, keybindings and editor toolbar buttons', () => {
    expect(contributionSource).toContain("'unilab_function_navigation'")
    expect(contributionSource).toContain("'函数导航'")
    expect(contributionSource).toContain('registerMenuAction')
    expect(contributionSource).toContain('registerKeybinding')
    expect(contributionSource).toContain('registerToolbarItems')
    expect(contributionSource).toContain('widget instanceof EditorWidget')
    expect(moduleSource).toMatch(
      /bind\(CommandContribution\)\.toService\(WorkbenchCodeNavigationContribution\)/u
    )
    expect(moduleSource).toMatch(
      /bind\(MenuContribution\)\.toService\(WorkbenchCodeNavigationContribution\)/u
    )
    expect(moduleSource).toMatch(
      /bind\(KeybindingContribution\)\.toService\(WorkbenchCodeNavigationContribution\)/u
    )
    expect(moduleSource).toMatch(
      /bind\(TabBarToolbarContribution\)\.toService\([\s\S]*WorkbenchCodeNavigationContribution/u
    )
  })
})
