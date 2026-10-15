import { clsx } from 'clsx'
import styles from './DeviceActionPresentation.module.scss'
import { Button } from 'antd'
import { useState } from 'react'
import { groupActionsByCategory } from '@unilab-fe/core'
import type { DeviceActionPresentations, DeviceActionState } from '@unilab-fe/core'
import { DeviceActionList } from '@unilab/lab-ui'

/**
 * 按类别分组的动作列表：先“查看与采集”，再“驱动机构”等；流程辅助与资源钩子由流程调用，
 * 默认收起以免误点。没有展示元数据时退回原平铺列表。
 */
export function DeviceActionGroups({
  actions,
  presentations,
  deviceKey,
  selectedActionRef,
  onSelectAction,
}: {
  actions: readonly DeviceActionState[]
  presentations: DeviceActionPresentations | undefined
  deviceKey: string
  selectedActionRef?: string
  onSelectAction: (action: DeviceActionState) => void
}) {
  const [showFlow, setShowFlow] = useState(false)
  if (!presentations) {
    return (
      <DeviceActionList
        actions={actions}
        selectedActionRef={selectedActionRef}
        onSelectAction={onSelectAction}
      />
    )
  }
  const groups = groupActionsByCategory(actions, presentations, deviceKey)
  const manualGroups = groups.filter((group) => group.info.manual)
  const flowGroups = groups.filter((group) => !group.info.manual)
  const flowCount = flowGroups.reduce((total, group) => total + group.actions.length, 0)
  const selectedInFlow = flowGroups.some((group) =>
    group.actions.some((action) => action.actionRef === selectedActionRef),
  )
  const visible = showFlow || selectedInFlow ? groups : manualGroups
  return (
    <div className={clsx(styles['action-groups'])}>
      {visible.map((group) => (
        <section key={group.category} aria-label={group.info.label}>
          <h3 className={clsx(styles['action-group__title'])}>
            <span>{group.info.label}</span>
            <span>{group.actions.length}</span>
          </h3>
          {!group.info.manual && (
            <p className={clsx(styles['action-group__hint'])}>由流程调用，一般不需要手动下发</p>
          )}
          <DeviceActionList
            actions={group.actions}
            selectedActionRef={selectedActionRef}
            onSelectAction={onSelectAction}
          />
        </section>
      ))}
      {flowCount > 0 && !selectedInFlow && (
        <Button
          type="link"
          className={clsx(styles['action-groups__toggle'])}
          onClick={() => setShowFlow((value) => !value)}
        >
          {showFlow ? '收起流程辅助动作' : `显示流程辅助动作（${flowCount}）`}
        </Button>
      )}
    </div>
  )
}
