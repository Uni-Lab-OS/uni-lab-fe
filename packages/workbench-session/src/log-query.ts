/** 日志查询与 OS workspace_host/log_query.py 使用同一组级别、类别和记录语义。 */
export interface WorkbenchLogQuery {
  levels?: string[]
  categories?: Array<'runtime' | 'heartbeat'>
  heartbeat?: boolean
  limit: number
}
export const WORKBENCH_LOG_LEVELS = ['trace', 'debug', 'info', 'warning', 'error', 'critical', 'system', 'plain'] as const
export function workbenchLogCategory(raw: string): 'runtime' | 'heartbeat' {
  return /(?:[<>]\s*(?:PING|PONG)\b|\bkeepalive\s+(?:ping|pong)\b)/i.test(raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')) ? 'heartbeat' : 'runtime'
}
/** 显式心跳选项与普通级别取并集；省略时保留旧级别/类别交集合同。 */
export function matchesWorkbenchLogQuery(level: string, raw: string, query: WorkbenchLogQuery): boolean {
  const category = workbenchLogCategory(raw)
  if (query.heartbeat !== undefined && category === 'heartbeat') return query.heartbeat
  return (query.levels === undefined || query.levels.includes(level))
    && (query.categories === undefined || query.categories.includes(category))
}
export function workbenchLogQueryParameters(query: WorkbenchLogQuery): string {
  validate(query)
  const params = new URLSearchParams({ limit: String(query.limit) })
  if (query.levels !== undefined) params.set('levels', query.levels.join(','))
  if (query.categories !== undefined) params.set('categories', query.categories.join(','))
  if (query.heartbeat !== undefined) params.set('heartbeat', String(query.heartbeat))
  return params.toString()
}
/** 先合并多行记录，再从完整当前文件筛选；不反转义消息或截取字节尾部。 */
export function queryWorkbenchLogText(content: string, query: WorkbenchLogQuery): string {
  validate(query)
  const retained: string[] = []
  let ringStart = 0
  let pending = ''
  let pendingLevel = 'plain'
  let traceback = false
  let terminal = false
  const flush = () => {
    if (pending && matchesWorkbenchLogQuery(pendingLevel, pending, query)) {
      if (retained.length < query.limit) retained.push(pending)
      else { retained[ringStart] = pending; ringStart = (ringStart + 1) % query.limit }
    }
  }
  for (const match of content.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const raw = match[0]
    const clean = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\r\n]+$/, '')
    const level = logLevel(clean)
    if (level === 'plain' && clean.startsWith('Traceback (most recent call last):')) {
      if (pending && pendingLevel !== 'error' && pendingLevel !== 'critical') { flush(); pending = '' }
      pending += raw
      pendingLevel = pendingLevel === 'critical' ? 'critical' : 'error'
      traceback = true; terminal = false; continue
    }
    const chain = /^(During handling of the above exception|The above exception was the direct cause)/.test(clean)
    if (traceback && level === 'plain' && (!terminal || chain)) {
      pending += raw
      terminal = /^[A-Za-z_][\w.]*(?::(?:\s|$)|$)/.test(clean.trimStart())
      continue
    }
    flush(); pending = raw; pendingLevel = level; traceback = false; terminal = false
  }
  flush()
  return [...retained.slice(ringStart), ...retained.slice(0, ringStart)].join('')
}
function logLevel(line: string): string {
  if (line.startsWith('[launcher] ')) return 'system'
  for (const pattern of [/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*\|\s*([A-Z]+)\s*\|/,
    /^(?:\d{2}|\d{4})-\d{2}-\d{2}\s+\[[\d:,.]+\]\s+\[([A-Z]+)\]/, /^\[([A-Z]+)\]\s+/]) {
    const match = line.match(pattern)
    if (match) {
      const level = match[1]!.toLowerCase()
      return level === 'warn' ? 'warning' : level === 'fatal' ? 'critical'
        : WORKBENCH_LOG_LEVELS.slice(0, 6).some(value => value === level) ? level : 'info'
    }
  }
  return 'plain'
}
function validate(query: WorkbenchLogQuery): void {
  if ((query.heartbeat !== undefined && typeof query.heartbeat !== 'boolean')
    || !Number.isInteger(query.limit) || query.limit < 1 || query.limit > 2000
    || query.levels?.some(level => !WORKBENCH_LOG_LEVELS.some(value => value === level))
    || query.categories?.some(category => category !== 'runtime' && category !== 'heartbeat')) {
    throw new Error('日志筛选条件无效或条数不在 1–2000 范围')
  }
}
