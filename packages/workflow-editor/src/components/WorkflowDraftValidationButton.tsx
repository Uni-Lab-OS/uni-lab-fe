import type { WorkflowEditMode } from '../utils/workflowCanvasPolicy'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowToolbarIcon } from './WorkflowWorkspaceToolbar'

interface WorkflowDraftValidationButtonProps {
  aggregateAvailable: boolean
  authorityLabel: string
  available: boolean
  busy: boolean
  mode: WorkflowEditMode
  runningEntryBusy: boolean
  visible: boolean
  onValidate: () => void
}

/** 当前本地画布草稿的非持久化 OS 校验入口。 */
export function WorkflowDraftValidationButton({
  aggregateAvailable,
  authorityLabel,
  available,
  busy,
  mode,
  runningEntryBusy,
  visible,
  onValidate
}: WorkflowDraftValidationButtonProps): React.JSX.Element | null {
  if (!visible) return null
  return (
    <WorkflowButton
      type="button"
      className="persistent-authoring__debug-icon"
      aria-label="校验本地工作流草稿"
      disabled={busy || runningEntryBusy || !aggregateAvailable || !available}
      disabledReason={busy || runningEntryBusy
        ? '正在处理工作流，请稍后校验'
        : !aggregateAvailable
          ? '工作流尚未加载完成'
          : mode !== 'canvas'
            ? '请切换到画布模式校验当前画布草稿'
            : `${authorityLabel} 不提供 Python 草稿校验`}
      title="生成 Python 并校验当前本地草稿（不会保存或应用）"
      onClick={onValidate}
    >
      <WorkflowToolbarIcon name="validate" />
    </WorkflowButton>
  )
}
