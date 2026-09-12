export interface RelativeDialogSize { width: number; height: number }
export const DEFAULT_LOADING_DIALOG_SIZE: RelativeDialogSize = { width: 0.62, height: 0.62 }
export const LOADING_DIALOG_SIZE_KEY = 'unilab.loading-dialog.relative-size.v1'

/** 只保存相对视口尺寸；损坏/旧格式偏好回退，不保存任何任务或库存数据。 */
export function readRelativeDialogSize(value: string | null): RelativeDialogSize {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_LOADING_DIALOG_SIZE }
    const candidate = parsed as Partial<RelativeDialogSize>
    if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number' ||
      !Number.isFinite(candidate.width) || !Number.isFinite(candidate.height)) return { ...DEFAULT_LOADING_DIALOG_SIZE }
    return clampRelativeDialogSize(candidate as RelativeDialogSize)
  } catch { return { ...DEFAULT_LOADING_DIALOG_SIZE } }
}

export function clampRelativeDialogSize(size: RelativeDialogSize): RelativeDialogSize {
  return { width: Math.max(0.3, Math.min(0.95, size.width)), height: Math.max(0.3, Math.min(0.95, size.height)) }
}
