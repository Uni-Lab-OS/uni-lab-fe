import type { WorkflowExecutionTask } from '@unilab/services'
import { describe, expect, it } from 'vitest'

import {
  workflowTaskControlStatusLabel,
  workflowTaskControls,
  workflowTaskIsLive,
  workflowTaskStatusLabel,
  workflowTaskToolbarControls,
  workflowTaskVisualStatus
} from './workflowTaskPresentation'

describe('Workflow Task admission presentation', () => {
  it('keeps only cancel available while Task authority reports admission_blocked', () => {
    const task = workflowTask({ status: 'admission_blocked' })
    const controls = workflowTaskControls(task, false)

    expect(Object.fromEntries(controls.map((control) => [
      control.command,
      control.disabled
    ]))).toEqual({
      pause: true,
      resume: true,
      step: true,
      cancel: false
    })
    expect(workflowTaskStatusLabel(task.status)).toBe('等待物料准入')
    expect(workflowTaskControlStatusLabel(task)).toBe('等待物料准入')
    expect(workflowTaskVisualStatus(task)).toBe('admission_blocked')
  })
})

describe('Workflow Task compact debugger presentation', () => {
  it('keeps only cancel visible while admission is blocked', () => {
    const task = workflowTask({ status: 'admission_blocked' })

    expect(workflowTaskToolbarControls(
      task,
      workflowTaskControls(task, false)
    ).map((control) => control.command)).toEqual(['cancel'])
  })

  it('replaces start with pause and cancel for an active task', () => {
    const task = workflowTask({ status: 'running', control_status: 'active' })
    const controls = workflowTaskControls(task, false)

    expect(workflowTaskIsLive(task)).toBe(true)
    expect(workflowTaskToolbarControls(task, controls).map(
      (control) => control.command
    )).toEqual(['pause', 'cancel'])
  })

  it('keeps only cancel visible while waiting for human intervention', () => {
    const task = workflowTask({
      status: 'running',
      control_status: 'waiting_intervention'
    })
    const controls = workflowTaskControls(task, false)

    expect(workflowTaskToolbarControls(task, controls).map(
      (control) => control.command
    )).toEqual(['cancel'])
    expect(workflowTaskControlStatusLabel(task)).toBe('等待人工干预')
    expect(workflowTaskVisualStatus(task)).toBe('intervention_required')
  })

  it('shows resume, step and cancel only for a paused step task', () => {
    const task = workflowTask({
      status: 'running',
      control_status: 'paused',
      run_mode: 'step'
    })
    const controls = workflowTaskControls(task, false)

    expect(workflowTaskToolbarControls(task, controls).map(
      (control) => control.command
    )).toEqual(['resume', 'step', 'cancel'])
  })

  it('returns the toolbar to start mode after a terminal task', () => {
    const task = workflowTask({ status: 'succeeded' })

    expect(workflowTaskIsLive(task)).toBe(false)
    expect(workflowTaskToolbarControls(
      task,
      workflowTaskControls(task, false)
    )).toEqual([])
  })
})

function workflowTask(
  override: Partial<WorkflowExecutionTask> = {}
): WorkflowExecutionTask {
  return {
    uuid: '10000000-0000-4000-8000-000000000001',
    create_time: '2026-08-02T00:00:00Z',
    update_time: '2026-08-02T00:00:00Z',
    meta_data: {},
    execution_kind: 'workflow',
    workflow_uuid: '20000000-0000-4000-8000-000000000001',
    status: 'pending',
    workflow_snapshot: {},
    execution_plan: {},
    run_mode: 'normal',
    control_status: 'active',
    cleanup_status: 'none',
    trace_context: {},
    input: {},
    output: {},
    error_info: [],
    ...override
  }
}
