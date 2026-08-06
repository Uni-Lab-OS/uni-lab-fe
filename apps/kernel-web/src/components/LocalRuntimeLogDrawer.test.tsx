import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { LocalRuntimeLogDrawer } from './LocalRuntimeLogDrawer'

describe('LocalRuntimeLogDrawer PLC diagnostics', () => {
  it('projects Edge precondition diagnostics into the PLC-Sim log view', () => {
    const feedback = JSON.stringify({
      phase: 'waiting_precondition',
      diagnostic_event: 'waiting',
      observed_at: '2026-08-06T04:00:05Z',
      task_uuid: 'task-s04',
      job_uuid: 'job-s04',
      feedback_event_id: 'job-s04:2',
      effect: { identity: 'job-s04:2' },
      sensor: '传感器状态_上位机[2].NO[10]',
      position: 1,
      expected_value: true,
      actual_value: false,
      elapsed_s: 5,
      timeout_s: 300
    })
    const markup = renderToStaticMarkup(
      <LocalRuntimeLogDrawer
        snapshot={{
          readAt: 1_785_499_200_000,
          entries: [{
            kind: 'edge',
            content: `[UNILAB-ACTION-FEEDBACK] ${feedback}`,
            available: true,
            truncated: false
          }]
        }}
        activeKind="simulator"
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(markup).toMatch(/PLC-Sim<\/span><small>有输出/)
    expect(markup).toContain('PLC 前置诊断')
    expect(markup).toContain('waiting · 正在等待前置传感器')
    expect(markup).toContain('工作流任务（WorkflowTask） task-s04')
    expect(markup).toContain('作业（Job） job-s04')
    expect(markup).toContain('派发效果（DispatchEffect） job-s04:2')
    expect(markup).toContain('data-level="info"')
  })
})
