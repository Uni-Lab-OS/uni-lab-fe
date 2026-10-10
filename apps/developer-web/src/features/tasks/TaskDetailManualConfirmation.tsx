import { useState } from 'react'
import { clsx } from 'clsx'
import type { ManualConfirmationAction, WorkflowNodeJobDetail } from '@unilab-fe/core'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import { DebugIcon } from './TaskDetailIcons'
import { readManualConfirmation } from './taskDetailModel'

export function ManualConfirmationActions({
  job,
  onDecide,
}: {
  job: WorkflowNodeJobDetail | null
  onDecide: (jobUuid: string, action: ManualConfirmationAction) => Promise<void>
}) {
  const confirmation = readManualConfirmation(job)
  const [busy, setBusy] = useState<ManualConfirmationAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!job || confirmation?.status !== 'pending' || confirmation.actions.length === 0) return null

  const decide = async (action: ManualConfirmationAction) => {
    setBusy(action)
    setError(null)
    try {
      await onDecide(job.jobUuid, action)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交人工确认失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      className={clsx(taskDetailInspectorStyles['debug-manual-confirmation'])}
      aria-label="人工确认"
    >
      <div className={clsx(taskDetailInspectorStyles['debug-manual-confirmation-copy'])}>
        <DebugIcon name="user-check" size={17} />
        <div>
          <strong>等待人工确认</strong>
          <span>请选择批准或拒绝，OS 会在确认后更新节点状态。</span>
        </div>
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-manual-confirmation-actions'])}>
        {confirmation.actions.includes('reject') && (
          <button
            type="button"
            className={clsx(taskDetailInspectorStyles['debug-manual-confirmation-reject'])}
            disabled={busy !== null}
            onClick={() => void decide('reject')}
          >
            拒绝
          </button>
        )}
        {confirmation.actions.includes('approve') && (
          <button
            type="button"
            className={clsx(taskDetailInspectorStyles['debug-manual-confirmation-approve'])}
            disabled={busy !== null}
            onClick={() => void decide('approve')}
          >
            {busy === 'approve' ? '提交中…' : '批准'}
          </button>
        )}
      </div>
      {error && (
        <p className={clsx(taskDetailInspectorStyles['debug-manual-confirmation-error'])}>
          {error}
        </p>
      )}
    </section>
  )
}
