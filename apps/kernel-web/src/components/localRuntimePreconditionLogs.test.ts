import { describe, expect, it } from 'vitest'

import type { LocalRuntimeLogsSnapshot } from '../types/electron'
import { projectLocalRuntimeLogEntry } from './localRuntimePreconditionLogs'

function feedbackLine(
  event: string,
  taskUuid: string,
  jobUuid: string,
  phase = 'waiting_precondition'
): string {
  return `[INFO] [12:00:00] [edge]: [UNILAB-ACTION-FEEDBACK] ${JSON.stringify({
    phase,
    diagnostic_event: event,
    feedback_event_id: `${jobUuid}:1`,
    observed_at: '2026-08-06T04:00:00Z',
    task_uuid: taskUuid,
    job_uuid: jobUuid,
    goal: {
      device_id: 'szlab_mixer_stirrer',
      action_name: 'run_stirring'
    },
    effect: { identity: `${jobUuid}:1`, phase },
    sensor: '传感器状态_上位机[2].NO[10]',
    position: 1,
    expected_value: true,
    actual_value: false
  })}`
}

describe('local runtime PLC precondition projection', () => {
  it('projects first-load Edge diagnostics into the PLC-Sim log tab', () => {
    const snapshot: LocalRuntimeLogsSnapshot = {
      readAt: 1,
      entries: [
        {
          kind: 'simulator',
          content: '[INFO] [11:59:59] [plc_sim]: accepted',
          available: true,
          truncated: false
        },
        {
          kind: 'edge',
          content: feedbackLine(
            'precondition_check_started',
            'task-a',
            'job-a'
          ),
          available: true,
          truncated: false
        }
      ]
    }

    const projected = projectLocalRuntimeLogEntry(snapshot, 'simulator')

    expect(projected?.available).toBe(true)
    expect(projected?.content).toContain('accepted')
    expect(projected?.content).toContain('precondition_check_started')
    expect(projected?.content).toContain('task-a')
    expect(projected?.content).toContain('job-a')
  })

  it('keeps refresh and concurrent 工作流任务（WorkflowTask）/作业（Job） correlations independent', () => {
    const edgeContent = [
      feedbackLine('waiting', 'task-a', 'job-a'),
      feedbackLine('waiting', 'task-b', 'job-b'),
      feedbackLine('timed_out', 'task-a', 'job-a'),
      feedbackLine(
        'writing_parameters',
        'task-b',
        'job-b',
        'writing_parameters'
      )
    ].join('\n')
    const snapshot: LocalRuntimeLogsSnapshot = {
      readAt: 2,
      entries: [{
        kind: 'edge',
        content: edgeContent,
        available: true,
        truncated: false
      }]
    }

    const projected = projectLocalRuntimeLogEntry(snapshot, 'simulator')

    expect(projected?.content).toContain('timed_out')
    expect(projected?.content).toContain('writing_parameters')
    expect(projected?.content.match(/task-a/g)).toHaveLength(2)
    expect(projected?.content.match(/task-b/g)).toHaveLength(2)
    expect(projected?.content.match(/job-a/g)).toHaveLength(6)
    expect(projected?.content.match(/job-b/g)).toHaveLength(6)
  })

  it('does not copy unrelated Edge output into PLC-Sim', () => {
    const snapshot: LocalRuntimeLogsSnapshot = {
      readAt: 3,
      entries: [{
        kind: 'edge',
        content: 'ordinary Edge log',
        available: true,
        truncated: false
      }]
    }

    expect(projectLocalRuntimeLogEntry(snapshot, 'simulator')).toBeUndefined()
  })
})
