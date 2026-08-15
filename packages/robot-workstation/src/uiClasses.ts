import { badgeVariants, buttonVariants } from '@unilab/design-system'

type ButtonTone = 'primary' | 'secondary' | 'danger'
type ButtonSize = 'default' | 'compact' | 'icon'
type PillTone = 'info' | 'success' | 'warning' | 'neutral'

/** 共享的原子样式只保留为静态 Tailwind 类，确保构建期可以完整扫描。 */
export const uiClass = {
  compactEmptyState: 'px-2 py-6 text-center text-xs text-[var(--unilab-color-text-muted)]',
  dialogActions: 'flex justify-end gap-2 border-t border-[var(--unilab-color-border)] px-3.5 pt-3',
  dialogBackdrop: 'fixed inset-0 z-[100] grid place-items-center bg-[rgb(15_23_42_/_48%)] p-6 max-[720px]:items-end max-[720px]:p-0',
  headerActions: 'flex flex-wrap justify-end gap-2 max-[720px]:justify-start',
  moduleHeader:
    'mb-3 flex items-start justify-between gap-4 max-[720px]:grid [&_h1]:mb-1 [&_h1]:text-xl [&_h1]:leading-[1.35] [&_h1]:font-bold [&_h1]:tracking-[-0.015em] [&_h1]:text-[var(--unilab-color-text)] max-[480px]:[&_h1]:text-lg [&_p]:m-0 [&_p]:max-w-[72ch] [&_p]:text-xs [&_p]:leading-[1.55] [&_p]:text-[var(--unilab-color-text-muted)]',
  modulePage: 'box-border min-h-full min-w-0 p-5 max-[940px]:p-3.5 max-[720px]:p-3 max-[480px]:p-2.5',
  mono: 'font-[var(--unilab-font-mono)] tabular-nums',
  notice:
    'mb-3 flex min-h-[34px] items-center gap-2 rounded-[var(--unilab-radius-control)] border border-[#fed7aa] bg-[var(--unilab-color-warning-soft)] px-2.5 py-[7px] text-[13px] leading-[1.45] text-[#8a4b08] max-[720px]:items-start [&>svg]:size-4 [&>svg]:shrink-0',
  panel:
    'min-w-0 overflow-hidden rounded-[var(--unilab-radius-lg)] border border-[var(--unilab-color-border)] bg-[var(--unilab-color-surface)]',
  panelBody: 'p-3',
  panelHeader:
    'flex min-h-12 items-center justify-between gap-3 border-b border-[var(--unilab-color-border)] px-3 py-[9px] [&>div]:min-w-0 [&_h2]:m-0 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-[var(--unilab-color-text)] [&_small]:mt-0.5 [&_small]:block [&_small]:text-xs [&_small]:text-[var(--unilab-color-text-muted)]',
  rowActions: 'flex gap-0.5 [&_button:disabled]:opacity-[0.38]',
  screenReaderOnly: 'sr-only',
  tableScroll: 'min-w-0 overflow-auto',
} as const

/**
 * 把机械臂工作台的既有按钮语义映射到共享 shadcn/ui 变体。
 * @param tone 主操作、次操作或危险操作语义。
 * @param size 常规、紧凑或纯图标尺寸。
 * @returns 可以用于渐进迁移既有原生按钮的共享组件类名。
 */
export function buttonClass(tone: ButtonTone = 'secondary', size: ButtonSize = 'default'): string {
  const variant = tone === 'primary' ? 'default' : tone === 'danger' ? 'destructive' : 'outline'
  const mappedSize = size === 'compact' ? 'sm' : size === 'icon' ? 'icon-sm' : 'default'
  return buttonVariants({ variant, size: mappedSize })
}

/**
 * 把工作台状态语义映射到共享 shadcn/ui Badge 变体。
 * @param tone 信息、成功、警告或中性状态。
 * @returns 可用于现有状态标签的共享组件类名。
 */
export function pillClass(tone: PillTone): string {
  const variant = tone === 'info' ? 'default' : tone
  return badgeVariants({ variant: variant === 'neutral' ? 'secondary' : variant })
}

/** 给动态状态标签复用结构，不抢占其由模块 SCSS 决定的语义颜色。 */
export const pillBaseClass = badgeVariants({ variant: 'secondary' })
