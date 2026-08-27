import { useRef, useState } from 'react'

import type {
  WorkflowExecutionTask,
  WorkflowRuntimePort,
  WorkflowTaskCommandType
} from '@unilab/services'

import {
  workflowTaskControls,
  workflowTaskToolbarControls
} from '../utils/workflowTaskPresentation'
import { WorkflowButton } from './WorkflowButton'

export interface WorkflowTaskQueueControlsProps {
  runtime: WorkflowRuntimePort
  task: WorkflowExecutionTask
  onReconcile: () => Promise<void>
}

/**
 * 为已进入任务队列的工作流暴露与 OS 状态一致的暂停/继续入口。
 *
 * @param props Backend 运行端口、当前权威任务和命令后的列表补读函数。
 * @returns 仅在状态允许时出现的单个暂停或继续按钮。
 */
export function WorkflowTaskQueueControls({
  runtime,
  task,
  onReconcile
}: WorkflowTaskQueueControlsProps): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const commandSequence = useRef(0)
  const controls = workflowTaskToolbarControls(
    task,
    workflowTaskControls(task, busy)
  ).filter((control) =>
    control.command === 'pause' || control.command === 'resume'
  )

  if (controls.length === 0 && !error) return null

  const command = async (type: WorkflowTaskCommandType): Promise<void> => {
    commandSequence.current += 1
    setBusy(true)
    setError(null)
    try {
      await runtime.commandWorkflowTask(task.uuid, {
        type,
        idempotency_key: [
          'workflow-task-list',
          task.uuid,
          type,
          Date.now(),
          commandSequence.current
        ].join(':')
      })
      await onReconcile()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="workflow-task-list__queue-controls">
      <div role="group" aria-label="工作流任务运行控制">
        {controls.map((control) => (
          <WorkflowButton
            key={control.command}
            type="button"
            disabled={control.disabled}
            disabledReason={control.disabledReason}
            title={control.title}
            onClick={() => void command(control.command)}
          >
            <span aria-hidden="true">{control.glyph}</span>
            {control.label}
          </WorkflowButton>
        ))}
      </div>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  )
}
