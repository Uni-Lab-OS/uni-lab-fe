/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 右侧滑出抽屉(遮罩 + translate-x 动画),对齐大 web InteractivePanel
 * Context: 工作流步骤参数编辑面板容器,纯 CSS 过渡,不引入 headlessui
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { XIcon } from 'lucide-react'

import { Button } from './components/button'

interface SlideOverDrawerProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  ariaLabel?: string
  closeLabel?: string
  size?: 'default' | 'medium' | 'wide'
  /**
   * 模态抽屉会遮罩页面、接管焦点并限制 Tab 键范围。检查器一类需要和
   * 页面内容并行交互的面板应关闭此项。
   */
  modal?: boolean
  /** 是否启用抽屉和遮罩的 300ms 过渡动画。 */
  animated?: boolean
}

// 右侧滑出抽屉:遮罩点击关闭,Esc 关闭,面板从右侧 translate-x 滑入
export function SlideOverDrawer({
  open,
  title,
  onClose,
  children,
  footer,
  ariaLabel,
  closeLabel = '关闭',
  size = 'default',
  modal = true,
  animated = true
}: SlideOverDrawerProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  const sizeClass = size === 'wide'
    ? 'w-[min(1120px,96%)]'
    : size === 'medium'
      ? 'w-[min(860px,96%)]'
      : 'w-[480px] max-w-[90%]'

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // 打开时监听 Esc 关闭
  useEffect(() => {
    if (!open) return
    const returnFocus = modal && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (!modal || event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), ' +
          'select:not([disabled]), textarea:not([disabled]), ' +
          '[href], [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusable.length === 0) {
        event.preventDefault()
        dialogRef.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    const focusFrame = modal
      ? requestAnimationFrame(() => {
          const initialFocus = dialogRef.current?.querySelector<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), button:not([disabled])'
          )
          ;(initialFocus ?? dialogRef.current)?.focus({ preventScroll: true })
        })
      : null
    return () => {
      window.removeEventListener('keydown', handleKey)
      if (focusFrame !== null) cancelAnimationFrame(focusFrame)
      returnFocus?.focus({ preventScroll: true })
    }
  }, [modal, open])

  return (
    <div
      className={`${
        modal
          ? 'fixed inset-0 overflow-hidden'
          : `fixed inset-y-0 right-0 overflow-hidden ${sizeClass}`
      } ${
        open && modal ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      style={{
        zIndex: 1000,
        visibility: open ? 'visible' : 'hidden',
        transition: open || !animated
          ? 'none'
          : 'visibility 0s linear 300ms'
      }}
      aria-hidden={!open}
      data-slide-over-mode={modal ? 'modal' : 'modeless'}
    >
      {modal && (
        <div
          className={`absolute inset-0 bg-[rgba(15,23,42,0.35)] ${
            animated ? 'transition-opacity duration-300' : ''
          } ${open ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClose}
          data-slide-over-backdrop
        />
      )}
      <div
        ref={dialogRef}
        className={`absolute inset-y-0 right-0 flex ${
          modal ? sizeClass : 'w-full'
        } pointer-events-auto flex-col bg-[var(--unilab-color-surface)] shadow-[-8px_0_24px_rgba(15,23,42,0.18)] ${
          animated
            ? 'transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]'
            : ''
        }`}
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)'
        }}
        role="dialog"
        aria-modal={modal || undefined}
        tabIndex={-1}
        aria-label={
          ariaLabel ?? (typeof title === 'string' ? title : undefined)
        }
      >
        <header className="flex items-center justify-between border-b border-[var(--unilab-color-border)] bg-[var(--unilab-color-surface-subtle)] px-[18px] py-3.5">
          <div className="text-[15px] font-semibold text-[var(--unilab-color-text)]">{title}</div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <XIcon className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--unilab-color-bg-subtle)] px-[18px] py-4">
          {children}
        </div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-[var(--unilab-color-border)] bg-[var(--unilab-color-surface-subtle)] px-[18px] py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
