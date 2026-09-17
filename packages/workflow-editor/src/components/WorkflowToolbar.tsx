import type {
  ChangeEventHandler,
  RefObject
} from 'react'

import { WorkflowButton } from './WorkflowButton'

interface WorkflowToolbarProps {
  authoringMode: 'json' | 'python'
  runMode: 'run' | 'debug'
  compactPane: 'code' | 'dag'
  message: string
  busy: boolean
  sourceRunnable: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileChange: ChangeEventHandler<HTMLInputElement>
  onAuthoringModeChange: (mode: 'json' | 'python') => void
  onCompactPaneChange: (pane: 'code' | 'dag') => void
  onImportJson: () => void
  onImportPython: () => void
  onApplyPython: () => void
  onValidate: () => void
  onSave: () => void
  onRunModeChange: (mode: 'run' | 'debug') => void
  onStart: () => void
}

export function WorkflowToolbar({
  authoringMode,
  runMode,
  compactPane,
  message,
  busy,
  sourceRunnable,
  fileInputRef,
  onFileChange,
  onAuthoringModeChange,
  onCompactPaneChange,
  onImportJson,
  onImportPython,
  onApplyPython,
  onValidate,
  onSave,
  onRunModeChange,
  onStart
}: WorkflowToolbarProps): React.JSX.Element {
  return (
    <div className="workflow__toolbar">
      <div className="workflow__context">
        <div className="workflow__title-row">
          <span className="workflow__toolbar-label">工作流运行</span>
          <span className="workflow__format">
            {authoringMode === 'json'
              ? '标准工作流 v2'
              : 'Python 编写模式'}
          </span>
        </div>
        <span
          className="workflow-runtime__message"
          role="status"
          aria-live="polite"
        >
          {message}
        </span>
      </div>

      <div
        className="workflow__mode-switch"
        role="group"
        aria-label="工作流编写格式"
      >
        <WorkflowButton
          type="button"
          className={authoringMode === 'json' ? 'is-active' : ''}
          aria-pressed={authoringMode === 'json'}
          disabled={busy}
          disabledReason="正在处理工作流，暂时不能切换编写格式"
          onClick={() => onAuthoringModeChange('json')}
        >
          JSON
        </WorkflowButton>
        <WorkflowButton
          type="button"
          className={authoringMode === 'python' ? 'is-active' : ''}
          aria-pressed={authoringMode === 'python'}
          disabled={busy}
          disabledReason="正在处理工作流，暂时不能切换编写格式"
          onClick={() => onAuthoringModeChange('python')}
        >
          Python
        </WorkflowButton>
      </div>

      <div
        className="workflow__mode-switch workflow__mobile-view"
        role="group"
        aria-label="紧凑屏幕工作区"
      >
        <button
          type="button"
          className={compactPane === 'code' ? 'is-active' : ''}
          aria-pressed={compactPane === 'code'}
          onClick={() => onCompactPaneChange('code')}
        >
          代码
        </button>
        <button
          type="button"
          className={compactPane === 'dag' ? 'is-active' : ''}
          aria-pressed={compactPane === 'dag'}
          onClick={() => onCompactPaneChange('dag')}
        >
          DAG
        </button>
      </div>

      <div className="workflow__toolbar-actions">
        <input
          ref={fileInputRef}
          className="workflow__file-input"
          type="file"
          accept=".json,.py,application/json,text/x-python"
          aria-label="选择工作流文件"
          onChange={onFileChange}
        />
        <WorkflowButton
          type="button"
          className="workflow__upload"
          disabled={busy}
          disabledReason="正在处理工作流，请稍后再导入 JSON"
          onClick={onImportJson}
        >
          导入 JSON
        </WorkflowButton>
        <WorkflowButton
          type="button"
          className="workflow__upload"
          disabled={busy}
          disabledReason="正在处理工作流，请稍后再导入 Python"
          onClick={onImportPython}
        >
          导入 Python
        </WorkflowButton>
        {authoringMode === 'python' && (
          <WorkflowButton
            type="button"
            className="workflow__upload"
            aria-label="编译 Python"
            disabled={busy}
            disabledReason="正在处理工作流，请稍后再应用 Python"
            onClick={onApplyPython}
          >
            应用 Python 到画布
          </WorkflowButton>
        )}
        <WorkflowButton
          type="button"
          className="workflow__upload"
          disabled={busy || !sourceRunnable}
          disabledReason={busy
            ? '正在处理工作流，请稍后再校验'
            : '当前内容尚未形成可运行的工作流，不能校验'}
          onClick={onValidate}
        >
          校验
        </WorkflowButton>
        <WorkflowButton
          type="button"
          className="workflow__upload"
          disabled={busy || !sourceRunnable}
          disabledReason={busy
            ? '正在处理工作流，请稍后再保存'
            : '当前内容尚未形成可运行的工作流，不能保存工作流'}
          onClick={onSave}
        >
          保存工作流
        </WorkflowButton>

        <span className="workflow__toolbar-divider" aria-hidden="true" />
        <div
          className="workflow__mode-switch workflow__run-mode"
          role="group"
          aria-label="运行方式"
        >
          <WorkflowButton
            type="button"
            className={runMode === 'run' ? 'is-active' : ''}
            aria-pressed={runMode === 'run'}
            disabled={busy}
            disabledReason="正在处理工作流，暂时不能切换运行方式"
            onClick={() => onRunModeChange('run')}
          >
            整图运行
          </WorkflowButton>
          <WorkflowButton
            type="button"
            className={runMode === 'debug' ? 'is-active' : ''}
            aria-pressed={runMode === 'debug'}
            disabled={busy}
            disabledReason="正在处理工作流，暂时不能切换运行方式"
            onClick={() => onRunModeChange('debug')}
          >
            调试运行
          </WorkflowButton>
        </div>
        <WorkflowButton
          type="button"
          className="workflow-runtime__primary"
          aria-label={
            runMode === 'debug'
              ? '调试启动：开始调试'
              : '整图执行：开始运行'
          }
          disabled={busy || !sourceRunnable}
          disabledReason={busy
            ? '正在处理上一项工作流操作，请稍候'
            : '当前内容尚未形成可运行的工作流'}
          onClick={onStart}
        >
          {busy
            ? '处理中…'
            : runMode === 'debug'
              ? '开始调试'
              : '开始运行'}
        </WorkflowButton>
      </div>
    </div>
  )
}
