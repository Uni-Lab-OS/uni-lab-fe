import { cn } from '../lib/utils'

export type NativeSelectProps = React.ComponentProps<'select'>

/**
 * 渲染保留浏览器原生键盘与表单语义的统一选择框。
 * @param props 原生选择框属性和选项子元素。
 * @returns 带统一尺寸、禁用和错误状态的选择元素。
 */
export function NativeSelect({ className, children, ...props }: NativeSelectProps): React.JSX.Element {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'flex h-9 w-full min-w-0 appearance-auto rounded-[var(--unilab-radius-control)] border border-[var(--unilab-color-border-strong)] bg-[var(--unilab-color-surface)] px-2.5 py-1 text-[13px] text-[var(--unilab-color-text)] outline-none',
        'transition-[color,box-shadow,border-color] duration-[var(--unilab-motion-fast)] motion-reduce:transition-none',
        'focus-visible:border-[var(--unilab-color-control)] focus-visible:ring-[3px] focus-visible:ring-[var(--unilab-color-focus)]/45',
        'aria-invalid:border-[var(--unilab-color-danger)] aria-invalid:ring-[var(--unilab-color-danger)]/20 disabled:cursor-not-allowed disabled:bg-[var(--unilab-color-bg-muted)] disabled:opacity-70',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}
