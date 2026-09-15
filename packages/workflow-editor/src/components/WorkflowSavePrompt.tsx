import type { RefObject } from 'react'

interface WorkflowSavePromptProps {
  fileName: string
  canWriteOriginal: boolean
  saveFileButtonRef: RefObject<HTMLButtonElement | null>
  saveRevisionButtonRef: RefObject<HTMLButtonElement | null>
  onCancel: () => void
  onSaveRevision: () => void
  onSaveFile: () => void
}

export function WorkflowSavePrompt({
  fileName,
  canWriteOriginal,
  saveFileButtonRef,
  saveRevisionButtonRef,
  onCancel,
  onSaveRevision,
  onSaveFile
}: WorkflowSavePromptProps): React.JSX.Element {
  return (
    <div
      className="workflow-save-prompt"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <section
        className="workflow-save-prompt__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-save-prompt-title"
        aria-describedby="workflow-save-prompt-description"
      >
        <header className="workflow-save-prompt__header">
          <span className="workflow-save-prompt__eyebrow">
            文件导入工作流
          </span>
          <h2 id="workflow-save-prompt-title">
            是否同时保存更新后的文件？
          </h2>
        </header>
        <div className="workflow-save-prompt__body">
          <p id="workflow-save-prompt-description">
            当前工作流来自
            <strong title={fileName}>{fileName}</strong>。
            保存工作流时，可以同时保存更新后的标准工作流 JSON。
          </p>
          <p className="workflow-save-prompt__notice">
            {canWriteOriginal
              ? '原文件会被当前内容直接覆盖，请确认不再需要原内容。'
              : '当前浏览器或导入方式没有原文件写入权限，将下载更新后的同名文件。'}
          </p>
        </div>
        <footer className="workflow-save-prompt__actions">
          <button
            type="button"
            className="workflow-save-prompt__cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            ref={saveRevisionButtonRef}
            type="button"
            className="workflow-save-prompt__revision"
            onClick={onSaveRevision}
          >
            仅保存修订
          </button>
          <button
            ref={saveFileButtonRef}
            type="button"
            className="workflow-save-prompt__file"
            onClick={onSaveFile}
          >
            {canWriteOriginal ? '保存到原文件' : '下载更新文件'}
          </button>
        </footer>
      </section>
    </div>
  )
}
