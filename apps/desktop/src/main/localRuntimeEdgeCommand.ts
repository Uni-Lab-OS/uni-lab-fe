import type { LocalRuntimeCustomEdgeCommand } from '../shared/localRuntime'
import { win32 } from 'node:path'

export type LocalRuntimeEdgeCommandToken =
  | 'unilab'
  | 'python'
  | 'workspace'
  | 'graph'
  | 'config'
  | 'working_dir'
  | 'edge_http_port'
  | 'hostlink_port'

export type LocalRuntimeEdgeCommandTokens = Record<
  LocalRuntimeEdgeCommandToken,
  string
>

export interface ResolvedLocalRuntimeEdgeCommand {
  command: string
  args: string[]
}

const MAX_EXECUTABLE_LENGTH = 4_096
const MAX_ARGUMENT_COUNT = 256
const MAX_ARGUMENT_LENGTH = 8_192
const TOKEN_PATTERN = /\{\{([a-z_]+)\}\}/g
const UNRESOLVED_TOKEN_PATTERN = /\{\{[^{}]+\}\}/

/**
 * 将用户保存的领域侧 Edge 命令模板解析为可直接传给 `spawn` 的结构化命令。
 *
 * @param template 用户配置的可执行文件和逐项参数；空白参数行会被忽略。
 * @param tokens 由 Electron 主进程从已校验路径和固定端口构造的占位符值。
 * @param platform 当前目标平台，用于拒绝 Windows 下不能直接执行的批处理文件。
 * @returns 不含 shell 拼接、可直接作为 `command` 与 `args` 使用的解析结果。
 * @throws 当命令为空、超出边界、包含未知占位符、NUL 字符或 Windows 批处理文件时抛出。
 */
export function resolveLocalRuntimeEdgeCommand(
  template: LocalRuntimeCustomEdgeCommand,
  tokens: LocalRuntimeEdgeCommandTokens,
  platform: NodeJS.Platform
): ResolvedLocalRuntimeEdgeCommand {
  const executable = template.executable.trim()
  if (!executable) throw new Error('请输入 Edge 自定义可执行文件')
  if (executable.length > MAX_EXECUTABLE_LENGTH) {
    throw new Error('Edge 自定义可执行文件路径过长')
  }
  if (template.args.length > MAX_ARGUMENT_COUNT) {
    throw new Error(`Edge 自定义参数不能超过 ${MAX_ARGUMENT_COUNT} 项`)
  }

  const command = expandCommandTokens(executable, tokens, '可执行文件')
  if (platform === 'win32') {
    const executableName = command.split(/[\\/]/).at(-1)?.toLowerCase()
    if (
      /\.(?:cmd|bat|ps1)$/i.test(command)
      || ['cmd.exe', 'powershell.exe', 'pwsh.exe'].includes(executableName ?? '')
    ) {
      throw new Error(
        'Windows shell 或脚本不能作为原生 Edge 可执行文件；请选择 Conda 环境中的 unilab.exe 或 python.exe'
      )
    }
    if (!win32.isAbsolute(command) || !/\.exe$/i.test(command)) {
      throw new Error('Windows Edge 自定义可执行文件必须是绝对 .exe 路径')
    }
  }

  const args = template.args.flatMap((argument, index) => {
    if (!argument.trim()) return []
    if (argument.length > MAX_ARGUMENT_LENGTH) {
      throw new Error(`Edge 自定义参数第 ${index + 1} 项过长`)
    }
    return [expandCommandTokens(argument, tokens, `参数第 ${index + 1} 项`)]
  })
  return { command, args }
}

/**
 * 展开单个命令字段中的受控占位符，同时阻止未知模板和 NUL 字符进入子进程参数。
 *
 * @param value 待解析的可执行文件或单个参数原文。
 * @param tokens 当前启动计划允许使用的占位符及其值。
 * @param label 用于错误信息定位的中文字段名称。
 * @returns 已展开且可安全作为单个 `spawn` 字段传递的字符串。
 * @throws 当字段包含未知占位符或 NUL 字符时抛出。
 */
function expandCommandTokens(
  value: string,
  tokens: LocalRuntimeEdgeCommandTokens,
  label: string
): string {
  if (value.includes('\0')) throw new Error(`Edge 自定义${label}不能包含 NUL 字符`)
  const expanded = value.replace(TOKEN_PATTERN, (_match, token: string) => {
    if (!(token in tokens)) return `{{${token}}}`
    return tokens[token as LocalRuntimeEdgeCommandToken]
  })
  const unresolved = expanded.match(UNRESOLVED_TOKEN_PATTERN)?.[0]
  if (unresolved) {
    throw new Error(`Edge 自定义${label}包含未知占位符：${unresolved}`)
  }
  return expanded
}
