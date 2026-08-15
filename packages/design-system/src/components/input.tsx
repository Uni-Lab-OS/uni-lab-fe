import { cn } from '../lib/utils'

export type InputProps = React.ComponentProps<'input'>

/**
 * 渲染适用于文本、数值、日期和搜索值的统一输入框。
 * @param props 原生输入框属性；`className` 可补充业务布局但不重建交互状态。
 * @returns 带错误、禁用和键盘焦点反馈的输入元素。
 */
export function Input({ className, type, ...props }: InputProps): React.JSX.Element {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-[var(--unilab-radius-control)] border border-[var(--unilab-color-border-strong)] bg-[var(--unilab-color-surface)] px-2.5 py-1 text-[13px] text-[var(--unilab-color-text)] shadow-none outline-none',
        'transition-[color,box-shadow,border-color] duration-[var(--unilab-motion-fast)] motion-reduce:transition-none',
        'placeholder:text-[var(--unilab-color-text-muted)] selection:bg-[var(--unilab-color-primary-soft)] selection:text-[var(--unilab-color-text)]',
        'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-xs file:font-medium',
        'focus-visible:border-[var(--unilab-color-control)] focus-visible:ring-[3px] focus-visible:ring-[var(--unilab-color-focus)]/45',
        'aria-invalid:border-[var(--unilab-color-danger)] aria-invalid:ring-[var(--unilab-color-danger)]/20',
        'disabled:cursor-not-allowed disabled:bg-[var(--unilab-color-bg-muted)] disabled:text-[var(--unilab-color-text-muted)] disabled:opacity-70',
        className
      )}
      {...props}
    />
  )
}
