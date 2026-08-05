import type {
  LocalRuntimeCustomEdgeCommand,
  LocalRuntimeEnvironmentVariable
} from '../shared/localRuntime'
import { posix, win32 } from 'node:path'

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
  workingDirectory: string
  environment: LocalRuntimeEnvironmentVariable[]
}

const MAX_EXECUTABLE_LENGTH = 4_096
const MAX_WORKING_DIRECTORY_LENGTH = 4_096
const MAX_ARGUMENT_COUNT = 256
const MAX_ARGUMENT_LENGTH = 8_192
const MAX_ENVIRONMENT_COUNT = 64
const MAX_ENVIRONMENT_NAME_LENGTH = 128
const MAX_ENVIRONMENT_VALUE_LENGTH = 8_192
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SENSITIVE_ENVIRONMENT_NAME_PATTERN =
  /(?:^|_)(?:AUTH|COOKIE|KEY|PASS|PASSWORD|SECRET|TOKEN)(?:_|$)/i
const TOKEN_PATTERN = /\{\{([a-z_]+)\}\}/g
const UNRESOLVED_TOKEN_PATTERN = /\{\{[^{}]+\}\}/

/**
 * 将用户保存的领域侧 Edge 命令模板解析为可直接传给 `spawn` 的结构化命令。
 *
 * @param template 用户配置的可执行文件、工作目录、逐项参数和非敏感环境变量覆盖。
 * @param tokens 由 Electron 主进程从已校验路径和固定端口构造的占位符值。
 * @param platform 当前目标平台，用于拒绝 Windows 下不能直接执行的批处理文件。
 * @returns 不含 shell 拼接、可直接用于子进程启动的结构化解析结果。
 * @throws 当路径、参数或环境变量越界，或试图覆盖启动器权威变量时抛出。
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
  const workingDirectoryTemplate = template.workingDirectory.trim()
  if (!workingDirectoryTemplate) throw new Error('请输入 Edge 自定义工作目录')
  if (workingDirectoryTemplate.length > MAX_WORKING_DIRECTORY_LENGTH) {
    throw new Error('Edge 自定义工作目录路径过长')
  }
  const workingDirectory = expandCommandTokens(
    workingDirectoryTemplate,
    tokens,
    '工作目录'
  )
  const absoluteWorkingDirectory = platform === 'win32'
    ? win32.isAbsolute(workingDirectory)
    : posix.isAbsolute(workingDirectory)
  if (!absoluteWorkingDirectory) {
    throw new Error('Edge 自定义工作目录必须是绝对路径')
  }
  const environment = resolveEnvironmentOverrides(
    template.environment,
    tokens,
    platform
  )
  return { command, args, workingDirectory, environment }
}

/**
 * 校验并展开用户环境变量覆盖，确保其不会取代启动器托管的运行事实或保存秘密。
 *
 * @param entries renderer 提交的环境变量名称和值。
 * @param tokens 当前启动计划允许使用的受控占位符。
 * @param platform 当前目标平台，用于 Windows 大小写不敏感去重。
 * @returns 名称规范化、值已展开且顺序稳定的环境变量副本。
 * @throws 当名称非法、重复、敏感、受保护或值越界时抛出。
 */
function resolveEnvironmentOverrides(
  entries: LocalRuntimeEnvironmentVariable[],
  tokens: LocalRuntimeEdgeCommandTokens,
  platform: NodeJS.Platform
): LocalRuntimeEnvironmentVariable[] {
  if (entries.length > MAX_ENVIRONMENT_COUNT) {
    throw new Error(`Edge 自定义环境变量不能超过 ${MAX_ENVIRONMENT_COUNT} 项`)
  }
  const seenNames = new Set<string>()
  return entries.map((entry, index) => {
    const name = entry.name.trim()
    if (!name || name.length > MAX_ENVIRONMENT_NAME_LENGTH) {
      throw new Error(`Edge 自定义环境变量第 ${index + 1} 项名称无效`)
    }
    if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new Error(`Edge 自定义环境变量 ${name} 的名称格式无效`)
    }
    const comparisonName = platform === 'win32' ? name.toUpperCase() : name
    if (seenNames.has(comparisonName)) {
      throw new Error(`Edge 自定义环境变量 ${name} 重复`)
    }
    seenNames.add(comparisonName)
    if (isProtectedEnvironmentName(name)) {
      throw new Error(`环境变量 ${name} 由 Edge 启动器托管，不能覆盖`)
    }
    if (SENSITIVE_ENVIRONMENT_NAME_PATTERN.test(name)) {
      throw new Error(`环境变量 ${name} 可能包含敏感信息，不能保存在本地启动配置中`)
    }
    if (entry.value.length > MAX_ENVIRONMENT_VALUE_LENGTH) {
      throw new Error(`Edge 自定义环境变量 ${name} 的值过长`)
    }
    return {
      name,
      value: expandCommandTokens(entry.value, tokens, `环境变量 ${name}`)
    }
  })
}

/**
 * 判断环境变量是否属于 Conda、端口、运行数据库或可观测性等启动器权威范围。
 *
 * @param name 已通过格式校验的环境变量名称。
 * @returns 启动器必须保持最终写权威时返回 true。
 */
function isProtectedEnvironmentName(name: string): boolean {
  const normalizedName = name.toUpperCase()
  return normalizedName === 'PATH'
    || normalizedName === 'PYTHONPATH'
    || normalizedName === 'PYTHONUNBUFFERED'
    || normalizedName === 'ROS_DOMAIN_ID'
    || normalizedName === 'UNILABOS_RUNTIME_DB'
    || normalizedName === 'UNILABOS_HOSTLINKCONFIG_PORT'
    || normalizedName.startsWith('CONDA_')
    || normalizedName.startsWith('UNILABOS_OBSERVABILITYCONFIG_')
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
