import type { ExperimentOperationCreateRequest } from '@unilab/services'
import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'

import { CatalogDialog } from './WorkflowCatalogDialogs'
import { WorkflowButton } from './WorkflowButton'

export function CreateExperimentOperationDialog({
  categorySuggestions,
  onCancel,
  onCreate
}: {
  categorySuggestions: readonly string[]
  onCancel: () => void
  onCreate: (request: ExperimentOperationCreateRequest) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [categoryInput, setCategoryInput] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const categoryHelpId = useId()
  const availableSuggestions = categorySuggestions.filter(
    suggestion => !categories.includes(suggestion)
  )
  const pendingCategories = normalizeOperationCategories([
    ...categories,
    categoryInput
  ])
  const canSubmit = Boolean(name.trim() && pendingCategories.length > 0)
    && !submitting

  const addCategory = (value: string): void => {
    const normalizedValue = value.trim()
    if (!normalizedValue) return
    const nextCategories = normalizeOperationCategories([...categories, value])
      .slice(0, MAX_OPERATION_CATEGORIES)
    setCategories(nextCategories)
    setCategoryInput(current => current.trim() === normalizedValue ? '' : current)
  }

  const removeCategory = (value: string): void => {
    setCategories(current => current.filter(category => category !== value))
  }

  const handleCategoryKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (categoryInput.trim()) addCategory(categoryInput)
  }

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return
    const normalizedCategories = normalizeOperationCategories([
      ...categories,
      categoryInput
    ])
    setSubmitting(true)
    setError(null)
    try {
      await onCreate({
        name: name.trim(),
        categories: normalizedCategories,
        description: description.trim() || undefined
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSubmitting(false)
    }
  }

  return (
    <CatalogDialog
      title="新建实验操作"
      description="在当前设备包工作区创建 Python 文件并登记到 OS 数据库。"
      onClose={submitting ? undefined : onCancel}
      initialFocusRef={nameRef}
      className="experiment-operation__create-dialog"
    >
      <form
        className="workflow-runtime__catalog-form experiment-operation__create-form"
        onSubmit={event => void handleSubmit(event)}
      >
        <label className="experiment-operation__create-field">
          <span>名称</span>
          <input
            ref={nameRef}
            value={name}
            maxLength={100}
            required
            autoComplete="off"
            placeholder="例如：称量并投料"
            onChange={event => setName(event.target.value)}
          />
        </label>
        <label className="experiment-operation__create-field is-required">
          <span>分类</span>
          <div className="experiment-operation__category-entry">
            <input
              value={categoryInput}
              maxLength={MAX_OPERATION_CATEGORY_LENGTH}
              disabled={categories.length >= MAX_OPERATION_CATEGORIES}
              autoComplete="off"
              aria-describedby={categoryHelpId}
              placeholder="输入分类后按 Enter"
              onChange={event => setCategoryInput(event.target.value)}
              onKeyDown={handleCategoryKeyDown}
            />
            <WorkflowButton
              type="button"
              disabled={
                !categoryInput.trim()
                || categories.length >= MAX_OPERATION_CATEGORIES
              }
              disabledReason={categories.length >= MAX_OPERATION_CATEGORIES
                ? '最多只能选择 20 个分类'
                : '请先输入分类名称'}
              onClick={() => addCategory(categoryInput)}
            >
              添加
            </WorkflowButton>
          </div>
          <small id={categoryHelpId}>可选择多个，最多 20 个分类。</small>
        </label>
        {categories.length > 0 ? (
          <div
            className="experiment-operation__selected-categories"
            aria-label="已选分类"
          >
            <span>已选</span>
            <div>
              {categories.map(category => (
                <span key={category}>
                  {category}
                  <button
                    type="button"
                    aria-label={`移除分类 ${category}`}
                    onClick={() => removeCategory(category)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {categorySuggestions.length > 0 ? (
          <div
            className="experiment-operation__category-suggestions"
            role="group"
            aria-label="已有分类"
          >
            <span>已有分类</span>
            <div>
              {categorySuggestions.map(category => {
                const selected = categories.includes(category)
                return (
                  <button
                    key={category}
                    type="button"
                    className={selected ? 'is-selected' : undefined}
                    aria-pressed={selected}
                    onClick={() => selected
                      ? removeCategory(category)
                      : addCategory(category)}
                  >
                    {selected ? '✓ ' : '+ '}{category}
                  </button>
                )
              })}
            </div>
            {availableSuggestions.length === 0 ? (
              <small>当前已有分类均已选择。</small>
            ) : null}
          </div>
        ) : null}
        <label className="experiment-operation__create-field is-wide">
          <span>描述说明</span>
          <textarea
            value={description}
            maxLength={500}
            rows={4}
            placeholder="说明操作用途、输入条件和预期结果"
            onChange={event => setDescription(event.target.value)}
          />
        </label>
        <p className="experiment-operation__create-boundary-note">
          <span className="codicon codicon-info" aria-hidden="true" />
          <span>
            创建成功后进入空白流程画布；Python 文件与 OS 数据库任一写入失败，
            都不会创建前端临时定义。
          </span>
        </p>
        {error ? (
          <p className="workflow-runtime__catalog-dialog-error" role="alert">
            创建失败：{error}
          </p>
        ) : null}
        <footer>
          <WorkflowButton
            type="button"
            disabled={submitting}
            disabledReason="实验操作创建事务正在提交"
            onClick={onCancel}
          >
            取消
          </WorkflowButton>
          <WorkflowButton
            type="submit"
            className="is-primary"
            disabled={!canSubmit}
            disabledReason={submitting
              ? '正在同步 Python 文件与 OS 数据库'
              : '请填写名称和分类'}
          >
            {submitting ? '正在创建…' : '创建并打开'}
          </WorkflowButton>
        </footer>
      </form>
    </CatalogDialog>
  )
}

const MAX_OPERATION_CATEGORIES = 20
const MAX_OPERATION_CATEGORY_LENGTH = 50

/** 规范作者选择的分类，保持顺序并移除空值与重复项。 */
export function normalizeOperationCategories(
  values: readonly string[]
): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}
