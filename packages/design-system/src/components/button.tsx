import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../lib/utils'

export const buttonVariants = cva(
  [
    'inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--unilab-radius-control)] border px-3 text-[13px] leading-[1.2] font-semibold',
    'transition-[color,background-color,border-color,box-shadow] duration-[var(--unilab-motion-fast)] motion-reduce:transition-none',
    'outline-none focus-visible:border-[var(--unilab-color-primary)] focus-visible:ring-[3px] focus-visible:ring-[var(--unilab-color-focus)]/45',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--unilab-color-bg-muted)] disabled:text-[var(--unilab-color-text-subtle)] disabled:opacity-70',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'
  ],
  {
    variants: {
      variant: {
        default:
          'border-[var(--unilab-color-control)] bg-[var(--unilab-color-control)] text-white hover:border-[var(--unilab-color-control-hover)] hover:bg-[var(--unilab-color-control-hover)]',
        destructive:
          'border-[#fca5a5] bg-[var(--unilab-color-danger-soft)] text-[var(--unilab-color-danger)] hover:border-[var(--unilab-color-danger)] hover:bg-[#fee2e2]',
        outline:
          'border-[var(--unilab-color-border-strong)] bg-[var(--unilab-color-surface)] text-[var(--unilab-color-text)] hover:border-[var(--unilab-color-control)] hover:bg-[var(--unilab-color-bg-subtle)]',
        secondary:
          'border-[var(--unilab-color-border)] bg-[var(--unilab-color-bg-muted)] text-[var(--unilab-color-text)] hover:bg-[var(--unilab-color-surface-muted)]',
        ghost:
          'border-transparent bg-transparent text-[var(--unilab-color-text-muted)] hover:bg-[var(--unilab-color-bg-muted)] hover:text-[var(--unilab-color-text)]',
        link:
          'min-h-0 border-transparent bg-transparent px-0 text-[var(--unilab-color-control)] underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-10',
        sm: 'h-8 min-h-8 gap-1.5 px-2.5 text-xs',
        lg: 'h-11 px-4 text-sm',
        icon: 'size-9 min-h-9 p-0',
        'icon-sm': 'size-8 min-h-8 p-0'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

/**
 * 渲染 shadcn/ui 风格的统一按钮原语。
 * @param props 原生按钮属性、视觉变体、尺寸及可选的 `asChild` 组合模式。
 * @returns 带统一状态、焦点和尺寸语义的按钮元素。
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      data-slot="button"
      data-variant={variant ?? 'default'}
      data-size={size ?? 'default'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...(!asChild ? { type } : {})}
      {...props}
    />
  )
}
