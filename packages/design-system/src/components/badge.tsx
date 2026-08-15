import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../lib/utils'

export const badgeVariants = cva(
  'inline-flex min-h-[22px] w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs leading-[1.2] font-semibold [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-[var(--unilab-color-primary-soft)] text-[var(--unilab-color-primary)]',
        secondary: 'bg-[var(--unilab-color-bg-muted)] text-[var(--unilab-color-text-muted)]',
        destructive: 'bg-[var(--unilab-color-danger-soft)] text-[var(--unilab-color-danger)]',
        outline: 'border border-[var(--unilab-color-border-strong)] text-[var(--unilab-color-text)]',
        success: 'bg-[var(--unilab-color-success-soft)] text-[var(--unilab-color-success)]',
        warning: 'bg-[var(--unilab-color-warning-soft)] text-[var(--unilab-color-warning)]'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps
  extends React.ComponentProps<'span'>,
    VariantProps<typeof badgeVariants> {}

/**
 * 渲染带文字证据的紧凑状态标签。
 * @param props 标签内容、语义变体和原生 span 属性。
 * @returns 不把颜色作为唯一状态证据的标签元素。
 */
export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return (
    <span
      data-slot="badge"
      data-variant={variant ?? 'default'}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}
