import { cn } from '../lib/utils'

export type LabelProps = React.ComponentProps<'label'>

/**
 * 渲染统一的表单字段标签，并把禁用状态传递给文字层级。
 * @param props 原生标签属性、字段内容和布局类名。
 * @returns 适合包裹输入控件或通过 `htmlFor` 关联控件的标签元素。
 */
export function Label({ className, ...props }: LabelProps): React.JSX.Element {
  return (
    <label
      data-slot="label"
      className={cn(
        'grid min-w-0 gap-1.5 text-xs font-medium leading-none text-[var(--unilab-color-text-muted)] has-[[data-slot=input]]:leading-normal has-[[data-slot=textarea]]:leading-normal peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className
      )}
      {...props}
    />
  )
}
