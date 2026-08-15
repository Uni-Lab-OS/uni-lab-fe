import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '../lib/utils'

/** 渲染管理打开状态、焦点约束和模态语义的对话框根节点。 */
export function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>): React.JSX.Element {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

/** 渲染对话框的可选触发器，并保留调用方元素语义。 */
export function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>): React.JSX.Element {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

/** 把模态内容挂载到应用根级浮层，避免被工作区裁剪。 */
export function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>): React.JSX.Element {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

/** 渲染恢复焦点并关闭当前对话框的组合节点。 */
export function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>): React.JSX.Element {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/** 渲染模态遮罩，并在减少动态效果时关闭过渡。 */
export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>): React.JSX.Element {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-[100] bg-[rgb(15_23_42_/_48%)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
        className
      )}
      {...props}
    />
  )
}

export interface DialogContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  showCloseButton?: boolean
  closeLabel?: string
  portalled?: boolean
}

/**
 * 渲染具备焦点约束、Escape 关闭和焦点恢复的模态内容。
 * @param props 内容属性、可选关闭按钮及中文可访问标签。
 * @returns 通过 Portal 呈现的 shadcn/ui 对话框内容。
 */
export function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = '关闭',
  portalled = true,
  ...props
}: DialogContentProps): React.JSX.Element {
  const content = (
    <>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-[101] grid w-[min(780px,calc(100vw-48px))] max-h-[calc(100dvh-48px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[var(--unilab-radius-lg)] bg-[var(--unilab-color-surface)] text-[var(--unilab-color-text)] shadow-[var(--unilab-shadow-panel)] outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none',
          'max-[720px]:top-auto max-[720px]:bottom-0 max-[720px]:w-full max-[720px]:max-h-[92dvh] max-[720px]:translate-y-0 max-[720px]:rounded-b-none',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-[var(--unilab-radius-control)] border border-transparent bg-transparent text-[var(--unilab-color-text-muted)] outline-none transition-colors hover:bg-[var(--unilab-color-bg-muted)] hover:text-[var(--unilab-color-text)] focus-visible:ring-[3px] focus-visible:ring-[var(--unilab-color-focus)]/45 disabled:pointer-events-none"
            aria-label={closeLabel}
          >
            <XIcon className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </>
  )
  return portalled ? <DialogPortal>{content}</DialogPortal> : content
}

/** 渲染对话框标题和说明的稳定纵向分组。 */
export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="dialog-header" className={cn('grid gap-1.5', className)} {...props} />
}

/** 渲染对话框底部的主次操作区。 */
export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return <div data-slot="dialog-footer" className={cn('flex justify-end gap-2', className)} {...props} />
}

/** 渲染由 Radix 自动关联到对话框的可访问标题。 */
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>): React.JSX.Element {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('m-0 text-sm font-semibold text-[var(--unilab-color-text)]', className)}
      {...props}
    />
  )
}

/** 渲染由 Radix 自动关联到对话框的补充说明。 */
export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>): React.JSX.Element {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('m-0 text-xs leading-relaxed text-[var(--unilab-color-text-muted)]', className)}
      {...props}
    />
  )
}
