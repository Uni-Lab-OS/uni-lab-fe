import { useMemo, useState } from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { materialScopeClassName } from './materialStyles'
import {
  createMaterialDraftFromTemplate,
  type MaterialTemplateDetail,
  type TemplateMaterialDraft
} from './templateMaterial'

export function MaterialCreateDialog({
  template,
  existingNames,
  createStatus,
  onCancel,
  onCreate
}: {
  template: MaterialTemplateDetail
  existingNames: readonly string[]
  createStatus: CapabilityStatus
  onCancel: () => void
  onCreate: (draft: TemplateMaterialDraft) => Promise<void> | void
}): React.JSX.Element {
  const [requestedName, setRequestedName] = useState(
    template.displayName
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const draft = useMemo(
    () =>
      createMaterialDraftFromTemplate(template, {
        existingNames,
        requestedName
      }),
    [existingNames, requestedName, template]
  )

  /**
   * 提交模板派生的物料创建草稿，并保留失败原因供用户修正或重试。
   * @returns 创建成功后结束；能力或名称无效时不调用服务端口。
   */
  const submit = async (): Promise<void> => {
    if (
      !createStatus.available ||
      !draft.nameValidation.valid ||
      submitting
    ) {
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      await onCreate(draft)
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : '物料创建失败，请稍后重试'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={materialScopeClassName('material-dialog-backdrop')}
    >
      <section
        className="material-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="material-create-title"
      >
        <header>
          <div>
            <span>从模板创建</span>
            <h3 id="material-create-title">
              {template.displayName}
            </h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="material-dialog__content">
          <label>
            实例名称
            <input
              value={requestedName}
              onChange={(event) => setRequestedName(event.target.value)}
              aria-invalid={!draft.nameValidation.valid}
              aria-describedby={
                draft.nameValidation.valid
                  ? undefined
                  : 'material-create-name-error'
              }
              autoFocus
            />
            {!draft.nameValidation.valid ? (
              <small
                className="material-dialog__field-error"
                id="material-create-name-error"
              >
                {draft.nameValidation.message}
              </small>
            ) : null}
          </label>

          <div className="material-dialog__summary">
            <span>类型</span>
            <strong>
              {template.kind === 'device' ? '设备' : '资源'}
            </strong>
            <span>容器布局</span>
            <strong>{containerCount(template)}</strong>
          </div>

          {!createStatus.available ? (
            <p className="material-dialog__disabled">
              {createStatus.reason ?? '当前服务配置不支持创建物料'}
            </p>
          ) : null}
          {submitError ? (
            <p className="material-dialog__error" role="alert">
              {submitError}
            </p>
          ) : null}
        </div>

        <footer>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={
              !createStatus.available ||
              !draft.nameValidation.valid ||
              submitting
            }
            title={createStatus.reason}
            onClick={() => void submit()}
          >
            {submitting ? '正在创建…' : '创建物料'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function containerCount(template: MaterialTemplateDetail): number {
  const layout = template.containerLayout
  if (!layout) return 0
  return layout.type === 'grid'
    ? layout.rows.length * layout.columns
    : layout.containers.length
}
