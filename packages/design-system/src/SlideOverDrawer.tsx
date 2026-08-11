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

import './SlideOverDrawer.css'

interface SlideOverDrawerProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  ariaLabel?: string
  closeLabel?: string
  size?: 'default' | 'medium' | 'wide'
}

/**
 * 展示由设计系统自身携带布局样式的右侧任务抽屉。
 * @param props 打开状态、标题、内容、可选底栏、尺寸与关闭回调。
 * @returns 支持遮罩关闭、Escape、焦点循环及焦点恢复的模态抽屉。
 */
export function SlideOverDrawer({
  open,
  title,
  onClose,
  children,
  footer,
  ariaLabel,
  closeLabel = '关闭',
  size = 'default'
}: SlideOverDrawerProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // 打开时监听 Esc 关闭
  useEffect(() => {
    if (!open) return
    const returnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
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
    requestAnimationFrame(() => {
      const initialFocus = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), button:not([disabled])'
      )
      ;(initialFocus ?? dialogRef.current)?.focus({ preventScroll: true })
    })
    return () => {
      window.removeEventListener('keydown', handleKey)
      returnFocus?.focus({ preventScroll: true })
    }
  }, [open])

  return (
    <div
      className={`unilab-slide-over${open ? ' is-open' : ''}`}
      aria-hidden={!open}
    >
      <div
        className="unilab-slide-over__backdrop"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className={`unilab-slide-over__panel unilab-slide-over__panel--${size}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={
          ariaLabel ?? (typeof title === 'string' ? title : undefined)
        }
      >
        <header className="unilab-slide-over__header">
          <div className="unilab-slide-over__title">{title}</div>
          <button
            type="button"
            className="unilab-slide-over__close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            ×
          </button>
        </header>
        <div className="unilab-slide-over__content">
          {children}
        </div>
        {footer && (
          <footer className="unilab-slide-over__footer">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
