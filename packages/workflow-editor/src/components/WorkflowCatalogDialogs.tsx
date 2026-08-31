import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import type {
  WorkflowDefinitionChange,
  WorkflowDefinitionCreateRequest,
  WorkflowDefinitionKind,
  WorkflowSummary
} from '@unilab/services'

import { WorkflowButton } from './WorkflowButton'

export function CreateWorkflowDialog({
  definitionKind = 'workflow',
  onCancel,
  onCreate
}: {
  definitionKind?: WorkflowDefinitionKind
  onCancel: () => void
  onCreate: (request: WorkflowDefinitionCreateRequest) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const isOperation = definitionKind === 'operation'

  /** 提交经过本地约束的工作流定义，并保留失败时的用户输入。 */
  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onCreate({
        name: normalizedName,
        description: description.trim() || undefined,
        tags: tags.split(/[，,]/u).map((tag) => tag.trim()).filter(Boolean),
        meta_data: isOperation
          ? { unilab: { definition_kind: 'operation' } }
          : undefined
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSubmitting(false)
    }
  }

  return (
    <CatalogDialog
      title={isOperation ? '新建实验操作' : '新建工作流'}
      description={isOperation
        ? '创建后进入空白画布，可从设备动作目录添加并编排节点。'
        : '创建后可进入编排界面添加步骤并保存定义。'}
      onClose={submitting ? undefined : onCancel}
      initialFocusRef={nameRef}
    >
      <form className="workflow-runtime__catalog-form" onSubmit={handleSubmit}>
        <label>
          <span>名称</span>
          <input
            ref={nameRef}
            value={name}
            maxLength={100}
            required
            autoComplete="off"
            placeholder={isOperation ? '例如：机械臂取放样品' : '例如：S01 自动配液'}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          <span>描述</span>
          <textarea
            value={description}
            maxLength={500}
            rows={4}
            placeholder={isOperation
              ? '说明该实验操作的用途、设备动作与预期结果'
              : '说明用途、输入与预期结果'}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          <span>标签</span>
          <input
            value={tags}
            autoComplete="off"
            placeholder={isOperation
              ? '用逗号分隔，例如：机械臂，取放'
              : '用逗号分隔，例如：S01，配液'}
            onChange={(event) => setTags(event.target.value)}
          />
        </label>
        {error ? (
          <p className="workflow-runtime__catalog-dialog-error" role="alert">
            创建失败：{error}。请检查 OS 服务后重试。
          </p>
        ) : null}
        <footer>
          <WorkflowButton
            type="button"
            onClick={onCancel}
            disabled={submitting}
            disabledReason="创建请求正在提交，请稍候"
          >
            取消
          </WorkflowButton>
          <WorkflowButton
            type="submit"
            className="is-primary"
            disabled={!name.trim() || submitting}
            disabledReason={submitting
              ? '创建请求正在提交，请稍候'
              : '请先填写工作流名称'}
          >
            {submitting
              ? '正在创建…'
              : isOperation ? '创建并进入画布' : '创建并打开'}
          </WorkflowButton>
        </footer>
      </form>
    </CatalogDialog>
  )
}

export function DeleteWorkflowDialog({
  workflow,
  onCancel,
  onDelete
}: {
  workflow: WorkflowSummary
  onCancel: () => void
  onDelete: () => Promise<void>
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmed = confirmation === workflow.name

  /** 仅在名称复核通过后删除 OS 中的工作流定义。 */
  const handleDelete = async (): Promise<void> => {
    if (!confirmed || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onDelete()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSubmitting(false)
    }
  }

  return (
    <CatalogDialog
      title="删除工作流"
      description="此操作会软删除工作流定义，目录中将不再显示。已保存的运行记录不会被改写。"
      onClose={submitting ? undefined : onCancel}
      initialFocusRef={inputRef}
    >
      <div className="workflow-runtime__catalog-form">
        <label>
          <span>输入“{workflow.name}”以确认</span>
          <input
            ref={inputRef}
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error ? (
          <p className="workflow-runtime__catalog-dialog-error" role="alert">
            删除失败：{error}。工作流仍保留，请重试。
          </p>
        ) : null}
        <footer>
          <WorkflowButton
            type="button"
            onClick={onCancel}
            disabled={submitting}
            disabledReason="删除请求正在提交，请稍候"
          >
            取消
          </WorkflowButton>
          <WorkflowButton
            type="button"
            className="is-danger"
            disabled={!confirmed || submitting}
            disabledReason={submitting
              ? '删除请求正在提交，请稍候'
              : `请输入“${workflow.name}”以确认删除`}
            onClick={() => void handleDelete()}
          >
            {submitting ? '正在删除…' : '确认删除'}
          </WorkflowButton>
        </footer>
      </div>
    </CatalogDialog>
  )
}

export function WorkflowChangeLogDialog({
  workflow,
  loadChanges,
  onClose
}: {
  workflow: WorkflowSummary
  loadChanges: () => Promise<readonly WorkflowDefinitionChange[]>
  onClose: () => void
}): React.JSX.Element {
  const [changes, setChanges] = useState<readonly WorkflowDefinitionChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestRevision, setRequestRevision] = useState(0)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    void loadChanges()
      .then((items) => {
        if (!disposed) setChanges(items)
      })
      .catch((reason) => {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [loadChanges, requestRevision])

  return (
    <CatalogDialog
      title={`${workflow.name} · 修改日志`}
      description="由 OS 在定义事务提交时记录，按最新变更优先排列。"
      onClose={onClose}
      initialFocusRef={closeRef}
      closeButtonRef={closeRef}
      wide
    >
      {loading ? (
        <div className="workflow-runtime__catalog-log-state" role="status">
          正在读取修改日志…
        </div>
      ) : error ? (
        <div className="workflow-runtime__catalog-log-state is-error" role="alert">
          <strong>修改日志读取失败</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setRequestRevision((value) => value + 1)}>
            重试
          </button>
        </div>
      ) : changes.length === 0 ? (
        <div className="workflow-runtime__catalog-log-state" role="status">
          暂无修改记录
        </div>
      ) : (
        <ol className="workflow-runtime__catalog-log">
          {changes.map((change) => (
            <li key={`${change.sequence}-${change.create_time}`}>
              <span className="workflow-runtime__catalog-log-mark" aria-hidden="true" />
              <div>
                <strong>{change.summary}</strong>
                <span>{formatChangeTime(change.create_time)} · 版本 {change.revision}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </CatalogDialog>
  )
}

export function CatalogDialog({
  title,
  description,
  children,
  onClose,
  initialFocusRef,
  closeButtonRef,
  className,
  wide = false
}: {
  title: string
  description: string
  children: ReactNode
  onClose?: () => void
  initialFocusRef: React.RefObject<HTMLElement | null>
  closeButtonRef?: React.RefObject<HTMLButtonElement | null>
  className?: string
  wide?: boolean
}): React.JSX.Element {
  const headingId = `workflow-catalog-dialog-${dialogSlug(title)}`

  useEffect(() => {
    initialFocusRef.current?.focus()
    /** 允许用户用 Escape 关闭当前非提交态弹窗。 */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && onClose) onClose()
    }
    globalThis.addEventListener('keydown', handleKeyDown)
    return () => globalThis.removeEventListener('keydown', handleKeyDown)
  }, [initialFocusRef, onClose])

  const content = (
    <div className="workflow-runtime__catalog-dialog-backdrop">
      <section
        className={[
          'workflow-runtime__catalog-dialog',
          wide ? 'is-wide' : '',
          className ?? ''
        ].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <header>
          <div>
            <h3 id={headingId}>{title}</h3>
            <p>{description}</p>
          </div>
          {onClose ? (
            <button
              ref={closeButtonRef}
              type="button"
              aria-label={`关闭${title}`}
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </header>
        {children}
      </section>
    </div>
  )
  return typeof document === 'undefined'
    ? content
    : createPortal(content, document.body)
}

/** 使用中文日期时间显示 OS 持久日志时间。 */
function formatChangeTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

/** 生成仅用于弹窗标题关联的稳定 DOM 片段。 */
function dialogSlug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
}
