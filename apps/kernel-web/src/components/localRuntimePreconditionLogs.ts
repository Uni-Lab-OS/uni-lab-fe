import type {
  LocalRuntimeLogEntry,
  LocalRuntimeLogsSnapshot,
  LocalRuntimeProcessKind
} from '../types/electron'

import { LOCAL_RUNTIME_LOG_MAX_LINES } from './localRuntimeLogModel'

export const ACTION_FEEDBACK_LOG_MARKER = '[UNILAB-ACTION-FEEDBACK]'

const PLC_DIAGNOSTIC_EVENTS = new Set([
  'precondition_check_started',
  'waiting',
  'satisfied',
  'timed_out'
])
const PLC_FOLLOW_UP_PHASES = new Set([
  'writing_parameters',
  'processing',
  'waiting_completion',
  'terminal'
])

/**
 * 读取一个本地日志页签，并把 Edge 中的 PLC 前置诊断投影到 PLC-Sim 页签。
 *
 * @param snapshot 当前会话的全部本地日志快照。
 * @param kind 用户选择的日志来源。
 * @returns 真实来源或附加诊断后的只读展示项；没有任何来源时返回 undefined。
 * @safety 只复制固定 JSON 日志标记，不改变磁盘日志或传感器权威事实。
 */
export function projectLocalRuntimeLogEntry(
  snapshot: LocalRuntimeLogsSnapshot | null,
  kind: LocalRuntimeProcessKind
): LocalRuntimeLogEntry | undefined {
  const source = snapshot?.entries.find((entry) => entry.kind === kind)
  if (kind !== 'simulator') return source

  const edge = snapshot?.entries.find((entry) => entry.kind === 'edge')
  const diagnosticLines = extractPlcDiagnosticLines(edge?.content ?? '')
  if (diagnosticLines.length === 0) return source

  const sourceLines = splitCompletedLines(source?.content ?? '')
  const combined = [...sourceLines, ...diagnosticLines]
  const visible = combined.slice(-LOCAL_RUNTIME_LOG_MAX_LINES)
  return {
    kind: 'simulator',
    content: visible.join('\n'),
    available: true,
    truncated: Boolean(
      source?.truncated || edge?.truncated ||
      combined.length > LOCAL_RUNTIME_LOG_MAX_LINES
    )
  }
}

/** 从 Edge 原文中筛出 S04 前置等待及其后续阶段诊断。 */
function extractPlcDiagnosticLines(content: string): string[] {
  const lines = splitCompletedLines(content)
  const seen = new Set<string>()
  return lines.filter((line) => {
    if (!line.includes(ACTION_FEEDBACK_LOG_MARKER) || seen.has(line)) {
      return false
    }
    const payload = parseMarkedPayload(line)
    if (!payload) return false
    const diagnosticEvent = asText(payload.diagnostic_event)
    const phase = asText(payload.phase)
    const selected = PLC_DIAGNOSTIC_EVENTS.has(diagnosticEvent)
      || PLC_FOLLOW_UP_PHASES.has(phase)
    if (selected) seen.add(line)
    return selected
  })
}

/** 从带固定标记的日志行中读取首个闭合 JSON 对象。 */
export function parseMarkedPayload(
  line: string
): Record<string, unknown> | null {
  const markerIndex = line.indexOf(ACTION_FEEDBACK_LOG_MARKER)
  if (markerIndex < 0) return null
  const jsonStart = line.indexOf('{', markerIndex + ACTION_FEEDBACK_LOG_MARKER.length)
  if (jsonStart < 0) return null
  const jsonEnd = findJsonObjectEnd(line, jsonStart)
  if (jsonEnd < 0) return null
  try {
    const value: unknown = JSON.parse(line.slice(jsonStart, jsonEnd + 1))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/** 查找 JSON 对象闭合位置，同时忽略字符串内部括号。 */
function findJsonObjectEnd(value: string, start: number): number {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function splitCompletedLines(content: string): string[] {
  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
