import {
  filterWorkflowResourceSlotOptions,
  type WorkflowResourceSlotOption,
  type WorkflowResourceSlotOptionsState
} from '../utils/workflowResourceSlotOptions'

export interface WorkflowResourceSelectorProps {
  label: string
  value: string
  optionsState?: WorkflowResourceSlotOptionsState
  allowedResourceTemplateUuids?: readonly string[] | null
  disabled?: boolean
  emptyLabel?: string
  onChange: (materialUuid: string | null) => void
}

/**
 * Selects a stable material UUID from the current laboratory inventory.
 *
 * The component deliberately accepts only the narrow ResourceSlot options
 * projection. It never reads inventory authority or serializes JSON itself.
 */
export function WorkflowResourceSelector({
  label,
  value,
  optionsState,
  allowedResourceTemplateUuids,
  disabled = false,
  emptyLabel = '请选择物料',
  onChange
}: WorkflowResourceSelectorProps): React.JSX.Element {
  const options = compatibleOptions(
    optionsState,
    allowedResourceTemplateUuids ?? undefined
  )
  const problem = availabilityMessage(optionsState, options)
  const selectedOption = value
    ? options.find((option) => option.materialUuid === value)
    : undefined
  const staleSelectedOption: WorkflowResourceSlotOption | null =
    value && !selectedOption
      ? {
          materialUuid: value,
          resourceTemplateUuid: '',
          displayLabel: `当前引用 · …${value.replace(/-/g, '').slice(-6)}（不可用）`
        }
      : null

  return (
    <div className="persistent-authoring__resource-selector">
      <label>
        <span className="persistent-authoring__resource-selector-heading">
          <span>{label}</span>
          <small>可选物料：{options.length}</small>
        </span>
        <select
          aria-label={label}
          value={value}
          disabled={disabled || Boolean(problem)}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{emptyLabel}</option>
          {staleSelectedOption && (
            <option value={staleSelectedOption.materialUuid}>
              {staleSelectedOption.displayLabel}
            </option>
          )}
          {options.map((option) => (
            <option key={option.materialUuid} value={option.materialUuid}>
              {option.displayLabel}
            </option>
          ))}
        </select>
      </label>
      {problem && <span role="status">{problem}</span>}
    </div>
  )
}

function compatibleOptions(
  state: WorkflowResourceSlotOptionsState | undefined,
  allowedResourceTemplateUuids?: readonly string[]
): readonly WorkflowResourceSlotOption[] {
  if (!state || state.kind !== 'ready') return []
  return filterWorkflowResourceSlotOptions(
    state.options,
    allowedResourceTemplateUuids
  )
}

function availabilityMessage(
  state: WorkflowResourceSlotOptionsState | undefined,
  compatible: readonly WorkflowResourceSlotOption[]
): string | null {
  if (!state) return '正在读取当前实验室物料…'
  if (state.kind !== 'ready') return state.message
  return compatible.length === 0
    ? '当前实验室没有符合参数模板的物料'
    : null
}
