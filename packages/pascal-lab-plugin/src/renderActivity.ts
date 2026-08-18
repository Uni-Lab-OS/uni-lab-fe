export type PascalLabViewMode = '2d' | '2.5d' | '3d' | 'split'

/**
 * 判断统一实验室视图是否完全覆盖 Pascal 三维画布。
 *
 * @param viewMode 当前 2D、2.5D、3D 或分屏视图模式。
 * @returns 2D 与 2.5D 模式返回 true，避免隐藏画布继续消耗 GPU；其余返回 false。
 */
export function shouldPausePascalRendering(
  viewMode: PascalLabViewMode
): boolean {
  return viewMode === '2d' || viewMode === '2.5d'
}
