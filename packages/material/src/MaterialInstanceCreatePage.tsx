import { useMemo, useState, type FormEvent } from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { materialScopeClassName } from './materialStyles'
import {
  createMaterialDraftFromTemplate,
  type MaterialTemplateDetail,
  type TemplateMaterialDraft
} from './templateMaterial'

export interface MaterialInstanceCreatePageProps {
  template?: MaterialTemplateDetail
  loadState: 'pending' | 'ready' | 'error'
  initialBatch?: string
  existingNames: readonly string[]
  createStatus: CapabilityStatus
  onCancel: () => void
  onCreate: (draft: TemplateMaterialDraft) => Promise<void> | void
}

/**
 * 在当前资源模板与批次上下文中创建一个物料（Material）实例。
 * @param props 模板读取状态、实例初始值、创建能力与页面操作回调。
 * @returns 独立于模板目录的结构化物料实例创建页面。
 */
export function MaterialInstanceCreatePage({
  template,
  loadState,
  initialBatch = '',
  existingNames,
  createStatus,
  onCancel,
  onCreate
}: MaterialInstanceCreatePageProps): React.JSX.Element {
  const [requestedName, setRequestedName] = useState(
    template?.displayName ?? ''
  )
  const [batch, setBatch] = useState(initialBatch)
  const [expiresAt, setExpiresAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const config = useMemo(
    () => materialInstanceInitialConfig(batch, expiresAt),
    [batch, expiresAt]
  )
  const draft = useMemo(
    () => template
      ? createMaterialDraftFromTemplate(template, {
          existingNames,
          requestedName,
          config
        })
      : null,
    [config, existingNames, requestedName, template]
  )

  /**
   * 提交带当前类型与批次上下文的物料实例创建命令。
   * @param event 页面表单的提交事件。
   * @returns 创建成功后结束；能力或名称无效时不调用写端口。
   */
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (
      !draft ||
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
        error instanceof Error ? error.message : '物料实例创建失败，请稍后重试'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      className={materialScopeClassName('material-instance-create')}
      aria-labelledby="material-instance-create-title"
    >
      <header className="material-instance-create__header">
        <button type="button" onClick={onCancel}>
          ← 返回物料管理
        </button>
        <div>
          <h3 id="material-instance-create-title">新建物料实例</h3>
          <p>从当前物料类型创建一个具有独立身份的实验室物料。</p>
          <ol
            className="material-instance-create__flow"
            aria-label="物料实例创建流程"
          >
            <li className="is-complete"><span>1</span>选择类型</li>
            <li aria-current="step"><span>2</span>新建实例</li>
            <li><span>3</span>配置参数</li>
            <li><span>4</span>设置位置</li>
          </ol>
        </div>
      </header>

      {loadState === 'pending' ? (
        <div className="material-instance-create__loading" role="status">
          <span aria-hidden="true" />
          <strong>正在读取物料类型…</strong>
        </div>
      ) : loadState === 'error' || !template || !draft ? (
        <div className="material-instance-create__load-error" role="alert">
          <strong>物料类型读取失败</strong>
          <p>返回物料管理后重新选择类型，再发起创建。</p>
        </div>
      ) : (
        <form className="material-instance-create__layout" onSubmit={submit}>
          <div className="material-instance-create__form">
            <section aria-labelledby="material-instance-basic-title">
              <header>
                <h4 id="material-instance-basic-title">实例信息</h4>
                <p>名称用于操作识别，UUID 和实例编号由系统创建时生成。</p>
              </header>
              <div className="material-instance-create__fields">
                <label className="is-wide">
                  <span>实例名称 <i>必填</i></span>
                  <input
                    value={requestedName}
                    aria-invalid={!draft.nameValidation.valid}
                    aria-describedby={draft.nameValidation.valid
                      ? 'material-instance-name-help'
                      : 'material-instance-name-error'}
                    autoFocus
                    onChange={(event) => setRequestedName(event.target.value)}
                  />
                  {draft.nameValidation.valid ? (
                    <small id="material-instance-name-help">
                      建议使用实验室中可直接识别的名称或标签。
                    </small>
                  ) : (
                    <small
                      id="material-instance-name-error"
                      className="is-error"
                    >
                      {draft.nameValidation.message}
                    </small>
                  )}
                </label>
                <label>
                  <span>物料批次</span>
                  <input
                    value={batch}
                    placeholder="例如 B-20260808"
                    onChange={(event) => setBatch(event.target.value)}
                  />
                </label>
                <label>
                  <span>有效期</span>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </label>
              </div>
              <p className="material-instance-create__batch-note">
                批次与有效期当前写入物料实例配置；正式物料批次服务接入后将统一维护。
              </p>
            </section>

            <section aria-labelledby="material-instance-placement-title">
              <header>
                <h4 id="material-instance-placement-title">初始位置</h4>
                <p>创建实例不等于完成物理放置。</p>
              </header>
              <div className="material-instance-create__placement">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>暂不放置</strong>
                  <small>创建后先配置实例参数，再到“位置”页面选择兼容库位（Site）。</small>
                </div>
                <span>已选择</span>
              </div>
            </section>

            {!createStatus.available ? (
              <p className="material-instance-create__disabled" role="note">
                {createStatus.reason ?? '当前服务配置不支持创建物料实例'}
              </p>
            ) : null}
            {submitError ? (
              <p className="material-instance-create__error" role="alert">
                {submitError}
              </p>
            ) : null}
          </div>

          <aside className="material-instance-create__summary">
            <header>
              <span aria-hidden="true"><TemplateIcon /></span>
              <div>
                <h4>{template.displayName}</h4>
                <p>{template.categoryPath.join(' / ') || '未分类'}</p>
              </div>
            </header>
            <dl>
              <div>
                <dt>物料类型</dt>
                <dd>{template.key}</dd>
              </div>
              <div>
                <dt>内部结构</dt>
                <dd>{containerLabel(template)}</dd>
              </div>
              <div>
                <dt>所属批次</dt>
                <dd>{batch.trim() || '未分批'}</dd>
              </div>
              <div>
                <dt>初始位置</dt>
                <dd>未放置</dd>
              </div>
            </dl>
            <p>
              创建只登记新的物料身份和初始配置；完成后将打开右侧参数配置，不表示该实例可分配、已预留或已被任务使用。
            </p>
            <footer>
              <button type="button" onClick={onCancel}>取消</button>
              <button
                type="submit"
                className="is-primary"
                disabled={
                  !createStatus.available ||
                  !draft.nameValidation.valid ||
                  submitting
                }
                title={createStatus.reason}
              >
                {submitting ? '正在创建…' : '创建并继续配置'}
              </button>
            </footer>
          </aside>
        </form>
      )}
    </section>
  )
}

/**
 * 将用户填写的批次和有效期整理为物料实例初始配置。
 * @param batch 用户填写或从当前批次继承的批次标识。
 * @param expiresAt 用户填写的 ISO 日期；空值表示未配置。
 * @returns 只包含非空字段的新配置对象。
 */
export function materialInstanceInitialConfig(
  batch: string,
  expiresAt: string
): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  const normalizedBatch = batch.trim()
  if (normalizedBatch) config.batch = normalizedBatch
  if (expiresAt) config.expiresAt = expiresAt
  return config
}

/**
 * 将模板容器布局转换为创建摘要中的简短结构说明。
 * @param template 当前物料资源模板。
 * @returns 容器位数量或无内部容器说明。
 */
function containerLabel(template: MaterialTemplateDetail): string {
  const layout = template.containerLayout
  if (!layout) return '无内部容器'
  const count = layout.type === 'grid'
    ? layout.rows.length * layout.columns
    : layout.containers.length
  return `${count} 个容器位`
}

/**
 * 渲染新建物料实例页的资源模板图标。
 * @returns 继承物料模块视觉语言的线性 SVG 图标。
 */
function TemplateIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 13h3M13 13h3" />
    </svg>
  )
}
