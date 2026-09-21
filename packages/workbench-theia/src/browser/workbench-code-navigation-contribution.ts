import type {
  KeybindingContribution,
  KeybindingRegistry
} from '@theia/core/lib/browser'
import type {
  TabBarToolbarContribution,
  TabBarToolbarRegistry
} from '@theia/core/lib/browser/shell/tab-bar-toolbar/tab-bar-toolbar-registry'
import type {
  CommandContribution,
  CommandRegistry
} from '@theia/core/lib/common/command'
import type {
  MenuContribution,
  MenuModelRegistry,
  MenuPath
} from '@theia/core/lib/common/menu'
import {
  EditorContextMenu,
  EditorWidget
} from '@theia/editor/lib/browser'
import { injectable } from '@theia/core/shared/inversify'

import {
  codeNavigationHandler,
  WORKBENCH_CODE_NAVIGATION_ACTIONS
} from './workbench-code-navigation'

export const WORKBENCH_CODE_NAVIGATION_MENU: MenuPath = [
  ...EditorContextMenu.NAVIGATION,
  'unilab_function_navigation'
]

/** 为文件模块暴露可发现的函数级代码导航入口。 */
@injectable()
export class WorkbenchCodeNavigationContribution implements
CommandContribution,
MenuContribution,
KeybindingContribution,
TabBarToolbarContribution {
  registerCommands(commands: CommandRegistry): void {
    for (const action of WORKBENCH_CODE_NAVIGATION_ACTIONS) {
      commands.registerCommand(
        action.command,
        codeNavigationHandler(commands, action.targetCommand)
      )
    }
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerSubmenu(
      WORKBENCH_CODE_NAVIGATION_MENU,
      '函数导航',
      { sortString: '0_unilab_function_navigation' }
    )
    WORKBENCH_CODE_NAVIGATION_ACTIONS.forEach((action, index) => {
      menus.registerMenuAction(WORKBENCH_CODE_NAVIGATION_MENU, {
        commandId: action.command.id,
        label: action.command.label,
        order: String(index + 1)
      })
    })
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    for (const action of WORKBENCH_CODE_NAVIGATION_ACTIONS) {
      keybindings.registerKeybinding({
        command: action.command.id,
        keybinding: action.keybinding,
        when: 'editorTextFocus'
      })
    }
  }

  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    WORKBENCH_CODE_NAVIGATION_ACTIONS.forEach((action, index) => {
      registry.registerItem({
        id: `unilab.code-navigation.toolbar.${index + 1}`,
        command: action.command.id,
        icon: action.icon,
        tooltip: action.tooltip,
        group: 'navigation',
        priority: 30 + index,
        isVisible: widget => widget instanceof EditorWidget
      })
    })
  }
}
