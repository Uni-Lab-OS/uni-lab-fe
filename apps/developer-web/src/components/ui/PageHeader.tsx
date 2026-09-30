import { cx } from '../../styles/styleMaps'
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
    <header className={cx('page-header')}>
      <div className={cx('page-header-title-row')}>
        {leading}
        <Typography.Title className={cx('page-header-title')} level={1}>
          {title}
        </Typography.Title>
      </div>
      {actions && <div className={cx('page-header-actions')}>{actions}</div>}
    </header>
  )
}
