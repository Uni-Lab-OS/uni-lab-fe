import { clsx } from 'clsx'
import runStyles from '../run.module.scss'
export interface RunSubmitConfirmationProps {
  readonly canSubmit: boolean
  readonly busy?: boolean
  readonly onSubmit: () => void
  readonly onEdit?: () => void
  readonly submitLabel?: string
}

/** 提交前确认的交互壳；实际提交由调用方连接到 core 场景。 */
export function RunSubmitConfirmation({
  canSubmit,
  busy = false,
  onSubmit,
  onEdit,
  submitLabel = '提交运行',
}: RunSubmitConfirmationProps) {
  return (
    <div className={clsx(runStyles['lab-ui-run-submit-confirmation'])}>
      <div className={clsx(runStyles['lab-ui-run-submit-confirmation__actions'])}>
        {onEdit && (
          <button type="button" onClick={onEdit} disabled={busy}>
            返回修改
          </button>
        )}
        <button
          type="button"
          className={clsx(runStyles['is-primary'])}
          onClick={onSubmit}
          disabled={!canSubmit || busy}
          aria-busy={busy}
        >
          {busy ? '提交中…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
