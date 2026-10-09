import { clsx } from 'clsx'
import sharedStyles from '../../styles/shared.module.scss'
import { Typography } from 'antd'
import type { ReactNode } from 'react'

export function PageHeader({
  title,
  leading,
  actions,
}: {
  title: ReactNode
  leading?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className={clsx(sharedStyles['page-header'])}>
      <div className={clsx(sharedStyles['page-header-title-row'])}>
        {leading}
        <Typography.Title className={clsx('page-header-title')} level={1}>
          {title}
        </Typography.Title>
      </div>
      {actions && <div className={clsx(sharedStyles['page-header-actions'])}>{actions}</div>}
    </header>
  )
}
