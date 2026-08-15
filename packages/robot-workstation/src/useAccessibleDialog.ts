import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** 为本地工作站模态框提供初始聚焦、焦点约束、Escape 关闭和焦点恢复。 */
export function useAccessibleDialog(onClose: () => void): RefObject<HTMLElement | null> {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const activeDialog: HTMLElement = dialog
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const initialFocus =
      activeDialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      activeDialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      activeDialog

    initialFocus.focus()

    /** 关闭模态框并把 Tab 键循环约束在当前对话框。 */
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      if (focusable.length === 0) {
        event.preventDefault()
        activeDialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    activeDialog.addEventListener('keydown', handleKeyDown)
    return () => {
      activeDialog.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [onClose])

  return dialogRef
}
