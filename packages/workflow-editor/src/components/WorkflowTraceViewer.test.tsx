import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { WorkflowTracePort } from '../traceRuntime'
import { WorkflowDebugger } from './WorkflowDebugger'
import {
  WorkflowTraceViewer,
  listWorkflowRunTraces,
  signozTraceUrl,
  traceMatchesWorkflowRun,
  workflowSpanSummaries,
  workflowTraceSummary
} from './WorkflowTraceViewer'

const RUN_ID = '01234567-89ab-cdef-0123-456789abcdef'

describe('WorkflowTraceViewer', () => {
  it('keeps the modal above material viewport labels and controls', async () => {
    const stylesheet = await readFile(
      fileURLToPath(new URL('./_workflow-trace.scss', import.meta.url)),
      'utf8'
    )
    const overlayRule = stylesheet.match(
      /\.workflow\s+:global\(\.workflow-runtime__trace-overlay\)\s*\{([^}]*)\}/u
    )?.[1]
    const zIndex = Number(overlayRule?.match(/z-index:\s*(\d+)/u)?.[1])

    expect(overlayRule).toMatch(/position:\s*fixed/u)
    expect(zIndex).toBeGreaterThan(1000)
  })

  it('offers the local SigNoz UI as an external Trace destination', () => {
    const runtime: WorkflowTracePort = {
      listTraces: async () => ({
        project_name: 'uni-lab-electron',
        traces: [],
        next_cursor: null
      }),
      getTrace: async (traceId) => ({
        project_name: 'uni-lab-electron',
        trace_id: traceId,
        spans: [],
        next_cursor: null
      })
    }
    const html = renderToStaticMarkup(
      <WorkflowTraceViewer
        open
        currentRunId={RUN_ID}
        runtime={runtime}
        onClose={() => {}}
      />
    )

    expect(html).toContain('href="http://127.0.0.1:30080/trace"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('打开 SigNoz')
  })

  it('builds a SigNoz detail link for the selected trace', () => {
    expect(signozTraceUrl('0123456789abcdef')).toBe(
      'http://127.0.0.1:30080/trace/0123456789abcdef'
    )
  })

  it('associates a trace with the current workflow run identifier', () => {
    const trace = {
      trace_id: 'f'.repeat(32),
      root_span_name: 'workflow.node.dispatch',
      start_time: '2026-08-02T08:00:00.000Z',
      latency_ms: 24.5,
      status_code: 'OK',
      spans: [
        {
          name: 'workflow.node.dispatch',
          attributes: {
            'workflow.task.uuid': '0123456789abcdef0123456789abcdef'
          }
        }
      ]
    }

    expect(traceMatchesWorkflowRun(trace, RUN_ID)).toBe(true)
    expect(workflowTraceSummary(trace, RUN_ID)).toMatchObject({
      name: 'workflow.node.dispatch',
      latencyMs: 24.5,
      spanCount: 1,
      status: 'OK',
      matchesCurrentRun: true
    })
  })

  it('orders spans by time and derives their parent depth', () => {
    const spans = workflowSpanSummaries([
      {
        name: 'device.driver.execute',
        context: { span_id: 'child' },
        parent_id: 'root',
        start_time: '2026-08-02T08:00:00.020Z',
        end_time: '2026-08-02T08:00:00.050Z',
        attributes: { 'device.id': 'pump-1' }
      },
      {
        name: 'workflow.node.dispatch',
        context: { span_id: 'root' },
        start_time: '2026-08-02T08:00:00.000Z',
        end_time: '2026-08-02T08:00:00.060Z'
      }
    ])

    expect(spans.map((span) => span.name)).toEqual([
      'workflow.node.dispatch',
      'device.driver.execute'
    ])
    expect(spans[0]?.depth).toBe(0)
    expect(spans[1]?.depth).toBe(1)
    expect(spans[1]?.latencyMs).toBe(30)
    expect(spans[1]?.attributes).toContainEqual(['device.id', 'pump-1'])
  })

  it('keeps concurrent children with their own descendants', () => {
    const spans = workflowSpanSummaries([
      span('root', null, 0),
      span('child-a', 'root', 10),
      span('child-b', 'root', 20),
      span('grandchild-a', 'child-a', 30)
    ])

    expect(spans.map((item) => [item.spanId, item.depth])).toEqual([
      ['root', 0],
      ['child-a', 1],
      ['grandchild-a', 2],
      ['child-b', 1]
    ])
  })

  it('queries every available page for the current run session', async () => {
    const queries: unknown[] = []
    const runtime: WorkflowTracePort = {
      listTraces: async (query) => {
        queries.push(query)
        return query?.cursor === 'next'
          ? {
              project_name: 'uni-lab-electron',
              traces: [{ trace_id: 'b'.repeat(32) }],
              next_cursor: null
            }
          : {
              project_name: 'uni-lab-electron',
              traces: [{ trace_id: 'a'.repeat(32) }],
              next_cursor: 'next'
            }
      },
      getTrace: async (traceId) => ({
        project_name: 'uni-lab-electron',
        trace_id: traceId,
        spans: [],
        next_cursor: null
      })
    }

    const traces = await listWorkflowRunTraces(runtime, RUN_ID)

    expect(traces).toHaveLength(2)
    expect(queries).toEqual([
      expect.objectContaining({
        limit: 1000,
        sessionIdentifiers: [RUN_ID]
      }),
      expect.objectContaining({
        cursor: 'next',
        sessionIdentifiers: [RUN_ID]
      })
    ])
  })

  it('renders an accessible current-run drawer shell', () => {
    const runtime: WorkflowTracePort = {
      listTraces: async () => ({
        project_name: 'uni-lab-electron',
        traces: [],
        next_cursor: null
      }),
      getTrace: async (traceId) => ({
        project_name: 'uni-lab-electron',
        trace_id: traceId,
        spans: [],
        next_cursor: null
      })
    }
    const html = renderToStaticMarkup(
      <WorkflowTraceViewer
        open
        currentRunId={RUN_ID}
        runtime={runtime}
        onClose={() => {}}
      />
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('工作流 Trace')
    expect(html).toContain('当前运行')
    expect(html).toContain('最近记录')
    expect(html).toContain('关闭 Trace 查看器')
  })
})

function span(
  spanId: string,
  parentId: string | null,
  offsetMs: number
): Record<string, unknown> {
  return {
    name: spanId,
    context: { span_id: spanId },
    ...(parentId ? { parent_id: parentId } : {}),
    start_time: new Date(Date.UTC(2026, 7, 2, 8, 0, 0, offsetMs)).toISOString()
  }
}

describe('WorkflowDebugger Trace entry', () => {
  it('shows the entry only when an Electron trace runtime is available', () => {
    const withTrace = renderToStaticMarkup(
      <WorkflowDebugger
        debugStatus="running"
        runStatus="running"
        pausedBeforeNodeId={null}
        startNodeId={null}
        breakpointCount={0}
        controls={[]}
        traceAvailable
        onTraceOpen={() => {}}
        onCommand={() => {}}
      />
    )
    const withoutTrace = renderToStaticMarkup(
      <WorkflowDebugger
        debugStatus="running"
        runStatus="running"
        pausedBeforeNodeId={null}
        startNodeId={null}
        breakpointCount={0}
        controls={[]}
        onCommand={() => {}}
      />
    )

    expect(withTrace).toContain('查看 Trace')
    expect(withoutTrace).not.toContain('查看 Trace')
  })
})
