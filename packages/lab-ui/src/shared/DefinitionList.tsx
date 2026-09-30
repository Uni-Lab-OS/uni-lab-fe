import type { ReactNode } from 'react'

import { cx } from '../classNames'

export interface DefinitionListItem {
  readonly key?: string
  readonly label: ReactNode
  readonly value?: ReactNode
  readonly missingText?: ReactNode
  readonly mono?: boolean
  readonly wide?: boolean
  readonly className?: string
}

export interface DefinitionListProps {
  readonly items: readonly DefinitionListItem[]
  readonly variant?: 'rows' | 'form'
  readonly columns?: 1 | 2
  readonly emptyValue?: ReactNode
  readonly className?: string
  readonly ariaLabel?: string
}

/**
 * 只读领域事实的键值展示。字段值、缺失文案和数据标识由调用方提供，
 * 组件不读取领域状态，也不绑定表单库或请求状态。
 */
export function DefinitionList({
  items,
  variant = 'rows',
  columns = 1,
  emptyValue = '未提供',
  className,
  ariaLabel,
}: DefinitionListProps) {
  return (
    <dl
      className={cx(
        'lab-ui-definition',
        variant === 'form' && 'lab-ui-definition--form',
        variant === 'form' && `lab-ui-definition--columns-${columns}`,
        className,
      )}
      aria-label={ariaLabel}
    >
      {items.map((item, index) => {
        const missing = item.value == null || item.value === ''
        return (
          <div
            key={item.key ?? `${String(item.label)}-${index}`}
            className={cx(
              item.wide && 'lab-ui-definition__item--wide',
              item.className,
            )}
          >
            <dt>{item.label}</dt>
            <dd className={cx(item.mono && 'lab-ui-definition__value--mono', missing && 'lab-ui-definition__value--missing')}>
              {missing ? (item.missingText ?? emptyValue) : item.value}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
