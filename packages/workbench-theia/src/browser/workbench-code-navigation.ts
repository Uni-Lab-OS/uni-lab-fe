import type {
  Command,
  CommandHandler,
  CommandRegistry
} from '@theia/core/lib/common/command'

export interface WorkbenchCodeNavigationAction {
  command: Command
  targetCommand: string
  icon: string
  tooltip: string
  keybinding: string
}

export const WORKBENCH_CODE_NAVIGATION_ACTIONS: readonly WorkbenchCodeNavigationAction[] = [
  {
    command: {
      id: 'unilab.code-navigation.go-to-definition',
      label: '转到函数定义',
      category: '文件 · 函数导航'
    },
    targetCommand: 'editor.action.revealDefinition',
    icon: 'codicon codicon-go-to-file',
    tooltip: '转到函数定义（F12 / Cmd+点击）',
    keybinding: 'f12'
  },
  {
    command: {
      id: 'unilab.code-navigation.find-references',
      label: '查找函数引用',
      category: '文件 · 函数导航'
    },
    targetCommand: 'editor.action.goToReferences',
    icon: 'codicon codicon-references',
    tooltip: '查找函数引用（Shift+F12）',
    keybinding: 'shift+f12'
  },
  {
    command: {
      id: 'unilab.code-navigation.call-hierarchy',
      label: '查看函数调用层次',
      category: '文件 · 函数导航'
    },
    targetCommand: 'callhierarchy:open',
    icon: 'codicon codicon-type-hierarchy-sub',
    tooltip: '查看调用方与函数调用关系（Cmd/Ctrl+F1）',
    keybinding: 'ctrlcmd+f1'
  }
]

/** 将产品命令代理到 Monaco/Theia 的语言服务命令，不在前端自行解析源码。 */
export function codeNavigationHandler(
  commands: Pick<CommandRegistry, 'executeCommand' | 'isEnabled' | 'isVisible'>,
  targetCommand: string
): CommandHandler {
  return {
    execute: (...args: unknown[]) => commands.executeCommand(
      targetCommand,
      ...args
    ),
    isEnabled: (...args: unknown[]) => commands.isEnabled(
      targetCommand,
      ...args
    ),
    isVisible: (...args: unknown[]) => commands.isVisible(
      targetCommand,
      ...args
    )
  }
}
