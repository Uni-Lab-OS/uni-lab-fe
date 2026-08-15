const SELECTION_DRAG_THRESHOLD_PX = 6

/** 区分场景点击与相机拖拽，允许不超过阈值的自然手部抖动。 */
export function exceedsSelectionDragThreshold(
  start: Readonly<{ x: number; y: number }>,
  current: Readonly<{ x: number; y: number }>,
  thresholdPx = SELECTION_DRAG_THRESHOLD_PX
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > thresholdPx
}
