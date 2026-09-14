export type PascalLabViewMode = '2d' | '2.5d' | '3d' | 'split'

/** 三维画布被二维视图完全覆盖时暂停连续帧循环。 */
export function shouldPausePascalRendering(
  viewMode: PascalLabViewMode
): boolean {
  return viewMode === '2d' || viewMode === '2.5d'
}
