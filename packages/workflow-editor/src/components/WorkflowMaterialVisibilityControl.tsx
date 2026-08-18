import { useDismissibleDetails } from '@unilab/design-system/hooks'
import type { ChangeEvent } from 'react'

import type { WorkflowMaterialRoleOption } from '../utils/workflowMaterialTrace'
import { WorkflowButton } from './WorkflowButton'

interface WorkflowMaterialVisibilityControlProps {
  options: readonly WorkflowMaterialRoleOption[]
  visibleMaterialRoles: readonly string[] | null
  primarySampleLocked: boolean
  onVisibleMaterialRolesChange: (
    visibleMaterialRoles: readonly string[] | null
  ) => void
}

/**
 * 渲染物料流角色（MaterialFlowRole）的独立显隐控件。
 *
 * @param props 角色目录、当前可见角色、主样品锁定状态与可见性变更入口。
 * @returns 支持键盘操作的多选物料（Material）可见性菜单。
 * @throws 不主动抛错；可见性回调异常由宿主处理。
 * @safety 至少保留一种物料角色，收起菜单不改变过滤结果。
 */
export default function WorkflowMaterialVisibilityControl({
  options,
  visibleMaterialRoles,
  primarySampleLocked,
  onVisibleMaterialRolesChange
}: WorkflowMaterialVisibilityControlProps): React.JSX.Element {
  const menuRef = useDismissibleDetails()
  const visibleRoleSet = new Set(
    visibleMaterialRoles ?? options.map((option) => option.value)
  )
  const allVisible = visibleRoleSet.size === options.length
  const summaryLabel = allVisible
    ? '全部物料'
    : `显示 ${visibleRoleSet.size}/${options.length}`

  /**
   * 切换一个物料流角色（MaterialFlowRole）的画布可见性。
   *
   * @param event 发生变化的原生复选框事件；value 是角色 wire 值。
   * @returns 无返回值；至少保留一种角色，全部选中时规范化为 null。
   */
  function handleRoleToggle(event: ChangeEvent<HTMLInputElement>): void {
    const next = new Set(visibleRoleSet)
    if (event.currentTarget.checked) next.add(event.currentTarget.value)
    else next.delete(event.currentTarget.value)
    if (next.size === 0) return
    const ordered = options
      .map((option) => option.value)
      .filter((value) => next.has(value))
    onVisibleMaterialRolesChange(
      ordered.length === options.length ? null : ordered
    )
  }

  /**
   * 恢复全部物料流角色（MaterialFlowRole）可见。
   *
   * @returns 无返回值；null 表示画布不做角色裁剪。
   */
  function showAllMaterialRoles(): void {
    onVisibleMaterialRolesChange(null)
  }

  return (
    <details
      ref={menuRef}
      className="workflow-runtime__material-role-filter"
      data-filter-active={!allVisible}
    >
      <summary aria-label={`物料节点可见性：${summaryLabel}`}>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="M3 4h14l-5.4 6.2v4.4l-3.2 1.8v-6.2L3 4Z" />
        </svg>
        <span>{summaryLabel}</span>
      </summary>
      <div
        className="workflow-runtime__material-role-menu"
        role="group"
        aria-label="物料节点可见性"
      >
        {options.map((option) => {
          const checked = visibleRoleSet.has(option.value)
          const locked = primarySampleLocked &&
            option.value === 'primary_sample'
          return (
            <label
              key={option.value}
              className={checked ? 'is-active' : undefined}
              title={locked
                ? '主样品蛇形布局以主样品为固定主干，不能隐藏'
                : undefined}
            >
              <input
                type="checkbox"
                value={option.value}
                checked={checked}
                disabled={locked || (checked && visibleRoleSet.size === 1)}
                onChange={handleRoleToggle}
              />
              <span
                className="workflow-runtime__material-role-swatch"
                aria-hidden="true"
                style={{ backgroundColor: option.accent }}
              />
              <span>{option.label}</span>
              <small>{option.lineageCount}</small>
            </label>
          )
        })}
        <WorkflowButton
          type="button"
          className="workflow-runtime__material-role-show-all"
          disabled={allVisible}
          disabledReason="当前已经显示全部物料节点"
          onClick={showAllMaterialRoles}
        >
          全部显示
        </WorkflowButton>
      </div>
    </details>
  )
}
