import { useEffect, useRef, type RefObject } from 'react'

type OutsidePointerDetails = Pick<
  HTMLDetailsElement,
  'contains' | 'open'
>

interface EscapeDismissDetails extends Pick<HTMLDetailsElement, 'open'> {
  querySelector: (
    selectors: string
  ) => Pick<HTMLElement, 'focus'> | null
}

/**
 * 当指针命中 details 之外时收起已展开菜单。
 *
 * @param details 原生 details 菜单；未挂载时允许为空。
 * @param target 指针事件命中的目标；未知目标按外部点击处理。
 * @returns 无返回值；内部点击保持菜单原状态，外部点击将 open 设为 false。
 * @throws 不主动抛错；调用方需保证 contains 接受 DOM Node。
 * @safety 只改变当前菜单的展开状态，不阻止或重放外部控件的原始事件。
 */
export function closeDetailsOnOutsidePointer(
  details: OutsidePointerDetails | null,
  target: EventTarget | null
): void {
  if (!details?.open) return
  if (target && details.contains(target as Node)) return
  details.open = false
}

/**
 * 使用 Escape 收起已展开菜单，并将键盘焦点归还给 summary。
 *
 * @param details 原生 details 菜单；未挂载时允许为空。
 * @param key 当前键盘事件的 key 值。
 * @returns 无返回值；非 Escape 或关闭状态不会产生变化。
 * @throws 不主动抛错；summary 不存在时只关闭菜单。
 * @safety 不改变业务选择，也不吞掉其他键盘事件。
 */
export function closeDetailsOnEscape(
  details: EscapeDismissDetails | null,
  key: string
): void {
  if (!details?.open || key !== 'Escape') return
  details.open = false
  details.querySelector('summary')?.focus()
}

/**
 * 为原生 details 下拉菜单统一安装外点与 Escape 关闭行为。
 *
 * @returns 应挂到 details 元素上的稳定 React ref。
 * @throws 不主动抛错；SSR 阶段不会访问 document。
 * @safety 监听器只在组件挂载期存在，卸载时完整清理，不改写领域状态。
 */
export function useDismissibleDetails<
  T extends HTMLDetailsElement = HTMLDetailsElement
>(): RefObject<T | null> {
  const detailsRef = useRef<T>(null)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      closeDetailsOnOutsidePointer(detailsRef.current, event.target)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      closeDetailsOnEscape(detailsRef.current, event.key)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return detailsRef
}
