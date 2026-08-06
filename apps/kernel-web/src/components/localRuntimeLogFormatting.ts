import {
  ACTION_FEEDBACK_LOG_MARKER,
  parseMarkedPayload
} from './localRuntimePreconditionLogs'

export type LocalRuntimeLogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warning'
  | 'error'
  | 'critical'
  | 'system'
  | 'plain'

export interface FormattedLocalRuntimeLogRow {
  time: string
  level: LocalRuntimeLogLevel
  source: string
  message: string
}

const ANSI_CSI_PATTERN = new RegExp(
  `(?:${String.fromCharCode(27)}\\[|${String.fromCharCode(155)})[0-?]*[ -/]*[@-~]`,
  'g'
)
const ANSI_STRING_PATTERN = new RegExp(
  `(?:${String.fromCharCode(27)}\\]|${String.fromCharCode(157)})[\\s\\S]*?(?:${String.fromCharCode(7)}|${String.fromCharCode(27)}\\\\|${String.fromCharCode(156)})|(?:${String.fromCharCode(27)}[PX^_]|[${String.fromCharCode(144)}${String.fromCharCode(152)}${String.fromCharCode(158)}${String.fromCharCode(159)}])[\\s\\S]*?(?:${String.fromCharCode(27)}\\\\|${String.fromCharCode(156)})`,
  'g'
)
const ANSI_SINGLE_ESCAPE_PATTERN = new RegExp(
  `${String.fromCharCode(27)}[ -/]*[0-~]`,
  'g'
)
const ANSI_C1_PATTERN = /[\u0080-\u009f]/g
const PHOENIX_DEPENDENCY_MISSING_PATTERN =
  /Phoenix[^\r\n]*未安装\s+Arize Phoenix/i
const OTLP_TRACE_PATH = '/api/v1/observability/otlp/v1/traces'
const CURRENT_EDGE_LAUNCH_PATTERN =
  /^\[launcher\]\s+\S+\s+starting\s*$/gm

/**
 * 检测当前 Edge 启动会话是否缺少 Phoenix 可观测性依赖。
 *
 * @param content Edge 当前日志窗口的原始文本。
 * @returns 最新启动会话同时包含依赖缺失与 OTLP 503 时返回 true。
 * @throws 不抛出异常；无法识别的文本视为没有命中。
 * @safety 先剥离终端控制码，只做固定文本匹配，不执行日志内容。
 */
export function detectPhoenixObservabilityDependencyIssue(
  content: string
): boolean {
  const sanitizedContent = prepareLocalRuntimeLogCopyText(content)
  const launchMarkers = [...sanitizedContent.matchAll(CURRENT_EDGE_LAUNCH_PATTERN)]
  const latestLaunch = launchMarkers.at(-1)
  const currentLaunchContent = latestLaunch?.index === undefined
    ? sanitizedContent
    : sanitizedContent.slice(latestLaunch.index)

  return PHOENIX_DEPENDENCY_MISSING_PATTERN.test(currentLaunchContent)
    && currentLaunchContent.split(/\r?\n/).some((line) => (
      line.includes(OTLP_TRACE_PATH) && /\b503\b/.test(line)
    ))
}

/**
 * 清理并格式化日志，同时把 Python traceback 合并到一条错误记录。
 *
 * @param content 当前来源的原始日志窗口。
 * @returns 可按级别筛选和窗口化渲染的结构化日志记录；内部空行作为普通记录保留。
 * @throws 不抛出异常；无法识别的行以普通日志原文保留。
 * @safety 仅移除终端控制码，不执行或解释日志中的控制内容。
 */
export function formatLocalRuntimeLog(
  content: string
): FormattedLocalRuntimeLogRow[] {
  const rows: FormattedLocalRuntimeLogRow[] = []
  let tracebackRowIndex: number | null = null
  let tracebackTerminalLineSeen = false
  const lines = prepareLocalRuntimeLogCopyText(content).split(/\r?\n/)
  // 以换行符结束只表示最后一行完成，不额外制造一条空记录；内部空行仍需保留。
  if (lines.at(-1) === '') lines.pop()

  lines.forEach((line) => {
    const row = formatLocalRuntimeLogLine(line)
    if (isPythonTracebackHeader(row)) {
      const previousIndex = rows.length - 1
      const previous = rows[previousIndex]
      if (previous && (
        previous.level === 'error' || previous.level === 'critical'
      )) {
        rows[previousIndex] = {
          ...previous,
          message: `${previous.message}\n${row.message}`
        }
        tracebackRowIndex = previousIndex
      } else {
        rows.push({
          ...row,
          level: 'error',
          source: row.source || 'Python'
        })
        tracebackRowIndex = rows.length - 1
      }
      tracebackTerminalLineSeen = false
      return
    }

    if (tracebackRowIndex !== null && row.level === 'plain') {
      if (
        tracebackTerminalLineSeen
        && !isPythonTracebackChainSeparator(row.message)
      ) {
        tracebackRowIndex = null
        tracebackTerminalLineSeen = false
        rows.push(row)
        return
      }
      const tracebackRow = rows[tracebackRowIndex]
      if (tracebackRow) {
        rows[tracebackRowIndex] = {
          ...tracebackRow,
          message: `${tracebackRow.message}\n${row.message}`
        }
        tracebackTerminalLineSeen = isPythonTracebackTerminalLine(row.message)
        return
      }
    }

    tracebackRowIndex = null
    tracebackTerminalLineSeen = false
    rows.push(row)
  })

  return rows
}

/**
 * 生成可安全写入剪贴板的日志原文。
 *
 * @param content 当前日志来源的原始文本。
 * @returns 只移除终端控制序列、保留换行与缩进的文本。
 * @throws 不抛出异常。
 * @safety 不执行日志内容，也不访问剪贴板或文件系统。
 */
export function prepareLocalRuntimeLogCopyText(content: string): string {
  return content
    .replace(ANSI_STRING_PATTERN, '')
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_SINGLE_ESCAPE_PATTERN, '')
    .replace(ANSI_C1_PATTERN, '')
}

/**
 * 判断普通日志行是否为 Python traceback 的起始标记。
 *
 * @param row 已清理且初步格式化的日志行。
 * @returns 行是否应开启 traceback 多行合并。
 * @throws 不抛出异常。
 * @safety 只做精确前缀匹配，不执行日志文本。
 */
function isPythonTracebackHeader(row: FormattedLocalRuntimeLogRow): boolean {
  return row.level === 'plain'
    && row.message.startsWith('Traceback (most recent call last):')
}

/**
 * 判断 traceback 普通行是否已经给出最终异常类型与消息。
 *
 * @param message traceback 中尚未结构化的原始行。
 * @returns 是否为类似 ValueError 或 module.CustomFailure 的异常终止行。
 * @throws 不抛出异常。
 * @safety 只匹配 Python 标识符和冒号，不吞并后续无关普通日志。
 */
function isPythonTracebackTerminalLine(message: string): boolean {
  return /^[A-Za-z_][\w.]*(?::(?:\s|$)|$)/.test(message.trimStart())
}

/**
 * 判断最终异常后的文本是否开启 Python 链式异常上下文。
 *
 * @param message traceback 中的普通文本行。
 * @returns 是否为 Python 固定的链式异常分隔提示。
 * @throws 不抛出异常。
 * @safety 只接受 Python 固定前缀，避免扩展 traceback 合并范围。
 */
function isPythonTracebackChainSeparator(message: string): boolean {
  return message.startsWith('During handling of the above exception')
    || message.startsWith('The above exception was the direct cause')
}

/**
 * 把一行已清理日志转换为结构化展示字段。
 *
 * @param line 不含终端控制序列的单行日志原文。
 * @returns 常见格式的时间、级别、来源和正文；未知格式完整保留为普通日志。
 * @throws 不抛出异常。
 * @safety 只使用固定正则解析文本，不执行消息中的任何内容。
 */
function formatLocalRuntimeLogLine(
  line: string
): FormattedLocalRuntimeLogRow {
  const actionFeedback = formatActionFeedbackLogLine(line)
  if (actionFeedback) return actionFeedback

  const launcher = line.match(/^\[launcher\]\s+(\S+)\s*(.*)$/)
  if (launcher) {
    return {
      time: compactLogTime(launcher[1] ?? ''),
      level: 'system',
      source: 'launcher',
      message: launcher[2] ?? ''
    }
  }

  const loguru = line.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s*\|\s*([A-Z]+)\s*\|\s*(?:(.*?)\s+-\s+)?(.*)$/
  )
  if (loguru) {
    return {
      time: loguru[2] ?? '',
      level: normalizeLogLevel(loguru[3]),
      source: (loguru[4] ?? '').trim(),
      message: loguru[5] ?? ''
    }
  }

  const unilab = line.match(
    /^(?:\d{2}|\d{4})-\d{2}-\d{2}\s+\[([\d:,\.]+)\]\s+\[([A-Z]+)\]\s+(.*)$/
  )
  if (unilab) {
    const remainder = unilab[3] ?? ''
    const sourceAndMessage = remainder.match(
      /^(\S+)\s+(?=(?:\[[^\]]+\]|\S))([\s\S]+)$/
    )
    const legacyContext = remainder.match(
      /^(.*?)(?:\s+\[[^\]]+\]\s+\[([^\]]+)\])$/
    )
    return {
      time: unilab[1] ?? '',
      level: normalizeLogLevel(unilab[2]),
      source: legacyContext?.[2]
        ?? sourceAndMessage?.[1]
        ?? 'unilabos',
      message: legacyContext?.[1]
        ?? sourceAndMessage?.[2]
        ?? remainder
    }
  }

  const ros = line.match(
    /^\[([A-Z]+)\]\s+\[([^\]]+)\](?:\s+\[([^\]]+)\])?:\s*(.*)$/
  )
  if (ros) {
    return {
      time: ros[2] ?? '',
      level: normalizeLogLevel(ros[1]),
      source: ros[3] ?? 'ROS',
      message: ros[4] ?? ''
    }
  }

  const status = line.match(/^\[([A-Z]+)\]\s+(.*)$/)
  if (status) {
    return {
      time: '',
      level: normalizeLogLevel(status[1]),
      source: 'unilabos',
      message: status[2] ?? ''
    }
  }

  return { time: '', level: 'plain', source: '', message: line }
}

/** 把固定结构化动作反馈转换为 PLC/运行日志的可读诊断行。 */
function formatActionFeedbackLogLine(
  line: string
): FormattedLocalRuntimeLogRow | null {
  if (!line.includes(ACTION_FEEDBACK_LOG_MARKER)) return null
  const payload = parseMarkedPayload(line)
  if (!payload) return null
  const phase = textValue(payload.phase)
  const diagnosticEvent = textValue(payload.diagnostic_event) || phase
  const observedAt = textValue(payload.observed_at)
  const effect = recordValue(payload.effect)
  const eventLabel = actionFeedbackEventLabel(diagnosticEvent)
  const fields = [
    `工作流任务（WorkflowTask） ${textValue(payload.task_uuid) || '—'}`,
    `作业（Job） ${textValue(payload.job_uuid) || '—'}`,
    `派发效果（DispatchEffect） ${
      textValue(effect?.identity) || textValue(payload.feedback_event_id) || '—'
    }`
  ]
  if (payload.sensor !== undefined) {
    fields.push(`变量 ${displayLogValue(payload.sensor)}`)
  }
  if (payload.position !== undefined) {
    fields.push(`位置 ${displayLogValue(payload.position)}`)
  }
  if (payload.expected_value !== undefined) {
    fields.push(`期望 ${displayLogValue(payload.expected_value)}`)
  }
  if (payload.actual_value !== undefined) {
    fields.push(`实际 ${displayLogValue(payload.actual_value)}`)
  }
  if (payload.elapsed_s !== undefined && payload.timeout_s !== undefined) {
    fields.push(
      `已等待 ${displayLogValue(payload.elapsed_s)} 秒/` +
      `${displayLogValue(payload.timeout_s)} 秒`
    )
  }
  if (observedAt) fields.push(`时间 ${observedAt}`)

  return {
    time: compactLogTime(observedAt),
    level: diagnosticEvent === 'timed_out' ? 'warning' :
      phase === 'terminal' && textValue(payload.outcome) !== 'succeeded'
        ? 'error'
        : 'info',
    source: phase === 'waiting_precondition'
      ? 'PLC 前置诊断'
      : 'PLC 阶段诊断',
    message: [
      `${diagnosticEvent || 'action_feedback'} · ${eventLabel}`,
      ...fields
    ].join(' · ')
  }
}

function actionFeedbackEventLabel(event: string): string {
  switch (event) {
    case 'precondition_check_started':
      return '请求已到达 PLC 网关'
    case 'waiting':
      return '正在等待前置传感器'
    case 'satisfied':
      return '前置传感器已满足'
    case 'timed_out':
      return '前置传感器等待超时'
    case 'writing_parameters':
      return '正在写入 PLC 参数'
    case 'processing':
      return 'PLC 正在加工'
    case 'waiting_completion':
      return '正在等待 PLC 完成信号'
    case 'terminal':
      return '动作已进入终态'
    default:
      return '设备动作阶段更新'
  }
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function displayLogValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 把 ISO 时间压缩为适合日志元数据列展示的时间部分。
 *
 * @param value 启动器日志中的时间文本。
 * @returns ISO 时间的时分秒部分，或无法识别时的原值。
 * @throws 不抛出异常。
 * @safety 只读取字符串，不进行时区换算或修改时间语义。
 */
function compactLogTime(value: string): string {
  const match = value.match(/T(\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/)
  return match?.[1] ?? value
}

/**
 * 把日志库级别文本归一到界面支持的固定集合。
 *
 * @param value 日志来源提供的大小写不敏感级别。
 * @returns 对应界面级别；未知级别按 info 保底。
 * @throws 不抛出异常。
 * @safety 返回值来自封闭枚举，不把任意输入传播到样式属性。
 */
function normalizeLogLevel(
  value: string | undefined
): LocalRuntimeLogLevel {
  switch ((value ?? '').toLowerCase()) {
    case 'trace':
      return 'trace'
    case 'debug':
      return 'debug'
    case 'warn':
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'fatal':
    case 'critical':
      return 'critical'
    default:
      return 'info'
  }
}
