import { clsx } from 'clsx'
import sharedStyles from '../../styles/shared.module.scss'
import { Typography } from 'antd'
import type { CSSProperties } from 'react'

export function TableText({
  text,
  className,
  style,
}: {
  text: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <Typography.Text
      className={clsx([sharedStyles['table-text'], className].filter(Boolean).join(' '))}
      ellipsis={{ tooltip: text }}
      style={{ display: 'block', maxWidth: '100%', ...style }}
    >
      {text}
    </Typography.Text>
  )
}
