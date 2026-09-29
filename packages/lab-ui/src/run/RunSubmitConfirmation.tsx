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
  const title = canSubmit ? '检查完成，可以提交' : '当前不能提交'
  const description = canSubmit
    ? '提交后将由运行时返回任务和节点状态。'
    : '请先处理运行前检查中的阻塞项。'

  return (
    <div className="lab-ui-run-submit-confirmation">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <div className="lab-ui-run-submit-confirmation__actions">
        {onEdit && (
          <button type="button" onClick={onEdit} disabled={busy}>
            返回修改
          </button>
        )}
        <button
          type="button"
          className="is-primary"
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
