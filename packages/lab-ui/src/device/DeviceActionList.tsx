import type { DeviceActionState } from '@unilab-fe/core'

import { cx } from '../classNames'
export interface DeviceActionListProps {
  readonly actions: readonly DeviceActionState[]
  readonly selectedActionRef?: string
  readonly onSelectAction?: (action: DeviceActionState) => void
  readonly emptyDescription?: string
}

/** 设备动作选择列表；动作执行和调试状态由场景页面负责。 */
export function DeviceActionList({
  actions,
  selectedActionRef,
  onSelectAction,
  emptyDescription = '设备没有可用动作',
}: DeviceActionListProps) {
  if (actions.length === 0) {
    return <p className={cx('lab-ui-device-action-list__empty')}>{emptyDescription}</p>
  }
  return (
    <div className={cx('lab-ui-device-action-list')}>
      {actions.map((action) => (
        <button
          type="button"
          key={action.actionRef}
          className={cx('action-item', selectedActionRef === action.actionRef && 'is-selected')}
          aria-pressed={selectedActionRef === action.actionRef}
          onClick={() => onSelectAction?.(action)}
        >
          <span className={cx('action-item-label')} title={action.label}>
            <strong>{action.label}</strong>
          </span>
          {action.isBusy && <span className={cx('lab-ui-device-action-list__busy')}>执行中</span>}
        </button>
      ))}
    </div>
  )
}
