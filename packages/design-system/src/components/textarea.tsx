import { cn } from '../lib/utils'

export type TextareaProps = React.ComponentProps<'textarea'>

/**
 * 渲染支持多行说明和诊断文本的统一输入区。
 * @param props 原生多行输入属性及可选业务布局类名。
 * @returns 带统一边框、错误和焦点状态的多行输入元素。
 */
export function Textarea({ className, ...props }: TextareaProps): React.JSX.Element {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-20 w-full resize-y rounded-[var(--unilab-radius-control)] border border-[var(--unilab-color-border-strong)] bg-[var(--unilab-color-surface)] px-2.5 py-2 text-[13px] leading-relaxed text-[var(--unilab-color-text)] outline-none',
        'transition-[color,box-shadow,border-color] duration-[var(--unilab-motion-fast)] motion-reduce:transition-none',
        'placeholder:text-[var(--unilab-color-text-muted)] focus-visible:border-[var(--unilab-color-control)] focus-visible:ring-[3px] focus-visible:ring-[var(--unilab-color-focus)]/45',
        'aria-invalid:border-[var(--unilab-color-danger)] aria-invalid:ring-[var(--unilab-color-danger)]/20 disabled:cursor-not-allowed disabled:bg-[var(--unilab-color-bg-muted)] disabled:opacity-70',
        className
      )}
      {...props}
    />
  )
}
