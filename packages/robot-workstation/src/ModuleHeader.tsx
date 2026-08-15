import type { ReactNode } from 'react'
import { Button } from '@unilab/design-system'

import { uiClass } from './uiClasses'
import { WorkstationIcon } from './WorkstationIcon'
import type { WorkstationDataStatus } from './types'

/** 渲染四个模块共享的身份、能力说明与主要操作区。 */
export function ModuleHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <header className={uiClass.moduleHeader}>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className={uiClass.headerActions}>{actions}</div>
    </header>
  )
}

/** 显示真实接口投影与调度、传感器或写模型之间的数据权威边界。 */
export function DataAuthorityNotice({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className={uiClass.notice} role="note">
      <WorkstationIcon name="shield" />
      <span>{children}</span>
    </div>
  )
}

/**
 * 呈现真实数据接口的加载、空、错误或未接入状态。
 * @param props 当前接口状态、业务标题与空态图标。
 * @returns 不包含任何夹具回退的可行动状态面板。
 */
export function WorkstationDataState({
  status,
  title,
  icon = 'shield',
  action
}: {
  status: WorkstationDataStatus
  title: string
  icon?: 'shield' | 'point' | 'map' | 'flask'
  action?: ReactNode
}): React.JSX.Element {
  return (
    <section className="flex min-h-[280px] items-center justify-center px-6 py-10" role={status.phase === 'error' ? 'alert' : 'status'}>
      <div className="max-w-[520px] text-center text-[var(--unilab-color-text)]">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl border border-[var(--unilab-color-border)] bg-[var(--unilab-color-surface-muted)] text-[var(--unilab-color-instrument)]">
          <WorkstationIcon name={icon} />
        </span>
        <h2 className="m-0 text-base font-semibold">{title}</h2>
        <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-6 text-[var(--unilab-color-text-muted)]">{status.message}</p>
        {action ? (
          <div className="mt-4">{action}</div>
        ) : status.retry ? (
          <Button variant="outline" className="mt-4" onClick={status.retry}>
            重新读取
          </Button>
        ) : null}
      </div>
    </section>
  )
}
