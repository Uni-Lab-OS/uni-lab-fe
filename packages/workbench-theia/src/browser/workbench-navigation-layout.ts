import type { Widget } from '@theia/core/lib/browser'

/**
 * 将 CSS 引起的侧栏尺寸变化同步给 Lumino。
 * 入口页通过 display:none 隐藏侧栏，原生活动栏会在零高度时把菜单收进
 * 溢出区；恢复可见不会产生 Lumino 的显示消息，必须重新布局并测量菜单。
 */
export function observeWorkbenchNavigationLayout(
  panel: Pick<Widget, 'node' | 'fit'>,
  activityBar: Pick<Widget, 'update'>
): { dispose(): void } {
  let frame: number | undefined
  const observer = new ResizeObserver(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    if (panel.node.clientWidth === 0 || panel.node.clientHeight === 0) return

    // 下一帧重新读取真实尺寸，避免切回入口页时继续按隐藏状态测量。
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (panel.node.clientWidth === 0 || panel.node.clientHeight === 0) return
      panel.fit()
      activityBar.update()
    })
  })
  observer.observe(panel.node)

  return {
    dispose() {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }
}
