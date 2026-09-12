import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { WorkbenchLogQuery } from './log-query'
import { queryWorkbenchLogText, workbenchLogCategory, workbenchLogQueryParameters } from './log-query'
const prefix = '2026-09-09 10:00:00 | '
const wire = String.raw`{"Message":"{\"MethodName\":\"加液\"}"}`
const content = [
  `${prefix}ERROR | tcp - old error`,
  'Traceback (most recent call last):', '  File "a.py", line 1', 'RuntimeError: 中文错误',
  `${prefix}DEBUG | websockets.client.protocol - < PING aa`,
  `${prefix}DEBUG | websockets.client.protocol - > PONG aa`,
  `${prefix}INFO | ws - keepalive ping`,
  `${prefix}WARNING | tcp - ${wire}`
].join('\r\n') + '\r\n'
describe('complete-file log queries', () => {
  it('matches the shared OS/FE wire, ROS, LOGURU and traceback fixtures', () => {
    const fixture = JSON.parse(readFileSync(new URL('./log-query.fixture.json', import.meta.url), 'utf8')) as {
      content: string; cases: Array<{ query: WorkbenchLogQuery; expected: string }>
    }
    for (const item of fixture.cases) expect(queryWorkbenchLogText(fixture.content, item.query)).toBe(item.expected)
  })
  it('filters the complete history before limiting, including errors older than 500 records', () => {
    const recent = Array.from({ length: 2500 }, (_, i) => `${prefix}INFO | app - recent ${i}\n`).join('')
    expect(queryWorkbenchLogText(content + recent, { levels: ['error'], limit: 1 })).toBe(content.split(`${prefix}DEBUG`)[0])
  })
  it('classifies heartbeat independently of severity, supports OR and explicit empty sets', () => {
    expect(queryWorkbenchLogText(content, { levels: ['debug', 'info'], categories: ['heartbeat'], limit: 2 }))
      .toBe(`${prefix}DEBUG | websockets.client.protocol - > PONG aa\r\n${prefix}INFO | ws - keepalive ping\r\n`)
    expect(queryWorkbenchLogText(content, { levels: [], limit: 500 })).toBe('')
    expect(queryWorkbenchLogText(content, { categories: [], limit: 500 })).toBe('')
    expect(workbenchLogCategory('> pOnG abc')).toBe('heartbeat')
    expect(workbenchLogCategory('device method ping test')).toBe('runtime')
  })
  it('unions all heartbeat severities with only non-heartbeat selected levels before the limit', () => {
    const runtimeDebug = `${prefix}DEBUG | device - ordinary debug\r\n`
    const errorHeartbeat = `${prefix}ERROR | socket - > PONG alarm\r\n`
    const newer = Array.from({ length: 700 }, () => runtimeDebug).join('')
    const history = content + errorHeartbeat + newer
    const selected = queryWorkbenchLogText(history, { levels: ['error'], heartbeat: true, limit: 500 })
    expect(selected).toContain('old error')
    expect(selected).toContain('< PING aa')
    expect(selected).toContain('keepalive ping')
    expect(selected).toContain('> PONG alarm')
    expect(selected).not.toContain('ordinary debug')
    expect(queryWorkbenchLogText(history, { levels: ['error'], heartbeat: false, limit: 500 })).not.toContain('PONG')
    expect(queryWorkbenchLogText(history, { levels: [], heartbeat: true, limit: 500 })).toContain('< PING')
    expect(queryWorkbenchLogText(history, { levels: [], heartbeat: true, limit: 500 })).not.toContain('old error')
    expect(queryWorkbenchLogText(history, { levels: [], heartbeat: false, limit: 500 })).toBe('')
    expect(new URLSearchParams(workbenchLogQueryParameters({ heartbeat: false, limit: 500 })).get('heartbeat')).toBe('false')
  })
  it('preserves nested wire escaping, readable Chinese and CRLF exactly', () => {
    expect(queryWorkbenchLogText(content, { levels: ['warning'], categories: ['runtime'], limit: 1 }))
      .toBe(`${prefix}WARNING | tcp - ${wire}\r\n`)
  })
  it('serializes explicit empty filters and never adds a byte-tail limit', () => {
    const params = new URLSearchParams(workbenchLogQueryParameters({ levels: [], categories: ['heartbeat'], limit: 100 }))
    expect(params.get('levels')).toBe(''); expect(params.get('categories')).toBe('heartbeat')
    expect(params.has('maxBytes')).toBe(false)
    expect(new URLSearchParams(workbenchLogQueryParameters({ limit: 500 })).has('levels')).toBe(false)
    expect(() => workbenchLogQueryParameters({ limit: 2001 })).toThrow()
  })
})
