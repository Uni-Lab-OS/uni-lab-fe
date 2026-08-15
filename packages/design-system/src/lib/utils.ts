import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并组件的条件类名，并按 Tailwind 规则消解冲突。
 * @param inputs 组件默认类名、调用方覆盖类名及条件类名。
 * @returns 可以直接赋给 `className` 的稳定字符串。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
